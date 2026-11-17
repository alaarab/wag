// Putting a video together: however quiet the voice and however loud the track, the voice comes out
// at one loudness and the bed sits under it.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { assemble, loudness, LOUD } from '../scripts/media/assemble.mjs';
import { scratch, tidy } from './helpers.mjs';

const ffmpeg = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
/** The mean level between two moments of a file, in dB. */
const level = (file, from, to) => Number(/mean_volume: (-?[\d.]+)/.exec(spawnSync('ffmpeg', ['-ss', String(from), '-to', String(to), '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' }).stderr)?.[1]);

describe('the sound of a video', () => {
  after(tidy);
  const dir = scratch('assemble');
  const picture = join(dir, 'red.jpg');
  ffmpeg('-f', 'lavfi', '-i', 'color=c=red:s=320x180', '-frames:v', '1', picture);
  const jpeg = execFileSync('cat', [picture]);
  // something like speech, said quietly and said loudly; a track, loud and quiet
  const noise = (name, amplitude) => (ffmpeg('-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=${amplitude}:d=2`, join(dir, name)), join(dir, name));
  const tone = (name, volume) => (ffmpeg('-f', 'lavfi', '-i', 'sine=f=220:d=3', '-af', `volume=${volume}dB`, join(dir, name)), join(dir, name));
  const [whisper, shout] = [noise('whisper.mp3', 0.15), noise('shout.mp3', 0.9)];
  const [loudBed, quietBed] = [tone('loud.mp3', 12), tone('quiet.mp3', -20)];

  const make = async (name, voice, music) => {
    const out = join(dir, name);
    const lines = voice ? [{ at: 0.5, seconds: 2, text: 'One.', file: voice }, { at: 3.5, seconds: 2, text: 'Two.', file: voice }] : [];
    const job = assemble({ pictures: { pipe: 10 }, length: 6, out, lines, music });
    for (let i = 0; i < 60; i++) await job.write(jpeg);
    await job.end();
    return out;
  };

  test('a whisper and a shout come out as loud as each other', async () => {
    const [soft, hard] = [await make('soft.mp4', whisper), await make('hard.mp4', shout)];
    for (const file of [soft, hard]) assert.ok(Math.abs(loudness([file]) - LOUD) < 1.5, `${file} is at ${loudness([file])} LUFS`);
  });

  test('the bed sits under the voice whichever track it is, and takes its place when nothing is said', async () => {
    const [a, b] = [await make('a.mp4', whisper, { file: loudBed, duck: false }), await make('b.mp4', whisper, { file: quietBed, duck: false })];
    // between the two lines only the bed is heard
    const [bedA, bedB, voice] = [level(a, 2.7, 3.3), level(b, 2.7, 3.3), level(a, 0.8, 2.2)];
    assert.ok(Math.abs(bedA - bedB) < 1.5, `a loud track is at ${bedA} dB and a quiet one at ${bedB} dB`);
    assert.ok(voice - bedA > 6, `the voice is at ${voice} dB over a bed at ${bedA} dB`);
    const alone = await make('alone.mp4', null, { file: quietBed });
    assert.ok(level(alone, 2, 3) - bedB > 8, 'with nothing said the bed is brought forward');
  });
});
