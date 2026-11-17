// Starter title: a short ad or promo, about 20 seconds. Make the video with `wag produce starter-name`.
// What makes an ad work: a hook in the first three seconds, one promise, three reasons, one thing to do.
// Every line of narration is short enough to say in one breath.
import { Clock, ShieldCheck, Sparkles } from 'lucide';
import { arrive, aurora, box, canvas, cols, deck, fresh, headline, icon, look, page, panel, rows, seedOr, slide, text, type Format } from 'wag';

// wide (16:9, for the web and YouTube), square (1:1, for a feed) or tall (9:16, for a phone)
const FORMAT = 'wide' as Format;
const t = fresh(seedOr('starter-name'), { mood: 'bold' });

const all = canvas(FORMAT);
const wide = FORMAT === 'wide';
// the bottom is left clear for the captions, which are drawn into the video
const safe = page(FORMAT, { bottom: { wide: 140, square: 200, tall: 190 }[FORMAT] });
const [top, middle] = rows(safe, [1, 4], 0);
const size = { wide: 100, square: 92, tall: 76 }[FORMAT];
const align = wide ? ('left' as const) : ('center' as const);

const light = (strength: number) => aurora({ theme: t, strength, ...all });
const small = (content: string) => text(content, { x: top.x, y: top.y, w: top.w, h: 24, font: t.mono, fontSize: 14, weight: 500, tracking: 0.18, caps: true, color: t.faint, align, enter: arrive(t) });
const shout = (content: string) => text(content, { ...headline(t), ...middle, fontSize: size, leading: 1, align, valign: wide ? 'top' : 'middle', reveal: 'words' });

// 1. The hook: a question or a claim that stops the scroll.
const hook = slide({ title: 'Hook', narration: 'Still doing it the slow way?' }, [light(1), small('For anyone who has had enough'), shout('Still doing it\nthe *slow* way?')]);

// 2. The promise, then three reasons, one at a time: each arrow press (or each line, in a video) shows one.
const reasons = [
  { icon: Clock, title: 'Done in minutes', line: 'What took an afternoon takes one sitting.' },
  { icon: Sparkles, title: 'Looks the part', line: 'A look of its own, every time.' },
  { icon: ShieldCheck, title: 'Nothing to learn', line: 'Say what you want. It does the rest.' },
];
const [lead, below] = rows(safe, [1, 4], 24);
const cards = wide ? cols(below, 3, 24) : rows(below, 3, 20);
const named = wide ? 104 : 44;
const why = slide(
  {
    title: 'Three reasons',
    transition: 'push',
    steps: ['one', 'two', 'three'],
    states: Object.fromEntries(['one', 'two', 'three'].map((name, i) => [name, Object.fromEntries(['card', 'icon', 'name', 'line'].map((part) => [`${part}${i}`, { opacity: 1 }]))])),
    narration: ['Meet the fast way.', 'It is done in minutes.', 'It looks the part.', 'And there is nothing to learn.'],
  },
  [
    light(0.4),
    text('Meet the *fast* way.', { ...headline(t), ...lead, fontSize: wide ? 56 : 50, align, valign: 'middle', reveal: 'words' }),
    ...cards.flatMap((c, i) => [
      box({ ...panel(t), ...c, id: `card${i}`, opacity: 0 }),
      icon(reasons[i].icon, { id: `icon${i}`, x: c.x + 28, y: c.y + 24, w: 56, h: 56, alt: reasons[i].title, color: t.accent, opacity: 0 }),
      // a narrow card leaves its title room for two lines: some looks have wide type
      text(reasons[i].title, { ...headline(t), id: `name${i}`, x: c.x + 28, y: c.y + 94, w: c.w - 56, h: named, fontSize: wide ? 30 : 32, valign: 'top', opacity: 0 }),
      text(reasons[i].line, { id: `line${i}`, x: c.x + 28, y: c.y + 100 + named, w: c.w - 56, h: c.h - 124 - named, fontSize: 23, leading: 1.4, color: t.dim, opacity: 0 }),
    ]),
  ]
);

// 3. One thing to do.
const button = { w: wide ? 360 : Math.min(safe.w, 440), h: 68 };
const act = slide({ title: 'Call to action', transition: 'zoom', narration: 'Try it today, at your product dot com.' }, [
  light(1),
  small('Free to start'),
  shout('Try it\n*today.*'),
  box({ x: wide ? safe.x : safe.x + (safe.w - button.w) / 2, y: safe.y + safe.h - button.h, ...button, radius: Math.min(34, (t.radius ?? 20) * 1.6), fill: t.accent, color: t.bg, font: t.display, fontSize: 24, weight: 700, text: 'yourproduct.com', enter: arrive(t, 0.9) }),
]);

export default deck(
  {
    ...look(t),
    title: 'Starter title',
    format: FORMAT,
    assets: '/starter-name',
    // an ad moves fast and is often watched with the sound off, so the lines are drawn in
    video: { lead: 0.3, gap: 0.35, hold: 2, captions: 'burn' },
    // video: { ..., music: '/starter-name/bed.mp3' },   a bed under the voice, in public/starter-name/
    // voice: 'kokoro',
  },
  [hook, why, act]
);
