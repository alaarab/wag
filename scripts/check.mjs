// wag check <deck>: plays every slide and step with nobody watching and says what does not fit,
// then writes a picture of every slide and one sheet of them all, so a deck can be looked at before
// anyone else sees it. It looks for:
//
//   problems   text taller or wider than its box, a deck that fails to load or throws
//   warnings   words that run off the canvas, text lying over other text, text too close in
//              colour to what is behind it, a narration line too long to follow
//   notes      lines with no audio yet, slides that say nothing in a deck that talks
//
// It ends with 1 when there is a problem (with --strict, a warning too), so it can gate a video.
// Options: --out DIR (default ./wag-check/<deck>), --look WORD (as npm run video), --strict,
// --settle S (seconds each step is given to finish moving, default 5).
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { deckHomes, findDeck, openStage, plan } from './media/stage.mjs';

const run = promisify(execFile);
const { values: o, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, look: { type: 'string' }, strict: { type: 'boolean', default: false }, settle: { type: 'string', default: '5' } } });
const name = positionals[0];
const where = findDeck(name);
if (!where) {
  console.error(name ? `No deck called "${name}" in ${deckHomes().join(' or ')}` : 'Usage: wag check <deck>');
  process.exit(2);
}
const out = resolve(process.env.INIT_CWD ?? process.cwd(), o.out ?? join('wag-check', name));

