// The voices a deck's lines can be said in. A deck names its own with `deck({ voice: 'kokoro' })`
// or `{ engine: 'kokoro', voice: 'af_heart' }`; WAG_TTS in the shell wins over it:
//
//   piper       (default) offline, on this machine: ~/.local/share/wag-voice, see the README
//   kokoro      offline, on this machine, a better voice than Piper: `npm i --no-save kokoro-js` once
//   pocket      offline, on this machine, and it can speak in your own voice from a recording of it.
//               Runs Kyutai's pocket-tts through `uv`, which fetches it the first time
//   elevenlabs  ElevenLabs' studio voices, paid, and the lines are sent to them
//
// Each one turns a line into an mp3 file. `id` names the voice exactly, so a deck made again with
// the same voice keeps the lines it already has, and a new voice says them all again.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = fileURLToPath(new URL('.', import.meta.url));
export const VOICES = ['piper', 'kokoro', 'pocket', 'elevenlabs'];

/** A wav (or anything ffmpeg reads) as a small mono mp3, the form every made line takes. */
const toMp3 = (from, to) => run('ffmpeg', ['-y', '-loglevel', 'error', '-i', from, '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '96k', to]);

/**
 * The voice the surroundings ask for. Gives { name, id, parallel, why, say(text, mp3), close() }:
 * `why` says what is missing when it cannot speak, and is empty when it can.
 */
export async function openVoice(env = process.env, choice) {
  // the deck's own choice (`deck({ voice })`) stands unless the shell says otherwise
  const own = typeof choice === 'string' ? { engine: choice } : (choice ?? {});
  const name = (env.WAG_TTS ?? own.engine ?? 'piper').toLowerCase();
  if (!VOICES.includes(name)) throw new Error(`The voice is "${name}": it can be ${VOICES.join(', ')}`);
  // the deck's voice within that engine, when it names one and it is the deck's engine being used
  const key = { piper: 'WAG_VOICE', kokoro: 'WAG_KOKORO_VOICE', pocket: 'WAG_POCKET_VOICE', elevenlabs: 'WAG_ELEVENLABS_VOICE' }[name];
  const with_ = own.voice && own.engine === name && !env[key] ? { ...env, [key]: own.voice } : env;
  return { piper, kokoro, pocket, elevenlabs }[name](with_);
}

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'wag-voice-'));
  return { dir, close: () => rmSync(dir, { recursive: true, force: true }) };
}

async function piper(env) {
  const home = join(homedir(), '.local/share/wag-voice');
  const program = env.WAG_PIPER ?? [join(home, 'venv/bin/piper'), '/usr/bin/piper'].find(existsSync) ?? 'piper';
  const model = env.WAG_VOICE ?? join(home, 'voices/en_US-lessac-high.onnx');
  let why = '';
  if (!existsSync(model)) why = `Piper's voice is not at ${model}`;
  else await run(program, ['--help']).catch(() => (why = `Piper is not at ${program}`));
  const temp = scratch();
  let n = 0;
  return {
    name: 'piper',
    id: model,
    // each line loads the voice again, which takes most of a second, so a few go at once
    parallel: 4,
    why: why && `${why}. To set Piper up, see "Narration" in the README.`,
    async say(text, mp3) {
      const stem = join(temp.dir, String(++n));
      writeFileSync(`${stem}.txt`, text);
      await run(program, ['-m', model, '-i', `${stem}.txt`, '-f', `${stem}.wav`, '--sentence-silence', '0.3', '--length-scale', '1.04']);
      await toMp3(`${stem}.wav`, mp3);
    },
    close: temp.close,
  };
}

async function kokoro(env) {
  const voice = env.WAG_KOKORO_VOICE ?? 'af_heart';
  const dtype = env.WAG_KOKORO_DTYPE ?? 'q8';
  const temp = scratch();
  let tts = null;
  let why = '';
  try {
    const { KokoroTTS } = await import('kokoro-js');
    // the model (about 90 MB at q8) is fetched once and kept in the Hugging Face cache
    tts = await KokoroTTS.from_pretrained(env.WAG_KOKORO_MODEL ?? 'onnx-community/Kokoro-82M-v1.0-ONNX', { dtype, device: 'cpu' });
    if (!Object.keys(tts.voices ?? {}).includes(voice) && tts.voices) why = `Kokoro has no voice "${voice}". It has: ${Object.keys(tts.voices).join(', ')}`;
  } catch (error) {
    why = error.code === 'ERR_MODULE_NOT_FOUND' ? 'Kokoro is not installed: run "npm i --no-save kokoro-js" once' : `Kokoro did not start: ${error.message}`;
  }
  let n = 0;
  return {
    name: 'kokoro',
    id: `kokoro:${voice}:${dtype}`,
    // one model in memory, saying one line at a time
    parallel: 1,
    why,
    async say(text, mp3) {
      const wav = join(temp.dir, `${++n}.wav`);
      const audio = await tts.generate(text, { voice, speed: Number(env.WAG_KOKORO_SPEED ?? 1) });
      await audio.save(wav);
      await toMp3(wav, mp3);
    },
    close: temp.close,
  };
}

