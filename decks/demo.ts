import { box, choice, deck, ellipse, field, path, scene, slide, text } from 'wag';
import { film } from './scenes/film';

const ink = '#f8fafc';
const dim = '#94a3b8';
const panel = '#1e293b';
const sky = '#38bdf8';
const violet = '#a78bfa';
const mint = '#34d399';
const amber = '#fbbf24';
const night = '#0f172a';

const heading = (content: string) => text(content, { x: 80, y: 56, w: 1000, h: 60, fontSize: 44, weight: 700, color: ink });
const hint = (content: string) => text(content, { x: 80, y: 122, w: 1000, h: 30, fontSize: 20, color: dim });
// the same id on every slide, so a morph carries it from the title into the corner
const logo = () => text('wag', { id: 'logo', x: 1120, y: 58, w: 100, h: 44, fontSize: 34, weight: 800, color: dim });

const rise = { dy: 70, opacity: 0 };
const pill = { h: 56, radius: 28, fontSize: 20, weight: 700, color: night, whileHover: { scale: 1.06 }, whilePress: { scale: 0.95 } };

const title = slide({ name: 'start', stagger: 0.08 }, [
  ellipse({ x: 880, y: -140, w: 560, h: 560, fill: '#172554', enter: { scale: 0.6, opacity: 0 }, loop: { dy: [-14, 14], scale: [1, 1.04], duration: 4 } }),
  text('wag', { id: 'logo', x: 80, y: 190, w: 700, h: 170, fontSize: 150, weight: 800, color: ink, enter: rise }),
  path('M6 20 C 90 2, 170 34, 334 10', { x: 84, y: 352, w: 340, h: 36, color: amber, strokeWidth: 9, enter: { draw: 0, delay: 0.35 } }),
  text('Slides that move, written in code.', { x: 86, y: 410, w: 900, h: 50, fontSize: 34, color: dim, enter: rise }),
  ...[['springs', sky], ['hover', violet], ['click', mint], ['.pptx fallback', amber]].map(([label, fill], i) =>
    box({ x: 86 + i * 215, y: 500, w: 195, h: 56, radius: 28, fill, color: night, fontSize: 21, weight: 700, text: label, enter: rise, whileHover: { scale: 1.08 }, whilePress: { scale: 0.94 } })
  ),
  text('Arrow keys to move', { x: 86, y: 640, w: 400, h: 30, fontSize: 18, color: dim, enter: { opacity: 0, delay: 0.3 } }),
]);

// one scene filling the whole slide: the closest thing to a motion video in a deck
const opener = slide({ name: 'film', bg: '#07060b' }, [scene({ x: 0, y: 0, w: 1280, h: 720 }, film)]);

const dog = slide(
  {
    transition: 'morph',
    states: {
      woof: {
        dog: { scale: 1.3, rotate: -6, fill: amber, radius: 60 },
        bubble: { opacity: 1, y: 170, scale: 1 },
      },
    },
  },
  [
    heading('Hover the dog, throw the ball'),
    hint('Hover and press are states. The dog wags on a loop the whole time. Drag the ball and let go.'),
    logo(),
    ellipse({ id: 'ball', x: 250, y: 520, w: 70, h: 70, fill: mint, drag: true, whilePress: { scale: 1.2 }, motion: { type: 'spring', stiffness: 120, damping: 9 } }),
    box({ id: 'dog', x: 500, y: 250, w: 280, h: 280, radius: 36, fill: panel, fontSize: 150, text: '🐶', hover: 'woof', whilePress: { scale: 1.15 }, loop: { rotate: [-3, 3], duration: 0.5 } }),
    box({ id: 'bubble', x: 800, y: 210, w: 210, h: 84, radius: 42, fill: ink, color: night, fontSize: 32, weight: 700, text: 'Woof!', opacity: 0, scale: 0.6 }),
  ]
);

const cardX = [80, 470, 860];
const plans = [
  { name: 'Springs', fill: sky, detail: 'Real spring physics in the browser, baked to keyframes for PowerPoint.' },
  { name: 'States', fill: violet, detail: 'Every state is a full layout, so each one can become its own slide.' },
  { name: 'Fallback', fill: mint, detail: 'Hover turns into a mouse-over jump through a Morph transition.' },
];
const cards = slide(
  {
    transition: 'zoom',
    states: Object.fromEntries(
      plans.map((_, i) => [
        `open${i}`,
        {
          [`card${i}`]: { x: 80, y: 190, w: 1120, h: 430, radius: 40, fontSize: 84 },
          [`detail${i}`]: { opacity: 1, y: 500 },
          ...Object.fromEntries(plans.flatMap((_, j) => (j === i ? [] : [[`card${j}`, { opacity: 0, scale: 0.9 }]]))),
        },
      ])
    ),
  },
  [
    heading('Click a card'),
    hint('Click to open, click again to close. Hovering a card is a separate state layered on top.'),
    logo(),
    ...plans.map((p, i) =>
      box({ id: `card${i}`, x: cardX[i], y: 230, w: 340, h: 320, radius: 28, fill: p.fill, color: night, fontSize: 40, weight: 800, text: p.name, click: `open${i}`, whileHover: { scale: 1.04 }, enter: { dy: 60, opacity: 0, delay: i * 0.07 } })
    ),
    ...plans.map((p, i) =>
      text(p.detail, { id: `detail${i}`, x: 80, y: 530, w: 1120, h: 40, fontSize: 26, weight: 600, color: night, align: 'center', opacity: 0 })
    ),
  ]
);

