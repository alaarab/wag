// The talking half of a live session. It runs where the person's guide session runs and does three
// things: speaks each line the guide says with a voice kept warm, keeps the transcript, and serves
// a console page that shows every line as text, plays the audio, and can mirror the driven tab.
//
//   node scripts/session.mjs --dir <session folder> --bridge "<command that starts live.mjs --stdio>"
//
// It also starts the bridge and is the only thing that can talk to it: the bridge runs with
// --stdio (on this machine, or on another one through ssh) and this program passes the guide's
// commands to it. It mints a key at every start, writes it to --key (readable by its owner
// only), and answers only requests that carry it.
//
// The guide calls it through the `guide` command: where, goto, highlight, ..., say, heard.
// Options: --port N (default 5191), --key FILE (default ~/.cache/wag/bridge.token), --voice FILE
// (a Piper voice; default the medium voice under ~/.local/share/wag-voice), --pronounce FILE (a
// JSON object of written form to spoken form), --label TEXT (shown on the console, such as
// "PRIVATE: production data").
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const dir = resolve(option('dir', join(homedir(), '.cache/wag/session')));
const port = Number(option('port', 5191));
const bridgeCommand = option('bridge');
const keyFile = resolve(option('key', join(homedir(), '.cache/wag/bridge.token')));
const voiceHome = join(homedir(), '.local/share/wag-voice');
const voiceFile = option('voice', join(voiceHome, 'voices/en_US-lessac-medium.onnx'));
const pronounce = option('pronounce') ? JSON.parse(readFileSync(option('pronounce'), 'utf8')) : {};
const label = option('label', '');
mkdirSync(join(dir, 'audio'), { recursive: true });
mkdirSync(resolve(keyFile, '..'), { recursive: true });
const token = randomBytes(24).toString('hex');
writeFileSync(keyFile, token, { mode: 0o600 });
const key = () => token;

// ---- the bridge ---------------------------------------------------------------------------------

let bridge = null;
let bridgeReady = false;
const asked = new Map();
let askId = 0;
if (bridgeCommand) {
  bridge = spawn('bash', ['-c', bridgeCommand], { stdio: ['pipe', 'pipe', 'inherit'] });
  createInterface({ input: bridge.stdout }).on('line', (line) => {
    let said;
    try {
      said = JSON.parse(line);
    } catch {
      return;
    }
    if (said.ready) bridgeReady = true;
    asked.get(said.id)?.(said.answer);
    asked.delete(said.id);
  });
  bridge.on('exit', (code) => {
    bridgeReady = false;
    bridge = null;
    for (const done of asked.values()) done({ ok: false, why: 'the bridge stopped' });
    console.log(`The bridge stopped (${code}).`);
  });
}
const toBridge = (route, body) =>
  new Promise((done) => {
    if (!bridge) return done({ ok: false, why: 'the bridge is not running' });
    const id = ++askId;
    asked.set(id, done);
    bridge.stdin.write(`${JSON.stringify({ id, route, body })}\n`);
  });

// ---- the voice ----------------------------------------------------------------------------------

const python = [join(voiceHome, 'venv/bin/python'), 'python3'].find((p) => p === 'python3' || existsSync(p));
const waiting = new Map();
let voice = null;
if (existsSync(voiceFile)) {
  voice = spawn(python, [new URL('./voice.py', import.meta.url).pathname, voiceFile], { stdio: ['pipe', 'pipe', 'inherit'] });
  createInterface({ input: voice.stdout }).on('line', (line) => {
    const said = JSON.parse(line);
    waiting.get(said.id)?.(said);
    waiting.delete(said.id);
  });
  voice.on('exit', () => (voice = null));
} else console.log(`No voice at ${voiceFile}: lines will be shown and read by the browser's own voice.`);

const spoken = (text) => Object.entries(pronounce).reduce((out, [written, said]) => out.replaceAll(written, said), text);

function speak(id, text) {
  if (!voice) return Promise.resolve({ id });
  return new Promise((done) => {
    waiting.set(id, done);
    voice.stdin.write(`${JSON.stringify({ id, text: spoken(text), out: join(dir, 'audio', `${id}.wav`) })}\n`);
  });
}

// ---- the transcript and the console -----------------------------------------------------------------

const began = Date.now();
let count = 0;
const lines = [];
const listeners = new Set();
function add(entry) {
  const line = { n: ++count, at: new Date().toISOString(), t: Math.round((Date.now() - began) / 100) / 10, ...entry };
  lines.push(line);
  appendFileSync(join(dir, 'transcript.jsonl'), `${JSON.stringify(line)}\n`);
  for (const send of listeners) send(line);
  return line;
}

const CONSOLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Guide</title><link rel="icon" href="data:,">
<style>
body{margin:0;background:#0f172a;color:#f8fafc;font:17px/1.5 Inter,"Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column;height:100vh}
header{display:flex;gap:12px;align-items:center;padding:10px 18px;background:#020617;border-bottom:1px solid #1e293b}
header b{flex:1} .tag{background:#b45309;color:#fff;border-radius:999px;padding:2px 12px;font-size:14px;font-weight:600}
button{font:inherit;font-weight:600;border:0;border-radius:8px;padding:6px 14px;background:#1e293b;color:inherit;cursor:pointer} button[aria-pressed=true]{background:#38bdf8;color:#0f172a}
main{flex:1;display:flex;min-height:0} #log{flex:1;overflow:auto;padding:18px} #mirror{display:none;flex:2;background:#020617;align-items:center;justify-content:center} #mirror img{max-width:100%;max-height:100%}
.line{margin:0 0 14px;max-width:70ch} .who{font-size:13px;color:#94a3b8;display:block} .you{color:#cbd5e1} .guide.now{color:#38bdf8}
#start{display:none;position:fixed;inset:0;margin:auto;width:260px;height:64px;font-size:20px;background:#38bdf8;color:#0f172a;border-radius:999px}
</style></head><body>
<header><b>Guide</b><span class="tag" id="label" hidden></span><button id="sound" aria-pressed="true">Sound</button><button id="mirrorBtn" aria-pressed="false">Show the page here</button></header>
<main><div id="log"></div><div id="mirror"><img alt="The page the guide is driving"></div></main>
<button id="start">Start with sound</button>
<script>
const key = new URLSearchParams(location.search).get('key') ?? '';
const log = document.getElementById('log'), start = document.getElementById('start');
const label = ${JSON.stringify(label)}; if (label) { const tag = document.getElementById('label'); tag.textContent = label; tag.hidden = false; }
let sound = true, queue = [], playing = null;
const audio = new Audio();
function next() {
  if (playing || !queue.length) return;
  playing = queue.shift();
  for (const el of document.querySelectorAll('.now')) el.classList.remove('now');
  playing.el.classList.add('now');
  const done = () => { playing = null; next(); };
  if (!sound) return done();
  if (playing.line.audio) {
    audio.src = '/audio/' + playing.line.audio + '?key=' + key; audio.onended = done; audio.onerror = done;
    audio.play().catch(() => { start.style.display = 'block'; queue.unshift(playing); playing = null; });
  } else if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(playing.line.text); u.onend = done; u.onerror = done; speechSynthesis.speak(u); }
  else done();
}
function show(line, old) {
  const p = document.createElement('p'); p.className = 'line ' + line.who;
  const who = document.createElement('span'); who.className = 'who'; who.textContent = line.who === 'guide' ? 'Guide' : line.who === 'you' ? 'You' : line.who;
  p.append(who, document.createTextNode(line.text)); log.append(p); log.scrollTop = log.scrollHeight;
  if (line.who === 'guide' && !old) { queue.push({ line, el: p }); next(); }
}
start.onclick = () => { start.style.display = 'none'; next(); };
document.getElementById('sound').onclick = (e) => { sound = !sound; e.target.setAttribute('aria-pressed', sound); if (!sound) { audio.pause(); playing = null; queue = []; } };
let mirror = false, img = document.querySelector('#mirror img');
const frame = () => { if (!mirror) return; const n = new Image(); n.onload = () => { img.src = n.src; setTimeout(frame, 700); }; n.onerror = () => setTimeout(frame, 2000); n.src = '/mirror?key=' + key + '&t=' + Date.now(); };
document.getElementById('mirrorBtn').onclick = (e) => { mirror = !mirror; e.target.setAttribute('aria-pressed', mirror); document.getElementById('mirror').style.display = mirror ? 'flex' : 'none'; frame(); };
fetch('/lines?key=' + key).then((r) => r.json()).then((old) => { old.forEach((l) => show(l, true)); new EventSource('/events?key=' + key).onmessage = (m) => show(JSON.parse(m.data)); });
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if ((req.headers['x-wag-key'] ?? url.searchParams.get('key')) !== key()) {
    res.writeHead(401);
    return res.end();
  }
  const json = (body) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const live = /^\/live\/(\w+)$/.exec(url.pathname)?.[1];
    if (live) return json(await toBridge(live, JSON.parse(body || '{}')));
    const { text } = JSON.parse(body || '{}');
    if (url.pathname === '/heard') return json({ ok: true, n: add({ who: 'you', text }).n });
    if (url.pathname === '/say') {
      // the line is shown and heard as soon as its audio exists, which for a warm voice is a fraction of a second
      const id = `line-${String(count + 1).padStart(4, '0')}`;
      const made = await speak(id, text);
      const line = add({ who: 'guide', text, audio: made.seconds ? `${id}.wav` : undefined, seconds: made.seconds });
      return json({ ok: true, n: line.n, seconds: made.seconds ?? null });
    }
  }
  if (url.pathname === '/' || url.pathname === '/console') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(CONSOLE);
  }
  if (url.pathname === '/lines') return json(lines);
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const send = (line) => res.write(`data: ${JSON.stringify(line)}\n\n`);
    listeners.add(send);
    return req.on('close', () => listeners.delete(send));
  }
  const audio = /^\/audio\/(line-\d+\.wav)$/.exec(url.pathname)?.[1];
  if (audio && existsSync(join(dir, 'audio', audio))) {
    res.writeHead(200, { 'Content-Type': 'audio/wav' });
    return createReadStream(join(dir, 'audio', audio)).pipe(res);
  }
  if (url.pathname === '/mirror') {
    const shot = await toBridge('cmd', { cmd: 'frame' });
    if (!shot?.ok) {
      res.writeHead(503);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
    return res.end(Buffer.from(shot.jpeg, 'base64'));
  }
  res.writeHead(404);
  res.end();
});
server.listen(port, '127.0.0.1', () => console.log(`Session console: http://127.0.0.1:${port}/?key=${token}\nTranscript: ${join(dir, 'transcript.jsonl')}   Key file: ${keyFile}`));
const stop = () => {
  voice?.kill();
  // closing its input is how the bridge is told to stop and tidy the page
  bridge?.stdin.end();
  setTimeout(() => process.exit(0), 1500);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
