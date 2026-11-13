// What a wag deck can do, in one deck. Everything in it is made up.
import { aurora, bars, box, choice, code, confetti, dark, deck, ellipse, fade, field, flow, look, path, pointer, ring, scene, slide, stat, text, ticker, trend, wordmark } from 'wag';
import { film } from './scenes/film';

const t = dark;
const [warm, pink, cool] = ['#ffb86b', '#ff7eb6', '#8ab4ff'];
const mint = t.good;

type Type = Partial<Parameters<typeof text>[1]>;
type Shape = Parameters<typeof box>[0];
const rise = { dy: 26, opacity: 0 };

/** small spaced capitals over a heading */
const eyebrow = (content: string, o: Type = {}) => text(content, { x: 80, y: 62, w: 700, h: 22, font: t.mono, fontSize: 13, weight: 500, tracking: 0.18, caps: true, color: t.faint, enter: { opacity: 0, dy: 10 }, ...o });
const heading = (content: string, o: Type = {}) => text(content, { x: 80, y: 90, w: 1000, h: 66, font: t.display, fontSize: 56, weight: 800, tracking: -0.035, leading: 1.02, color: t.ink, reveal: 'words', ...o });
const hint = (content: string, o: Type = {}) => text(content, { x: 80, y: 166, w: 880, h: 60, fontSize: 21, leading: 1.4, color: t.dim, enter: { ...rise, delay: 0.3 }, ...o });
// the same id on every slide, so a morph carries it across
const logo = () => text('wag', { id: 'logo', x: 1110, y: 56, w: 90, h: 34, font: t.display, fontSize: 28, weight: 800, tracking: -0.05, color: t.faint, align: 'right' });
const panel = (o: Shape) => box({ fill: t.panel, radius: 24, stroke: t.line, strokeWidth: 1, shadow: t.shadow, ...o });
/** what a chart piece needs to be its own card */
const asCard = { fill: t.panel, radius: 22, stroke: t.line, strokeWidth: 1, shadow: t.shadow, theme: t };
const pill = { h: 56, radius: 28, fontSize: 19, weight: 600, color: t.bg, whileHover: { scale: 1.06 }, whilePress: { scale: 0.95 } };

// ---------- the title ----------

const title = slide({ name: 'start', stagger: 0.06 }, [
  aurora({ theme: t, strength: 1 }),
  eyebrow('Slide decks, written in code', { x: 86, y: 112 }),
  wordmark({ x: 78, y: 146, w: 560, h: 250, size: 196, theme: t }),
  text('Slides that *move*, written in code.', { x: 86, y: 424, w: 640, h: 60, font: t.display, fontSize: 40, weight: 700, tracking: -0.03, color: t.ink, reveal: 'words', enter: { delay: 0.75 } }),
  text('One TypeScript file. Springs, states and scenes, a voice that reads it aloud, a guide for real pages, and a way out to PowerPoint.', { x: 86, y: 486, w: 560, h: 90, fontSize: 20, leading: 1.45, color: t.dim, enter: { ...rise, delay: 1.1 } }),
  // three small slides of their own, afloat on the right
  trend([12, 14, 13, 19, 18, 26, 24, 33, 38, 46], { ...asCard, x: 742, y: 96, w: 380, h: 210, pad: 24, rotate: -5, end: '+38%', delay: 1, enter: { dy: 70, opacity: 0, scale: 0.9, delay: 0.35 }, loop: { dy: [-7, 7], duration: 5 }, whileHover: { scale: 1.05, rotate: -2 } }),
  bars([{ label: 'Mon', value: 32 }, { label: 'Tue', value: 51 }, { label: 'Wed', value: 44 }, { label: 'Thu', value: 78 }, { label: 'Fri', value: 60 }], { ...asCard, x: 846, y: 286, w: 350, h: 236, pad: 22, rotate: 4, mark: 3, delay: 1.2, enter: { dy: 70, opacity: 0, scale: 0.9, delay: 0.5 }, loop: { dy: [6, -6], duration: 6 }, whileHover: { scale: 1.05, rotate: 1 } }),
  stat(1284, { ...asCard, x: 716, y: 420, w: 250, h: 150, pad: 24, rotate: -3, label: 'Springs fired', bright: true, delay: 1.4, enter: { dy: 70, opacity: 0, scale: 0.9, delay: 0.65 }, loop: { dy: [-5, 5], duration: 4.2 }, whileHover: { scale: 1.06, rotate: 0 } }),
  box({ x: 86, y: 596, w: 40, h: 34, radius: 9, fill: fade(t.ink, 0.07), stroke: fade(t.ink, 0.2), strokeWidth: 1, color: t.ink, font: t.mono, fontSize: 16, text: '→', enter: { opacity: 0, delay: 1.6 } }),
  text('to begin', { x: 138, y: 596, w: 200, h: 34, fontSize: 17, color: t.faint, valign: 'middle', enter: { opacity: 0, delay: 1.6 } }),
  ticker(['Springs', 'States', 'Scenes', 'Narration', 'Guides for live pages', 'Word handouts', 'PowerPoint export', 'Recorded video'], { x: 0, y: 656, w: 1280, h: 44, size: 20, theme: t, seconds: 34, enter: { opacity: 0, delay: 1.8 } }),
]);

