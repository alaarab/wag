// wag produce <deck> [video options]: from a deck to its finished video in one go.
//
//   1. make    the narration audio, handouts and walk (in the voice the deck names, or WAG_TTS)
//   2. check   every slide played and looked at; a problem stops it here (--force goes on anyway)
//   3. video   the mp4, with the music and captions the deck asks for in `video: { ... }`
//
// Anything after the deck's name goes to the video step: --out, --look, --music, --captions, ...
// --no-make skips the first step, for a deck whose audio is already made.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const name = args.find((word) => !word.startsWith('--'));
if (!name) {
  console.error('Usage: wag produce <deck> [--out file.mp4] [--look WORD] [--force] [--no-make]');
  process.exit(2);
}
const flags = new Set(['--force', '--no-make']);
const rest = args.filter((word) => word !== name && !flags.has(word));
const lookAt = rest.includes('--look') ? ['--look', rest[rest.indexOf('--look') + 1]] : [];
const step = (title, script, more) => {
  console.log(`\n== ${title} ==`);
  return spawnSync(process.execPath, [join(here, script), name, ...more], { stdio: 'inherit' }).status ?? 1;
};

if (!args.includes('--no-make') && step('Voice and handouts', 'make.mjs', []) !== 0) process.exit(1);
const checked = step('Check', 'check.mjs', lookAt);
if (checked !== 0 && !args.includes('--force')) {
  console.error('\nStopped: mend the problems above and run it again, or add --force to make the video anyway.');
  process.exit(1);
}
process.exit(step('Video', 'video.mjs', rest));
