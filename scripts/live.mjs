// The live bridge: lets a guided deck drive a real browser that is already open and signed in.
//
//   node scripts/live.mjs --serve dist --cdp http://127.0.0.1:9333
//
// It serves the built deck on --port (default 5180) and answers the player's Show me, My turn and
// Check buttons by talking to the browser over its debugging port (start the browser with
// --remote-debugging-port=9333). It opens one tab of its own and closes it when it stops.
//
// The rule it enforces whatever a deck asks for: it never presses a control whose label says it
// saves, posts, approves, submits, deletes or sends. Those are refused, and the deck can only ring
// them and wait for the viewer's own click (My turn).
//
// With --stdio it listens on nothing at all: it reads one request per line on its input
// ({"id":1,"route":"cmd","body":{...}}) and writes one answer per line, so only the program that
// started it can use it. That is how a live session on another machine reaches it, over ssh.
//
// Options: --port N, --serve DIR (a built deck; leave out when `npm run dev` serves the page),
// --cdp URL, --app URL (send the deck's `go` addresses somewhere else, for a rehearsal),
// --files DIR (where downloads are kept and checks look for workbooks), --no-open (never start
// another program to open a file).
// It needs only Node and Playwright, so it can be copied next to any Playwright install.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const { chromium } = await import('playwright-core').catch(() => import('playwright'));

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const port = Number(option('port', 5180));
const cdp = option('cdp', 'http://127.0.0.1:9333');
const serve = option('serve') ? resolve(option('serve')) : null;
const appOverride = option('app')?.replace(/\/$/, '');
const filesDir = resolve(option('files', join(tmpdir(), 'wag-live')));
// where a download made by the viewer's own click is put: their Downloads folder in a real session, a lane folder while building
const downloadsDir = resolve(option('downloads', filesDir));
const mayOpen = !args.includes('--no-open');
// requests a look is allowed to cause besides plain reads, as path prefixes, for an app that reads with POST
const readsWithPost = (option('reads', '') || '').split(',').filter(Boolean);
const isLocal = (address) => ['127.0.0.1', 'localhost'].includes(new URL(address).hostname);
mkdirSync(filesDir, { recursive: true });
mkdirSync(downloadsDir, { recursive: true });
// --live: a session the viewer started. The guide drives the one tab they are looking at, and every download is their own click.
const liveSession = args.includes('--live');
const overStdio = args.includes('--stdio');

// A new key at every start, written where only the session that launched the bridge reads it. Every
// request has to carry it, so no other program on this machine can use the bridge.
const token = randomBytes(24).toString('hex');
const tokenFile = resolve(option('token', join(filesDir, 'bridge.token')));
writeFileSync(tokenFile, token, { mode: 0o600 });

// every command and every refusal, one line each
const logFile = resolve(option('log', join(filesDir, 'bridge.log')));
const record = (entry) => appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);

// Keep in step with COMMITS in src/scene.ts.
const COMMITS = /^(save|post|approve|submit|delete|send|remove|reject|confirm|apply|run|import|sync|void|reverse|pay|create|update|mark|undo|close the period|reopen)\b/i;

// What a button in a dialog may say for the guide to press it: it only shows, hides, reads again or downloads.
const LOOKS = /^(close|x|×|cancel|back|next|previous|show|hide|expand|collapse|how to fix|how it is measured|refresh|open|view|details?|more|less|sort|filter|full detail|download|correcting entry|split by source)\b/i;

class Refused extends Error {}

// ---- the browser ------------------------------------------------------------------------------

let browser = null;
let page = null;
/** requests other than plain reads that the page made while the deck was acting, for the viewer to see */
let sent = [];

/** closing the tab on the way out is only right for a tab the bridge opened for itself */
let ownsTab = true;

/** The tab the viewer is looking at: the one that is showing, preferring one already on the app. */
async function visibleTab() {
  const showing = [];
  for (const candidate of browser.contexts()[0].pages()) {
    const state = await candidate.evaluate(() => ({ visible: document.visibilityState === 'visible', focused: document.hasFocus() })).catch(() => null);
    if (state?.visible) showing.push({ candidate, focused: state.focused });
  }
  const host = appOverride ? new URL(appOverride).host : null;
  return (showing.find((s) => host && s.candidate.url().includes(host)) ?? showing.find((s) => s.focused) ?? showing[0])?.candidate ?? null;
}

/** A tab of the bridge's own, opened behind whatever the person at that browser is looking at. */
async function quietTab() {
  const context = browser.contexts()[0];
  try {
    const session = await browser.newBrowserCDPSession();
    const arriving = context.waitForEvent('page', { timeout: 8000 });
    await session.send('Target.createTarget', { url: 'about:blank', background: true });
    return await arriving;
  } catch {
    return context.newPage();
  }
}