// one scene filling the whole slide: the closest thing to a motion video in a deck
const opener = slide({ name: 'film', bg: '#07060b' }, [scene({ x: 0, y: 0, w: 1280, h: 720, alt: 'Slides that move like film.' }, film)]);

// ---------- states: a dog made of shapes ----------

const cx = 900;
const fur = '#ffb86b';
const shade = '#d98a4e';
const dark1 = '#2b1b14';
/** every part of the dog, so one state can lift them all together */
const dogParts: Record<string, Shape> = {
  earL: { x: cx - 152, y: 262, w: 80, h: 152, radius: 40, fill: shade, rotate: 16 },
  earR: { x: cx + 72, y: 262, w: 80, h: 152, radius: 40, fill: shade, rotate: -16 },
  head: { x: cx - 120, y: 250, w: 240, h: 214, radius: 100, fill: fur, gradient: 'radial-gradient(circle at 34% 24%, rgba(255,255,255,0.35), transparent 60%)', shadow: 'inset 0 -14px 24px rgba(160,84,30,0.28)' },
  muzzle: { x: cx - 70, y: 358, w: 140, h: 98, fill: '#ffe6c9' },
  eyeL: { x: cx - 74, y: 316, w: 24, h: 28, fill: dark1 },
  eyeR: { x: cx + 50, y: 316, w: 24, h: 28, fill: dark1 },
  glintL: { x: cx - 68, y: 320, w: 8, h: 8, fill: '#ffffff' },
  glintR: { x: cx + 56, y: 320, w: 8, h: 8, fill: '#ffffff' },
  tongue: { x: cx - 14, y: 406, w: 28, h: 10, radius: 14, fill: pink, opacity: 0 },
  nose: { x: cx - 24, y: 364, w: 48, h: 32, fill: dark1 },
};
const round = new Set(['muzzle', 'eyeL', 'eyeR', 'glintL', 'glintR', 'nose']);
const lifted = Object.fromEntries(Object.entries(dogParts).map(([id, part]) => [`dog-${id}`, { y: part.y - 14 }]));

