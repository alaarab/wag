// A guided walkthrough: narration, a "how this came up" story, a screenshot with callouts, and
// files to take away. Everything in it is made up, including the page in the picture.
// `npm run make guide` writes its audio and Word handouts; without that the browser's voice reads it.
import { aurora, box, dark, deck, fade, look, shot, slide, story, text } from 'wag';

const t = dark;
const rise = { dy: 30, opacity: 0 };
const eyebrow = (content: string) => text(content, { x: 84, y: 150, w: 800, h: 22, font: t.mono, fontSize: 13, weight: 500, tracking: 0.18, caps: true, color: t.faint, enter: { opacity: 0, dy: 10 } });
const big = (content: string, h: number) => text(content, { x: 80, y: 184, w: 1120, h, font: t.display, fontSize: 88, weight: 800, tracking: -0.04, leading: 1, color: t.ink, reveal: 'words' });
/** a key, drawn as a key */
const key = (letter: string, does: string, x: number) => [
  box({ x, y: 596, w: 34, h: 34, radius: 9, fill: fade(t.ink, 0.07), stroke: fade(t.ink, 0.2), strokeWidth: 1, color: t.ink, font: t.mono, fontSize: 15, text: letter, enter: { opacity: 0, delay: 0.9 } }),
  text(does, { x: x + 46, y: 596, w: 220, h: 34, fontSize: 17, color: t.faint, valign: 'middle', enter: { opacity: 0, delay: 0.9 } }),
];

const start = slide(
  {
    name: 'start',
    title: 'A guided walkthrough',
    stagger: 0.08,
    narration: 'This deck talks. Each slide has lines that are said when it arrives and after each step. Press the right arrow to move, or switch on Auto and let it play.',
  },
  [
    aurora({ theme: t, strength: 0.85 }),
    eyebrow('A narrated walkthrough'),
    big('A deck that\n*walks you through.*', 190),
    text('Narration, a story slide, a screenshot with callouts, and files to take away.', { x: 84, y: 410, w: 760, h: 80, fontSize: 25, leading: 1.4, color: t.dim, enter: { ...rise, delay: 0.5 } }),
    ...key('P', 'plays or pauses the voice', 84),
    ...key('A', 'switches Auto', 400),
    ...key('C', 'shows the words', 630),
  ]
);

const cameUp = story({
  name: 'story',
  title: 'How the snack budget went sideways',
  sub: 'A made-up story, told as cause, effect and fix.',
  timeline: [
    { when: 'Spring', what: 'One budget per shelf: tea, biscuits, fruit' },
    { when: 'Marzember 1', what: 'The shelves are renumbered', mark: true },
    { when: 'That month', what: 'Receipts keep the old shelf numbers' },
    { when: 'Friday', what: 'The month closes' },
  ],
  cause: 'The till fills in the shelf by itself.\n\nReceipts typed in by hand keep whatever number the person remembers.',
  effect: 'Biscuits show up on the tea budget, and a refund sits on a shelf that no longer exists.',
  fix: 'One correcting line before Friday, and a till that looks the shelf up for hand-typed receipts too.',
  narration: [
    'This is a story slide. It starts with a timeline. The shelves were renumbered at the start of the month.',
    'Then the cause. The till fills in the shelf by itself, but receipts typed in by hand keep the old number.',
    'Then the effect. Biscuits show up on the tea budget, and a refund sits on a shelf that no longer exists.',
    'And the fix. One correcting line before Friday, and a till that looks the shelf up every time.',
  ],
  handout: true,
});

const page = shot('/guide/page.png', {
  name: 'page',
  title: 'A screenshot with callouts',
  sub: 'The whole picture first. Each step zooms in on one numbered region.',
  size: [1600, 800],
  handout: true,
  callouts: [
    { at: [88, 190, 1480, 92], label: 'Three counts across the top', say: 'Callout one. Three cards count the items: two block the close, three wait on a decision, and one is clear.' },
    { at: [88, 350, 1480, 100], label: 'The two items that block the close', say: 'Callout two. These two rows block the close. Each has an owner, an amount and a due date.' },
    { at: [1240, 134, 336, 42], label: 'The buttons are easy to miss up here', issue: true, say: 'Callout three is marked as a known issue. The filter and the two buttons sit tight under the heading, where they are easy to miss.' },
    { at: [88, 718, 592, 52], label: 'Tabs and the month, under the list', say: 'Callout four. The detail tabs and the month picker are under the list.' },
  ],
});

const end = slide(
  {
    name: 'end',
    title: 'Files to take away',
    stagger: 0.08,
    narration: 'Last, files. A slide can offer downloads, and the Files button in the bar lists them. After npm run make, it also offers each slide as a Word document.',
    downloads: [{ label: 'The made-up page', href: '/guide/page.png' }],
  },
  [
    aurora({ theme: t, strength: 0.6 }),
    eyebrow('The end'),
    big('Files to *take away.*', 100),
    text('The Files button in the bar lists what this slide offers. After `npm run make guide` it also offers a Word handout for each slide, and the whole deck as one document.', { x: 84, y: 318, w: 860, h: 130, fontSize: 25, leading: 1.4, color: t.dim, enter: { ...rise, delay: 0.5 } }),
  ]
);

export default deck({ ...look(t), title: 'A guided walkthrough', assets: '/guide', pronounce: { 'npm run make': 'N P M run make' } }, [start, cameUp, page, end]);