/**
 * A browser with a window belongs to whoever sits at it. Only a session that person started may
 * drive it; building, testing and recording need a browser with no window. Checked before every
 * connection, here in the bridge rather than in anyone's instructions.
 */
async function mayUse() {
  const version = await fetch(`${cdp}/json/version`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
  const hidden = /Headless/i.test(version['User-Agent'] ?? '');
  if (!hidden && !liveSession) {
    throw new Refused('That browser has a window, so it is someone\'s. The bridge only drives a windowless browser unless the person at it started a live session (--live).');
  }
}

async function tab() {
  if (!browser?.isConnected()) {
    await mayUse();
    browser = await chromium.connectOverCDP(cdp, { timeout: 8000 });
    page = null;
    // any download the browser itself makes goes to this folder under its own name, never to the person's list of downloads
    if (!liveSession) {
      const session = await browser.newBrowserCDPSession();
      await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: filesDir, eventsEnabled: true }).catch(() => {});
      // the browser names each file by a random id; give it back its own name when it is complete
      const names = new Map();
      session.on('Browser.downloadWillBegin', (event) => names.set(event.guid, event.suggestedFilename));
      session.on('Browser.downloadProgress', (event) => {
        if (event.state !== 'completed' || !names.has(event.guid)) return;
        const name = names.get(event.guid);
        const file = join(filesDir, name);
        try {
          renameSync(join(filesDir, event.guid), file);
        } catch {
          return;
        }
        lastDownload = { name, file, at: Date.now() };
        kept.set(name, file);
        if (wanted?.as) kept.set(wanted.as, file);
      });
    }
  }
  if (!page || page.isClosed()) {
    page = (liveSession && (await visibleTab())) || (await quietTab());
    ownsTab = !liveSession;
    page.on('request', (request) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) sent.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    // what the viewer does with their own mouse, so a guide can carry on from where they went
    await page.addInitScript(watchInPage);
    await page.evaluate(watchInPage).catch(() => {});
    page.on('download', (download) => void keepDownload(download));
  }
  // only a session the viewer started may put its tab in front of them
  if (liveSession) await page.bringToFront().catch(() => {});
  return page;
}

/** Runs in the page: remembers the viewer's last few real clicks. */
function watchInPage() {
  if (window.__wagSeen) return;
  window.__wagSeen = [];
  addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted || window.__wagActing) return;
      const el = event.target instanceof Element ? (event.target.closest('button, a, [role], tr, label') ?? event.target) : null;
      if (!el) return;
      window.__wagSeen.push({ what: (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 90), at: Date.now() });
      window.__wagSeen = window.__wagSeen.slice(-5);
    },
    true
  );
}

/** Every download in the guide's tab is kept, whoever clicked: by the name the guide asked for, or the file's own. */
let wanted = null;
let lastDownload = null;
async function keepDownload(download) {
  const name = wanted?.as ? wanted.as + extname(download.suggestedFilename()) : download.suggestedFilename();
  const file = join(wanted?.dir ?? downloadsDir, name);
  await download.saveAs(file).catch(() => {});
  lastDownload = { name: download.suggestedFilename(), file, at: Date.now() };
  if (wanted?.as) kept.set(wanted.as, file);
  kept.set(download.suggestedFilename(), file);
}

/**
 * While the guide itself clicks, the page may only read. Anything else it tries to send is
 * stopped here and reported, so on a real system a guide's click cannot change anything even
 * if the control was mislabelled. Pages on this machine (practice pages) are left alone.
 */
async function lookOnly(work) {
  if (isLocal(page.url())) return work();
  const stopped = [];
  const gate = (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || readsWithPost.some((prefix) => path.startsWith(prefix))) return route.continue();
    stopped.push(`${request.method()} ${path}`);
    return route.abort();
  };
  await page.route('**/*', gate);
  try {
    await page.evaluate(() => (window.__wagActing = true)).catch(() => {});
    const result = await work();
    await page.waitForTimeout(1200);
    if (stopped.length) throw new Refused(`That click tried to send ${stopped.join(', ')}, which is more than a look, so it was stopped. That step is yours.`);
    return result;
  } finally {
    await page.evaluate(() => (window.__wagActing = false)).catch(() => {});
    await page.unroute('**/*', gate).catch(() => {});
  }
}