const dog = slide(
  {
    transition: 'push',
    states: {
      woof: {
        ...lifted,
        'dog-earL': { y: 240, rotate: 36 },
        'dog-earR': { y: 240, rotate: -36 },
        'dog-eyeL': { y: 312, h: 10 },
        'dog-eyeR': { y: 312, h: 10 },
        'dog-glintL': { opacity: 0 },
        'dog-glintR': { opacity: 0 },
        'dog-tongue': { y: 392, h: 40, opacity: 1 },
        'dog-mouth': { y: 384 },
        bubble: { opacity: 1, y: 186, scale: 1 },
      },
    },
  },
  [
    aurora({ theme: t }),
    eyebrow('States'),
    heading('Hover the dog.\nThrow the ball.', { h: 124 }),
    hint('Hover and press are states: a state is a set of overrides, and the player springs between layouts. Every part of the dog is a box, an ellipse or a path.', { y: 232, w: 470, h: 130 }),
    logo(),
    ellipse({ x: cx - 130, y: 470, w: 260, h: 30, fill: 'rgba(0,0,0,0)', gradient: 'radial-gradient(closest-side, rgba(0,0,0,0.55), transparent)', decor: true }),
    // the tail's box is twice its length, so the middle of the box is where the tail joins the dog
    path('M150 60 C 186 62, 216 40, 252 8', { id: 'dog-tail', x: cx - 50, y: 372, w: 300, h: 120, color: shade, strokeWidth: 22, loop: { rotate: [-9, 13], duration: 0.3 } }),
    ...Object.entries(dogParts)
      .slice(0, 9)
      .map(([id, part]) => (round.has(id) ? ellipse({ id: `dog-${id}`, ...part }) : box({ id: `dog-${id}`, ...part }))),
    path('M2 2 Q 15 16 28 2 Q 41 16 54 2', { id: 'dog-mouth', x: cx - 28, y: 398, w: 56, h: 16, color: dark1, strokeWidth: 4 }),
    ellipse({ id: 'dog-nose', ...dogParts.nose }),
    box({ id: 'bubble', x: cx + 132, y: 206, w: 180, h: 72, radius: 36, fill: t.ink, color: t.bg, font: t.display, fontSize: 30, weight: 800, tracking: -0.02, text: 'Woof!', opacity: 0, scale: 0.6 }),
    // the whole dog answers the pointer, not only the part under it
    box({ x: cx - 160, y: 236, w: 320, h: 250, radius: 60, fill: 'rgba(0,0,0,0)', hover: 'woof' }),
    ellipse({ id: 'ball', x: 150, y: 520, w: 68, h: 68, fill: mint, gradient: 'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.6), transparent 55%)', shadow: `0 18px 30px -12px ${fade(mint, 0.55)}`, drag: true, whilePress: { scale: 1.2 }, motion: { type: 'spring', stiffness: 120, damping: 9 }, enter: { dy: -200, opacity: 0, delay: 0.5 } }),
    text('drag me', { x: 232, y: 540, w: 200, h: 28, font: t.mono, fontSize: 13, tracking: 0.14, caps: true, color: t.faint, enter: { opacity: 0, delay: 1 } }),
  ]
);

// ---------- click ----------

const cardX = [80, 470, 860];
const plans = [
  { name: 'Springs', label: '01', gradient: 'linear-gradient(160deg, #3b2a8c, #7c5cff)', detail: 'Real spring physics in the browser, baked to keyframes for PowerPoint.' },
  { name: 'States', label: '02', gradient: 'linear-gradient(160deg, #8c1f4f, #ff5c93)', detail: 'Every state is a full layout, so each one can become its own slide.' },
  { name: 'Fallback', label: '03', gradient: 'linear-gradient(160deg, #143c80, #4f9bff)', detail: 'Hover turns into a mouse-over jump through a Morph transition.' },
];
const cards = slide(
  {
    transition: 'zoom',
    states: Object.fromEntries(
      plans.map((_, i) => [
        `open${i}`,
        {
          [`card${i}`]: { x: 80, y: 236, w: 1120, h: 400, radius: 40, fontSize: 108 },
          [`detail${i}`]: { opacity: 1, y: 540 },
          [`no${i}`]: { x: 120, y: 268 },
          ...Object.fromEntries(plans.flatMap((_, j) => (j === i ? [] : [[`card${j}`, { opacity: 0, scale: 0.9 }], [`no${j}`, { opacity: 0 }]]))),
        },
      ])
    ),
  },
  [
    aurora({ theme: t }),
    eyebrow('Click'),
    heading('Pick a card.'),
    hint('Click to open, click again to close. Hovering a card is its own state, layered on top.'),
    logo(),
    ...plans.map((p, i) =>
      box({ id: `card${i}`, x: cardX[i], y: 256, w: 340, h: 340, radius: 30, fill: '#1b1830', gradient: p.gradient, shadow: '0 40px 80px -34px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.28)', color: '#ffffff', font: t.display, fontSize: 50, weight: 800, tracking: -0.035, text: p.name, click: `open${i}`, whileHover: { scale: 1.04, rotate: i - 1 }, whilePress: { scale: 0.98 }, enter: { dy: 70, opacity: 0, rotate: (i - 1) * 6, delay: i * 0.08 } })
    ),
    ...plans.map((p, i) => text(p.label, { id: `no${i}`, x: cardX[i] + 28, y: 282, w: 100, h: 20, font: t.mono, fontSize: 13, tracking: 0.2, color: 'rgba(255,255,255,0.75)', decor: true, enter: { opacity: 0, delay: 0.3 + i * 0.08 } })),
    ...plans.map((p, i) => text(p.detail, { id: `detail${i}`, x: 120, y: 570, w: 1040, h: 40, fontSize: 24, weight: 500, color: 'rgba(255,255,255,0.92)', align: 'center', opacity: 0, decor: true })),
  ]
);

