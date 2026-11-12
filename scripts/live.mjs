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
// Options: --port N, --serve DIR (a built deck; leave out when `npm run dev` serves the page),
// --cdp URL, --app URL (send the deck's `go` addresses somewhere else, for a rehearsal),
// --files DIR (where downloads are kept and checks look for workbooks), --no-open (never start
// another program to open a file).
// It needs only Node and Playwright, so it can be copied next to any Playwright install.
import { execFile } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
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
const mayOpen = !args.includes('--no-open');
mkdirSync(filesDir, { recursive: true });

// Keep in step with COMMITS in src/scene.ts.
const COMMITS = /^(save|post|approve|submit|delete|send|remove|reject|confirm|apply|run|import|sync|void|reverse|pay|create|update|close the period|reopen)\b/i;

class Refused extends Error {}

// ---- the browser ------------------------------------------------------------------------------

let browser = null;
let page = null;
/** requests other than plain reads that the page made while the deck was acting, for the viewer to see */
let sent = [];

async function tab() {
  if (!browser?.isConnected()) {
    browser = await chromium.connectOverCDP(cdp, { timeout: 8000 });
    page = null;
  }
  if (!page || page.isClosed()) {
    page = await browser.contexts()[0].newPage();
    page.on('request', (request) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) sent.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
  }
  await page.bringToFront().catch(() => {});
  return page;
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
    return { label: label.trim().replace(/\s+/g, ' ').slice(0, 80), submits: pressed.type === 'submit' && Boolean(pressed.closest('form')) };
  });
  if (control.submits || COMMITS.test(control.label)) {
    throw new Refused(`"${control.label}" changes something, so the deck will not press it. That click is yours.`);
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
    await found.click({ timeout: 15000 });
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
    const found = await ring(action.download);
    await guard(found);
    await page.waitForTimeout(700);
    await clear();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 45000 }), found.click({ timeout: 15000 })]);
    const file = join(filesDir, action.as + (extname(action.as) ? '' : extname(download.suggestedFilename())));
    await download.saveAs(file);
    kept.set(action.as, file);
    return `Downloaded ${download.suggestedFilename()}`;
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

async function read(reading) {
  if ('value' in reading) return reading.value;
  if ('page' in reading) {
    // a control is read for what it is set to, not for every choice it offers
    const said = (await locate(reading.page).evaluate((el) => (el.tagName === 'SELECT' ? (el.selectedOptions[0]?.text ?? '') : el.tagName === 'INPUT' ? el.value : el.innerText), null, { timeout: 10000 })).trim();
    return reading.pick ? (new RegExp(reading.pick).exec(said)?.[1] ?? '') : said;
  }
  const wanted = new RegExp(`^${reading.sheet.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`);
  const sheets = workbook(fileFor(reading.file)).filter((sheet) => wanted.test(sheet.name));
  if (!sheets.length) throw new Error(`"${reading.file}" has no sheet called "${reading.sheet}"`);
  const rows = sheets.flatMap((sheet) => sheet.rows).filter((row) => Object.entries(reading.where ?? {}).every(([column, value]) => row[column] === value));
  const values = rows.map((row) => row[reading.column]).filter((value) => value !== undefined && value !== '');
  if (reading.take === 'first') return values[0] ?? '';
  if (reading.take === 'all') return [...new Set(values)].join(', ');
  return Math.round(values.reduce((sum, value) => sum + (Number(value) || 0), 0) * 100) / 100;
}

const shown = (value) => (typeof value === 'number' ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value));

async function check(item) {
  try {
    let got = await read(item.read);
    let want = await read(item.equals);
    // when either side is a number, both are read as figures
    if (typeof got === 'number' || typeof want === 'number') {
      got = figure(got);
      want = figure(want);
      if (got === null || want === null) return { label: item.label, ok: false, got: shown(got ?? 'no figure'), want: shown(want ?? 'no figure') };
      const [a, b] = item.abs ? [Math.abs(got), Math.abs(want)] : [got, want];
      return { label: item.label, ok: Math.abs(a - b) < 0.005, got: shown(got), want: shown(want) };
    }
    return { label: item.label, ok: String(got).trim().toLowerCase() === String(want).trim().toLowerCase(), got: shown(got), want: shown(want) };
  } catch (error) {
    return { label: item.label, ok: false, got: `could not read: ${error.message.split('\n')[0]}`, want: '' };
  }
}

// ---- what the player asks for -----------------------------------------------------------------

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
        if (!again) await ring(live.turn.point, `Your turn. ${live.turn.says}`, '#fbbf24');
        const reached = await until(live.turn.until, 20000);
        if (reached) await clear();
        return { ok: true, reached };
      } catch (error) {
        return { ok: false, why: error.message.split('\n')[0] };
      }
    }),
  check: ({ live }) =>
    inTurn(async () => {
      await tab();
      const results = [];
      for (const item of live.check ?? []) results.push(await check(item));
      return { ok: true, results };
    }),
  clear: () => inTurn(async () => ({ ok: true, cleared: Boolean(await clear()) })),
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
    let body = '';
    for await (const chunk of req) body += chunk;
    const answer = await routes[route](body ? JSON.parse(body) : {}).catch((error) => ({ ok: false, why: error.message.split('\n')[0] }));
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

server.listen(port, '127.0.0.1', () => {
  console.log(`wag live bridge on http://127.0.0.1:${port}${serve ? `, serving ${serve}` : ''}`);
  console.log(`Browser: ${cdp}${appOverride ? `, app sent to ${appOverride}` : ''}. Files: ${filesDir}. Ctrl+C stops it and closes its tab.`);
});

const stop = async () => {
  await clear();
  await page?.close().catch(() => {});
  await browser?.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
