// A deck on a stage of its own: in a browser with no window and no bar, with its clock in our
// hands. `npm run video` films it frame by frame; `wag check` walks it and reads what is on each slide.
//
//   const where = findDeck('promo')            // { name, home, pub } or null
//   const stage = await openStage(where, { size: 1080, look })
//   await stage.to(1500)                       // the clock moved on to 1.5 s, every animation with it
//   await stage.next()                         // the deck's next step
//   const jpeg = await stage.shot()            // what is on the page now
//   await stage.close()
//
// WAG_BROWSER names the Chromium to use when none is found on the PATH.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

export const repo = fileURLToPath(new URL('../..', import.meta.url));

/** Where decks are looked for: the WAG_DECKS folder first, then the repo's own. */
export function deckHomes() {
  const outside = process.env.WAG_DECKS ? resolve(process.env.WAG_DECKS) : null;
  return [...(outside ? [outside] : []), join(repo, 'decks')];
}

/** A deck by name: the folder it is in, and the public folder its files are served from. */
export function findDeck(name) {
  const home = name ? deckHomes().find((dir) => existsSync(join(dir, `${name}.ts`))) : undefined;
  if (!home) return null;
  return { name, home, pub: home === join(repo, 'decks') ? join(repo, 'public') : join(home, 'public') };
}

const BROWSERS = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'microsoft-edge'];
export function findBrowser() {
  if (process.env.WAG_BROWSER) return process.env.WAG_BROWSER;
  for (const name of BROWSERS) {
    try {
      return execFileSync('which', [name], { encoding: 'utf8' }).trim();
    } catch {}
  }
  return null;
}

/** What `npm run make` wrote for a deck, or {} when it has not been made. */
export function madeFor(where, deck) {
  const file = deck.assets && join(where.pub, deck.assets, 'wag.json');
  return file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

/**
 * When each step of a deck starts and when each line is heard, in seconds from the start: how a
 * video of it is timed. A line with audio takes as long as its audio; one without is timed as if
 * read aloud; a step with nothing to say stays for `hold`.
 */
export function plan(deck, wag, made, where, { hold = 3, gap = 1, lead = 0.5 } = {}) {
  const moves = [];
  const said = [];
  const steps = [];
  let t = 0;
  const shown = deck.slides.filter((s) => !s.hidden);
  shown.forEach((slide, n) => {
    for (let step = -1; step < slide.steps.length; step++) {
      if (n > 0 || step > -1) moves.push(t);
      const line = slide.narration[step + 1];
      const from = t;
      if (!line) t += hold;
      else {
        const clip = made.audio?.[wag.lineKey(wag.spoken(deck, line))];
        const seconds = clip ? clip.seconds : 1.5 + line.length * 0.065;
        said.push({ at: t + lead, seconds, text: line, file: clip ? join(where.pub, deck.assets, 'audio', clip.file) : undefined });
        t += lead + seconds + gap;
      }
      steps.push({ slide: n, step, name: slide.name, title: slide.title, line, from, until: t });
    }
  });
  return { moves, said, steps, shown, total: t + 0.5 };
}

/** Open the deck on its stage. `size` is the shorter side of the pictures, in pixels. */
export async function openStage(where, { size = 1080, look } = {}) {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error('No Chromium found: install one, or set WAG_BROWSER to its path.');
  // vite says nothing itself: a deck that does not load is reported by whoever opened the stage
  const vite = await createServer({ root: repo, server: { port: 0, host: '127.0.0.1' }, logLevel: 'silent' });
  await vite.listen();
  let browser;
  try {
    const origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
    const wag = await vite.ssrLoadModule('wag');
    const deck = (await vite.ssrLoadModule(join(where.home, `${where.name}.ts`))).default;
    const scale = size / Math.min(deck.width, deck.height);
    browser = await chromium.launch({ executablePath: browserPath, args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
    const page = await browser.newPage({ viewport: { width: deck.width, height: deck.height }, deviceScaleFactor: scale, reducedMotion: 'no-preference' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: 0 });
    await page.goto(`${origin}/?deck=${encodeURIComponent(where.name)}&video${look ? `&look=${encodeURIComponent(look)}` : ''}`);
    await page.waitForFunction(() => window.wagVideo || document.querySelector('pre'), null, { polling: 100, timeout: 30_000 });
    if (!(await page.evaluate(() => Boolean(window.wagVideo)))) throw new Error(`The deck did not load: ${await page.evaluate(() => document.querySelector('pre')?.textContent ?? 'no reason given')}`);
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

    const cdp = await page.context().newCDPSession(page);
    let now = 0;
    await page.evaluate((ms) => window.wagFrame(ms), 0);
    return {
      deck,
      wag,
      page,
      errors,
      made: madeFor(where, deck),
      /** the clock moved on to `ms` from the start, in steps no longer than a frame, so springs run true */
      async to(ms, step = 1000 / 30) {
        while (now < ms - 0.001) {
          const by = Math.min(step, ms - now);
          await page.clock.runFor(by);
          now += by;
          await page.evaluate((at) => window.wagFrame(at), now);
        }
      },
      get now() {
        return now;
      },
      next: () => page.evaluate(() => window.wagPlayer.next()),
      /** the page as a picture */
      async shot({ format = 'jpeg', quality = 92 } = {}) {
        // the size asked for is given here: a picture taken this way does not follow the page's own pixel ratio
        const clip = { x: 0, y: 0, width: deck.width, height: deck.height, scale };
        const { data } = await cdp.send('Page.captureScreenshot', format === 'png' ? { format, clip } : { format, quality, clip });
        return Buffer.from(data, 'base64');
      },
      async close() {
        await browser.close();
        await vite.close();
      },
    };
  } catch (error) {
    await browser?.close();
    await vite.close();
    throw error;
  }
}