// ---------- builds ----------

const points = ['Each arrow press takes one step', 'Steps add up, and undo going back', 'The last one draws the tick'];
const builds = slide(
  {
    transition: 'push',
    steps: ['one', 'two', 'three'],
    states: {
      one: { p0: { opacity: 1, x: 150 }, n0: { opacity: 1, fill: warm, color: t.bg } },
      two: { p1: { opacity: 1, x: 150 }, n1: { opacity: 1, fill: pink, color: t.bg } },
      three: { p2: { opacity: 1, x: 150 }, n2: { opacity: 1, fill: cool, color: t.bg }, tick: { draw: 1 }, halo: { opacity: 1, scale: 1 } },
    },
  },
  [
    aurora({ theme: t }),
    eyebrow('Builds'),
    heading('One step at a *time.*'),
    hint('Press the right arrow three times.'),
    logo(),
    ...points.flatMap((p, i) => [
      box({ id: `n${i}`, x: 80, y: 262 + i * 96, w: 48, h: 48, radius: 24, fill: fade(t.ink, 0.07), stroke: fade(t.ink, 0.16), strokeWidth: 1, color: t.faint, font: t.mono, fontSize: 16, weight: 500, text: String(i + 1), opacity: 0.6 }),
      text(p, { id: `p${i}`, x: 110, y: 262 + i * 96, w: 700, h: 48, font: t.display, fontSize: 34, weight: 700, tracking: -0.025, color: t.ink, valign: 'middle', opacity: 0 }),
    ]),
    ellipse({ id: 'halo', x: 880, y: 250, w: 290, h: 290, fill: 'rgba(0,0,0,0)', gradient: `radial-gradient(closest-side, ${fade(mint, 0.28)}, transparent)`, opacity: 0, scale: 0.6, decor: true }),
    path('M24 130 L104 208 L250 30', { id: 'tick', x: 888, y: 276, w: 274, h: 238, color: mint, strokeWidth: 26, draw: 0 }),
  ]
);

// ---------- figures ----------

