// npm run make <deck>: writes the files a guided deck plays with, next to the deck's other
// public files, under the folder the deck names in `assets`:
//   audio/<key>.mp3     one per narration line, spoken by Piper (an offline voice)
//   handouts/<slide>.docx  a Word document for each slide that asks for one
//   handouts/<deck>.docx   every slide in one Word document
//   wag.json            what was made, which is how the player finds it
// Nothing here is needed to play a deck: without audio the browser's own voice reads the lines.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx';
import { createServer } from 'vite';

const run = promisify(execFile);
const repo = fileURLToPath(new URL('..', import.meta.url));
const name = process.argv[2];
const outside = process.env.WAG_DECKS ? resolve(process.env.WAG_DECKS) : null;
const homes = [...(outside ? [outside] : []), join(repo, 'decks')];
const home = name ? homes.find((dir) => existsSync(join(dir, `${name}.ts`))) : undefined;
if (!home) {
  console.error(name ? `No deck called "${name}" in ${homes.join(' or ')}` : 'Usage: npm run make <deck>');
  process.exit(1);
}
// the repo's decks keep their files in the repo's public/, an outside folder in its own
const pub = home === outside ? join(home, 'public') : join(repo, 'public');

// decks are TypeScript and import 'wag', so Vite loads them the same way the player's page does
const vite = await createServer({ root: repo, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
let deck, wag;
try {
  wag = await vite.ssrLoadModule('wag');
  deck = (await vite.ssrLoadModule(join(home, `${name}.ts`))).default;
} finally {
  await vite.close();
}
if (!deck.assets) {
  console.error(`${name}: give the deck an \`assets\` folder, such as deck({ assets: '/${name}' }, ...), so there is somewhere to write to`);
  process.exit(1);
}
const out = join(pub, deck.assets);
const made = existsSync(join(out, 'wag.json')) ? JSON.parse(readFileSync(join(out, 'wag.json'), 'utf8')) : {};

// ---- narration audio -------------------------------------------------------------------------

const voiceHome = join(homedir(), '.local/share/wag-voice');
const piper = process.env.WAG_PIPER ?? [join(voiceHome, 'venv/bin/piper'), '/usr/bin/piper'].find(existsSync) ?? 'piper';
const model = process.env.WAG_VOICE ?? join(voiceHome, 'voices/en_US-lessac-high.onnx');
const lines = [...new Set(deck.slides.flatMap((s) => s.narration).map((line) => wag.spoken(deck, line)))];
const audioDir = join(out, 'audio');
const audio = {};

async function canSpeak() {
  if (!existsSync(model)) return false;
  try {
    await run(piper, ['--help']);
    return true;
  } catch {
    return false;
  }
}

if (lines.length && !(await canSpeak())) {
  console.log(`No narration audio written: Piper or its voice was not found (looked for ${piper} and ${model}).`);
  console.log('The browser will read the lines with its own voice. To set Piper up, see "Narration" in the README.');
} else if (lines.length) {
  mkdirSync(audioDir, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'wag-voice-'));
  // a different voice means every line is said again
  const kept = made.voice === model ? (made.audio ?? {}) : {};
  let fresh = 0;
  const speak = async (line) => {
    const key = wag.lineKey(line);
    const file = `${key}.mp3`;
    if (!kept[key] || !existsSync(join(audioDir, file))) {
      const wav = join(scratch, `${key}.wav`);
      const text = join(scratch, `${key}.txt`);
      writeFileSync(text, line);
      await run(piper, ['-m', model, '-i', text, '-f', wav, '--sentence-silence', '0.3', '--length-scale', '1.04']);
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '64k', join(audioDir, file)]);
      fresh++;
    }
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(audioDir, file)]);
    audio[key] = { file, seconds: Math.round(Number(stdout) * 10) / 10 };
  };
  // a few at a time: each one loads the voice, which takes most of a second
  const waiting = [...lines];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let line = waiting.shift(); line !== undefined; line = waiting.shift()) await speak(line);
  }));
  rmSync(scratch, { recursive: true, force: true });
  for (const file of readdirSync(audioDir)) if (!audio[file.replace(/\.mp3$/, '')]) rmSync(join(audioDir, file));
  const total = Object.values(audio).reduce((sum, clip) => sum + clip.seconds, 0);
  console.log(`Narration: ${lines.length} lines, ${fresh} newly spoken, ${Math.round(total / 6) / 10} minutes in all`);
}

// ---- Word handouts ---------------------------------------------------------------------------

const para = (text, options = {}) => new Paragraph({ spacing: { after: 160 }, ...options, children: [new TextRun({ text, ...options.run })] });

/** A picture from the deck's public folder, as wide as the page's text. Only PNG says its size simply. */
function picture(href) {
  const file = join(pub, href);
  if (!href.startsWith('/') || !file.endsWith('.png') || !existsSync(file)) return [];
  const data = readFileSync(file);
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  return [new Paragraph({ spacing: { after: 200 }, children: [new ImageRun({ type: 'png', data, transformation: { width: 624, height: Math.round((624 * height) / width) } })] })];
}

function section(slide) {
  const handout = slide.handout ?? { intro: slide.narration[0], points: slide.narration.slice(1).map((text) => ({ text })) };
  return [
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 160 }, children: [new TextRun(slide.title ?? slide.name ?? '')] }),
    ...(handout.intro ? [para(handout.intro)] : []),
    ...(handout.image ? picture(handout.image) : []),
    ...(handout.points ?? []).flatMap((point) => [
      ...(point.label ? [para(point.label, { spacing: { before: 120, after: 40 }, run: { bold: true } })] : []),
      ...(point.text ? [para(point.text)] : []),
    ]),
  ];
}

const write = async (file, children) => {
  const doc = new Document({
    title: deck.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children: [...(deck.title ? [para(deck.title, { run: { color: '64748B', size: 20 } })] : []), ...children] }],
  });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, await Packer.toBuffer(doc));
};

const handouts = [];
for (const slide of deck.slides) {
  if (!slide.handout) continue;
  const file = wag.handoutFile(deck, slide);
  await write(join(out, 'handouts', file), section(slide));
  handouts.push(file);
}
const told = deck.slides.filter((s) => !s.hidden && s.title && (s.handout || s.narration.length));
let whole;
if (told.length) {
  whole = `handouts/${name}.docx`;
  await write(join(out, whole), told.flatMap(section));
}
console.log(`Handouts: ${handouts.length} slides${whole ? ', and the whole deck as one document' : ''}`);

writeFileSync(join(out, 'wag.json'), JSON.stringify({ voice: Object.keys(audio).length ? model : undefined, audio, handouts, whole }, null, 2));
console.log(`Wrote ${out}`);