function locate(target) {
  const t = typeof target === 'string' ? { text: target } : target;
  // only what can be seen counts: an app may keep a closed dialog or an unused tab in the page
  const root = t.within ? page.locator(t.within === 'dialog' ? '[role="dialog"]' : t.within).locator('visible=true').last() : page;
  const found = t.css
    ? root.locator(t.css)
    : t.role
      ? root.getByRole(t.role, t.name ? { name: t.name, exact: t.exact ?? false } : {})
      : root.getByText(t.text ?? t.name ?? '', { exact: t.exact ?? false });
  const seen = found.locator('visible=true');
  return t.last ? seen.last() : seen.first();
}

const words = (target) => (typeof target === 'string' ? target : (target.name ?? target.text ?? target.css ?? 'that'));

/** Refuse to press anything that changes something. Looks at the real control, not at what the deck called it. */
async function guard(found) {
  const control = await found.evaluate((el) => {
    const pressed = el.closest('button, [role="button"], [role="menuitem"], input[type="submit"], input[type="button"], a') ?? el;
    const label = pressed.getAttribute('aria-label') || pressed.innerText || pressed.value || '';
    return {
      label: label.trim().replace(/\s+/g, ' ').slice(0, 80),
      submits: pressed.type === 'submit' && Boolean(pressed.closest('form')),
      button: pressed !== el || el.matches('button, [role="button"], input') ? pressed.matches('button, [role="button"], [role="menuitem"], input') : false,
      inDialog: Boolean(pressed.closest('[role="dialog"], dialog')),
      // a control that only opens and shuts part of the page, or switches a view
      opens: pressed.hasAttribute('aria-expanded') || ['tab', 'combobox', 'option'].includes(pressed.getAttribute('role') ?? ''),
    };
  });
  if (control.submits || COMMITS.test(control.label)) {
    throw new Refused(`"${control.label}" changes something, so the guide will not press it. That click is yours.`);
  }
  // inside a dialog, a button has to be one the guide knows only looks. Anything else is not pressed, and the reason is given.
  if (control.inDialog && control.button && !control.opens && !LOOKS.test(control.label)) {
    throw new Refused(`The guide cannot tell what "${control.label || 'that button'}" does, so it will not press it. That click is yours.`);
  }
}

/** Runs in the page: a ring that follows an element, with a line of words under or over it. */
function ringInPage(el, [note, tone]) {
  window.__wagClear?.();
  // a modal <dialog> is drawn over everything outside it, so a ring for something inside one has to live inside it too
  const host = el.closest('dialog:modal') ?? document.documentElement;
  const make = (css) => {
    const node = document.createElement('div');
    node.style.cssText = css;
    host.append(node);
    return node;
  };
  const ring = make(`position:fixed;border:3px solid ${tone};border-radius:10px;box-shadow:0 0 0 9999px rgba(15,23,42,.38);pointer-events:none;z-index:2147483646`);
  const words = make(`position:fixed;max-width:min(560px,80vw);background:#0f172a;color:#f8fafc;border-left:5px solid ${tone};border-radius:10px;padding:12px 16px;font:500 16px/1.4 "Segoe UI",system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.45);pointer-events:none;z-index:2147483647`);
  words.textContent = note || '';
  if (!note) words.style.display = 'none';
  let live = true;
  const place = () => {
    if (!live) return;
    if (!el.isConnected) return window.__wagClear();
    const r = el.getBoundingClientRect();
    Object.assign(ring.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    const below = r.bottom + 14 + words.offsetHeight < innerHeight;
    words.style.left = `${Math.max(8, Math.min(r.left, innerWidth - words.offsetWidth - 8))}px`;
    words.style.top = below ? `${r.bottom + 14}px` : `${Math.max(8, r.top - 14 - words.offsetHeight)}px`;
    requestAnimationFrame(place);
  };
  window.__wagClear = () => {
    live = false;
    ring.remove();
    words.remove();
    window.__wagClear = undefined;
  };
  place();
}

async function ring(target, note, tone = '#38bdf8') {
  const found = locate(target);
  await found.waitFor({ state: 'visible', timeout: 15000 });
  await found.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await found.evaluate(ringInPage, [note ?? '', tone]);
  return found;
}

const clear = () => page?.evaluate(() => window.__wagClear?.()).catch(() => {});

async function holds(expect) {
  if (expect.url && !page.url().includes(expect.url)) return false;
  if (expect.see && !(await locate(expect.see).isVisible().catch(() => false))) return false;
  if (expect.gone && (await locate(expect.gone).isVisible().catch(() => false))) return false;
  if (expect.file) {
    // a file whose name fits, downloaded since this wait began
    const fits = new RegExp(`^${expect.file.like.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`, 'i');
    if (!lastDownload || lastDownload.at < (expect.since ?? 0) || !fits.test(lastDownload.name)) return false;
    kept.set(expect.file.as, lastDownload.file);
  }
  return true;
}

async function until(expect, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await holds(expect)) return true;
    await page.waitForTimeout(300);
  }
  return holds(expect);
}

