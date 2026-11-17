// Starter title: a deck of slides. Play it with `npm run dev` at /?deck=starter-name, check it with
// `wag check starter-name`, and make it a narrated video with `wag produce starter-name`.
import { Lightbulb, Rocket, Target } from 'lucide';
import { arrive, aurora, bars, box, cols, deck, fresh, headline, icon, look, page, panel, seedOr, slide, stat, text } from 'wag';

// The look is made from a word: change the word and the colours, type, shapes and motion all
// change with it. Browse looks at /?looks, or try one on this deck with ?deck=starter-name&look=word.
const t = fresh(seedOr('starter-name'));

// Where things go is worked out, not counted: the canvas inside its margins, and the room below a heading.
const safe = page('wide');
const body = page('wide', { top: 216 });

const eyebrow = (content: string) => text(content, { x: safe.x, y: safe.y - 18, w: safe.w, h: 22, font: t.mono, fontSize: 13, weight: 500, tracking: 0.18, caps: true, color: t.faint, enter: arrive(t) });
// words between asterisks are set in the look's marked style
const heading = (content: string) => text(content, { ...headline(t), x: safe.x, y: safe.y + 12, w: safe.w, h: 70, fontSize: 54, reveal: 'words' });

// `narration` is what is said: short, plain sentences, one idea a slide. `wag make` turns it into audio.
const title = slide({ title: 'Title', stagger: 0.08, narration: 'Say in one sentence what this deck is about and why it matters.' }, [
  aurora({ theme: t, strength: 0.9 }),
  text('What this is about', { x: safe.x, y: 208, w: safe.w, h: 22, font: t.mono, fontSize: 13, weight: 500, tracking: 0.18, caps: true, color: t.faint, enter: arrive(t) }),
  text('Starter *title*', { ...headline(t), x: safe.x, y: 240, w: safe.w, h: 124, fontSize: 104, leading: 1, reveal: 'words' }),
  text('One sentence that says why it matters.', { x: safe.x, y: 392, w: 860, h: 40, fontSize: 26, color: t.dim, enter: arrive(t, 0.5) }),
]);

const points = [
  { icon: Target, title: 'The first point', line: 'One or two short lines that back it up.' },
  { icon: Lightbulb, title: 'The second point', line: 'Keep to three points a slide, or split it.' },
  { icon: Rocket, title: 'The third point', line: 'Say the rest out loud, in the narration.' },
];
const three = slide({ title: 'Three points', transition: 'push', stagger: 0.06, narration: 'Three points, said one after another, each in a sentence of its own.' }, [
  aurora({ theme: t, strength: 0.35 }),
  eyebrow('The idea'),
  heading('Three things to *remember.*'),
  ...cols(body, 3, 28).flatMap((c, i) => [
    box({ ...panel(t), ...c, enter: arrive(t, 0.15 + i * 0.1) }),
    icon(points[i].icon, { x: c.x + 30, y: c.y + 32, w: 56, h: 56, alt: points[i].title, color: t.accent, delay: 0.5 + i * 0.12 }),
    text(points[i].title, { ...headline(t), x: c.x + 30, y: c.y + 118, w: c.w - 60, h: 72, fontSize: 28, valign: 'top', enter: arrive(t, 0.3 + i * 0.1) }),
    text(points[i].line, { x: c.x + 30, y: c.y + 198, w: c.w - 60, h: c.h - 230, fontSize: 20, leading: 1.45, color: t.dim, enter: arrive(t, 0.4 + i * 0.1) }),
  ]),
]);

const [left, right] = cols(body, [1, 2], 28);
const numbers = slide({ title: 'The numbers', transition: 'fade', stagger: 0.05, narration: 'Then the numbers. Say the one that matters most, and let the chart show the rest.' }, [
  aurora({ theme: t, strength: 0.35 }),
  eyebrow('The evidence'),
  heading('Numbers that *land.*'),
  stat(1284, { ...panel(t), theme: t, x: left.x, y: left.y, w: left.w, h: (left.h - 28) / 2, pad: 28, label: 'Teams', delta: '+31%', bright: true, enter: arrive(t, 0.1) }),
  stat(92, { ...panel(t), theme: t, x: left.x, y: left.y + (left.h + 28) / 2, w: left.w, h: (left.h - 28) / 2, pad: 28, label: 'Would recommend', suffix: '%', enter: arrive(t, 0.2) }),
  bars([{ label: 'Q1', value: 182 }, { label: 'Q2', value: 240 }, { label: 'Q3', value: 314 }, { label: 'Q4', value: 388 }], { ...panel(t), theme: t, ...right, pad: 32, mark: 3, max: 420, delay: 0.45, enter: arrive(t, 0.3) }),
]);

const end = slide({ title: 'What next', transition: 'zoom', stagger: 0.08, narration: 'End on what you want people to do next.' }, [
  aurora({ theme: t, strength: 1 }),
  text('What happens *next.*', { ...headline(t), x: safe.x, y: 250, w: safe.w, h: 116, fontSize: 96, leading: 1, reveal: 'words' }),
  text('One clear thing to do, and where to do it.', { x: safe.x, y: 392, w: 860, h: 40, fontSize: 26, color: t.dim, enter: arrive(t, 0.6) }),
]);

export default deck(
  {
    ...look(t),
    title: 'Starter title',
    // where `wag make` writes this deck's audio and handouts, under public/
    assets: '/starter-name',
    // voice: 'kokoro',                       // piper (default), kokoro, pocket or elevenlabs
    // video: { captions: 'srt', music: '/starter-name/bed.mp3' },
  },
  [title, three, numbers, end]
);
