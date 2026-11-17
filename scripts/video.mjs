// npm run video <deck> [-- options]: the deck as an mp4, for an ad, a promo or a training video.
//
// The deck plays in a browser with no window and no bar. Its clock is held and moved on one frame
// at a time, so every spring and fade is drawn whole, however slow the machine. Each slide stays for
// its narration (the audio `npm run make` wrote, laid in afterwards) and then a short pause; a
// slide or step with nothing to say stays for --hold seconds. Lines with no audio are timed as if
// read aloud and stay silent, so run `npm run make <deck>` first for a voice.
//
// Options:
//   --out FILE     where the video goes (default <deck>.mp4 here)
//   --fps N        frames a second (default 30)
//   --height N     the video's height in pixels; the width follows the deck (default 1080)
//   --hold S       seconds a step with no narration stays (default 3)
//   --gap S        seconds after a line before moving on (default 1)
//   --lead S       seconds between a slide arriving and its line starting (default 0.5)
//   --music FILE   a music bed under it all, looped, faded, and dipping while a line is heard
//   --music-volume DB  how loud the bed is (default -12)
//   --no-duck      keep the bed level while lines are heard
//   --captions srt|burn  the lines as subtitles next to the video, or drawn into it as well
//   --look WORD    for a deck made with fresh(seedOr(...)): play it in the look this word makes
// WAG_BROWSER names the Chromium to use when none is found on the PATH.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { assemble } from './media/assemble.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    fps: { type: 'string', default: '30' },
    height: { type: 'string', default: '1080' },
    hold: { type: 'string', default: '3' },
    gap: { type: 'string', default: '1' },
    lead: { type: 'string', default: '0.5' },
    music: { type: 'string' },
    'music-volume': { type: 'string', default: '-12' },
    'no-duck': { type: 'boolean', default: false },
    captions: { type: 'string' },
    look: { type: 'string' },
  },
});
const name = positionals[0];
const fps = Number(o.fps);
const [hold, gap, lead] = [o.hold, o.gap, o.lead].map(Number);
const outside = process.env.WAG_DECKS ? resolve(process.env.WAG_DECKS) : null;
const homes = [...(outside ? [outside] : []), join(repo, 'decks')];
const home = name ? homes.find((dir) => existsSync(join(dir, `${name}.ts`))) : undefined;
if (!home) {
  console.error(name ? `No deck called "${name}" in ${homes.join(' or ')}` : 'Usage: npm run video <deck> [-- --out file.mp4]');
  process.exit(1);
}
const pub = home === outside ? join(home, 'public') : join(repo, 'public');
const here = process.env.INIT_CWD ?? process.cwd();
const out = resolve(here, o.out ?? `${name}.mp4`);
const music = o.music ? { file: resolve(here, o.music), volume: Number(o['music-volume']), duck: !o['no-duck'] } : undefined;
if (music && !existsSync(music.file)) {
  console.error(`No music at ${music.file}`);
  process.exit(1);
}
if (o.captions && !['srt', 'burn'].includes(o.captions)) {
  console.error('--captions is srt or burn');
  process.exit(1);
}

const BROWSERS = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'microsoft-edge'];
const browserPath = process.env.WAG_BROWSER ?? BROWSERS.map((b) => { try { return execFileSync('which', [b], { encoding: 'utf8' }).trim(); } catch { return ''; } }).find(Boolean);
if (!browserPath) {
  console.error('No Chromium found: install one, or set WAG_BROWSER to its path.');
  process.exit(1);
}