const numbers = slide({ transition: 'fade', stagger: 0.05 }, [
  aurora({ theme: t, strength: 0.35 }),
  eyebrow('Motion pieces'),
  heading('Numbers that *arrive.*'),
  logo(),
  stat(3906, { ...asCard, x: 80, y: 196, w: 352, h: 150, pad: 26, label: 'Cups of tea', delta: '+12%', enter: rise }),
  stat(1284, { ...asCard, x: 464, y: 196, w: 352, h: 150, pad: 26, label: 'Biscuits', delta: '+31%', bright: true, delay: 0.1, enter: rise }),
  stat(412.5, { ...asCard, x: 848, y: 196, w: 352, h: 150, pad: 26, label: 'Left in the tin', prefix: '£', decimals: 2, delta: '-8%', tone: 'warn', delay: 0.2, enter: rise }),
  bars([{ label: 'Mon', value: 182 }, { label: 'Tue', value: 240 }, { label: 'Wed', value: 214 }, { label: 'Thu', value: 388 }, { label: 'Fri', value: 260 }], { ...asCard, x: 80, y: 370, w: 480, h: 290, pad: 28, mark: 3, max: 520, delay: 0.45, enter: rise }),
  trend([210, 232, 228, 260, 251, 290, 284, 312, 340, 331, 372, 396], { ...asCard, x: 592, y: 370, w: 372, h: 290, pad: 28, labels: ['Week 1', 'Week 12'], end: '396', delay: 0.6, enter: rise }),
  ring(0.72, { ...asCard, x: 996, y: 370, w: 204, h: 290, pad: 26, label: 'of budget', delay: 0.7, enter: rise }),
  // the names sit on their cards, so they come after them
  text('Biscuits by day', { x: 108, y: 392, w: 300, h: 20, font: t.mono, fontSize: 12.5, tracking: 0.16, caps: true, color: t.faint, decor: true, enter: { opacity: 0, delay: 0.7 } }),
  text('Tea, twelve weeks', { x: 620, y: 392, w: 300, h: 20, font: t.mono, fontSize: 12.5, tracking: 0.16, caps: true, color: t.faint, decor: true, enter: { opacity: 0, delay: 0.8 } }),
]);

// ---------- code ----------

const source = `
import { box, deck, slide } from 'wag';

const hello = slide({}, [
  box({
    x: 880, y: 300, w: 300, h: 180,
    radius: 40, text: 'hover me',
    whileHover: { scale: 1.12, rotate: -4 },
    whilePress: { scale: 0.94 },
  }),
]);

export default deck({}, [hello]);
`;
const written = slide({ transition: 'push' }, [
  aurora({ theme: t, strength: 0.35 }),
  eyebrow('Written in code'),
  heading('This box is *nine lines.*'),
  logo(),
  code(source, { x: 80, y: 196, w: 640, h: 460, file: 'decks/hello.ts', theme: t, size: 18.5, seconds: 5, enter: rise }),
  path('M4 20 C 40 2, 70 2, 108 18 M92 4 L108 18 L90 28', { x: 742, y: 360, w: 112, h: 32, color: t.faint, strokeWidth: 2.5, enter: { draw: 0, delay: 5.4 } }),
  box({ x: 880, y: 300, w: 300, h: 180, radius: 40, fill: '#1b1830', gradient: 'linear-gradient(140deg, #ffb86b, #ff7eb6 55%, #8ab4ff)', shadow: `0 40px 80px -30px ${fade(pink, 0.6)}, inset 0 1px 0 rgba(255,255,255,0.4)`, color: t.bg, font: t.display, fontSize: 34, weight: 800, tracking: -0.03, text: 'hover me', whileHover: { scale: 1.12, rotate: -4 }, whilePress: { scale: 0.94 }, enter: { scale: 0, opacity: 0, delay: 5.2 }, motion: { type: 'spring', stiffness: 260, damping: 14 } }),
  text('The code on the left is this box.', { x: 830, y: 520, w: 400, h: 30, fontSize: 17, color: t.faint, align: 'center', enter: { opacity: 0, delay: 5.8 } }),
  pointer([{ x: 700, y: 300 }, { x: 150, y: 90, click: true, wait: 1.4 }, { x: 240, y: 190, wait: 0.6 }], { x: 880, y: 300, w: 300, h: 180, theme: t, delay: 6.4 }),
]);

// ---------- one file, several ways out ----------

