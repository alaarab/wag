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
//   guide turn "Correcting entry" --says "It downloads a workbook; nothing is saved" --file "correcting-entry*" --as entry
//   guide check '<json list of checks>'
//   guide say "One or two sentences."      (shown as text and spoken)      guide heard "what the person asked"
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
  check: () => ({ items: JSON.parse(words[0]) }),
};

let answer;
if (cmd === 'say' || cmd === 'heard') {
  // the talking half of the session: say shows the line and speaks it, heard notes what the person asked
  const session = process.env.GUIDE_SESSION ?? 'http://127.0.0.1:5191';
  answer = await fetch(`${session}/${cmd}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wag-Key': key }, body: JSON.stringify({ text: words.join(' ') }) }).then((r) => (r.ok ? r.json() : { ok: false, why: `session answered ${r.status}` }), () => ({ ok: false, why: 'the session console is not running' }));
} else if (cmd === 'turn') {
  // ring it, say what the click does, and wait for the viewer: for a page state, or for a file they download
  const until = { url: flags.url, see: flags.see ? target(flags.see) : undefined, file: flags.file ? { like: flags.file, as: flags.as ?? 'download' } : undefined };
  const live = { turn: { point: target(words[0]), says: flags.says ?? '', until } };
  const end = Date.now() + Number(flags.wait ?? 180) * 1000;
  answer = await post('turn', { live });
  while (answer.ok && !answer.reached && Date.now() < end) answer = await post('turn', { live, again: true });
} else if (bodies[cmd]) answer = await post('cmd', { cmd, ...bodies[cmd]() });
else {
  console.error(`Unknown command "${cmd ?? ''}". Commands: ${Object.keys(bodies).join(', ')}, turn, say, heard`);
  process.exit(2);
}
console.log(JSON.stringify(answer, null, 1));
process.exit(answer.ok ? 0 : 1);