/** downloads kept this session, by the name the deck gave them */
const kept = new Map();

async function act(action, base) {
  if ('go' in action) {
    const to = /^https?:/.test(action.go) ? action.go : `${appOverride ?? base ?? ''}${action.go}`;
    await clear();
    if (page.url() !== to) await page.goto(to, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    return `Opened ${new URL(to).pathname}${new URL(to).search}`;
  }
  if ('point' in action) {
    await ring(action.point, action.note);
    return `Pointed at ${words(action.point)}`;
  }
  if ('click' in action) {
    const found = await ring(action.click);
    await guard(found);
    await page.waitForTimeout(700);
    await clear();
    await lookOnly(() => found.click({ timeout: 15000 }));
    return `Clicked ${words(action.click)}`;
  }
  if ('choose' in action) {
    const found = await ring(action.from);
    await guard(found);
    await page.waitForTimeout(500);
    await clear();
    if ((await found.evaluate((el) => el.tagName)) === 'SELECT') await found.selectOption({ label: action.choose });
    else {
      await found.click({ timeout: 15000 });
      const pick = page.getByRole('option', { name: action.choose }).or(page.getByRole('menuitem', { name: action.choose })).first();
      await pick.click({ timeout: 15000 });
    }
    return `Chose ${action.choose}`;
  }
  if ('download' in action) {
    if (liveSession) throw new Refused('In a live session a download is your own click, so the file lands in your Downloads. The guide rings the button and waits.');
    const found = await ring(action.download);
    await guard(found);
    await page.waitForTimeout(700);
    await clear();
    wanted = { as: action.as, dir: filesDir };
    try {
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 45000 }), found.click({ timeout: 15000 })]);
      const until = Date.now() + 15000;
      while (!kept.has(action.as) && Date.now() < until) await page.waitForTimeout(200);
      return `Downloaded ${download.suggestedFilename()}`;
    } finally {
      wanted = null;
    }
  }
  if ('open' in action) {
    const file = fileFor(action.open);
    if (!mayOpen) return `Would open ${file}`;
    if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', file]);
    else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [file]);
    return `Opened ${action.open}`;
  }
  if ('press' in action) {
    await page.keyboard.press('Escape');
    return 'Closed it';
  }
  if ('wait' in action) {
    if (!(await until(action.wait, 20000))) throw new Error('The page did not get to the expected state');
    return 'The page is ready';
  }
  throw new Error(`Unknown action ${JSON.stringify(action)}`);
}

// ---- workbooks --------------------------------------------------------------------------------

function fileFor(name) {
  const file = kept.get(name) ?? [name, `${name}.xlsx`].map((n) => join(filesDir, n)).find(existsSync);
  if (!file) throw new Error(`There is no file called "${name}" yet. Download it first.`);
  return file;
}

/** The files inside a zip, which is what an .xlsx is. */
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = buf.readUInt32LE(end + 16);
  const out = new Map();
  for (let i = buf.readUInt16LE(end + 10); i > 0; i--) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const lengths = [buf.readUInt16LE(at + 28), buf.readUInt16LE(at + 30), buf.readUInt16LE(at + 32)];
    const local = buf.readUInt32LE(at + 42);
    const from = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(from, from + size);
    out.set(buf.toString('utf8', at + 46, at + 46 + lengths[0]), method === 0 ? data : inflateRawSync(data));
    at += 46 + lengths[0] + lengths[1] + lengths[2];
  }
  return out;
}