const vite = await createServer({ root: repo, server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await vite.listen();
const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
const wag = await vite.ssrLoadModule('wag');
const deck = (await vite.ssrLoadModule(join(home, `${name}.ts`))).default;

// ---- the plan: when each step starts, and when each line is heard ------------------------------

const made = deck.assets && existsSync(join(pub, deck.assets, 'wag.json')) ? JSON.parse(readFileSync(join(pub, deck.assets, 'wag.json'), 'utf8')) : {};
const moves = []; // seconds at which the deck takes its next step
const said = []; // { at, seconds, text, file? }
let t = 0;
let silent = 0;
const shown = deck.slides.filter((s) => !s.hidden);
shown.forEach((slide, n) => {
  for (let step = -1; step < slide.steps.length; step++) {
    if (n > 0 || step > -1) moves.push(t);
    const line = slide.narration[step + 1];
    if (!line) {
      t += hold;
      continue;
    }
    const clip = made.audio?.[wag.lineKey(wag.spoken(deck, line))];
    const seconds = clip ? clip.seconds : 1.5 + line.length * 0.065;
    said.push({ at: t + lead, seconds, text: line, file: clip && join(pub, deck.assets, 'audio', clip.file) });
    if (!clip) silent++;
    t += lead + seconds + gap;
  }
});
const total = t + 0.5;
const frames = Math.ceil(total * fps);
if (silent) console.log(`${silent} line${silent === 1 ? ' has' : 's have'} no audio and will be silent: run npm run make ${name} for a voice.`);
console.log(`${name}: ${shown.length} slides, ${Math.round(total)} s, ${frames} frames at ${fps} fps`);

// ---- the browser, with its clock in our hands --------------------------------------------------

const scale = Number(o.height) / deck.height;
const browser = await chromium.launch({ executablePath: browserPath, args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
let encoder;
try {
  const page = await browser.newPage({ viewport: { width: deck.width, height: deck.height }, deviceScaleFactor: scale, reducedMotion: 'no-preference' });
  page.on('pageerror', (error) => console.error(`The deck failed: ${error.message}`));
  await page.clock.install({ time: 0 });
  await page.goto(`${origin}/?deck=${encodeURIComponent(name)}&video${o.look ? `&look=${encodeURIComponent(o.look)}` : ''}`);
  await page.waitForFunction(() => window.wagVideo, null, { polling: 100, timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));

  // Animations the compositor runs (Motion's springs and fades, CSS transitions) do not follow the
  // page's clock, so each frame sets them to where they would be by now, from when each one began.
  await page.evaluate(() => {
    const began = new WeakMap();
    window.wagFrame = async (now) => {
      for (const a of document.getAnimations()) {
        if (!began.has(a)) {
          began.set(a, now);
          a.pause();
        }
        if (a.playState === 'finished' || a.playState === 'idle') continue;
        const local = now - began.get(a);
        const end = a.effect?.getComputedTiming().endTime ?? Infinity;
        if (Number.isFinite(end) && local >= end) a.finish();
        else a.currentTime = local;
      }
      const films = [...document.querySelectorAll('video')].filter((v) => v.offsetParent && v.duration);
      await Promise.all(films.map((v) => {
        if (!began.has(v)) {
          began.set(v, now);
          v.pause();
        }
        const local = (now - began.get(v)) / 1000;
        v.currentTime = v.loop ? local % v.duration : Math.min(local, v.duration);
        return new Promise((done) => v.addEventListener('seeked', done, { once: true }));
      }));
      // a typeface is fetched the first time a slide uses it: lay the page out, then wait for it
      void document.body.offsetHeight;
      await document.fonts.ready;
      // a picture that is still on its way would be missing from this frame
      await Promise.all([...document.images].filter((img) => !img.complete).map((img) => new Promise((done) => (img.onload = img.onerror = done))));
    };
    window.wagPlayer = window.wagVideo.start();
  });

  // ---- frames into ffmpeg ------------------------------------------------------------------------

  encoder = assemble({ pictures: { pipe: fps }, length: total, out, lines: said, music, captions: o.captions, label: undefined });

  const cdp = await page.context().newCDPSession(page);
  let next = 0;
  const began = Date.now();
  for (let f = 0; f < frames; f++) {
    const now = (f * 1000) / fps;
    if (f > 0) await page.clock.runFor(1000 / fps);
    while (next < moves.length && moves[next] * 1000 <= now) {
      await page.evaluate(() => window.wagPlayer.next());
      next++;
    }
    await page.evaluate((ms) => window.wagFrame(ms), now);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
    await encoder.write(Buffer.from(data, 'base64'));
    if (f % (fps * 5) === 0) process.stdout.write(`\r${Math.round((f / frames) * 100)}%`);
  }
  const { subtitles } = await encoder.end();
  console.log(`\rWrote ${out} (${Math.round(total)} s, made in ${Math.round((Date.now() - began) / 1000)} s)${subtitles ? `, and ${subtitles}` : ''}`);
} catch (error) {
  encoder?.stop();
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await vite.close();
}