const ways = slide({ transition: 'zoom' }, [
  aurora({ theme: t, strength: 0.35 }),
  eyebrow('One file'),
  heading('Write it once. *Play it* six ways.'),
  logo(),
  flow(
    [
      { id: 'deck', label: 'decks/tour.ts', sub: 'slides, narration, steps', x: 0, y: 158, w: 264, bright: true },
      { id: 'web', label: 'Web player', sub: 'springs, hover, drag', x: 440, y: 0, w: 260, tone: warm },
      { id: 'voice', label: 'Narrated deck', sub: 'a voice on your machine', x: 440, y: 105, w: 260, tone: pink },
      { id: 'video', label: 'Recorded video', sub: 'mp4, subtitles, GIFs', x: 440, y: 210, w: 260, tone: cool },
      { id: 'guide', label: 'Guide on a live page', sub: 'show me, my turn, check', x: 440, y: 315, w: 260, tone: mint },
      { id: 'pptx', label: 'PowerPoint', sub: 'morph and builds kept', x: 860, y: 0, w: 260, tone: warm },
      { id: 'docx', label: 'Word handouts', sub: 'one per slide', x: 860, y: 105, w: 260, tone: pink },
    ],
    [
      { from: 'deck', to: 'web' },
      { from: 'deck', to: 'voice' },
      { from: 'deck', to: 'video' },
      { from: 'deck', to: 'guide' },
      { from: 'web', to: 'pptx' },
      { from: 'voice', to: 'docx' },
    ],
    { x: 80, y: 222, w: 1120, h: 400, theme: t }
  ),
]);

// ---------- free-form ----------

const free = slide({}, [
  aurora({ theme: t, strength: 0.3 }),
  eyebrow('Scenes'),
  heading('Anything *Motion* can do.'),
  hint('This panel is plain Motion code inside a slide. Move the pointer over it.'),
  logo(),
  scene({ x: 80, y: 240, w: 1120, h: 410, radius: 32, fill: '#100e19', stroke: t.line, strokeWidth: 1, shadow: t.shadow, alt: 'make it move' }, (root, { width, height, animate }) => {
    const add = (css: string) => {
      const node = document.createElement('div');
      node.style.cssText = `position:absolute;${css}`;
      root.append(node);
      return node;
    };

    // a glow that chases the pointer on a soft spring
    const glow = add(`left:-170px;top:-170px;width:340px;height:340px;border-radius:50%;background:radial-gradient(closest-side, ${fade(pink, 0.75)}, ${fade('#6d4aff', 0.35)} 55%, transparent)`);
    const chase = (x: number, y: number) => animate(glow, { x, y }, { type: 'spring', stiffness: 70, damping: 14 });
    chase(width / 2, height / 2);
    const onMove = (e: PointerEvent) => {
      const area = root.getBoundingClientRect();
      chase(((e.clientX - area.left) / area.width) * width, ((e.clientY - area.top) / area.height) * height);
    };
    root.addEventListener('pointermove', onMove);

    // a wave running through a grid of dots, for as long as the slide is up
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 24; col++) {
        const dot = add(`left:${68 + col * 43}px;top:${240 + row * 34}px;width:9px;height:9px;border-radius:50%;background:${[warm, pink, cool][(col + row) % 3]}`);
        animate(dot, { y: [0, -16], opacity: [0.2, 1] }, { duration: 0.8, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut', delay: (col + row * 2) * 0.06 });
      }
    }

    // letters that drop in one after another
    const line = add(`left:0;top:54px;width:${width}px;text-align:center;font-family:${t.display};font-size:104px;font-weight:800;letter-spacing:-.045em;color:${t.ink};white-space:pre`);
    [...'make it move'].forEach((letter, i) => {
      const span = document.createElement('span');
      span.textContent = letter;
      span.style.display = 'inline-block';
      line.append(span);
      animate(span, { y: [70, 0], opacity: [0, 1], rotate: [14, 0] }, { type: 'spring', stiffness: 260, damping: 13, delay: 0.25 + i * 0.045 });
    });

    // animations are stopped for us; the listener is ours to remove
    return () => root.removeEventListener('pointermove', onMove);
  }),
]);

// ---------- answers ----------

