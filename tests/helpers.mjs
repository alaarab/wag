// What the tests stand on: a browser with no window, a small file server that notes anything sent
// to it, the bridge and the session as separate programs (as they run for real), and the bar read
// the way a screen reader reads it. Nothing here reaches into the programs under test.
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const repo = fileURLToPath(new URL('..', import.meta.url));
export const built = join(repo, 'tests/.out');
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Ask again and again until the answer fits. Fails with the last answer, so a failure says what was there instead. */
export async function eventually(read, fits, { ms = 20000, every = 150 } = {}) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    last = await read();
    if (fits(last)) return last;
    if (Date.now() > end) throw new Error(`Not within ${ms / 1000} s. Last seen: ${JSON.stringify(last)?.slice(0, 600)}`);
    await sleep(every);
  }
}

const started = [];
const temp = [];
const listening = [];
const looking = [];
export const scratch = (name) => {
  const dir = mkdtempSync(join(tmpdir(), `wag-test-${name}-`));
  temp.push(dir);
  return dir;
};
/** End everything a test file started. */
export async function tidy() {
  for (const seen of looking.splice(0)) await seen.close().catch(() => {});
  for (const child of started.splice(0).reverse()) child.kill('SIGTERM');
  // a server left listening would keep the test program alive after its last test
  for (const server of listening.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
  await sleep(300);
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.xlsx': 'application/octet-stream', '.mp3': 'audio/mpeg' };
/** Serve a folder. `sent` lists every request that was more than a read. */
export function serve(root, host = '127.0.0.1') {
  const sent = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (!['GET', 'HEAD'].includes(req.method)) {
      sent.push(`${req.method} ${path}`);
      res.writeHead(204);
      return res.end();
    }
    const file = join(root, normalize(path === '/' ? '/index.html' : path));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/html' });
    createReadStream(file).pipe(res);
  });
  listening.push(server);
  return new Promise((done, fail) => {
    server.once('error', fail).listen(0, host, () => done({ origin: `http://${host}:${server.address().port}`, sent }));
  });
}

export const freePort = () =>
  new Promise((done) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

const BROWSERS = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'microsoft-edge'];
function findBrowser() {
  if (process.env.WAG_TEST_BROWSER) return process.env.WAG_TEST_BROWSER;
  for (const name of BROWSERS) {
    try {
      return execFileSync('which', [name], { encoding: 'utf8' }).trim();
    } catch {}
  }
  return null;
}
export const hasBrowser = Boolean(findBrowser());
export const has = (program) => {
  try {
    execFileSync('which', [program]);
    return true;
  } catch {
    return false;
  }
};