/** What is on the page now that does not fit. Runs in the page; coordinates are deck pixels. */
function inspect() {
  const found = [];
  const nodes = [...document.querySelectorAll('[data-wag]')].filter((node) => node.offsetParent !== null);
  if (!nodes.length) return found;
  const frame = nodes[0].parentElement.getBoundingClientRect();
  const rgba = (text) => {
    const m = /rgba?\(([^)]+)\)/.exec(text ?? '');
    if (!m) return null;
    const [r, g, b, a = '1'] = m[1].split(/[ ,/]+/).filter(Boolean);
    return [Number(r), Number(g), Number(b), Number(a)];
  };
  const lum = ([r, g, b]) => {
    const [x, y, z] = [r, g, b].map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * x + 0.7152 * y + 0.0722 * z;
  };
  const words = (node) => node.textContent.replace(/\s+/g, ' ').trim();
  const short = (text) => (text.length > 46 ? `${text.slice(0, 44)}…` : text);
  const seen = [];
  for (const node of nodes) {
    const style = getComputedStyle(node);
    const kind = node.dataset.kind;
    if ('decor' in node.dataset || Number(style.opacity) < 0.3 || style.visibility === 'hidden') continue;
    const box = node.getBoundingClientRect();
    const at = { x: Math.round(box.left - frame.left), y: Math.round(box.top - frame.top), w: Math.round(box.width), h: Math.round(box.height) };
    const text = ['text', 'box', 'ellipse'].includes(kind) ? words(node) : '';
    const what = text ? `"${short(text)}"` : `the ${kind} "${node.dataset.wag}"`;
    // off the canvas: a little is a choice (a tilted card), a lot is a mistake
    const over = Math.max(frame.left - box.left, box.right - frame.right, frame.top - box.top, box.bottom - frame.bottom);
    // something bigger than the canvas is meant to bleed (a picture zoomed in on one part)
    const bleeds = box.width > frame.width + 6 || box.height > frame.height + 6;
    if (over > 6 && kind !== 'scene' && !bleeds) found.push({ level: 'warning', id: node.dataset.wag, at, what: `${what} runs ${Math.round(over)} px off the canvas` });
    if (!text) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const ink = range.getBoundingClientRect();
    const size = parseFloat(style.fontSize);
    const turned = /matrix\((?!1, 0, 0, 1,)/.test(style.transform) && !/^matrix\(([\d.]+), 0, 0, \1,/.test(style.transform);
    const tall = turned ? node.scrollHeight - node.clientHeight : ink.height - box.height;
    const wide = turned ? node.scrollWidth - node.clientWidth : ink.width - box.width;
    if (tall > Math.max(4, size * 0.2)) found.push({ level: 'problem', id: node.dataset.wag, at, what: `${what} is ${Math.round(tall)} px taller than its box (${at.h} px): give it more height, fewer words or a smaller fontSize` });
    else if (wide > Math.max(4, size * 0.2)) found.push({ level: 'problem', id: node.dataset.wag, at, what: `${what} is ${Math.round(wide)} px wider than its box (${at.w} px): give it more width or a smaller fontSize` });
    if (kind !== 'text') continue;
    // text over text
    for (const other of seen) {
      const w = Math.min(ink.right, other.ink.right) - Math.max(ink.left, other.ink.left);
      const h = Math.min(ink.bottom, other.ink.bottom) - Math.max(ink.top, other.ink.top);
      if (w > 2 && h > 2 && w * h > 0.15 * Math.min(ink.width * ink.height, other.ink.width * other.ink.height)) found.push({ level: 'warning', id: node.dataset.wag, at, what: `${what} lies over "${short(other.text)}"` });
    }
    seen.push({ ink, text });
    // text against what is behind it: the first thing under its middle that has a colour of its own
    const colour = rgba(style.color);
    if (!colour || colour[3] < 0.5 || style.backgroundClip === 'text' || node.querySelector('[style*="background-clip"]')) continue;
    let ground = null;
    for (const under of document.elementsFromPoint(ink.left + ink.width / 2, ink.top + ink.height / 2)) {
      if (under === node || node.contains(under)) continue;
      const below = getComputedStyle(under);
      if (under.tagName === 'IMG' || under.tagName === 'VIDEO' || under.tagName === 'CANVAS' || (below.backgroundImage !== 'none' && under.dataset.kind !== 'scene' && !under.closest('[data-kind="scene"]'))) {
        ground = null;
        break;
      }
      const fill = rgba(below.backgroundColor);
      if (fill && fill[3] > 0.6) {
        ground = fill;
        break;
      }
    }
    if (!ground) continue;
    const [a, b] = [lum(colour), lum(ground)].sort((p, q) => q - p);
    const contrast = (a + 0.05) / (b + 0.05);
    if (contrast < (size >= 24 ? 2.4 : 2.9)) found.push({ level: 'warning', id: node.dataset.wag, at, what: `${what} is hard to read: its colour is too close to what is behind it (contrast ${contrast.toFixed(1)})` });
  }
  return found;
}

let stage;
const report = { deck: name, at: new Date().toISOString(), slides: [], found: [] };
// the same thing on every step of a slide is said once, where it first shows
const told = new Set();
const add = (entry) => {
  const key = `${entry.slide ?? entry.where}|${entry.id ?? ''}|${entry.what}`;
  if (told.has(key)) return;
  told.add(key);
  report.found.push(entry);
};
try {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  stage = await openStage(where, { look: o.look, size: 720 });
  const { deck, wag, made } = stage;
  const { steps, said, shown, total } = plan(deck, wag, made, where, deck.video);
  const settle = Number(o.settle) * 1000;
  const pictures = [];
  for (const [i, step] of steps.entries()) {
    if (i > 0) await stage.next();
    await stage.to(stage.now + settle, 250);
    const label = `${step.slide + 1}${step.title ? ` ${step.title}` : step.name ? ` ${step.name}` : ''}${step.step >= 0 ? `, step ${step.step + 1}` : ''}`;
    for (const item of await stage.page.evaluate(inspect)) add({ ...item, slide: step.slide + 1, step: step.step + 1, where: label });
    // one picture a slide: as it stands after its last step
    if (steps[i + 1]?.slide !== step.slide) {
      const file = join(out, `${String(step.slide + 1).padStart(2, '0')}.jpg`);
      writeFileSync(file, await stage.shot());
      pictures.push(file);
      report.slides.push({ n: step.slide + 1, name: step.name, title: step.title, picture: file });
    }
  }
  for (const error of stage.errors) add({ level: 'problem', where: 'the deck', what: `threw while playing: ${error}` });

  // the words
  const talks = said.length > 0;
  for (const line of said) if (line.text.length > 280) add({ level: 'warning', where: 'narration', what: `a line is ${line.text.length} characters long, too long to follow in one go: "${line.text.slice(0, 60)}…". Split it across steps or slides` });
  const silent = said.filter((line) => !line.file).length;
  if (silent) add({ level: 'note', where: 'narration', what: `${silent} of ${said.length} lines have no audio yet: run "wag make ${name}"` });
  if (talks) shown.forEach((slide, n) => slide.narration.length || add({ level: 'note', where: `${n + 1}${slide.title ? ` ${slide.title}` : ''}`, what: 'says nothing, in a deck that talks: in a video it only stays for the hold time' }));
  const hidden = deck.slides.length - shown.length;
  if (hidden) add({ level: 'note', where: 'the deck', what: `${hidden} hidden slide${hidden === 1 ? ' is' : 's are'} not looked at: only a button reaches ${hidden === 1 ? 'it' : 'them'}` });

  // every slide on one sheet, numbered
  const across = Math.min(pictures.length, deck.width >= deck.height ? 3 : 5);
  const wide = deck.width >= deck.height ? 560 : 320;
  const sheet = join(out, 'sheet.jpg');
  const tiles = pictures.map((_, i) => `[${i}:v]scale=${wide}:-2,drawtext=text='${i + 1}':x=10:y=10:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=8[t${i}]`).join(';');
  await run('ffmpeg', ['-y', '-loglevel', 'error', ...pictures.flatMap((file) => ['-i', file]), '-filter_complex', `${tiles};${pictures.map((_, i) => `[t${i}]`).join('')}concat=n=${pictures.length}:v=1:a=0,tile=${across}x${Math.ceil(pictures.length / across)}:padding=6:color=0x202020`, '-frames:v', '1', '-q:v', '3', sheet]);
  report.sheet = sheet;
  report.seconds = Math.round(total);

  const count = (level) => report.found.filter((item) => item.level === level).length;
  console.log(`${name}: ${shown.length} slides, ${steps.length} steps, about ${Math.round(total)} s as a video${deck.title ? ` ("${deck.title}")` : ''}`);
  for (const level of ['problem', 'warning', 'note']) {
    for (const item of report.found.filter((f) => f.level === level)) console.log(`  ${level.padEnd(8)} ${item.where}: ${item.what}${item.at ? ` [at ${item.at.x},${item.at.y}, ${item.at.w}x${item.at.h}]` : ''}`);
  }
  console.log(count('problem') + count('warning') ? `${count('problem')} problem${count('problem') === 1 ? '' : 's'}, ${count('warning')} warning${count('warning') === 1 ? '' : 's'}.` : 'Nothing out of place.');
  console.log(`Look at it: ${sheet} (every slide), and ${out}/NN.jpg for one slide`);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
  process.exitCode = count('problem') || (o.strict && count('warning')) ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await stage?.close();
}