async function pocket(env) {
  // a name of one of its own voices (alba, marius, ...), or a wav of someone speaking, to sound like them
  const voice = env.WAG_POCKET_VOICE ?? 'alba';
  const python = env.WAG_POCKET_PYTHON;
  const [program, args] = python ? [python, []] : ['uv', ['run', '--quiet', '--with', 'pocket-tts', '--with', 'scipy', 'python']];
  const temp = scratch();
  const worker = spawn(program, [...args, join(here, 'pocket.py'), voice], { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = new Map();
  let ready;
  const started = new Promise((done) => (ready = done));
  worker.on('error', (error) => ready(error.code === 'ENOENT' ? `${program} was not found: install uv (https://docs.astral.sh/uv/) or set WAG_POCKET_PYTHON to a Python with pocket-tts` : error.message));
  worker.on('exit', (code) => {
    ready(`pocket-tts stopped (${code}) before it was ready`);
    for (const done of waiting.values()) done({ error: 'pocket-tts stopped' });
  });
  createInterface({ input: worker.stdout }).on('line', (line) => {
    let said;
    try {
      said = JSON.parse(line);
    } catch {
      return;
    }
    if (said.ready) return ready('');
    if (said.failed) return ready(`pocket-tts did not start: ${said.failed}`);
    waiting.get(said.id)?.(said);
    waiting.delete(said.id);
  });
  const why = await started;
  let n = 0;
  return {
    name: 'pocket',
    id: `pocket:${voice}`,
    parallel: 1,
    why,
    async say(text, mp3) {
      const id = String(++n);
      const wav = join(temp.dir, `${id}.wav`);
      const said = await new Promise((done) => {
        waiting.set(id, done);
        worker.stdin.write(`${JSON.stringify({ id, text, out: wav })}\n`);
      });
      if (said.error) throw new Error(`pocket-tts: ${said.error}`);
      await toMp3(wav, mp3);
    },
    close() {
      worker.stdin.end();
      temp.close();
    },
  };
}

async function elevenlabs(env) {
  const key = env.ELEVENLABS_API_KEY;
  // George, one of ElevenLabs' own voices, so it works on any account
  const voice = env.WAG_ELEVENLABS_VOICE ?? 'JBFqnCBsd6RMkjVDRZzb';
  const model = env.WAG_ELEVENLABS_MODEL ?? 'eleven_multilingual_v2';
  // another region's address, such as https://api.eu.residency.elevenlabs.io
  const base = (env.WAG_ELEVENLABS_URL ?? 'https://api.elevenlabs.io').replace(/\/$/, '');
  return {
    name: 'elevenlabs',
    id: `elevenlabs:${voice}:${model}`,
    // plans allow only a few requests at once
    parallel: 2,
    why: key ? '' : 'WAG_TTS=elevenlabs needs ELEVENLABS_API_KEY set to your ElevenLabs API key.',
    /** Straight into an mp3. Waits and tries again when it is asked to slow down. */
    async say(text, mp3) {
      for (let attempt = 1; ; attempt++) {
        const res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
          body: JSON.stringify({ text, model_id: model }),
        });
        if (res.ok) return writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
        const why = (await res.text()).slice(0, 300);
        // 429: too many at once or too fast; 5xx: their side. Anything else will not mend by waiting.
        if ((res.status === 429 || res.status >= 500) && attempt < 5) {
          await new Promise((done) => setTimeout(done, 1000 * 2 ** attempt));
          continue;
        }
        throw new Error(`ElevenLabs said ${res.status} for "${text.slice(0, 60)}": ${why}`);
      }
    },
    close() {},
  };
}
