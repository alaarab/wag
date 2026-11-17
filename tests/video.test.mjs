// npm run video: a deck in, an mp4 out, with the deck's slides in it in order.
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

  test('a music bed gives the video sound, and the lines become subtitles timed to when they are said', async () => {
    const dir = scratch('video-music');
    const decks = join(dir, 'decks');
    mkdirSync(decks);
    writeFileSync(join(decks, 'told.ts'), `import { deck, slide } from 'wag';
export default deck({}, [slide({ narration: 'One line, read and not heard.' }, [])]);
`);
    const bed = join(dir, 'bed.mp3');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=f=220:d=1', bed]);
    const out = join(dir, 'told.mp4');
    const env = { ...process.env, WAG_DECKS: decks, ...(process.env.WAG_TEST_BROWSER ? { WAG_BROWSER: process.env.WAG_TEST_BROWSER } : {}) };
    await new Promise((done, fail) => execFile(process.execPath, [join(repo, 'scripts/video.mjs'), 'told', '--out', out, '--height', '360', '--music', bed, '--captions', 'srt'], { env }, (error) => (error ? fail(error) : done())));

    const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out], { encoding: 'utf8' });
    assert.match(streams, /audio/);
    // a bed shorter than the video plays again: there is sound near the end too, before the fade
    const late = spawnSync('ffmpeg', ['-ss', '3', '-t', '0.5', '-i', out, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    assert.ok(Number(/mean_volume: (-?[\d.]+)/.exec(late)?.[1]) > -60, 'the bed is heard after its first second');
    assert.equal(readFileSync(join(dir, 'told.srt'), 'utf8'), '1\n00:00:00,500 --> 00:00:03,885\nOne line, read and not heard.\n');
  });
});