const points = ['Each arrow press takes one step', 'Steps add up, and undo going back', 'The last one draws the tick'];
const builds = slide(
  {
    transition: 'push',
    steps: ['one', 'two', 'three'],
    states: {
      one: { p0: { opacity: 1, x: 140 } },
      two: { p1: { opacity: 1, x: 140 } },
      three: { p2: { opacity: 1, x: 140 }, tick: { draw: 1 } },
    },
  },
  [
    heading('Builds'),
    hint('Press the right arrow three times.'),
    logo(),
    ...points.map((p, i) => text(p, { id: `p${i}`, x: 80, y: 240 + i * 90, w: 760, h: 60, fontSize: 34, weight: 600, color: ink, opacity: 0 })),
    path('M24 130 L104 208 L250 30', { id: 'tick', x: 860, y: 240, w: 274, h: 238, color: mint, strokeWidth: 26, draw: 0 }),
  ]
);

const free = slide({}, [
  heading('Free-form scenes'),
  hint('This panel is plain Motion code inside a slide. Move the pointer over it.'),
  logo(),
  scene({ x: 80, y: 190, w: 1120, h: 450, radius: 32, fill: panel }, (root, { width, height, animate }) => {
    const add = (css: string) => {
      const node = document.createElement('div');
      node.style.cssText = `position:absolute;${css}`;
      root.append(node);
      return node;
    };

    // a glow that chases the pointer on a soft spring
    const glow = add(`left:-130px;top:-130px;width:260px;height:260px;border-radius:50%;background:${violet};filter:blur(70px);opacity:0.6`);
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
        const dot = add(`left:${68 + col * 43}px;top:${270 + row * 36}px;width:10px;height:10px;border-radius:50%;background:${sky}`);
        animate(dot, { y: [0, -16], opacity: [0.25, 1] }, { duration: 0.8, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut', delay: (col + row * 2) * 0.06 });
      }
    }

    // letters that drop in one after another
    const line = add(`left:0;top:70px;width:${width}px;text-align:center;font-size:92px;font-weight:800;color:${ink};white-space:pre`);
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

const label = (content: string, x: number, y: number) => text(content, { x, y, w: 400, h: 28, fontSize: 18, color: dim });
const gather = slide({ transition: 'push', states: { saved: { thanks: { opacity: 1, y: 494 } } } }, [
  heading('Collect answers'),
  hint('Type, pick one, then save. The answers land in an Excel file in your downloads.'),
  logo(),
  label('Your name', 80, 204),
  field('Name', { x: 80, y: 238, w: 520, h: 64, placeholder: 'Ada Lovelace', color: ink }),
  label('Email', 80, 330),
  field('Email', { x: 80, y: 364, w: 520, h: 64, inputType: 'email', placeholder: 'ada@example.com', color: ink }),
  label('Favourite part', 680, 204),
  choice('Favourite part', ['Springs', 'Hover', 'Drag', 'Scenes'], { x: 680, y: 240, w: 520, h: 130, color: ink }),
  box({ x: 80, y: 476, w: 260, h: 68, radius: 34, fill: mint, color: night, fontSize: 24, weight: 800, text: 'Save to Excel', click: { save: 'wag-answers', state: 'saved' }, whileHover: { scale: 1.05 }, whilePress: { scale: 0.95 } }),
  text('Saved. Look for wag-answers.xlsx in your downloads.', { id: 'thanks', x: 372, y: 518, w: 800, h: 34, fontSize: 22, color: mint, opacity: 0 }),
]);

const end = slide({ transition: 'iris', bg: '#172554', stagger: 0.1 }, [
  logo(),
  text("That's wag.", { x: 80, y: 250, w: 1120, h: 130, fontSize: 110, weight: 800, color: ink, align: 'center', enter: { scale: 0.8, opacity: 0 } }),
  text('Drag the dog anywhere. It stays where you drop it.', { x: 80, y: 400, w: 1120, h: 40, fontSize: 26, color: dim, align: 'center', enter: rise }),
  box({ x: 590, y: 490, w: 100, h: 100, radius: 26, fill: amber, fontSize: 56, text: '🐶', drag: true, snapBack: false, whilePress: { scale: 1.15 }, loop: { dy: [-6, 6], duration: 1.2 }, enter: rise }),
  box({ ...pill, x: 380, y: 624, w: 250, fill: sky, text: 'Back to the start', click: { go: 'start' }, enter: rise }),
  box({ ...pill, x: 650, y: 624, w: 250, fill: violet, text: 'A hidden slide', click: { go: 'secret' }, enter: rise }),
]);

const secret = slide({ name: 'secret', hidden: true, transition: 'zoom', bg: '#1e1b4b' }, [
  logo(),
  text('You found it.', { x: 80, y: 240, w: 1120, h: 120, fontSize: 96, weight: 800, color: ink, align: 'center', enter: { scale: 0.8, opacity: 0 } }),
  text('The arrow keys skip this slide. Only a button gets you here.', { x: 80, y: 380, w: 1120, h: 40, fontSize: 26, color: dim, align: 'center' }),
  box({ ...pill, x: 540, y: 470, w: 200, fill: amber, text: 'Go back', click: { go: 'back' } }),
]);

const fonts = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;700&display=swap';

export default deck({ stylesheets: [fonts] }, [title, opener, dog, cards, builds, free, gather, end, secret]);
