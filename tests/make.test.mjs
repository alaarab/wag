// npm run make with WAG_TTS=elevenlabs, against a stand-in for ElevenLabs on this machine.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { repo, scratch, tidy } from './helpers.mjs';

const DECK = `import { deck, slide } from 'wag';
export default deck({ assets: '/talk' }, [
  slide({ title: 'One', narration: 'The first line.' }, []),
  slide({ title: 'Two', narration: 'The second line.' }, []),
]);
`;

/** Run make on the little deck, in its own folder; gives the exit code and what it printed. */
const make = (decks, env) => new Promise((done) => {
  execFile(process.execPath, [join(repo, 'scripts/make.mjs'), 'talk'], { cwd: repo, env: { ...process.env, WAG_DECKS: decks, ...env } }, (error, stdout, stderr) =>
    done({ code: error?.code ?? 0, out: stdout + stderr }));
});

describe('narration by ElevenLabs', () => {
  let origin, asked, mp3, decks, server;
  before(async () => {
    const dir = scratch('make');
    mp3 = join(dir, 'quiet.mp3');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '1.5', '-codec:a', 'libmp3lame', mp3]);
    decks = join(dir, 'decks');
    mkdirSync(decks);
    writeFileSync(join(decks, 'talk.ts'), DECK);
    asked = [];
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        asked.push({ path: req.url, key: req.headers['xi-api-key'], body: JSON.parse(body || '{}') });
        res.writeHead(200, { 'content-type': 'audio/mpeg' });
        res.end(readFileSync(mp3));
      });
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    server.close();
    await tidy();
  });

  const env = () => ({ WAG_TTS: 'elevenlabs', ELEVENLABS_API_KEY: 'k-test', WAG_ELEVENLABS_URL: origin, WAG_ELEVENLABS_VOICE: 'v1' });

  test('each line is sent once with the key, and its audio is kept with its length', async () => {
    const { code } = await make(decks, env());
    assert.equal(code, 0);
    assert.deepEqual(asked.map((a) => a.body.text).sort(), ['The first line.', 'The second line.']);
    assert.ok(asked.every((a) => a.key === 'k-test' && a.path.startsWith('/v1/text-to-speech/v1')));
    const made = JSON.parse(readFileSync(join(decks, 'public/talk/wag.json'), 'utf8'));
    assert.equal(made.voice, 'elevenlabs:v1:eleven_multilingual_v2');
    for (const clip of Object.values(made.audio)) {
      assert.ok(existsSync(join(decks, 'public/talk/audio', clip.file)));
      assert.equal(clip.seconds, 1.5);
    }
  });

  test('a second make with the same voice sends nothing', async () => {
    asked.length = 0;
    assert.equal((await make(decks, env())).code, 0);
    assert.equal(asked.length, 0);
  });

  test('without a key it stops before sending anything', async () => {
    asked.length = 0;
    const { code, out } = await make(decks, { ...env(), ELEVENLABS_API_KEY: '', WAG_ELEVENLABS_VOICE: 'v2' });
    assert.equal(code, 1);
    assert.match(out, /ELEVENLABS_API_KEY/);
    assert.equal(asked.length, 0);
  });
});
