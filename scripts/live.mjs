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
// another program to open a file), --reads "/path,/path" (addresses your app reads from with a POST),
// and your app's own words, each as "words,words": --changes (what else a control says when it
// changes something: never pressed), --looks (what else a dialog button says when it only looks),
// --files-on (what else a button says when it hands over a file: in a live session never pressed).
// A session pack (see bin/wag.mjs) carries all of these for an app, so they need not be typed.
// It needs only Node and Playwright, so it can be copied next to any Playwright install.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
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
// The owner's own go to use a browser that has a window, for building: written to the log with the bridge's start.
const ownerGo = option('owner-go');
/** set when the bridge connects: whether the browser has a window */
let windowed = false;

// A new key at every start, written where only the session that launched the bridge reads it. Every
// request has to carry it, so no other program on this machine can use the bridge.
const token = randomBytes(24).toString('hex');
const tokenFile = resolve(option('token', join(filesDir, 'bridge.token')));
writeFileSync(tokenFile, token, { mode: 0o600 });

// every command and every refusal, one line each
const logFile = resolve(option('log', join(filesDir, 'bridge.log')));
const record = (entry) => appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);

// What a control says when it changes something. Keep in step with COMMITS in src/scene.ts.
const COMMITS = /^(save|post|approve|submit|delete|send|remove|reject|confirm|apply|run|import|sync|void|reverse|pay|create|update|mark|undo|reopen)\b/i;

// What a button in a dialog may say for the guide to press it: it only shows, hides, reads again or
// downloads. The short words are trusted only alone: "Close" shuts a dialog, "Close the books" does not.
const LOOKS = /^(show|hide|expand|collapse|refresh|open|view|details?|more|less|sort|filter|download)\b/i;
const LOOKS_ALONE = /^(close( (the )?(dialog|window|panel|menu))?|x|\u00d7|cancel|back|next|previous)$/i;

// An app's own words, given when the bridge starts (a session pack carries them): --changes for a
// control that changes something, --looks for a dialog button that only looks, and --files-on for a
// button that hands over a file, which in a live session is the viewer's own click.
const listed = (list) => (list || '').split(',').map((word) => word.trim().toLowerCase()).filter(Boolean);
const filesOn = listed(option('files-on'));
const looksToo = listed(option('looks'));
const changesToo = listed(option('changes'));
const starts = (label, words) => words.some((word) => label.toLowerCase().startsWith(word));
const changes = (label) => COMMITS.test(label) || starts(label, changesToo);
const onlyLooks = (label) => LOOKS.test(label) || LOOKS_ALONE.test(label.trim()) || starts(label, looksToo);
const DOWNLOADS = /\b(download|export|excel|xlsx|csv|pdf)\b/i;
const handsOver = (label) => DOWNLOADS.test(label) || filesOn.some((word) => label.toLowerCase().includes(word));

class Refused extends Error {}

// ---- the browser ------------------------------------------------------------------------------

let browser = null;
let page = null;
/** requests other than plain reads that the page made while the deck was acting, for the viewer to see */
let sent = [];

/** closing the tab on the way out is only right for a tab the bridge opened for itself */
let ownsTab = true;
/**
 * In a live session the browser is full of the viewer's own tabs. `mine` is a tab the guide opened;
 * `adopted` is a tab it may act in: its own, or one the viewer already had on the page a step goes
 * to. Any other tab is only read and pointed at, never clicked in and never sent somewhere else.
 */
let mine = false;
let adopted = true;
const samePage = (a, b) => {
  try {
    const [x, y] = [new URL(a), new URL(b)];
    return x.origin === y.origin && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '');
  } catch {
    return false;
  }
};
const blank = (address) => !address || /^(about:blank|edge:\/\/newtab|chrome:\/\/newtab|chrome:\/\/new-tab-page)/.test(address);

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
  windowed = !hidden;
  if (!hidden && !liveSession && ownerGo) record({ ownerGo, note: 'browser with a window, used on the owner\'s go' });
  if (!hidden && !liveSession && !ownerGo) {
    throw new Refused('That browser has a window, so it is someone\'s. The bridge only drives a windowless browser unless the person at it started a live session (--live).');
  }
}

async function tab() {
  if (!browser?.isConnected()) {
    await mayUse();
    browser = await chromium.connectOverCDP(cdp, { timeout: 8000 });
    page = null;
    // A browser with a window is someone's: their own downloads must go where they always go. Connecting
    // Playwright redirects them to a temporary folder it empties on leaving, so that is undone here.
    const session = await browser.newBrowserCDPSession();
    if (windowed) await session.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true }).catch(() => {});
    // In a live session a file is the viewer's to take. A download that the guide's own press sets off,
    // whatever the button was called, is stopped before it lands, and the press is reported as refused.
    const stopIfOurs = (event) => {
      if (!liveSession || !acting) return false;
      stoppedFiles.push(event.suggestedFilename);
      void session.send('Browser.cancelDownload', { guid: event.guid }).catch(() => {});
      return true;
    };
    if (windowed) session.on('Browser.downloadWillBegin', stopIfOurs);
    // in a windowless browser any download goes to the bridge's folder under its own name
    if (!windowed) {
      await session.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: liveSession ? downloadsDir : filesDir, eventsEnabled: true }).catch(() => {});
      // the browser names each file by a random id; when it is complete, name it as the step asked
      // (noted when it began: the step may be over by the time it ends), or else by its own name
      const names = new Map();
      session.on('Browser.downloadWillBegin', (event) => stopIfOurs(event) || names.set(event.guid, { name: event.suggestedFilename, as: wanted?.as }));
      session.on('Browser.downloadProgress', (event) => {
        if (event.state !== 'completed' || !names.has(event.guid)) return;
        const { name, as } = names.get(event.guid);
        names.delete(event.guid);
        const folder = liveSession ? downloadsDir : filesDir;
        const file = join(folder, as ? as + extname(name) : name);
        try {
          renameSync(join(folder, event.guid), file);
        } catch {
          return;
        }
        lastDownload = { name, file, at: Date.now() };
        kept.set(name, file);
        if (as) kept.set(as, file);
      });
    }
  }
  if (!page || page.isClosed()) {
    page = (liveSession && (await visibleTab())) || (await quietTab());
    ownsTab = !liveSession;
    // the tab in front in a live session is the viewer's: looked at, not driven, until a step goes to the page it is on
    mine = !liveSession;
    adopted = !liveSession || blank(page.url());
    await wire(page);
  }
  // only a session the viewer started may put its tab in front of them
  if (liveSession) await page.bringToFront().catch(() => {});
  return page;
}

