// npm run new <name> [-- --kind slides|ad|training|walkthrough] [--format wide|square|tall]
// A new deck from a starter: a small, whole example of its kind, in a look of its own, with
// narration, ready to play, check and make into a video. It goes in decks/, or in the WAG_DECKS
// folder when that is set. --format is for an ad: wide (16:9), square (1:1) or tall (9:16).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const KINDS = { slides: 'a deck of slides', ad: 'a short ad or promo', training: 'a narrated lesson', walkthrough: 'a walkthrough of a real app' };
const { values: o, positionals } = parseArgs({ allowPositionals: true, options: { kind: { type: 'string', default: 'slides' }, format: { type: 'string', default: 'wide' } } });
const name = positionals[0];
const usage = `Usage: npm run new <name> [-- --kind ${Object.keys(KINDS).join('|')}] [--format wide|square|tall]\n${Object.entries(KINDS).map(([kind, what]) => `  ${kind.padEnd(12)} ${what}`).join('\n')}`;
if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error(`${usage}\nThe name is lowercase letters, digits and dashes, for example: q4-pitch`);
  process.exit(1);
}
if (!KINDS[o.kind] || !['wide', 'square', 'tall'].includes(o.format)) {
  console.error(usage);
  process.exit(1);
}
if (o.format !== 'wide' && o.kind !== 'ad') {
  console.error(`--format ${o.format} is for --kind ad: the other starters are laid out for a wide canvas.`);
  process.exit(1);
}

const repo = fileURLToPath(new URL('..', import.meta.url));
const home = process.env.WAG_DECKS ? resolve(process.env.WAG_DECKS) : join(repo, 'decks');
const file = join(home, `${name}.ts`);
if (existsSync(file)) {
  console.error(`${file} already exists`);
  process.exit(1);
}
const title = name.charAt(0).toUpperCase() + name.slice(1).replaceAll('-', ' ');
// in a headline the last word is the marked one
const marked = title.includes(' ') ? title.replace(/ (\S+)$/, ' *$1*') : `*${title}*`;
const starter = readFileSync(join(repo, 'starters', `${o.kind}.ts`), 'utf8')
  .replaceAll('Starter *title*', marked)
  .replaceAll('Starter title', title)
  .replaceAll('starter-name', name)
  .replace("const FORMAT = 'wide' as Format;", `const FORMAT = '${o.format}' as Format;`);
mkdirSync(home, { recursive: true });
writeFileSync(file, starter);

console.log(`Created ${file}: ${KINDS[o.kind]}${o.kind === 'ad' ? `, ${o.format}` : ''}.`);
console.log(`  Play it      npm run dev, then http://localhost:5179/?deck=${name}`);
console.log(`  Check it     npx wag check ${name}        what does not fit, and a picture of every slide`);
if (o.kind === 'walkthrough') console.log(`  Film the app npx wag film <pack> ${name}   see the top of the file for the steps`);
else console.log(`  Make a video npx wag produce ${name}      its voice, a check and the mp4, in one go`);
