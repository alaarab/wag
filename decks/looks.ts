// One short promo, in a look made from a word. Try others from the address bar (?deck=looks&look=any
// word), from the looks page (?looks), or in a video: npm run video looks -- --look "any word".
import { Captions, Film, Mic } from 'lucide';
import { arrive, aurora, bars, box, deck, fade, fresh, headline, icon, look, panel, ring, scribble, seedOr, slide, stat, text } from 'wag';

const t = fresh(seedOr('wag'));
// the look's own way in, its own panel and its own headline
const rise = arrive(t);
const card = { ...panel(t), theme: t };
const eyebrow = (content: string, y = 62) => text(content, { x: 80, y, w: 900, h: 22, font: t.mono, fontSize: 13, weight: 500, tracking: 0.18, caps: true, color: t.faint, enter: { opacity: 0, dy: 10 } });
const heading = (content: string, y = 90, size = 56) => text(content, { ...headline(t), x: 80, y, w: 1100, h: size * 1.3, fontSize: size, leading: 1.02, reveal: 'words' });

const title = slide({ stagger: 0.06, narration: 'A look made from one word.' }, [
  aurora({ theme: t, strength: 0.9 }),
  eyebrow('A look made from one word', 190),
  heading('Every deck gets\na look of its *own.*', 222, 92),
  text(t.name ?? '', { x: 84, y: 470, w: 900, h: 30, font: t.mono, fontSize: 15, color: t.dim, enter: { ...rise, delay: 0.9 } }),
  box({ x: 84, y: 520, w: 260, h: 10, radius: 5, fill: t.gradient, enter: { opacity: 0, dx: -40, delay: 1.1 } }),
]);

const numbers = slide({ transition: 'push', stagger: 0.05, narration: 'Colour, type and light, all from the same seed.' }, [
  aurora({ theme: t, strength: 0.35 }),
  eyebrow('Figures'),
  heading('Numbers that *land.*'),
  stat(3906, { ...card, x: 80, y: 196, w: 352, h: 150, pad: 26, label: 'Sign-ups', delta: '+12%', enter: rise }),
  stat(1284, { ...card, x: 464, y: 196, w: 352, h: 150, pad: 26, label: 'Teams', delta: '+31%', bright: true, delay: 0.1, enter: rise }),
  ring(0.72, { ...card, x: 848, y: 196, w: 352, h: 464, pad: 60, label: 'of target', delay: 0.3, enter: rise }),
  bars([{ label: 'Mon', value: 182 }, { label: 'Tue', value: 240 }, { label: 'Wed', value: 214 }, { label: 'Thu', value: 388 }, { label: 'Fri', value: 260 }], { ...card, x: 80, y: 370, w: 736, h: 290, pad: 28, mark: 3, max: 420, delay: 0.45, enter: rise }),
]);

const made = slide({ transition: 'fade', stagger: 0.06, narration: 'Voice, video and captions come with it.' }, [
  aurora({ theme: t, strength: 0.5 }),
  eyebrow('Made with it'),
  heading('A voice, a video, *captions.*'),
  ...[Mic, Film, Captions].map((line, i) => [
    box({ ...card, x: 80 + i * 380, y: 260, w: 340, h: 300, enter: { ...rise, delay: 0.2 + i * 0.12 } }),
    icon(line, { x: 110 + i * 380, y: 296, w: 84, h: 84, alt: ['Voice', 'Video', 'Captions'][i], color: [t.accent, t.ink, t.ink][i], delay: 0.5 + i * 0.15 }),
    text(['Five voices', 'One command', 'Timed to the word'][i], { x: 110 + i * 380, y: 392, w: 290, h: 68, ...headline(t), fontSize: 26, valign: 'bottom', enter: { ...rise, delay: 0.6 + i * 0.12 } }),
    text(['Offline, or a studio voice when you ask for one.', 'Any deck to an mp4, frame by frame.', 'Drawn in, or kept beside the video.'][i], { x: 110 + i * 380, y: 472, w: 280, h: 70, fontSize: 18, leading: 1.4, color: t.dim, enter: { ...rise, delay: 0.7 + i * 0.12 } }),
  ]).flat(),
  scribble('underline', { x: 470, y: 548, w: 260, h: 24, color: t.accent, delay: 1.6 }),
]);

const end = slide({ transition: 'zoom', stagger: 0.08, narration: 'Change the word, get another look.' }, [
  aurora({ theme: t, strength: 1 }),
  heading('Change the word.\nGet *another.*', 230, 96),
  text("fresh('any word')", { x: 84, y: 480, w: 600, h: 40, font: t.mono, fontSize: 26, color: t.accent, enter: { ...rise, delay: 0.8 } }),
  box({ x: 84, y: 540, w: 120, h: 4, radius: 2, fill: fade(t.ink, 0.25), enter: { opacity: 0, delay: 1 } }),
]);

export default deck({ ...look(t), title: 'Fresh looks', auto: true }, [title, numbers, made, end]);
