#!/usr/bin/env node
// guide: one small command to the live bridge, for a live session.
//   guide where
//   guide goto "/app.html?month=marzember"
//   guide find "Biscuits"
//   guide read                      (the open dialog, or the page)      guide read "Snack budget watch"
//   guide highlight "412.50" --note "This is the amount"  [--in dialog]
//   guide click "Biscuits bought on the tea budget"    (look-only: the bridge refuses anything that changes something)
//   guide choose "Marzember" --from "role=combobox:Month"
//   guide scroll "Tea refund"   |   guide close   |   guide clear   |   guide screenshot name
//   guide turn "Download the entry" --says "It downloads a workbook; nothing is saved" --file "correcting-entry*" --as entry
//   guide check '<json list of checks>'
//   guide record start   |   guide record stop      (a video, subtitles and a written walkthrough of the session)
//   guide record stop --gif [--width 960]           (GIFs as well: the whole recording, and one for each step of a walk)
//   guide say "One or two sentences."      (shown as text and spoken)      guide heard "what the person asked"
//   guide say "It is this figure." --point "412.50" --note "The amount"       (rings that part of the page, then says it: one command)
//   guide open "what was asked, in your words" --why "the pages do not show it"     (kept in the session's list for later)
//   guide walk start <deck>   |   guide walk next   |   guide walk back   |   guide walk stop     (a deck's steps played on the page)
//   guide walk goto 7   |   guide walk goto "words from a step's title"   |   guide walk list     (jump to a step; the walks and steps there are)
// A target is the words on the page. Forms: "css=#id", "role=button:Name". --in dialog narrows it; --last takes the last match.
// It talks to scripts/session.mjs, which passes commands on to the bridge. GUIDE_SESSION is its address
// (default http://127.0.0.1:5191) and GUIDE_KEY_FILE where it wrote its key (default ~/.cache/wag/bridge.token).
// GUIDE_BRIDGE points straight at a bridge that listens by itself instead.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const words = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  else words.push(rest[i]);
}
const target = (text) => {
  if (text === undefined) return undefined;
  const t = text.startsWith('css=') ? { css: text.slice(4) } : text.startsWith('role=') ? { role: text.slice(5).split(':')[0], name: text.slice(5).split(':').slice(1).join(':') || undefined } : { text };
  if (flags.in) t.within = flags.in;
  if (flags.last) t.last = true;
  if (flags.exact) t.exact = true;
  return t;
};
const bridge = process.env.GUIDE_BRIDGE ?? process.env.GUIDE_SESSION ?? 'http://127.0.0.1:5191';
const key = readFileSync(process.env.GUIDE_KEY_FILE ?? join(homedir(), '.cache/wag/bridge.token'), 'utf8').trim();
const post = (route, body) => fetch(`${bridge}/live/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wag-Key': key }, body: JSON.stringify(body) }).then((r) => (r.ok ? r.json() : { ok: false, why: `bridge answered ${r.status}` }));

const bodies = {
  where: () => ({}),
  goto: () => ({ to: words[0], app: process.env.GUIDE_APP }),
  find: () => ({ text: words[0], most: Number(flags.most ?? 8) }),
  read: () => ({ target: target(words[0]), most: flags.most ? Number(flags.most) : undefined }),
  highlight: () => ({ target: target(words[0]), note: flags.note }),
  scroll: () => ({ target: target(words[0]), by: flags.by ? Number(flags.by) : undefined }),
  click: () => ({ target: target(words[0]) }),
  choose: () => ({ option: words[0], from: target(flags.from) }),
  close: () => ({}),
  clear: () => ({}),
  screenshot: () => ({ as: words[0] }),
  download: () => ({ target: target(words[0]), as: flags.as ?? 'download' }),
  capture: () => ({ target: target(words[0]), as: flags.as ?? 'file' }),
  check: () => ({ items: JSON.parse(words[0]) }),
};

let answer;
if (cmd === 'record') {
  // record start | record stop: the page, the voice and the words, made into a video and a written walkthrough
  const session = process.env.GUIDE_SESSION ?? 'http://127.0.0.1:5191';
  answer = await fetch(`${session}/record`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wag-Key': key }, body: JSON.stringify({ on: words[0] !== 'stop', gif: Boolean(flags.gif), width: flags.width ? Number(flags.width) : undefined }) }).then((r) => r.json(), () => ({ ok: false, why: 'the session console is not running' }));
} else if (cmd === 'open' || cmd === 'walk') {
  // open: something for the person to follow up later. walk: step a deck's walk on the page.
  const session = process.env.GUIDE_SESSION ?? 'http://127.0.0.1:5191';
  const body = cmd === 'open' ? { text: words.join(' '), why: flags.why } : { go: words[0] ?? 'next', deck: words[1], to: words.slice(1).join(' ') || undefined };
  answer = await fetch(`${session}/${cmd}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wag-Key': key }, body: JSON.stringify(body) }).then((r) => (r.ok ? r.json() : { ok: false, why: `session answered ${r.status}` }), () => ({ ok: false, why: 'the session console is not running' }));
} else if (cmd === 'say' || cmd === 'heard') {
  // the talking half of the session: say shows the line and speaks it, heard notes what the person asked
  const session = process.env.GUIDE_SESSION ?? 'http://127.0.0.1:5191';
  // say --point: ring that part of the page first, so pointing and answering are one command
  const pointed = cmd === 'say' && typeof flags.point === 'string' ? await post('cmd', { cmd: 'highlight', target: target(flags.point), note: typeof flags.note === 'string' ? flags.note : undefined }) : null;
  answer = await fetch(`${session}/${cmd}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wag-Key': key }, body: JSON.stringify({ text: words.join(' ') }) }).then((r) => (r.ok ? r.json() : { ok: false, why: `session answered ${r.status}` }), () => ({ ok: false, why: 'the session console is not running' }));
  if (pointed && !pointed.ok) answer.pointed = `It was said, but not pointed at: ${pointed.why}`;
} else if (cmd === 'turn') {
  // ring it, say what the click does, and wait for the viewer: for a page state, or for a file they download
  const until = { url: flags.url, see: flags.see ? target(flags.see) : undefined, file: flags.file ? { like: flags.file, as: flags.as ?? 'download' } : undefined };
  const live = { turn: { point: target(words[0]), says: flags.says ?? '', until } };
  const end = Date.now() + Number(flags.wait ?? 180) * 1000;
  answer = await post('turn', { live });
  while (answer.ok && !answer.reached && Date.now() < end) answer = await post('turn', { live, again: true });
} else if (bodies[cmd]) answer = await post('cmd', { cmd, ...bodies[cmd]() });
else {
  console.error(`Unknown command "${cmd ?? ''}". Commands: ${Object.keys(bodies).join(', ')}, turn, say, heard, open, walk, record`);
  process.exit(2);
}
console.log(JSON.stringify(answer, null, 1));
process.exit(answer.ok ? 0 : 1);
