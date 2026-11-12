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
// "PRIVATE: production data"), --deck DIR (a built deck to serve, so its buttons work in this session),
// --ask COMMAND (what answers a question typed in the deck's Ask box or on the console: see "questions").
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

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
// a built deck folder to serve too, so a guided deck's buttons reach the bridge through this session
const deckDir = option('deck') ? resolve(option('deck')) : null;
const askCommand = option('ask');
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
#ask{display:none;gap:10px;padding:12px 18px;background:#020617;border-top:1px solid #1e293b} #ask input{flex:1;font:inherit;padding:8px 12px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:inherit} #ask button{background:#38bdf8;color:#0f172a}
.line{margin:0 0 14px;max-width:70ch} .who{font-size:13px;color:#94a3b8;display:block} .you{color:#cbd5e1} .guide.now{color:#38bdf8}
#start{display:none;position:fixed;inset:0;margin:auto;width:260px;height:64px;font-size:20px;background:#38bdf8;color:#0f172a;border-radius:999px}
</style></head><body>
<header><b>Guide</b><span class="tag" id="label" hidden></span><button id="sound" aria-pressed="true">Sound</button><button id="mirrorBtn" aria-pressed="false">Show the page here</button></header>
<main><div id="log"></div><div id="mirror"><img alt="The page the guide is driving"></div></main>
<form id="ask"><input placeholder="Ask about the page" aria-label="Ask the guide"><button>Ask</button></form>
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
const ask = document.getElementById('ask'); if (${JSON.stringify(Boolean(askCommand))}) ask.style.display = 'flex';
ask.onsubmit = (e) => { e.preventDefault(); const box = ask.querySelector('input'), text = box.value.trim(); if (!text) return; box.value = ''; fetch('/ask?key=' + key, { method: 'POST', body: JSON.stringify({ text }) }); };
fetch('/lines?key=' + key).then((r) => r.json()).then((old) => { old.forEach((l) => show(l, true)); new EventSource('/events?key=' + key).onmessage = (m) => show(JSON.parse(m.data)); });
</script></body></html>`;

// ---- recording ----------------------------------------------------------------------------------
// "Record this": pictures of the driven tab a few times a second, plus the lines already kept with
// their audio and times. Stopping turns them into a video, subtitles and a written walkthrough.

const run = promisify(execFile);
let recording = null;

function startRecording() {
  if (recording) return { ok: true, already: true };
  const folder = join(dir, `recording-${String(Date.now()).slice(-8)}`);
  mkdirSync(join(folder, 'frames'), { recursive: true });
  recording = { folder, began: Date.now(), frames: [], from: count, busy: false };
  recording.timer = setInterval(async () => {
    if (recording.busy) return;
    recording.busy = true;
    const shot = await toBridge('cmd', { cmd: 'frame' });
    if (recording && shot?.ok) {
      const file = `frames/${String(recording.frames.length + 1).padStart(5, '0')}.jpg`;
      writeFileSync(join(recording.folder, file), Buffer.from(shot.jpeg, 'base64'));
      recording.frames.push({ file, t: (Date.now() - recording.began) / 1000 });
    }
    if (recording) recording.busy = false;
  }, 400);
  add({ who: 'note', text: 'Recording started.' });
  return { ok: true, folder };
}

const clock = (t) => `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')},${String(Math.round((t % 1) * 1000)).padStart(3, '0')}`;

async function stopRecording() {
  if (!recording) return { ok: false, why: 'nothing is being recorded' };
  const done = recording;
  clearInterval(done.timer);
  recording = null;
  const length = (Date.now() - done.began) / 1000;
  if (!done.frames.length) return { ok: false, why: 'no pictures of the page were taken' };
  const offset = (done.began - began) / 1000;
  const said = lines.filter((l) => l.n > done.from && l.who !== 'note').map((l) => ({ ...l, t: Math.max(0, l.t - offset - (l.seconds ?? 0) * 0) }));
  // each picture is held until the next one
  const list = done.frames.map((f, i) => `file '${f.file}'\nduration ${(((done.frames[i + 1]?.t ?? length) - f.t) || 0.4).toFixed(3)}`).join('\n');
  writeFileSync(join(done.folder, 'frames.txt'), `${list}\nfile '${done.frames.at(-1).file}'\n`);
  const spoken = said.filter((l) => l.audio);
  const inputs = spoken.flatMap((l) => ['-i', join(dir, 'audio', l.audio)]);
  const stamp = label ? `,drawtext=text='${label.replace(/[':]/g, ' ')}':x=24:y=24:fontsize=30:fontcolor=white:box=1:boxcolor=0xb45309@0.92:boxborderw=12` : '';
  const sound = spoken.length
    ? `;${spoken.map((l, i) => `[${i + 1}:a]adelay=${Math.round(l.t * 1000)}:all=1[a${i}]`).join(';')};${spoken.map((_, i) => `[a${i}]`).join('')}amix=inputs=${spoken.length}:normalize=0[a]`
    : '';
  const video = join(done.folder, 'session.mp4');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(done.folder, 'frames.txt'), ...inputs, '-filter_complex', `[0:v]fps=10,scale=1600:-2${stamp}[v]${sound}`, '-map', '[v]', ...(spoken.length ? ['-map', '[a]'] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', length.toFixed(2), video], { cwd: done.folder });
  writeFileSync(join(done.folder, 'session.srt'), spoken.map((l, i) => `${i + 1}\n${clock(l.t)} --> ${clock(l.t + (l.seconds ?? 3))}\n${l.text}\n`).join('\n'));
  // the written walkthrough: what was asked, what was said, and the page as it looked when each line ended
  const out = [`# Walkthrough of a live session, ${new Date(done.began).toLocaleString('en-US')}`, '', ...(label ? [`**${label}.** Not for sharing.`, ''] : [])];
  mkdirSync(join(done.folder, 'pictures'), { recursive: true });
  said.forEach((l, i) => {
    if (l.who === 'you') return out.push(`## ${l.text}`, '');
    out.push(l.text, '');
    const at = l.t + (l.seconds ?? 0);
    const frame = done.frames.findLast((f) => f.t <= at) ?? done.frames[0];
    const picture = `pictures/${String(i + 1).padStart(3, '0')}.jpg`;
    writeFileSync(join(done.folder, picture), readFileSync(join(done.folder, frame.file)));
    out.push(`![The page at this point](${picture})`, '');
  });
  writeFileSync(join(done.folder, 'walkthrough.md'), out.join('\n'));
  writeFileSync(join(done.folder, 'steps.json'), JSON.stringify(said, null, 1));
  add({ who: 'note', text: `Recording saved: ${video}` });
  return { ok: true, video, seconds: Math.round(length), walkthrough: join(done.folder, 'walkthrough.md'), subtitles: join(done.folder, 'session.srt'), private: Boolean(label) };
}

/** Show a line and speak it: it is heard as soon as its audio exists, which for a warm voice is a fraction of a second. */
let spokenLines = 0;
async function sayLine(text) {
  const id = `line-${String(++spokenLines).padStart(4, '0')}`;
  const made = await speak(id, text);
  return add({ who: 'guide', text, audio: made.seconds ? `${id}.wav` : undefined, seconds: made.seconds });
}

// ---- questions ----------------------------------------------------------------------------------
// "Ask": a question typed in the deck or on the console is handed to --ask, a command that gets the
// question and where the person is on its input. It answers by running `guide say` (after pointing
// at the page with the other guide commands, if it likes), or simply by printing the answer. One
// question at a time. WAG_ASK_ID is the same for the whole session and WAG_ASK_N counts the
// questions, so the command can keep one conversation going from the first question to the last.

const talkId = randomUUID();
let questions = 0;
let answering = false;

const promptFor = (text, where = {}, page) =>
  [
    where.deck && `The person is in the guided deck "${where.deck}", on "${where.slide}" (${where.at}).`,
    where.line && `The line said there: "${where.line}"`,
    where.words && `On the slide: ${where.words}`,
    where.buttons && `This step's buttons. ${where.buttons}`,
    where.report && `The last result shown to them: ${where.report}`,
    page?.ok && `The page now: ${page.address}${page.dialog ? `, with the dialog "${page.dialog}" open` : ''}${page.viewerClicks?.length ? `. Their last clicks: ${page.viewerClicks.join('; ')}` : ''}.`,
    `They ask: ${text}`,
  ]
    .filter(Boolean)
    .join('\n');

async function answer(text, where) {
  if (!askCommand) return { ok: false, why: 'This session has nothing to answer questions with. Start it with --ask.' };
  if (!text?.trim()) return { ok: false, why: 'There was no question.' };
  if (answering) return { ok: false, why: 'Still answering the last question.' };
  answering = true;
  add({ who: 'you', text });
  const from = count;
  try {
    const page = bridge ? await Promise.race([toBridge('cmd', { cmd: 'where' }), new Promise((done) => setTimeout(() => done(null), 4000))]) : null;
    const printed = await new Promise((done, fail) => {
      const env = { ...process.env, WAG_ASK_ID: talkId, WAG_ASK_N: String(++questions), GUIDE_SESSION: `http://127.0.0.1:${port}`, GUIDE_KEY_FILE: keyFile };
      const child = spawn('bash', ['-c', askCommand], { stdio: ['pipe', 'pipe', 'inherit'], env });
      let out = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      const timer = setTimeout(() => {
        child.kill();
        fail(new Error('No answer in two minutes.'));
      }, 120000);
      child.on('error', fail);
      child.on('exit', () => {
        clearTimeout(timer);
        done(out.trim());
      });
      child.stdin.on('error', () => {});
      child.stdin.end(promptFor(text, where, page));
    });
    // what the guide said while it answered; if it only printed, that is the answer
    let said = lines.filter((line) => line.n > from && line.who === 'guide');
    if (!said.length && printed) said = [await sayLine(printed)];
    if (!said.length) return { ok: false, why: 'No answer came back.' };
    return { ok: true, said: said.map((line) => ({ text: line.text, audio: line.audio, seconds: line.seconds })) };
  } catch (error) {
    return { ok: false, why: error.message.split('\n')[0] };
  } finally {
    answering = false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // the key arrives in the address once; after that the browser carries it in a cookie, so a deck's
  // own files and audio are as closed to other programs as the bridge is
  const cookie = /(?:^|;\s*)wagkey=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
  const given = req.headers['x-wag-key'] ?? url.searchParams.get('key') ?? cookie;
  if (given !== key()) {
    res.writeHead(401);
    return res.end();
  }
  if (url.searchParams.get('key')) res.setHeader('Set-Cookie', `wagkey=${key()}; Path=/; HttpOnly; SameSite=Strict`);
  const json = (body) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const live = /^\/live\/(\w+)$/.exec(url.pathname)?.[1];
    if (live) return json(await toBridge(live, JSON.parse(body || '{}')));
    if (url.pathname === '/record') return json(JSON.parse(body || '{}').on ? startRecording() : await stopRecording().catch((error) => ({ ok: false, why: error.message.split('\n')[0] })));
    const { text, where } = JSON.parse(body || '{}');
    if (url.pathname === '/heard') return json({ ok: true, n: add({ who: 'you', text }).n });
    if (url.pathname === '/say') {
      const line = await sayLine(text);
      return json({ ok: true, n: line.n, seconds: line.seconds ?? null });
    }
    if (url.pathname === '/ask') return json(await answer(text, where));
  }
  if (url.pathname === '/ask') return json({ ok: true, can: Boolean(askCommand), busy: answering });
  if (deckDir && (url.pathname === '/' ? url.searchParams.has('deck') : !['/console', '/lines', '/events', '/mirror'].includes(url.pathname) && !url.pathname.startsWith('/audio/line-'))) {
    const file = join(deckDir, normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
    if (file.startsWith(deckDir) && existsSync(file) && statSync(file).isFile()) {
      const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/html' });
      return createReadStream(file).pipe(res);
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