const plain = (xml) => xml.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Every sheet of a workbook as rows keyed by the first row's headings. Rows holding a formula (totals) are left out. */
function workbook(file) {
  const parts = unzip(readFileSync(file));
  const text = (name) => parts.get(name)?.toString('utf8') ?? '';
  const strings = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => plain(m[1]));
  const targets = new Map([...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  const sheets = [];
  for (const m of text('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = plain(/name="([^"]*)"/.exec(m[0])[1]);
    const target = targets.get(/r:id="([^"]+)"/.exec(m[0])?.[1]) ?? '';
    const xml = text(`xl/${target.replace(/^\/?xl\//, '')}`);
    let headings = null;
    const rows = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = {};
      let formula = false;
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const column = /r="([A-Z]+)\d+"/.exec(c[1])?.[1];
        const body = c[2] ?? '';
        if (body.includes('<f')) formula = true;
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const kind = /t="(\w+)"/.exec(c[1])?.[1];
        const value = v === undefined ? plain(body) : kind === 's' ? strings[Number(v)] : plain(v);
        if (column && value !== '') cells[column] = value;
      }
      if (!headings) headings = cells;
      else if (!formula) rows.push(Object.fromEntries(Object.entries(headings).map(([column, heading]) => [heading, cells[column] ?? ''])));
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

// ---- checks -----------------------------------------------------------------------------------

/** The first figure in a piece of text: "USD -1,234.50" is -1234.5, "(1,200.00)" is -1200. */
function figure(value) {
  if (typeof value === 'number') return value;
  const m = /(\(|[-−])?\s*(\d[\d,]*(?:\.\d+)?)(\))?/.exec(String(value));
  if (!m) return null;
  const n = Number(m[2].replaceAll(',', ''));
  return m[1] ? -n : n;
}

async function read(reading, onlySheet) {
  if ('value' in reading) return reading.value;
  if ('add' in reading) {
    let total = 0;
    for (const part of reading.add) total += figure(await read(part, onlySheet)) ?? NaN;
    for (const part of reading.minus ?? []) total -= figure(await read(part, onlySheet)) ?? NaN;
    if (Number.isNaN(total)) throw new Error('one of the figures to add could not be read');
    return Math.round(total * 100) / 100;
  }
  if ('page' in reading) {
    // a control is read for what it is set to, not for every choice it offers
    const said = (await locate(reading.page).evaluate((el) => (el.tagName === 'SELECT' ? (el.selectedOptions[0]?.text ?? '') : el.tagName === 'INPUT' ? el.value : el.innerText), null, { timeout: 10000 })).trim();
    return reading.pick ? (new RegExp(reading.pick).exec(said)?.[1] ?? '') : said;
  }
  const wanted = new RegExp(`^${reading.sheet.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`);
  const sheets = workbook(fileFor(reading.file)).filter((sheet) => wanted.test(sheet.name) && (!onlySheet || sheet.name === onlySheet));
  if (!sheets.length) throw new Error(`"${reading.file}" has no sheet called "${onlySheet ?? reading.sheet}"`);
  const keep = (row) => Object.entries(reading.where ?? {}).every(([column, value]) => row[column] === value);
  if (reading.take === 'moved') {
    // pairs are counted within a sheet, so a sheet's own first line starts its first pair
    let cents = 0;
    for (const sheet of sheets) {
      sheet.rows.forEach((row, i) => {
        if (i % 2 === 0 && keep(row)) cents += Math.round(((Number(row.CR) || 0) - (Number(row.DR) || 0)) * 100);
      });
    }
    return cents / 100;
  }
  const rows = sheets.flatMap((sheet) => sheet.rows).filter(keep);
  if (reading.take === 'count') return rows.length;
  const values = rows.map((row) => row[reading.column]).filter((value) => value !== undefined && value !== '');
  if (reading.take === 'first') return values[0] ?? '';
  if (reading.take === 'all') return [...new Set(values)].join(', ');
  return Math.round(values.reduce((sum, value) => sum + (Number(value) || 0), 0) * 100) / 100;
}

const shown = (value) => (typeof value === 'number' ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value));

/** Sheet names a file reading matches, for a check made once per sheet. */
function sheetsOf(reading) {
  const wanted = new RegExp(`^${reading.sheet.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`);
  return workbook(fileFor(reading.file)).map((sheet) => sheet.name).filter((name) => wanted.test(name));
}

async function check(item) {
  if (item.each && 'file' in item.read) {
    let names;
    try {
      names = sheetsOf(item.read);
    } catch (error) {
      return [{ label: item.label, ok: false, got: `could not read: ${error.message.split('\n')[0]}`, want: '' }];
    }
    const out = [];
    for (const name of names) out.push(...(await check({ ...item, each: false, label: `${item.label}, ${name}`, sheet: name })));
    return out.length ? out : [{ label: item.label, ok: false, got: 'no sheet matched', want: '' }];
  }
  try {
    let got = await read(item.read, item.sheet);
    let want = await read(item.equals, 'file' in item.equals ? item.sheet : undefined);
    // when either side is a number, both are read as figures
    if (typeof got === 'number' || typeof want === 'number') {
      got = figure(got);
      want = figure(want);
      if (got === null || want === null) return [{ label: item.label, ok: false, got: shown(got ?? 'no figure'), want: shown(want ?? 'no figure') }];
      const [a, b] = item.abs ? [Math.abs(got), Math.abs(want)] : [got, want];
      // a count reads as a count, not as money
      const counting = [item.read, item.equals].some((r) => r.take === 'count');
      const say = (n) => (counting ? n.toLocaleString('en-US') : shown(n));
      return [{ label: item.label, ok: Math.abs(a - b) < 0.005, got: say(got), want: say(want) }];
    }
    return [{ label: item.label, ok: String(got).trim().toLowerCase() === String(want).trim().toLowerCase(), got: shown(got), want: shown(want) }];
  } catch (error) {
    return [{ label: item.label, ok: false, got: `could not read: ${error.message.split('\n')[0]}`, want: '' }];
  }
}

// ---- what the player asks for -----------------------------------------------------------------

let turnBegan = 0;

// ---- small commands, for a live session ---------------------------------------------------------

const brief = (text, most = 1500) => {
  const tidy = text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  return tidy.length > most ? `${tidy.slice(0, most)} … (${tidy.length - most} more characters)` : tidy;
};

/** Where the page is now and what the viewer last did with their own mouse. */
async function whereNow() {
  const seen = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"], dialog[open]')].filter((d) => d.getClientRects().length).at(-1);
    const out = {
      title: document.title,
      dialog: dialog ? (dialog.getAttribute('aria-label') || dialog.querySelector('h1,h2,h3,b')?.textContent || 'a dialog').trim().slice(0, 120) : null,
      scrolled: Math.round(scrollY),
      viewerClicks: (window.__wagSeen ?? []).map((c) => `${c.what} (${Math.round((Date.now() - c.at) / 1000)} s ago)`),
      pointing: Boolean(window.__wagClear),
    };
    window.__wagSeen = [];
    return out;
  });
  return { address: page.url(), ...seen, lastDownload: lastDownload ? { name: lastDownload.name, secondsAgo: Math.round((Date.now() - lastDownload.at) / 1000) } : null };
}

