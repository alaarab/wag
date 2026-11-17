// npm run video <deck> [-- options]: the deck as an mp4, for an ad, a promo or a training video.
//
// The deck plays in a browser with no window and no bar. Its clock is held and moved on one frame
// at a time, so every spring and fade is drawn whole, however slow the machine. Each slide stays for
// its narration (the audio `npm run make` wrote, laid in afterwards) and then a short pause; a
// slide or step with nothing to say stays for --hold seconds. Lines with no audio are timed as if
// read aloud and stay silent, so run `npm run make <deck>` first for a voice.
//
// A deck says how its own video is made with `deck({ video: { music, captions, hold, ... } })`.
// A flag here wins over that:
//   --out FILE     where the video goes (default <deck>.mp4 here)
//   --fps N        frames a second (default 30)
//   --size N       the video's shorter side in pixels (default 1080); --height N sets its height instead
//   --hold S       seconds a step with no narration stays (default 3)
//   --gap S        seconds after a line before moving on (default 1)
//   --lead S       seconds between a slide arriving and its line starting (default 0.5)
//   --music FILE   a music bed under it all, looped, faded, and dipping while a line is heard
//   --music-volume DB  how loud the bed is (default -12)
//   --no-duck      keep the bed level while lines are heard
//   --captions srt|burn  the lines as subtitles next to the video, or drawn into it as well
//   --look WORD    for a deck made with fresh(seedOr(...)): play it in the look this word makes
// WAG_BROWSER names the Chromium to use when none is found on the PATH.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { assemble } from './media/assemble.mjs';
import { deckHomes, findDeck, openStage, plan } from './media/stage.mjs';

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    fps: { type: 'string' },
    size: { type: 'string' },
    height: { type: 'string' },
    hold: { type: 'string' },
    gap: { type: 'string' },
    lead: { type: 'string' },
    music: { type: 'string' },
    'music-volume': { type: 'string' },
    'no-duck': { type: 'boolean', default: false },
    captions: { type: 'string' },
    look: { type: 'string' },
  },
});
const name = positionals[0];
const where = findDeck(name);
if (!where) {
  console.error(name ? `No deck called "${name}" in ${deckHomes().join(' or ')}` : 'Usage: npm run video <deck> [-- --out file.mp4]');
  process.exit(1);
}
const here = process.env.INIT_CWD ?? process.cwd();
const out = resolve(here, o.out ?? `${name}.mp4`);
if (o.captions && !['srt', 'burn'].includes(o.captions)) {
  console.error('--captions is srt or burn');
  process.exit(1);
}

let stage, encoder;
try {
  // the deck is read once for its own settings, then opened at the size they give
  stage = await openStage(where, { look: o.look, size: 1080 });
  const set = stage.deck.video ?? {};
  const number = (flag, own, fallback) => Number(flag ?? own ?? fallback);
  const fps = number(o.fps, set.fps, 30);
  const short = Math.min(stage.deck.width, stage.deck.height);
  const size = o.height ? (Number(o.height) * short) / stage.deck.height : number(o.size, set.size, 1080);
  if (size !== 1080) {
    await stage.close();
    stage = await openStage(where, { look: o.look, size });
  }
  const { deck, wag, made } = stage;
  // a flag's music is a file from here; the deck's own is one of its public files
  const musicFile = o.music ? resolve(here, o.music) : set.music ? join(where.pub, set.music) : null;
  if (musicFile && !existsSync(musicFile)) throw new Error(`No music at ${musicFile}`);
  const music = musicFile ? { file: musicFile, volume: number(o['music-volume'], set.musicVolume, -12), duck: !o['no-duck'] && set.duck !== false } : undefined;
  const captions = o.captions ?? set.captions;

  const { moves, said, shown, total } = plan(deck, wag, made, where, { hold: number(o.hold, set.hold, 3), gap: number(o.gap, set.gap, 1), lead: number(o.lead, set.lead, 0.5) });
  const frames = Math.ceil(total * fps);
  const silent = said.filter((line) => !line.file).length;
  if (silent) console.log(`${silent} line${silent === 1 ? ' has' : 's have'} no audio and will be silent: run npm run make ${name} for a voice.`);
  console.log(`${name}: ${shown.length} slides, ${Math.round(total)} s, ${frames} frames at ${fps} fps, ${Math.round((deck.width * size) / short)}x${Math.round((deck.height * size) / short)}`);

  encoder = assemble({ pictures: { pipe: fps }, length: total, out, lines: said, music, captions, shape: [deck.width, deck.height] });
  let next = 0;
  const began = Date.now();
  for (let f = 0; f < frames; f++) {
    const now = (f * 1000) / fps;
    await stage.to(now, 1000 / fps);
    let moved = false;
    while (next < moves.length && moves[next] * 1000 <= now) {
      await stage.next();
      next++;
      moved = true;
    }
    // what a step starts is set to this frame's time before its picture is taken
    if (moved) await stage.page.evaluate((ms) => window.wagFrame(ms), now);
    await encoder.write(await stage.shot());
    if (f % (fps * 5) === 0) process.stdout.write(`\r${Math.round((f / frames) * 100)}%`);
  }
  const { subtitles } = await encoder.end();
  for (const error of stage.errors) console.error(`The deck failed: ${error}`);
  console.log(`\rWrote ${out} (${Math.round(total)} s, made in ${Math.round((Date.now() - began) / 1000)} s)${subtitles ? `, and ${subtitles}` : ''}`);
} catch (error) {
  encoder?.stop();
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await stage?.close();
}
