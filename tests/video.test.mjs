// npm run video: a deck in, an mp4 out, with the deck's slides in it in order.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { hasBrowser, repo, scratch, tidy } from './helpers.mjs';

const skip = hasBrowser ? false : 'no Chromium found: set WAG_TEST_BROWSER to one';

/** The colour in the middle of the frame at this second, as [r, g, b]. */
const colourAt = (file, seconds) => [...execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1', '-vf', 'crop=2:2,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];

describe('a deck to video', { skip }, () => {
  after(tidy);

  test('each slide is on screen for its time, in order, and the video is as long as the deck', async () => {
    const dir = scratch('video');
    const decks = join(dir, 'decks');
    mkdirSync(decks);
    writeFileSync(join(decks, 'reel.ts'), `import { deck, slide } from 'wag';
export default deck({}, [slide({ bg: '#ff0000' }, []), slide({ bg: '#0000ff' }, [])]);
`);
    const out = join(dir, 'reel.mp4');
    const env = { ...process.env, WAG_DECKS: decks, ...(process.env.WAG_TEST_BROWSER ? { WAG_BROWSER: process.env.WAG_TEST_BROWSER } : {}) };
    await new Promise((done, fail) => execFile(process.execPath, [join(repo, 'scripts/video.mjs'), 'reel', '--out', out, '--hold', '1', '--height', '360'], { env }, (error) => (error ? fail(error) : done())));

    const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }));
    assert.ok(Math.abs(seconds - 2.5) < 0.1, `the video is ${seconds} s`);
    const [first, last] = [colourAt(out, 0.5), colourAt(out, 2.3)];
    assert.ok(first[0] > 200 && first[2] < 60, `the first slide is red: ${first}`);
    assert.ok(last[2] > 200 && last[0] < 60, `the last slide is blue: ${last}`);
  });
});