const commands = {
  where: () => whereNow(),
  async goto({ to, app }) {
    return { did: await act({ go: to }, app), ...(await whereNow()) };
  },
  /** What on the page fits these words: up to `most` things, each with what it is and what it says. */
  async find({ text, most = 8 }) {
    const found = page.getByText(text, { exact: false }).locator('visible=true');
    const count = await found.count();
    const hits = [];
    for (let i = 0; i < Math.min(count, most); i++) {
      hits.push(await found.nth(i).evaluate((el) => {
        const control = el.closest('button, a, [role="button"], [role="tab"], [role="combobox"], tr, th, td, h1, h2, h3, label');
        const box = el.getBoundingClientRect();
        return { says: el.innerText.trim().replace(/\s+/g, ' ').slice(0, 110), is: (control?.getAttribute('role') || control?.tagName || el.tagName).toLowerCase(), onScreen: box.top >= 0 && box.bottom <= innerHeight, inDialog: Boolean(el.closest('[role="dialog"], dialog')) };
      }));
    }
    return { count, hits };
  },
  async read({ target, most }) {
    // with no target: the open dialog if there is one, since that is what the viewer is looking at; otherwise the page
    const dialog = page.locator('[role="dialog"], dialog[open]').locator('visible=true').last();
    const found = target ? locate(target) : (await dialog.count()) ? dialog : page.locator('main').first();
    return { text: brief(await found.innerText({ timeout: 10000 }), most) };
  },
  async highlight({ target, note }) {
    return { did: await act({ point: target, note }) };
  },
  async scroll({ target, by }) {
    if (target) await locate(target).evaluate((el) => el.scrollIntoView({ block: 'center' }));
    else await page.mouse.wheel(0, by ?? 600);
    return { did: 'Scrolled', scrolled: await page.evaluate(() => Math.round(scrollY)) };
  },
  async click({ target }) {
    return { did: await act({ click: target }), ...(await whereNow()) };
  },
  async choose({ option, from }) {
    return { did: await act({ choose: option, from }), ...(await whereNow()) };
  },
  async close() {
    return { did: await act({ press: 'Escape' }) };
  },
  async download({ target, as }) {
    return { did: await act({ download: target, as }), file: kept.get(as) };
  },
  async check({ items }) {
    const results = [];
    for (const item of items) results.push(...(await check(item)));
    return { results };
  },
  /**
   * For building only: press a download button and keep the file without the browser ever
   * starting a download, so nothing shows on the screen of whoever sits at that browser. Apps
   * hand a file over by making a blob and clicking a link to it; this catches the blob as it is
   * made and stops that one click, inside the page.
   */
  async capture({ target, as }) {
    if (liveSession) throw new Refused('In a live session a download is your own click.');
    const found = await ring(target);
    await guard(found);
    await clear();
    const before = lastDownload?.at ?? 0;
    await page.evaluate(() => {
      if (window.__wagCatch) {
        window.__wagCatch.on = true;
        window.__wagCatch.got = null;
        return;
      }
      const state = (window.__wagCatch = { on: true, got: null, blobs: new Map() });
      const make = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (thing) => {
        const address = make(thing);
        if (state.on && thing instanceof Blob) state.blobs.set(address, thing);
        return address;
      };
      const caught = (a) => {
        if (!state.on || !a.hasAttribute('download') || !state.blobs.has(a.href)) return false;
        state.got = { name: a.download, blob: state.blobs.get(a.href) };
        return true;
      };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (!caught(this)) click.call(this);
      };
      const dispatch = HTMLAnchorElement.prototype.dispatchEvent;
      HTMLAnchorElement.prototype.dispatchEvent = function (event) {
        return event.type === 'click' && caught(this) ? true : dispatch.call(this, event);
      };
      document.addEventListener(
        'click',
        (event) => {
          const a = event.target instanceof Element ? event.target.closest('a[download]') : null;
          if (a && caught(a)) event.preventDefault();
        },
        true
      );
    });
    try {
      await found.click({ timeout: 15000 });
      const end = Date.now() + 90000;
      while (Date.now() < end && !(await page.evaluate(() => Boolean(window.__wagCatch.got)))) {
        if ((lastDownload?.at ?? 0) > before) throw new Error(`The browser downloaded ${lastDownload.name} itself; it was kept, but it was not caught quietly`);
        await page.waitForTimeout(300);
      }
      const got = await page.evaluate(async () => {
        if (!window.__wagCatch.got) return null;
        const { name, blob } = window.__wagCatch.got;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let text = '';
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return { name, data: btoa(text) };
      });
      if (!got) throw new Error('No file came back from that button');
      const file = join(filesDir, `${as}__${got.name}`);
      writeFileSync(file, Buffer.from(got.data, 'base64'));
      kept.set(as, file);
      kept.set(got.name, file);
      // while building, this stands in for the person's own click on a My turn that waits for a file
      lastDownload = { name: got.name, file, at: Date.now() };
      return { did: `Kept ${got.name}`, file, name: got.name };
    } finally {
      await page.evaluate(() => (window.__wagCatch.on = false)).catch(() => {});
    }
  },
  async screenshot({ as = `shot-${Date.now()}` }) {
    const file = join(filesDir, `${as}.png`);
    await page.screenshot({ path: file });
    return { file };
  },
  /** the tab as a small picture, for a console that mirrors it or a recording */
  async frame() {
    return { jpeg: (await page.screenshot({ type: 'jpeg', quality: 55 })).toString('base64') };
  },
  async clear() {
    await clear();
    return { did: 'Cleared' };
  },
};

