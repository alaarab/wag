#!/usr/bin/env node
// wag: one command for all of it.
//
//   wag new <name>                 a new deck in decks/
//   wag dev | build                work on the decks in a browser, or build them
//   wag make <deck>                a deck's narration, handouts and walk
//   wag live <pack> [--walk DECK]  a live session on an app's pages: the bar, questions, walks
//   wag rehearse <pack> <deck>     play a walk with nobody watching and say which steps work
//   wag guide [--pack PACK] ...    the guide's own commands (where, goto, say, walk next, record ...)
//
// A pack is a folder with a pack.json: everything a session needs to know about one app, kept
// outside this repo if the app is not yours to publish. Every path in it is from the pack's folder.
//
//   app            where the app's pages are: "https://app.example"
//   start          the page the bar opens on when nothing is playing (default "/")
//   decks          the built decks to play (a folder; default "decks")
//   label          shown on the console and stamped on recordings, such as "PRIVATE: real data"
//   pronounce      { "written": "spoken" }, or a file of the same
//   looks          what a dialog button of the app says when it only looks: ["show the sums", ...]
//   changes        what a control of the app says when it changes something: never pressed
//   filesOn        what a button of the app says when it hands over a file: the viewer's own click
//   reads          addresses the app reads from with a POST: ["/api/search"]
//   ask            { command, dir, prompt, model } who answers questions; dir holds notes on the pages
//   browser        { cdp, files, downloads } the browser to drive and where its files go
//   bridge         a command that runs the bridge somewhere else, with {args} where its options go
//   sessions       where session folders and the session's key are kept (default "sessions")
//
// wag live options: --walk DECK starts with that walk, --build uses the browser for building (no
// --live: a tab of its own, downloads kept in the session's files), --port N.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const script = (name) => join(repo, 'scripts', name);
const [command, ...rest] = process.argv.slice(2);

/** Run a program in this terminal and end with its result. Ctrl+C reaches it, so it tidies up after itself. */
function run(program, args, env = {}) {
  const child = spawn(program, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code) => process.exit(code ?? 0));
}

function stop(why) {
  console.error(why);
  process.exit(2);
}

/** A pack, read from its folder or its file. `at` turns one of its paths into a whole one. */
function readPack(where) {
  if (!where || !existsSync(where)) stop(`No pack at "${where ?? ''}". A pack is a folder with a pack.json: see the top of bin/wag.mjs.`);
  const file = statSync(where).isDirectory() ? join(where, 'pack.json') : where;
  if (!existsSync(file)) stop(`${where} has no pack.json.`);
  const home = dirname(resolve(file));
  const pack = JSON.parse(readFileSync(file, 'utf8'));
  if (!pack.app) stop(`${file} does not say where the app is: add "app": "https://...".`);
  const at = (path) => resolve(home, String(path).replace(/^~(?=\/|$)/, homedir()));
  return { ...pack, home, at };
}

const quoted = (word) => `"${String(word).replace(/(["\\$`])/g, '\\$1')}"`;

