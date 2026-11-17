// wag film: a walk played on the app with nobody watching, as a video.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { browser, built, hasBrowser, repo, scratch, serve, tidy } from './helpers.mjs';

const skip = hasBrowser ? false : 'no Chromium found: set WAG_TEST_BROWSER to one';

describe('wag film', { skip }, () => {
  let site, there;
  before(async () => {
    site = await serve(built);
    there = await browser();
  });
  after(tidy);

  test('plays every step of the walk on the app and writes a video of the page at the size asked for', async () => {
    const home = scratch('film');
    writeFileSync(join(home, 'pack.json'), JSON.stringify({ app: `${site.origin}/guide`, decks: built, browser: { cdp: there.cdp } }));
    const out = join(home, 'walk.mp4');
    const child = spawn(process.execPath, [join(repo, 'bin/wag.mjs'), 'film', home, 'guided', '--out', out, '--size', '1280x720', '--port', '5197'], { stdio: 'ignore' });
    const code = await new Promise((done) => child.once('exit', done));
    assert.equal(code, 0);
    assert.ok(existsSync(out));
    const [width, height, seconds] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'csv=p=0:s=,', out], { encoding: 'utf8' }).trim().split(/[,\n]/).map(Number);
    assert.deepEqual([width, height], [1280, 720]);
    // six steps, each its lines' reading time and a pause: well over a few seconds
    assert.ok(seconds > 15, `the video is ${seconds} s`);
  });
});
