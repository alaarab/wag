// A recording of a walk, stopped with GIFs asked for.
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { bar, browser, built, eventually, guideTab, has, hasBrowser, serve, session, sleep, tidy } from './helpers.mjs';

const skip = !hasBrowser ? 'no Chromium found: set WAG_TEST_BROWSER to one' : !has('ffmpeg') ? 'ffmpeg is not installed' : false;

describe('a recording', { skip }, () => {
  let s, tab;
  before(async () => {
    const site = await serve(built);
    const there = await browser();
    s = await session({ cdp: there.cdp, app: `${site.origin}/guide`, args: ['--bar', '/app.html'], bridgeArgs: ['--live'] });
    tab = await guideTab(there.context);
  });
  after(tidy);

  test('gives a GIF of the whole recording and one for each step that was played', async () => {
    assert.equal((await s.guide('record', 'start')).ok, true);
    await s.guide('walk', 'start', 'guided');
    await eventually(() => bar(tab), (seen) => /1 of 6/.test(seen?.text ?? ''));
    await sleep(2500);
    await s.guide('walk', 'next');
    await eventually(() => bar(tab), (seen) => /2 of 6/.test(seen?.text ?? ''));
    await sleep(2500);
    const done = await s.guide('record', 'stop', '--gif', '--width', '480');
    assert.equal(done.ok, true);
    assert.deepEqual(done.gifs.map((gif) => basename(gif.file)), ['session.gif', '01-step-1-a-deck-that-drives-the-page.gif', '02-step-2-open-the-page.gif']);
    for (const gif of done.gifs) assert.ok(statSync(gif.file).size > 1000, `${gif.file} is empty`);
  });
});