/** What starts the session for a pack: the program's arguments and the surroundings the answerer needs. */
function sessionFor(pack, { walk, rehearse, build = false, port } = {}) {
  const sessions = pack.at(pack.sessions ?? 'sessions');
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const dir = join(sessions, stamp);
  mkdirSync(dir, { recursive: true });
  const key = join(sessions, 'bridge.token');
  // a rehearsal and a build never use the viewer's own tab or their Downloads
  const live = !build && !rehearse;
  const elsewhere = Boolean(pack.bridge);
  const browser = pack.browser ?? {};
  // with the bridge on this machine its folders are the pack's; on another machine they are that machine's, as written
  const place = (path, fallback) => (elsewhere ? (path ?? null) : path ? pack.at(path) : fallback);
  const files = place(browser.files, join(dir, 'files'));
  const downloads = live ? place(browser.downloads, files) : files;
  const words = (name, list) => (list?.length ? [name, list.join(',')] : []);
  const options = ['--stdio', '--no-open', '--cdp', browser.cdp ?? 'http://127.0.0.1:9333', '--app', pack.app, ...(live ? ['--live'] : []), ...words('--looks', pack.looks), ...words('--changes', pack.changes), ...words('--files-on', pack.filesOn), ...words('--reads', pack.reads), ...(files ? ['--files', files] : []), ...(downloads ? ['--downloads', downloads] : [])];
  const said = options.map((word) => (word.startsWith('--') ? word : quoted(word))).join(' ');
  const bridge = elsewhere ? pack.bridge.replace('{args}', said) : `${quoted(process.execPath)} ${quoted(script('live.mjs'))} ${said}`;
  let pronounce = pack.pronounce;
  if (pronounce && typeof pronounce === 'object') {
    writeFileSync(join(dir, 'pronounce.json'), JSON.stringify(pronounce));
    pronounce = join(dir, 'pronounce.json');
  } else if (pronounce) pronounce = pack.at(pronounce);
  const ask = pack.ask ?? {};
  const args = [
    script('session.mjs'), '--dir', dir, '--key', key, '--bridge', bridge, '--deck', pack.at(pack.decks ?? 'decks'),
    ...(port ? ['--port', String(port)] : []),
    ...(pronounce ? ['--pronounce', pronounce] : []),
    ...(pack.label ? ['--label', pack.label] : []),
    ...(rehearse ? ['--rehearse', rehearse, '--voice', 'none'] : ['--bar', pack.start ?? '/', ...(walk ? ['--walk', walk] : []), ...(ask.command || ask.dir ? ['--ask', ask.command ? pack.at(ask.command) : script('ask.sh')] : [])]),
  ];
  const env = { ...(ask.dir ? { ASK_DIR: pack.at(ask.dir) } : {}), ...(ask.prompt ? { ASK_PROMPT: ask.prompt } : {}), ...(ask.model ? { GUIDE_MODEL: ask.model } : {}), GUIDE_KEY_FILE: key, GUIDE_APP: pack.app };
  return { args, env, dir, key, live };
}

const flag = (name) => (rest.includes(`--${name}`) ? (rest[rest.indexOf(`--${name}`) + 1] ?? true) : undefined);
const plain = () => rest.filter((word, i) => !word.startsWith('--') && !(rest[i - 1]?.startsWith('--') && !['--build'].includes(rest[i - 1])));

if (command === 'new') run(process.execPath, [script('new.mjs'), ...rest]);
else if (command === 'make') run(process.execPath, [script('make.mjs'), ...rest]);
else if (command === 'dev' || command === 'build') run(process.execPath, [join(repo, 'node_modules/vite/bin/vite.js'), ...(command === 'build' ? ['build'] : []), ...rest]);
else if (command === 'guide') {
  // --pack points the guide at that pack's session, so its key and its app need not be put in the shell first
  const pack = rest[0] === '--pack' ? readPack(rest[1]) : null;
  run(process.execPath, [script('guide.mjs'), ...(pack ? rest.slice(2) : rest)], pack ? { GUIDE_KEY_FILE: join(pack.at(pack.sessions ?? 'sessions'), 'bridge.token'), GUIDE_APP: pack.app } : {});
} else if (command === 'live' || command === 'rehearse') {
  const [where, deck] = plain();
  const pack = readPack(where);
  if (command === 'rehearse' && !deck) stop('Which walk? wag rehearse <pack> <deck>');
  const made = sessionFor(pack, { walk: typeof flag('walk') === 'string' ? flag('walk') : undefined, rehearse: command === 'rehearse' ? deck : undefined, build: rest.includes('--build'), port: flag('port') });
  if (command === 'live') {
    console.log(`A live session on ${pack.app}${made.live ? '' : ' (for building: a tab of its own)'}.`);
    console.log('In the tab the guide drives: F2 asks, F8 is Next and Continue. Steps and Walks are in the bar. Ctrl+C here ends it.');
    console.log(`From another terminal: wag guide --pack ${where} where | walk next | record start | ...`);
    console.log(`Kept in ${made.dir}`);
  }
  run(process.execPath, made.args, made.env);
} else {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).map((line) => line.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(command ? 2 : 0);
}