/** A browser with no window, for the bridge to attach to. `open()` is the tests' own look at it. */
export async function browser() {
  const child = spawn(findBrowser(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${scratch('browser')}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--window-size=1400,900', ...(process.env.WAG_TEST_NO_SANDBOX ? ['--no-sandbox'] : []), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  started.push(child);
  const port = await new Promise((done, fail) => {
    createInterface({ input: child.stderr }).on('line', (line) => /DevTools listening on ws:\/\/[^:]+:(\d+)\//.test(line) && done(RegExp.$1));
    child.once('exit', () => fail(new Error('the browser did not start')));
  });
  const cdp = `http://127.0.0.1:${port}`;
  const seen = await chromium.connectOverCDP(cdp);
  looking.push(seen);
  return { cdp, context: seen.contexts()[0] };
}

/** The bridge as its own program, talked to on its input and output, as a session talks to it. */
export async function bridge({ cdp, app, args = [] }) {
  const files = scratch('files');
  const child = spawn(process.execPath, [join(repo, 'scripts/live.mjs'), '--stdio', '--cdp', cdp, '--app', app, '--files', files, '--downloads', files, ...args], { stdio: ['pipe', 'pipe', 'ignore'] });
  started.push(child);
  const waiting = new Map();
  const events = [];
  let ready;
  const up = new Promise((done) => (ready = done));
  createInterface({ input: child.stdout }).on('line', (line) => {
    const said = JSON.parse(line);
    if (said.ready) return ready();
    if (said.event) return events.push(said.event);
    waiting.get(said.id)?.(said.answer);
  });
  await up;
  let n = 0;
  const ask = (route, body = {}) =>
    new Promise((done) => {
      waiting.set(++n, done);
      child.stdin.write(`${JSON.stringify({ id: n, route, body })}\n`);
    });
  return { ask, cmd: (cmd, rest = {}) => ask('cmd', { cmd, ...rest }), show: (...show) => ask('show', { live: { show } }), events, files };
}

/** A whole session: the talking half, which starts its own bridge. `guide` is the command a guide types. */
export async function session({ cdp, app, args = [], bridgeArgs = [], env = {}, port, key, decks = built }) {
  const dir = scratch('session');
  port ??= await freePort();
  key ??= join(dir, 'key');
  const files = scratch('files');
  const command = `"${process.execPath}" "${join(repo, 'scripts/live.mjs')}" --stdio --cdp ${cdp} --app ${app} --files "${files}" --downloads "${files}" ${bridgeArgs.join(' ')}`;
  const child = spawn(process.execPath, [join(repo, 'scripts/session.mjs'), '--dir', dir, '--port', String(port), '--key', key, '--bridge', command, '--deck', decks, '--voice', 'none', ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  started.push(child);
  let out = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  child.stderr.on('data', (chunk) => (out += chunk));
  const exit = new Promise((done) => child.once('exit', done));
  const guideEnv = { ...process.env, GUIDE_SESSION: `http://127.0.0.1:${port}`, GUIDE_KEY_FILE: key, GUIDE_APP: app };
  // not a blocking call: this program also serves the pages, and a page cannot load while it waits
  const guide = (...words) =>
    new Promise((done) => {
      const asked = spawn(process.execPath, [join(repo, 'scripts/guide.mjs'), ...words], { env: guideEnv, stdio: ['ignore', 'pipe', 'ignore'] });
      let printed = '';
      asked.stdout.on('data', (chunk) => (printed += chunk));
      // the command ends with 1 when the answer is not ok; the answer is still what it printed
      asked.once('exit', () => done(printed.trim() ? JSON.parse(printed) : { ok: false, why: 'the guide command printed nothing' }));
    });
  // up when the bridge behind it answers; a session that ends at once (a port in use, a rehearsal) is not waited for
  await Promise.race([exit, eventually(() => (existsSync(key) ? guide('where') : null), (answer) => answer && 'ok' in answer && answer.why !== 'the bridge is not running', { ms: 20000, every: 300 }).catch(() => {})]);
  const lines = () => (existsSync(join(dir, 'transcript.jsonl')) ? readFileSync(join(dir, 'transcript.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
  return { dir, port, key, files, guide, lines, exit, out: () => out, kept: () => (existsSync(join(dir, 'open-questions.md')) ? readFileSync(join(dir, 'open-questions.md'), 'utf8') : '') };
}

/**
 * The bar on a page, as a screen reader finds it: its text in order, and its buttons. The bar keeps
 * its insides closed to the page, so this is also the only way in that does not ask the bar itself.
 */
export async function bar(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const by = new Map(nodes.map((node) => [node.nodeId, node]));
    const region = nodes.find((node) => node.role?.value === 'region' && node.name?.value === 'Guide');
    if (!region) return null;
    const text = [];
    const buttons = [];
    const walk = (node, inButton) => {
      if (!node) return;
      const role = node.role?.value;
      if (role === 'button' && !node.ignored) {
        const flag = (name) => node.properties?.find((p) => p.name === name)?.value.value;
        buttons.push({ name: node.name?.value ?? '', off: Boolean(flag('disabled')), pressed: flag('pressed') === 'true' || flag('pressed') === true, node: node.backendDOMNodeId });
      }
      if (role === 'StaticText' && !inButton) text.push(node.name?.value ?? '');
      for (const child of node.childIds ?? []) walk(by.get(child), inButton || role === 'button');
    };
    walk(region, false);
    return { text: text.join('\n'), buttons, names: buttons.map((button) => button.name) };
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** Press one of the bar's buttons with the mouse, as a person does. */
export async function press(page, name) {
  const found = await eventually(() => bar(page), (seen) => seen?.buttons.some((button) => button.name.startsWith(name) && !button.off));
  const button = found.buttons.find((b) => b.name.startsWith(name));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: button.node }).catch(() => {});
  const [x1, y1, , , x3, y3] = (await cdp.send('DOM.getBoxModel', { backendNodeId: button.node })).model.content;
  await cdp.detach().catch(() => {});
  await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
}

/** Type a question into the bar: F2, the words, Enter. */
export async function askInBar(page, text) {
  await eventually(() => bar(page), (seen) => seen?.buttons.some((button) => button.name.startsWith('Ask') && !button.off));
  await page.keyboard.press('F2');
  await sleep(250);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

/** The tab the guide works in: the one on the made-up page. */
export const guideTab = (context, part = 'app.html') => eventually(() => context.pages().find((page) => page.url().includes(part)) ?? null, Boolean, { ms: 15000 });
