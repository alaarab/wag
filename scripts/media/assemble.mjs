// Putting a video together: pictures, the lines heard over them, a music bed that dips while a line
// is heard, and captions. `npm run video` and `wag film` both end here.
//
//   const job = assemble({ pictures: { pipe: 30 }, length, out, lines, music, captions })
//   job.write(jpeg) ...; await job.end()
//
// pictures   { pipe: fps } JPEGs written one by one, or { list: file } an ffmpeg concat list
//            of JPEGs each held for its own time (a screencast: pictures come when the page changes)
// lines      [{ at, seconds, text, file? }] what is said and when, in seconds from the start. A line
//            with a file is heard; every line is a caption
// music      { file, volume = -12 (dB), duck = true } played under everything, again from its start
//            when it runs out, faded in and out. While a line is heard it dips further
// captions   'srt' writes a subtitle file next to the video; 'burn' also draws them into the picture
// label      words stamped in the corner, such as "PRIVATE: real data"
// width, height  the size of the video: every picture is fitted to it, even one drawn at another size
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const clock = (t) => {
  const ms = Math.round(Math.max(0, t) * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

/** Subtitles in SubRip form: each line from when it is heard until it ends. */
export const srt = (lines) => lines.map((l, i) => `${i + 1}\n${clock(l.at)} --> ${clock(l.at + l.seconds)}\n${l.text}\n`).join('\n');

/** Escape a path for a filter option: ffmpeg treats : , ' [ ] and \ there as its own. */
const inFilter = (path) => path.replace(/[\\:',[\]]/g, (c) => `\\${c}`);

export function assemble({ pictures, length, out, lines = [], music, captions, label, width, height }) {
  const heard = lines.filter((l) => l.file);
  const subtitles = captions && lines.length ? out.replace(/\.[^./]+$/, '') + '.srt' : null;
  if (subtitles) writeFileSync(subtitles, srt(lines));

  const inputs = pictures.pipe
    ? ['-f', 'image2pipe', '-framerate', String(pictures.pipe), '-c:v', 'mjpeg', '-i', '-']
    : ['-f', 'concat', '-safe', '0', '-i', pictures.list];
  heard.forEach((l) => inputs.push('-i', l.file));
  if (music) inputs.push('-stream_loop', '-1', '-i', music.file);

  // the picture: one steady rate, the size asked for, the label and the captions drawn on
  const video = [pictures.pipe ? '' : 'fps=30', width && height ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1` : width ? `scale=${width}:-2` : '', label ? `drawtext=text='${label.replace(/[':\\]/g, ' ')}':x=24:y=24:fontsize=30:fontcolor=white:box=1:boxcolor=0xb45309@0.92:boxborderw=12` : '', captions === 'burn' && subtitles ? `subtitles=filename=${inFilter(subtitles)}:force_style='FontName=Sans,FontSize=15,PrimaryColour=&H00FFFFFF,BackColour=&H99000000,BorderStyle=3,Outline=5,Shadow=0,MarginV=22'` : '']
    .filter(Boolean)
    .join(',');
  const graph = [`[0:v]${video || 'null'}[v]`];
  // the lines, each from its moment, as one voice track
  const even = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  if (heard.length) {
    heard.forEach((l, i) => graph.push(`[${i + 1}:a]${even},adelay=${Math.round(Math.max(0, l.at) * 1000)}:all=1[l${i}]`));
    graph.push(`${heard.map((_, i) => `[l${i}]`).join('')}amix=inputs=${heard.length}:normalize=0[voice]`);
  }
  let sound = heard.length ? '[voice]' : null;
  if (music) {
    const fadeOut = Math.max(0, length - 2.5);
    graph.push(`[${heard.length + 1}:a]${even},atrim=0:${length.toFixed(3)},volume=${music.volume ?? -12}dB,afade=t=in:d=1.5,afade=t=out:st=${fadeOut.toFixed(3)}:d=2.5[bed]`);
    if (heard.length && music.duck !== false) {
      // the voice drives a compressor on the music: it sinks while a line is heard and comes back after
      graph.push('[voice]asplit=2[key][said]', '[bed][key]sidechaincompress=threshold=0.015:ratio=8:attack=20:release=700[under]', '[under][said]amix=inputs=2:normalize=0[sound]');
    } else if (heard.length) graph.push('[bed][voice]amix=inputs=2:normalize=0[sound]');
    else graph.push('[bed]anull[sound]');
    sound = '[sound]';
  }

  const args = ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph.join(';'), '-map', '[v]', ...(sound ? ['-map', sound, '-c:a', 'aac', '-b:a', '192k'] : []), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', length.toFixed(3), out];
  const ffmpeg = spawn('ffmpeg', args, { stdio: [pictures.pipe ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
  const done = new Promise((ok, fail) => {
    ffmpeg.once('error', fail);
    ffmpeg.once('exit', (code) => (code === 0 ? ok({ out, subtitles }) : fail(new Error(`ffmpeg stopped with ${code}`))));
  });
  return {
    /** one more picture, when pictures are piped */
    async write(jpeg) {
      if (!ffmpeg.stdin.write(jpeg)) await new Promise((go) => ffmpeg.stdin.once('drain', go));
    },
    /** every picture is in: wait for the file */
    end() {
      ffmpeg.stdin?.end();
      return done;
    },
    stop: () => ffmpeg.kill(),
  };
}