const label = (content: string, x: number, y: number) => text(content, { x, y, w: 400, h: 22, font: t.mono, fontSize: 12.5, tracking: 0.16, caps: true, color: t.faint, enter: rise });
const input = { fill: '#16141f', stroke: t.line, strokeWidth: 1, color: t.ink, fontSize: 21, enter: rise };
const gather = slide({ transition: 'push', stagger: 0.05, states: { saved: { thanks: { opacity: 1, y: 548 } } } }, [
  aurora({ theme: t, strength: 0.3 }),
  eyebrow('Answers'),
  heading('Ask, and *keep* the answers.'),
  hint('Type, pick one, then save. The answers land in an Excel file in your downloads.'),
  logo(),
  panel({ x: 80, y: 250, w: 1120, h: 400, enter: rise }),
  label('Your name', 120, 290),
  field('Name', { ...input, x: 120, y: 322, w: 480, h: 62, placeholder: 'Ada Lovelace' }),
  label('Email', 120, 414),
  field('Email', { ...input, x: 120, y: 446, w: 480, h: 62, inputType: 'email', placeholder: 'ada@example.com' }),
  label('Favourite part', 680, 290),
  choice('Favourite part', ['Springs', 'Hover', 'Drag', 'Scenes', 'Narration'], { x: 680, y: 326, w: 480, h: 130, color: t.ink, fill: cool, fontSize: 20, enter: rise }),
  box({ x: 120, y: 546, w: 232, h: 60, radius: 30, fill: t.ink, color: t.bg, fontSize: 19, weight: 600, text: 'Save to Excel', click: { save: 'wag-answers', state: 'saved' }, whileHover: { scale: 1.05 }, whilePress: { scale: 0.95 }, enter: rise }),
  text('Saved. Look for wag-answers.xlsx in your downloads.', { id: 'thanks', x: 380, y: 562, w: 760, h: 30, fontSize: 19, color: mint, valign: 'middle', opacity: 0 }),
]);

// ---------- the end ----------

const end = slide({ transition: 'iris', stagger: 0.08 }, [
  aurora({ theme: t, strength: 0.9 }),
  confetti({ x: 240, y: 60, w: 800, h: 460, theme: t, delay: 0.5 }),
  logo(),
  text("That's *wag.*", { x: 80, y: 196, w: 1120, h: 150, font: t.display, fontSize: 132, weight: 800, tracking: -0.05, leading: 1, color: t.ink, align: 'center', reveal: 'letters' }),
  text('Drag the ball anywhere. It stays where you drop it.', { x: 80, y: 372, w: 1120, h: 36, fontSize: 23, color: t.dim, align: 'center', enter: { ...rise, delay: 0.6 } }),
  ellipse({ x: 606, y: 440, w: 68, h: 68, fill: warm, gradient: 'radial-gradient(circle at 32% 28%, rgba(255,255,255,0.6), transparent 55%)', shadow: `0 18px 30px -12px ${fade(warm, 0.6)}`, drag: true, snapBack: false, whilePress: { scale: 1.15 }, loop: { dy: [-7, 7], duration: 1.2 }, enter: { scale: 0, opacity: 0, delay: 0.8 } }),
  box({ ...pill, x: 392, y: 566, w: 236, fill: t.ink, text: 'Back to the start', click: { go: 'start' }, enter: { ...rise, delay: 1 } }),
  box({ ...pill, x: 652, y: 566, w: 236, fill: fade(t.ink, 0.08), stroke: fade(t.ink, 0.22), strokeWidth: 1, color: t.ink, text: 'A hidden slide', click: { go: 'secret' }, enter: { ...rise, delay: 1.08 } }),
]);

const secret = slide({ name: 'secret', hidden: true, transition: 'zoom' }, [
  aurora({ theme: t, strength: 0.7 }),
  logo(),
  eyebrow('A slide the arrows skip', { x: 80, y: 230, w: 1120, align: 'center' }),
  text('You *found* it.', { x: 80, y: 262, w: 1120, h: 120, font: t.display, fontSize: 104, weight: 800, tracking: -0.045, leading: 1, color: t.ink, align: 'center', reveal: 'words' }),
  text('Only a button gets you here.', { x: 80, y: 400, w: 1120, h: 36, fontSize: 23, color: t.dim, align: 'center', enter: { ...rise, delay: 0.5 } }),
  box({ ...pill, x: 540, y: 480, w: 200, fill: t.ink, text: 'Go back', click: { go: 'back' }, enter: { ...rise, delay: 0.7 } }),
]);

export default deck({ ...look(t), title: 'What wag can do' }, [title, opener, dog, cards, builds, numbers, written, ways, free, gather, end, secret]);