const wired = new WeakSet();
/** What the bridge listens for in a tab it works in. */
async function wire(target) {
  if (wired.has(target)) return;
  wired.add(target);
  target.on('request', (request) => {
    if (target === page) inFlight.add(request);
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return;
    sent.push(`${request.method()} ${new URL(request.url()).pathname}`);
    // what a content-rule report was about is kept in the log: it shows whether the guide's own marks set it off
    if (isBrowserReport(request)) record({ browserReport: new URL(request.url()).pathname, about: reportAbout(request.postData()) });
  });
  for (const over of ['requestfinished', 'requestfailed']) target.on(over, (request) => inFlight.delete(request));
  // what the viewer does with their own mouse, so a guide can carry on from where they went
  await target.addInitScript(watchInPage);
  await target.evaluate(watchInPage).catch(() => {});
  target.on('download', (download) => void keepDownload(download));
  // the bar on the page tells the bridge what was pressed or asked, and is put back when the page loads again
  await target.exposeBinding('__wagTell', (_source, said) => heard(said)).catch(() => {});
  const again = () => void (target === page && drawBar());
  target.on('load', again);
  target.on('framenavigated', (frame) => frame === target.mainFrame() && again());
}

/**
 * Before a step goes to an address in a live session: the tab to do it in. The guide's own tab, or
 * the tab in front when it is already on that page, or else a new tab. A page the viewer had open
 * on something else is never sent anywhere: it may hold work they have not saved.
 */
async function tabToGo(to) {
  if (!liveSession) return '';
  if (mine || blank(page.url()) || samePage(page.url(), to)) {
    adopted = true;
    return '';
  }
  await clear();
  await page.evaluate(barInPage, null).catch(() => {});
  page = await browser.contexts()[0].newPage();
  mine = true;
  adopted = true;
  await wire(page);
  await page.bringToFront().catch(() => {});
  return ', in a tab of its own: the page you had open is left as it was';
}

/** Clicking, choosing and typing are only for a tab the guide may act in. */
function mayActHere(what) {
  if (liveSession && !adopted) {
    throw new Refused(`This tab was open on something of yours, so the guide only reads it and will not ${what} here. When a step goes to a page, the guide opens a tab of its own.`);
  }
}

/** Runs in the page: remembers the viewer's last few real clicks. */
function watchInPage() {
  if (window.__wagSeen) return;
  window.__wagSeen = [];
  addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted || window.__wagActing) return;
      // a press on the guide's own bar is not something they did on the page
      if (event.composedPath().some((node) => node.id === 'wag-bar')) return;
      const el = event.target instanceof Element ? (event.target.closest('button, a, [role], tr, label') ?? event.target) : null;
      if (!el) return;
      const what = (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 90);
      // a click on nothing says nothing
      if (!what) return;
      window.__wagSeen.push({ what, at: Date.now() });
      window.__wagSeen = window.__wagSeen.slice(-5);
    },
    true
  );
}

/** Every download in the guide's tab is kept, whoever clicked: by the name the guide asked for, or the file's own. */
let wanted = null;
/** while the guide itself is pressing, picking or typing; and the files such a press tried to hand over in a live session */
let acting = false;
let stoppedFiles = [];
let lastDownload = null;
async function keepDownload(download) {
  // set off by the guide's own press in a live session: it is being stopped, not kept
  if (liveSession && acting) return void download.cancel().catch(() => {});
  const name = wanted?.as ? wanted.as + extname(download.suggestedFilename()) : download.suggestedFilename();
  const file = join(wanted?.dir ?? downloadsDir, name);
  // in a windowless browser the browser itself writes the file (see tab()) and this fails; that path keeps it
  if (!(await download.saveAs(file).then(() => true, () => false))) return;
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
  acting = true;
  stoppedFiles = [];
  try {
    const result = await sendingOnlyReads(work);
    // a download begins a moment after the press that sets it off
    if (liveSession) await page.waitForTimeout(350);
    if (stoppedFiles.length) throw new Refused(`That press started a download (${stoppedFiles.join(', ')}), and in a live session a download is your own click. It was stopped before it reached your folder. The guide can ring the button and wait for you.`);
    return result;
  } finally {
    acting = false;
  }
}