/** one request at a time: two buttons pressed together must not drive the page at once */
let line = Promise.resolve();
const inTurn = (work) => (line = line.then(work, work));

const routes = {
  async status() {
    const up = await fetch(`${cdp}/json/version`, { signal: AbortSignal.timeout(2500) }).then((r) => r.ok, () => false);
    return { ok: true, browser: up, app: appOverride ?? null };
  },
  show: ({ live, app }) =>
    inTurn(async () => {
      await tab();
      sent = [];
      const done = [];
      try {
        for (const action of live.show ?? []) done.push(await act(action, app));
        return { ok: true, done, sent };
      } catch (error) {
        return { ok: false, done, refused: error instanceof Refused, why: error.message.split('\n')[0], sent };
      }
    }),
  turn: ({ live, app, again }) =>
    inTurn(async () => {
      await tab();
      try {
        // the ring goes up once; asking again only keeps waiting
        if (!again) {
          await ring(live.turn.point, `Your turn. ${live.turn.says}`, '#fbbf24');
          turnBegan = Date.now();
        }
        const reached = await until({ ...live.turn.until, since: turnBegan }, 20000);
        if (reached) await clear();
        return { ok: true, reached };
      } catch (error) {
        return { ok: false, why: error.message.split('\n')[0] };
      }
    }),
  /**
   * The recorded run: plays a step's `demo` (or its `show`) with no refusals, which is only safe
   * because it refuses to start anywhere but a made-up copy served from this machine.
   */
  demo: ({ live, app }) =>
    inTurn(async () => {
      await tab();
      const done = [];
      try {
        for (const action of live.demo ?? live.show ?? []) {
          const to = 'go' in action ? (/^https?:/.test(action.go) ? action.go : `${appOverride ?? app ?? ''}${action.go}`) : page.url();
          if (!isLocal(to)) throw new Refused('A recorded run only plays on a made-up copy on this machine, never on a real system.');
          if ('click' in action) {
            await (await ring(action.click)).click({ timeout: 15000 });
            await clear();
            done.push(`Clicked ${words(action.click)}`);
          } else done.push(await act(action, app));
        }
        return { ok: true, done };
      } catch (error) {
        return { ok: false, done, refused: error instanceof Refused, why: error.message.split('\n')[0] };
      }
    }),
  check: ({ live }) =>
    inTurn(async () => {
      await tab();
      const results = [];
      for (const item of live.check ?? []) results.push(...(await check(item)));
      return { ok: true, results };
    }),
  clear: () => inTurn(async () => ({ ok: true, cleared: Boolean(await clear()) })),
  /** One small command from a live session: { cmd: 'highlight', target: ..., note: ... }. Answers in about a second. */
  cmd: ({ cmd, ...rest }) =>
    inTurn(async () => {
      const began = Date.now();
      if (!commands[cmd]) return { ok: false, why: `Unknown command "${cmd}". Known: ${Object.keys(commands).join(', ')}` };
      try {
        await tab();
        const answer = await commands[cmd](rest);
        return { ok: true, ...answer, ms: Date.now() - began };
      } catch (error) {
        return { ok: false, refused: error instanceof Refused, why: error.message.split('\n')[0], ms: Date.now() - began };
      }
    }),
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const route = /^\/live\/(\w+)$/.exec(url.pathname)?.[1];
  if (route && routes[route]) {
    // only a page on this machine may ask: a web site somewhere else must not be able to drive the browser
    const origin = req.headers.origin;
    if (origin && !['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) {
      res.writeHead(403);
      return res.end();
    }
    if (req.headers['x-wag-key'] !== token) {
      record({ route, refused: 'no key' });
      res.writeHead(401);
      return res.end();
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const answer = await answerTo(route, body ? JSON.parse(body) : {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(answer));
  }
  if (!serve) {
    res.writeHead(404);
    return res.end();
  }
  const file = join(serve, normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
  if (!file.startsWith(serve) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    return res.end();
  }
  // a practice page can stand at an address with no extension, the way an app's pages do
  res.writeHead(200, { 'Content-Type': extname(file) ? (TYPES[extname(file)] ?? 'application/octet-stream') : 'text/html' });
  createReadStream(file).pipe(res);
});

/** One request, answered and written to the log, however it arrived. */
async function answerTo(route, asked) {
  const answer = await routes[route](asked).catch((error) => ({ ok: false, why: error.message.split('\n')[0] }));
  if (route !== 'status' && asked.cmd !== 'frame') record({ route, asked: route === 'cmd' ? asked : { steps: (asked.live?.show ?? []).length || undefined, turn: asked.live?.turn?.says, checks: (asked.live?.check ?? []).length || undefined }, ok: answer.ok, refused: answer.refused || undefined, why: answer.why, done: answer.done ?? answer.did, sent: answer.sent?.length ? answer.sent : undefined, ms: answer.ms });
  return answer;
}

if (overStdio) {
  record({ started: true, live: liveSession, stdio: true, cdp, app: appOverride ?? null });
  console.error(`wag live bridge on its own input and output. Browser: ${cdp}. Files: ${filesDir}. Log: ${logFile}.`);
  console.log(JSON.stringify({ ready: true }));
  createInterface({ input: process.stdin }).on('line', async (line) => {
    let asked;
    try {
      asked = JSON.parse(line);
    } catch {
      return;
    }
    const answer = routes[asked.route] ? await answerTo(asked.route, asked.body ?? {}) : { ok: false, why: `Unknown route "${asked.route}"` };
    console.log(JSON.stringify({ id: asked.id, answer }));
  });
  // whoever started it has gone: stop, and tidy the page
  process.stdin.on('end', () => void stop());
} else {
  server.listen(port, '127.0.0.1', () => {
    console.log(`wag live bridge on http://127.0.0.1:${port}${serve ? `, serving ${serve}` : ''}`);
    console.log(`Browser: ${cdp}${appOverride ? `, app sent to ${appOverride}` : ''}. Files: ${filesDir}. Key: ${tokenFile}. Log: ${logFile}.`);
    console.log(liveSession ? 'Live session: driving the tab that is showing; downloads are the viewer\'s own click. Ctrl+C stops it and leaves the tab open.' : 'Ctrl+C stops it and closes its tab.');
    record({ started: true, live: liveSession, cdp, app: appOverride ?? null });
  });
}

async function stop() {
  await clear();
  if (ownsTab) await page?.close().catch(() => {});
  await browser?.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
