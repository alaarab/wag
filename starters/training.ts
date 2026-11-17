// Starter title: a narrated lesson. Make its audio, handouts and video with `wag produce starter-name`.
// What makes training work: say what they will be able to do, show it on the real screen, walk the
// steps in order, then say it back. One idea a slide; every line under about 25 words.
import { arrive, aurora, box, deck, fresh, headline, look, page, panel, rows, seedOr, shot, slide, text } from 'wag';

const t = fresh(seedOr('starter-name'), { mood: 'calm' });
const safe = page('wide');
const body = page('wide', { top: 216 });

const eyebrow = (content: string) => text(content, { x: safe.x, y: safe.y - 18, w: safe.w, h: 22, font: t.mono, fontSize: 13, weight: 500, tracking: 0.18, caps: true, color: t.faint, enter: arrive(t) });
const heading = (content: string) => text(content, { ...headline(t), x: safe.x, y: safe.y + 12, w: safe.w, h: 70, fontSize: 54, reveal: 'words' });

/** A list that builds: one row for each line of narration after the first. */
const list = (name: string, title: string, over: string, items: string[], narration: string[]) =>
  slide(
    {
      name,
      title,
      transition: 'push',
      steps: items.map((_, i) => `row${i}`),
      states: Object.fromEntries(items.map((_, i) => [`row${i}`, { [`n${i}`]: { opacity: 1 }, [`p${i}`]: { opacity: 1 } }])),
      narration,
      handout: true,
    },
    [
      aurora({ theme: t, strength: 0.35 }),
      eyebrow(over),
      heading(title),
      ...rows(body, items.length, 18).flatMap((r, i) => [
        box({ ...panel(t), id: `n${i}`, x: r.x, y: r.y, w: r.h, h: r.h, color: t.accent, font: t.mono, fontSize: 24, weight: 600, text: String(i + 1), opacity: 0.25 }),
        text(items[i], { ...headline(t), id: `p${i}`, x: r.x + r.h + 28, y: r.y, w: r.w - r.h - 28, h: r.h, fontSize: 30, valign: 'middle', opacity: 0 }),
      ]),
    ]
  );

const intro = slide({ name: 'start', title: 'Starter title', stagger: 0.08, narration: 'In this lesson you will learn to do one thing well. It takes about two minutes.' }, [
  aurora({ theme: t, strength: 0.9 }),
  text('A two-minute lesson', { x: safe.x, y: 208, w: safe.w, h: 22, font: t.mono, fontSize: 13, weight: 500, tracking: 0.18, caps: true, color: t.faint, enter: arrive(t) }),
  text('Starter *title*', { ...headline(t), x: safe.x, y: 240, w: safe.w, h: 124, fontSize: 100, leading: 1, reveal: 'words' }),
  text('What you will be able to do by the end.', { x: safe.x, y: 392, w: 860, h: 40, fontSize: 26, color: t.dim, enter: arrive(t, 0.5) }),
]);

const goals = list('goals', 'By the end, *you can*', 'What you will learn', ['Find the page you need', 'Read what it is telling you', 'Fix the one thing that is wrong'], [
  'By the end you can do three things.',
  'Find the page you need.',
  'Read what it is telling you.',
  'And fix the one thing that is wrong.',
]);

// A screenshot with callouts: the whole picture first, then a zoom on each region as its line is said.
// Put your own picture in public/starter-name/ and give its size and each region as [x, y, w, h] in its pixels.
const screen = shot('/guide/page.png', {
  name: 'screen',
  title: 'Where to look',
  sub: 'The whole page first, then each part in turn.',
  size: [1600, 800],
  theme: t,
  handout: true,
  say: 'This is the page. There are three parts to know.',
  callouts: [
    { at: [88, 190, 1480, 92], label: 'The counts across the top', say: 'First, the counts across the top. They tell you how much there is to do.' },
    { at: [88, 350, 1480, 100], label: 'The rows that need you', say: 'Second, the rows that need you. Each one has an owner and a date.' },
    { at: [1240, 134, 336, 42], label: 'The buttons, easy to miss', issue: true, say: 'Third, the buttons. They sit up here, where they are easy to miss.' },
  ],
});

const steps = list('steps', 'Do it in *this order*', 'The steps', ['Open the page and pick the month', 'Open the first row that needs you', 'Make the change, then check the count went down'], [
  'Now the steps, in order.',
  'Open the page and pick the month.',
  'Open the first row that needs you.',
  'Make the change, then check that the count went down.',
]);

const recap = slide({ name: 'recap', title: 'Recap', transition: 'zoom', stagger: 0.08, narration: 'That is it. Find the page, read it, fix the one thing. The handout has every step written down.', handout: true }, [
  aurora({ theme: t, strength: 1 }),
  text('Find it. Read it.\n*Fix it.*', { ...headline(t), x: safe.x, y: 190, w: safe.w, h: 250, fontSize: 96, leading: 1.05, reveal: 'words' }),
  text('The Files button has this lesson as a Word document.', { x: safe.x, y: 470, w: 900, h: 40, fontSize: 24, color: t.dim, enter: arrive(t, 0.7) }),
]);

export default deck(
  {
    ...look(t),
    title: 'Starter title',
    assets: '/starter-name',
    auto: true,
    // how a voice should say what it would get wrong: written form to spoken form
    pronounce: {},
    video: { captions: 'srt' },
    // voice: 'kokoro',
  },
  [intro, goals, screen, steps, recap]
);