const isBrowserReport = (request) => request.resourceType() === 'cspviolationreport' || /^application\/(csp-report|reports\+json)/.test(request.headers()['content-type'] ?? '');

/** The gist of a content-rule report: which rule, what was blocked, and where from. */
function reportAbout(body) {
  try {
    const said = JSON.parse(body ?? '{}');
    const report = said['csp-report'] ?? (Array.isArray(said) ? said[0]?.body : said.body) ?? {};
    const pick = (...names) => names.map((name) => report[name]).find((value) => value !== undefined);
    return { rule: pick('effective-directive', 'effectiveDirective', 'violated-directive'), blocked: pick('blocked-uri', 'blockedURL'), from: pick('source-file', 'sourceFile'), line: pick('line-number', 'lineNumber'), sample: String(pick('script-sample', 'sample') ?? '').slice(0, 80) || undefined };
  } catch {
    return {};
  }
}

/** Do it, and on a page that is not on this machine let nothing but reads out while it happens. */
async function sendingOnlyReads(work) {
  if (isLocal(page.url())) {
    // a page on this machine may do anything, but the guide's own clicks are still not the viewer's
    await page.evaluate(() => (window.__wagActing = true)).catch(() => {});
    try {
      return await work();
    } finally {
      await page.evaluate(() => (window.__wagActing = false)).catch(() => {});
    }
  }
  const stopped = [];
  const gate = (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || readsWithPost.some((prefix) => path.startsWith(prefix))) return route.continue();
    // Two things a browser sends by itself are not the press sending anything, and go through: its
    // report that a page broke its own content rules, and the renewal of a sign-in that is running out.
    if (isBrowserReport(request) || /(^|&)grant_type=refresh_token(&|$)/.test(request.postData() ?? '')) return route.continue();
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
  // something the bridge has already found on the page itself
  if (t.found) return t.found;
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
  if (control.submits || changes(control.label)) {
    throw new Refused(`"${control.label}" changes something, so the guide will not press it. That click is yours.`);
  }
  if (liveSession && control.button && handsOver(control.label)) {
    throw new Refused(`"${control.label}" hands over a file, and in a live session a download is your own click. The guide can ring it and wait for you.`);
  }
  // inside a dialog, a button has to be one the guide knows only looks. Anything else is not pressed, and the reason is given.
  if (control.inDialog && control.button && !control.opens && !onlyLooks(control.label)) {
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
  // the tone with some of it taken away, for the glow round the ring
  const rgb = [1, 3, 5].map((i) => parseInt(tone.slice(i, i + 2), 16)).join(',');
  const soft = (alpha) => `rgba(${rgb},${alpha})`;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ring = make(`position:fixed;box-sizing:border-box;border:2px solid ${tone};border-radius:12px;box-shadow:0 0 0 9999px rgba(8,7,13,.42),0 0 0 5px ${soft(0.2)},0 0 30px ${soft(0.55)};pointer-events:none;z-index:2147483646`);
  // a second edge that keeps leaving the first, so the eye finds the ring on a busy page
  const pulse = make(`position:fixed;box-sizing:border-box;border:2px solid ${tone};border-radius:12px;pointer-events:none;z-index:2147483646`);
  const words = make(`position:fixed;box-sizing:border-box;max-width:min(560px,80vw);background:linear-gradient(180deg,rgba(28,25,42,.96),rgba(14,13,22,.97));color:#f6f4ff;border:1px solid rgba(255,255,255,.09);border-left:3px solid ${tone};border-radius:12px;padding:12px 16px;font:500 16px/1.45 "Geist Variable",Geist,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;letter-spacing:-.005em;box-shadow:0 24px 50px -20px rgba(0,0,0,.8),0 0 0 1px rgba(0,0,0,.3);backdrop-filter:blur(12px);pointer-events:none;z-index:2147483647`);
  words.textContent = note || '';
  if (!note) words.style.display = 'none';
  if (still) pulse.style.display = 'none';
  else {
    pulse.animate([{ transform: 'scale(1)', opacity: 0.8 }, { transform: 'scale(1.08)', opacity: 0 }], { duration: 1600, iterations: Infinity, easing: 'cubic-bezier(.2,.7,.3,1)' });
    ring.animate([{ opacity: 0, transform: 'scale(1.12)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    words.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 120, fill: 'backwards', easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  let live = true;
  const place = () => {
    if (!live) return;
    if (!el.isConnected) return window.__wagClear();
    const r = el.getBoundingClientRect();
    const box = { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` };
    Object.assign(ring.style, box);
    Object.assign(pulse.style, box);
    // the bar along the bottom, when it is there, is not written over
    const floor = innerHeight - (document.getElementById('wag-bar')?.offsetHeight ?? 0) - 20;
    const below = r.bottom + 14 + words.offsetHeight < floor;
    words.style.left = `${Math.max(8, Math.min(r.left, innerWidth - words.offsetWidth - 8))}px`;
    words.style.top = below ? `${r.bottom + 14}px` : `${Math.max(8, r.top - 14 - words.offsetHeight)}px`;
    requestAnimationFrame(place);
  };
  window.__wagClear = () => {
    live = false;
    ring.remove();
    pulse.remove();
    words.remove();
    window.__wagClear = undefined;
  };
  place();
}

async function ring(target, note, tone = '#8ab4ff') {
  const found = locate(target);
  // said in words, with what was looked for: a rehearsal or a guide reads this to know what to fix
  await found.waitFor({ state: 'visible', timeout: 6000 }).catch((error) => {
    const within = typeof target === 'object' && target.within ? ` in the ${target.within}` : '';
    throw new Error(/Timeout/.test(error.message) ? `"${words(target)}" did not show on the page${within} within 6 seconds.` : error.message);
  });
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
    let got = lastDownload && lastDownload.at >= (expect.since ?? 0) && fits.test(lastDownload.name) ? lastDownload : null;
    if (!got) {
      // the browser saved it itself, so look in the downloads folder for a new file whose name fits
      const fresh = readdirSync(downloadsDir)
        .filter((name) => fits.test(name) && !/\.(crdownload|tmp)$/i.test(name))
        .map((name) => ({ name, file: join(downloadsDir, name), at: statSync(join(downloadsDir, name)).mtimeMs }))
        .filter((f) => f.at >= (expect.since ?? 0) - 2000)
        .sort((a, b) => b.at - a.at)[0];
      if (!fresh) return false;
      got = fresh;
    }
    kept.set(expect.file.as, got.file);
  }
  return true;
}

/** what a wait was for, in words, for when it does not come */
const expected = (expect) =>
  [expect.url && `the address to have "${expect.url}"`, expect.see && `"${words(expect.see)}" to show`, expect.gone && `"${words(expect.gone)}" to go away`, expect.file && `a file like "${expect.file.like}"`].filter(Boolean).join(' and ') || 'nothing it could name';

/** A press that timed out says so in words; anything else is passed on as it is. */
const orSay = (why) => (error) => {
  throw /Timeout/.test(error.message) ? new Error(why) : error;
};

async function until(expect, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await holds(expect)) return true;
    await page.waitForTimeout(300);
  }
  return holds(expect);
}

/** The one list on the page that has this choice, with the choice's full label. Only `count` when there is none, or more than one. */
async function listWith(choice) {
  const lists = page.locator('select').filter({ has: page.locator('option', { hasText: choice }) }).locator('visible=true');
  const count = await lists.count();
  if (count !== 1) return { count };
  const list = lists.first();
  const label = ((await list.locator('option', { hasText: choice }).first().textContent()) ?? choice).trim();
  return { count, label, from: { found: list, name: (await list.getAttribute('aria-label')) ?? 'the list' } };
}

/** downloads kept this session, by the name the deck gave them */
const kept = new Map();

/** A pause that is only there so a person can see what is about to be pressed. */
let unwatched = false;
const watched = (ms) => (unwatched ? undefined : page.waitForTimeout(ms));

/** requests a tab has sent that have not come back yet */
const inFlight = new Set();
/** Wait for the page to go quiet: nothing in flight for a quarter of a second. Gives up after `ms`. */
async function quiet(ms) {
  const end = Date.now() + ms;
  for (let since = null; Date.now() < end; await page.waitForTimeout(50)) {
    if (inFlight.size) since = null;
    else if (Date.now() - (since ??= Date.now()) >= 250) return true;
  }
  return false;
}

async function act(action, base) {
  if ('go' in action) {
    const to = /^https?:/.test(action.go) ? action.go : `${appOverride ?? base ?? ''}${action.go}`;
    const where = await tabToGo(to);
    await clear();
    if (page.url() !== to) await page.goto(to, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await drawBar();
    return `Opened ${new URL(to).pathname}${new URL(to).search}${where}`;
  }
  if ('point' in action) {
    await ring(action.point, action.note);
    return `Pointed at ${words(action.point)}`;
  }
  if ('click' in action) {
    mayActHere('click');
    // words that are a choice in a list are picked there: a choice is not something a click can reach
    const asText = typeof action.click === 'string' ? action.click : action.click.text;
    if (asText && !(await locate(action.click).isVisible().catch(() => false))) {
      const list = await listWith(asText);
      if (list.from) return act({ choose: list.label, from: list.from }, base);
    }
    const found = await ring(action.click);
    await guard(found);
    await watched(700);
    await clear();
    if ((await found.evaluate((el) => el.tagName)) === 'OPTION') {
      // a choice in a list is picked, not clicked: a click on it does nothing in most browsers
      const list = found.locator('xpath=ancestor::select[1]');
      await guard(list);
      const label = ((await found.textContent()) ?? '').trim();
      await lookOnly(() => list.selectOption({ label }, { timeout: 6000 }));
      return `Chose ${label}`;
    }
    await lookOnly(() => found.click({ timeout: 15000 }).catch(orSay(`"${words(action.click)}" could not be clicked in 15 seconds: something on the page is in front of it, or it is switched off.`)));
    return `Clicked ${words(action.click)}`;
  }
  if ('choose' in action) {
    mayActHere('choose');
    const found = await ring(action.from);
    await guard(found);
    await watched(500);
    await clear();
    // picking only changes what is shown: a list that sends anything but a read when it is picked from is stopped, as a click is
    await lookOnly(async () => {
      if ((await found.evaluate((el) => el.tagName)) === 'SELECT') return found.selectOption({ label: action.choose }, { timeout: 6000 }).catch(orSay(`"${action.choose}" is not one of the choices of ${words(action.from)}.`));
      await found.click({ timeout: 15000 }).catch(orSay(`${words(action.from)} could not be opened in 15 seconds: something on the page is in front of it, or it is switched off.`));
      const pick = page.getByRole('option', { name: action.choose }).or(page.getByRole('menuitem', { name: action.choose })).first();
      await pick.click({ timeout: 15000 }).catch(orSay(`"${action.choose}" did not show among the choices of ${words(action.from)}.`));
    });
    return `Chose ${action.choose}`;
  }
  if ('fill' in action) {
    mayActHere('type');
    const found = await ring(action.into);
    const box = await found.evaluate((el) => ({ tag: el.tagName, type: (el.getAttribute('type') ?? 'text').toLowerCase(), editable: el.isContentEditable, shut: Boolean(el.disabled || el.readOnly) }));
    const text = box.tag === 'TEXTAREA' || box.editable || (box.tag === 'INPUT' && ['text', 'search', 'number', 'tel'].includes(box.type));
    if (!text || box.shut) throw new Refused(`${words(action.into)} is not a text box the guide may type in. That one is yours.`);
    await watched(500);
    await clear();
    // typing only fills the box; a page that saves as you type is stopped like any other send
    await lookOnly(() => found.fill(action.fill));
    const lines = action.fill.split('\n').length;
    return `Filled ${words(action.into)}${lines > 1 ? ` (${lines} lines)` : ` with ${action.fill}`}`;
  }
  if ('if' in action) {
    // There at once, or decided as soon as the page has gone quiet: a part that is still arriving
    // counts as there, and a part that is not coming does not cost a wait.
    let there = await holds(action.if);
    if (!there) {
      await quiet(2500);
      there = await holds(action.if);
    }
    const done = [];
    for (const next of there ? action.then : (action.else ?? [])) done.push(...[].concat(await act(next, base)));
    return done;
  }
  if ('download' in action) {
    if (liveSession) throw new Refused('In a live session a download is your own click, so the file lands in your Downloads. The guide rings the button and waits.');
    const found = await ring(action.download);
    await guard(found);
    await watched(700);
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
    mayActHere('press Escape');
    await page.keyboard.press('Escape');
    return 'Closed it';
  }
  if ('wait' in action) {
    if (!(await until(action.wait, 20000))) throw new Error(`The page did not get there in 20 seconds: it waited for ${expected(action.wait)}.`);
    return 'The page is ready';
  }
  throw new Error(`Unknown action ${JSON.stringify(action)}`);
}

// ---- the bar on the page ------------------------------------------------------------------------
// In the tab the guide drives: the line being said, as text, and a box to ask in. It only shows and
// listens. What its buttons and keys mean is decided by the session that started the bridge: the bar
// tells it "next", "back", "ask" and so on, and draws whatever state it is handed. A state may carry
// a list to pick from (the steps of the walk, or the walks there are), behind one button.

/** what the bar shows now, kept so it can be put back when the page loads again */
let barState = null;
/** what the page said, waiting for a bridge that listens on a port (over stdio it is written out at once) */
const pageEvents = [];
const KINDS = ['ask', 'askopen', 'askclose', 'next', 'back', 'auto', 'sound', 'goto', 'walk', 'stop'];

function heard(said) {
  let event;
  try {
    event = JSON.parse(said);
  } catch {
    return;
  }
  if (!KINDS.includes(event?.kind)) return;
  event = {
    kind: event.kind,
    ...(event.kind === 'ask' ? { text: String(event.text ?? '').slice(0, 2000) } : {}),
    // picked from the bar's list: a step of the walk by its place, or a walk by its name
    ...(event.kind === 'goto' && Number.isInteger(event.n) ? { n: event.n } : {}),
    ...(event.kind === 'walk' ? { name: String(event.name ?? '').slice(0, 80) } : {}),
  };
  // the log says that something was asked, not what
  record({ fromPage: event.kind });
  if (overStdio) console.log(JSON.stringify({ event }));
  else pageEvents.push(event);
}

/**
 * Runs in the page: draws the bar, or takes it away when handed nothing. Its styles and its insides
 * are kept apart from the page's, and nothing typed or pressed in it reaches the page: an app that
 * holds the keyboard inside an open dialog, or shuts a dialog on a click outside it, is not disturbed.
 */
function barInPage(state) {
  if (!state) {
    window.__wagBar?.off();
    window.__wagBar = undefined;
    return false;
  }
  let bar = window.__wagBar;
  if (!bar?.host.isConnected) {
    bar?.off();
    const el = (tag, name, text) => {
      const node = document.createElement(tag);
      if (name) node.className = name;
      if (text) node.textContent = text;
      return node;
    };
    const host = el('div');
    host.id = 'wag-bar';
    host.style.cssText = 'all:initial;position:fixed;left:50%;bottom:16px;transform:translateX(-50%);width:min(940px,calc(100vw - 32px));z-index:2147483647;pointer-events:auto';
    // closed, so that the guide's own looking and clicking on the page never lands on the bar's words
    const root = host.attachShadow({ mode: 'closed' });
    // a sheet made in script, so a page that allows no inline styles still shows the bar
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      .wrap{--tone:#8ab4ff;--sans:"Geist Variable",Geist,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;--mono:"Geist Mono Variable","Geist Mono","Cascadia Mono",Consolas,ui-monospace,monospace;position:relative;box-sizing:border-box;overflow:hidden;background:linear-gradient(180deg,rgba(28,25,42,.95),rgba(13,12,20,.97));color:#f6f4ff;border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:14px 18px 14px 20px;font:500 16px/1.5 var(--sans);letter-spacing:-.005em;box-shadow:0 30px 60px -24px rgba(0,0,0,.85),0 0 0 1px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.06);backdrop-filter:blur(16px) saturate(140%);animation:rise .42s cubic-bezier(.2,.8,.2,1)}
      .wrap::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,#ffb86b,#ff7eb6 50%,#8ab4ff)}
      .wrap::after{content:"";position:absolute;inset:-40% 40% auto -10%;height:120%;background:radial-gradient(closest-side,rgba(109,74,255,.16),transparent);pointer-events:none}
      .wrap.asking{--tone:#ffc46b}
      .wrap.asking::before{background:#ffc46b}
      .wrap>*{position:relative;z-index:1}
      .head{display:flex;align-items:center;gap:10px;font:500 11.5px/1.6 var(--mono);letter-spacing:.02em;color:#8f8aa8;margin-bottom:4px}
      .head .mark{margin-left:auto;padding:1px 10px;border-radius:999px;background:rgba(255,196,107,.13);border:1px solid rgba(255,196,107,.3);color:#ffc46b;font-weight:600}
      .head .mark:empty{display:none}
      .asked{font-size:14px;color:#b3aecb;margin:2px 0 4px}
      .words{white-space:pre-wrap;max-height:9.5em;overflow:auto;font-size:17px;color:#f6f4ff}
      .list{display:grid;gap:2px;max-height:14.5em;overflow:auto;margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}
      .list button{text-align:left;background:transparent;border-color:transparent;font-weight:500;padding:8px 10px}
      .list button:hover{background:rgba(255,255,255,.06)}
      .list button.now{background:rgba(138,180,255,.12);color:#8ab4ff}
      form{display:flex;gap:8px;margin-top:12px}
      input{flex:1;min-width:0;font:inherit;font-size:15px;color:#f6f4ff;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:8px 12px}
      input::placeholder{color:#6f6a8a}
      input:focus{outline:none;border-color:var(--tone);box-shadow:0 0 0 3px rgba(138,180,255,.22)}
      .row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
      button{font:600 13.5px/1 var(--sans);color:#e7e4f5;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:9px 14px;cursor:pointer;transition:background .15s,border-color .15s,transform .15s}
      button:hover{background:rgba(255,255,255,.11);border-color:rgba(255,255,255,.16)}
      button:active{transform:translateY(1px)}
      button:focus-visible{outline:2px solid #8ab4ff;outline-offset:2px}
      button.main{color:#0b0a12;border:0;background:linear-gradient(100deg,#ffb86b,#ff7eb6 52%,#8ab4ff);box-shadow:0 8px 22px -10px rgba(255,126,182,.7)}
      button.main:hover{filter:brightness(1.08)}
      button[aria-pressed="true"]{background:rgba(138,180,255,.16);border-color:rgba(138,180,255,.45);color:#8ab4ff}
      button:disabled{opacity:.4;cursor:default;transform:none}
      [hidden]{display:none!important}
      @keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
      @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
    `);
    root.adoptedStyleSheets = [sheet];
    const wrap = el('div', 'wrap');
    // a named region, so a screen reader can find the bar and say what it is
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Guide');
    const head = el('div', 'head');
    const step = el('span');
    const mark = el('span', 'mark');
    head.append(step, mark);
    const asked = el('div', 'asked');
    const words = el('div', 'words');
    words.setAttribute('role', 'status');
    const list = el('div', 'list');
    list.hidden = true;
    let listed = '';
    const form = el('form');
    const box = el('input');
    box.type = 'text';
    box.autocomplete = 'off';
    box.placeholder = 'Ask about this page, then press Enter';
    box.setAttribute('aria-label', 'Ask the guide');
    const sendIt = el('button', 'main', 'Ask');
    form.append(box, sendIt);
    form.hidden = true;
    const row = el('div', 'row');
    const button = (does, label) => {
      const b = el('button', '', label);
      b.type = 'button';
      b.dataset.does = does;
      row.append(b);
      return b;
    };
    const back = button('back', 'Back');
    const next = button('next', 'Next (F8)');
    const ask = button('ask', 'Ask (F2)');
    const auto = button('auto', 'Auto');
    const menu = button('menu', '');
    const sound = button('sound', 'Sound');
    wrap.append(head, asked, words, list, form, row);
    root.append(wrap);

    const tell = (kind, more) => window.__wagTell?.(JSON.stringify({ kind, ...more }));
    let busy = false;
    const asking = (on) => {
      if (on === !form.hidden || (on && busy)) return;
      form.hidden = !on;
      if (on) box.focus();
      else {
        box.value = '';
        box.blur();
      }
      tell(on ? 'askopen' : 'askclose');
    };
    const inBar = (event) => event.composedPath().includes(host);
    const onKey = (event) => {
      if (!host.isConnected) return;
      if (event.key === 'F2' || event.key === 'F8') {
        // these two keys are the guide's wherever the cursor is
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        return event.key === 'F2' ? asking(form.hidden) : tell('next');
      }
      if (!inBar(event)) return;
      event.stopPropagation();
      if (event.key === 'Escape' && !form.hidden) {
        event.preventDefault();
        asking(false);
      }
    };
    const onClick = (event) => {
      if (!inBar(event)) return;
      event.stopPropagation();
      // the bar's insides are not in the event's path out here, so what was pressed is looked up: under the pointer, or where the keyboard is
      const at = event.detail === 0 ? root.activeElement : root.elementFromPoint(event.clientX, event.clientY);
      const pressed = at?.closest?.('[data-does]');
      if (!pressed || pressed.disabled) return;
      const does = pressed.dataset.does;
      if (does === 'menu') return void (list.hidden = !list.hidden);
      list.hidden = true;
      if (does === 'ask') asking(form.hidden);
      else tell(does, { n: pressed.dataset.n === undefined ? undefined : Number(pressed.dataset.n), name: pressed.dataset.name });
    };
    // a submit does not leave the bar's own tree, so the page never sees it
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = box.value.trim();
      if (!text || busy) return;
      box.value = '';
      form.hidden = true;
      tell('ask', { text });
    });
    // everything else that happens in the bar stops here, before the page's own listeners
    const quiet = (event) => {
      if (inBar(event) || event.relatedTarget === host) event.stopPropagation();
    };
    const QUIET = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'touchstart', 'touchend', 'keyup', 'keypress', 'focusin', 'focusout', 'input', 'beforeinput', 'paste', 'copy', 'cut', 'contextmenu'];
    addEventListener('keydown', onKey, true);
    addEventListener('click', onClick, true);
    for (const type of QUIET) addEventListener(type, quiet, true);
    // a dialog the browser itself holds open is drawn over the rest of the page, so the bar moves into it
    let placing = 0;
    const place = () => {
      const home = [...document.querySelectorAll('dialog:modal')].at(-1) ?? document.documentElement;
      if (host.parentNode !== home) home.append(host);
    };
    place();
    placing = setInterval(place, 500);
    bar = window.__wagBar = {
      host,
      off() {
        clearInterval(placing);
        removeEventListener('keydown', onKey, true);
        removeEventListener('click', onClick, true);
        for (const type of QUIET) removeEventListener(type, quiet, true);
        host.remove();
      },
      draw(s) {
        busy = Boolean(s.busy);
        wrap.className = `wrap${s.asked || !form.hidden ? ' asking' : ''}`;
        step.textContent = s.head ?? '';
        mark.textContent = s.mark ?? '';
        asked.textContent = s.asked ? `You asked: ${s.asked}` : '';
        asked.hidden = !s.asked;
        words.textContent = s.caption ?? '';
        next.textContent = s.next ?? 'Next (F8)';
        next.hidden = s.next === '';
        next.className = 'main';
        next.disabled = busy;
        back.hidden = !s.back;
        back.disabled = busy;
        auto.hidden = s.auto === undefined;
        auto.setAttribute('aria-pressed', String(Boolean(s.auto)));
        sound.setAttribute('aria-pressed', String(s.sound !== false));
        ask.disabled = busy;
        if (busy && !form.hidden) form.hidden = true;
        // the list behind its button: made again only when it has changed, so it keeps its place while open
        const items = s.menu?.items ?? [];
        menu.hidden = !items.length;
        menu.textContent = s.menu?.label ?? '';
        menu.disabled = busy;
        if (busy || !items.length) list.hidden = true;
        if (JSON.stringify(items) !== listed) {
          listed = JSON.stringify(items);
          list.replaceChildren(
            ...items.map((item) => {
              const b = el('button', item.now ? 'now' : '', item.label);
              b.type = 'button';
              b.dataset.does = item.kind;
              if (item.n !== undefined) b.dataset.n = String(item.n);
              if (item.name) b.dataset.name = item.name;
              return b;
            }),
          );
        }
      },
    };
  }
  bar.draw(state);
  return true;
}

/** Runs in the page: plays a spoken line where the viewer is looking. Says whether it could. */
async function playInPage([data, wanted]) {
  window.__wagHush?.();
  if (!wanted) return { played: false };
  const Sound = window.AudioContext ?? window.webkitAudioContext;
  if (!Sound) return { played: false };
  const context = (window.__wagSound ??= new Sound());
  // a browser lets a page make sound once the person has pressed or clicked something in it
  if (context.state !== 'running') await Promise.race([context.resume(), new Promise((done) => setTimeout(done, 400))]).catch(() => {});
  if (context.state !== 'running') return { played: false };
  const raw = atob(data);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const buffer = await context.decodeAudioData(bytes.buffer);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  window.__wagHush = () => {
    try {
      source.stop();
    } catch {}
    window.__wagHush = undefined;
  };
  return { played: true, seconds: Math.round(buffer.duration * 10) / 10 };
}

/** The bar is only for a tab the guide may act in: it is not drawn over a page the viewer had open on something else. */
async function drawBar() {
  if (!page || page.isClosed() || (liveSession && !adopted)) return false;
  return page.evaluate(barInPage, barState).catch(() => false);
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
        if (i % 2 === 0 && keep(row)) cents += Math.round(((Number(row[reading.credit ?? 'CR']) || 0) - (Number(row[reading.debit ?? 'DR']) || 0)) * 100);
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
  if (item.when && !(await holds(item.when))) return [{ label: item.label, ok: true, skipped: true, got: '', want: '' }];
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
      // by its label or heading, or else by its first line, so two dialogs can be told apart
      dialog: dialog ? (dialog.getAttribute('aria-label') || dialog.querySelector('h1,h2,h3,b')?.textContent || dialog.innerText.trim().split('\n')[0] || 'a dialog').trim().slice(0, 120) : null,
      scrolled: Math.round(scrollY),
      viewerClicks: (window.__wagSeen ?? []).map((c) => `${c.what} (${Math.round((Date.now() - c.at) / 1000)} s ago)`),
      pointing: Boolean(window.__wagClear),
    };
    window.__wagSeen = [];
    return out;
  });
  const whose = !liveSession ? undefined : mine ? 'the guide opened this tab' : adopted ? 'the viewer had this tab on the same page, so the guide works in it' : 'this tab is the viewer\'s own: the guide only reads it, and opens a tab of its own when it goes to a page';
  return { address: page.url(), tab: whose, ...seen, lastDownload: lastDownload ? { name: lastDownload.name, secondsAgo: Math.round((Date.now() - lastDownload.at) / 1000) } : null };
}

const commands = {
  where: () => whereNow(),
  /** Draw the bar on the page with this state, or take it away. `shown` is false on a tab the guide may not act in. */
  async bar({ state }) {
    barState = state ?? null;
    return { shown: Boolean(await drawBar()) };
  },
  /** Play a spoken line in the page. `played` is false when the page may not make sound yet: then the console plays it. */
  async speak({ audio }) {
    if (!barState || (liveSession && !adopted)) return { played: false };
    return page.evaluate(playInPage, [audio, true]).catch(() => ({ played: false }));
  },
  async hush() {
    await page.evaluate(() => window.__wagHush?.()).catch(() => {});
    return { did: 'Quiet' };
  },
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
        // a match inside a table or grid row comes with the rest of its row, which is usually what was wanted
        const row = el.closest('tr, [role="row"]');
        return { says: el.innerText.trim().replace(/\s+/g, ' ').slice(0, 110), row: row && row !== el ? row.innerText.trim().replace(/\s+/g, ' ').slice(0, 240) : undefined, is: (control?.getAttribute('role') || control?.tagName || el.tagName).toLowerCase(), onScreen: box.top >= 0 && box.bottom <= innerHeight, inDialog: Boolean(el.closest('[role="dialog"], dialog')) };
      }));
    }
    return { count, hits };
  },
  async read({ target, most }) {
    // with no target: the open dialog if there is one, since that is what the viewer is looking at; otherwise the page
    const dialog = page.locator('[role="dialog"], dialog[open]').locator('visible=true').last();
    const found = target ? locate(target) : (await dialog.count()) ? dialog : (await page.locator('main').count()) ? page.locator('main').first() : page.locator('body');
    return { text: brief(await found.innerText({ timeout: 4000 }), most) };
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
    const how = 'choose "<the choice>" --from "role=combobox:<the label of the list>"';
    if (!option) throw new Error(`Say what to pick: ${how}.`);
    if (!from) {
      // no list was named: the one list on the page that has that choice, if there is just one
      const list = await listWith(option);
      const count = list.count;
      if (list.from) [option, from] = [list.label, list.from];
      else {
        const names = await page.getByRole('combobox').locator('visible=true').evaluateAll((all) => all.map((el) => el.getAttribute('aria-label') ?? el.labels?.[0]?.innerText ?? '').filter(Boolean).slice(0, 12));
        throw new Error(`${count ? `${count} lists here have "${option}"` : `It is not clear which list "${option}" is in`}. Say which: ${how}.${names.length ? ` The lists on the page: ${names.join(', ')}.` : ''}`);
      }
    }
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
  show: ({ live, app, quick }) =>
    inTurn(async () => {
      await tab();
      sent = [];
      const done = [];
      // quick: nobody is watching (a rehearsal, or the steps redone before a jump), so nothing is paused on for show
      unwatched = Boolean(quick);
      try {
        for (const action of live.show ?? []) done.push(...[].concat(await act(action, app)));
        return { ok: true, done, sent };
      } catch (error) {
        return { ok: false, done, refused: error instanceof Refused, why: error.message.split('\n')[0], sent };
      } finally {
        unwatched = false;
      }
    }),
  turn: ({ live, app, again, peek }) =>
    inTurn(async () => {
      await tab();
      try {
        // a rehearsal only asks whether the page is already there: nothing is rung and nothing is waited for
        if (peek) return { ok: true, reached: !live.turn.until.file && (await holds(live.turn.until)) };
        // the ring goes up once; asking again only keeps waiting
        if (!again) {
          // already there, because the guide did it or the viewer was ahead: nothing to ring or wait for
          if (!live.turn.until.file && (await holds(live.turn.until))) return { ok: true, reached: true, already: true };
          await ring(live.turn.point, `Your turn. ${live.turn.says}`, '#ffc46b');
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
          } else done.push(...[].concat(await act(action, app)));
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
  /** what the bar on the page was told since the last call (a bridge on its own input and output writes these out as they happen) */
  events: async () => ({ ok: true, events: pageEvents.splice(0) }),
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
  // a picture, a spoken line and the words on the bar are not written to the log; neither is a poll for events
  const kept = ['speak', 'bar'].includes(asked.cmd) ? { cmd: asked.cmd } : asked;
  if (!['status', 'events'].includes(route) && asked.cmd !== 'frame') record({ route, asked: route === 'cmd' ? kept : { steps: (asked.live?.show ?? []).length || undefined, turn: asked.live?.turn?.says, checks: (asked.live?.check ?? []).length || undefined }, ok: answer.ok, refused: answer.refused || undefined, why: answer.why, done: answer.done ?? answer.did, sent: answer.sent?.length ? answer.sent : undefined, ms: answer.ms });
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
  await page?.evaluate(barInPage, null).catch(() => {});
  await page?.evaluate(() => window.__wagHush?.()).catch(() => {});
  if (ownsTab) await page?.close().catch(() => {});
  await browser?.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
