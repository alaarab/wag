// npm run new <name>: creates decks/<name>.ts from a small starter deck.
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const name = process.argv[2];
if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error('Usage: npm run new <name>   (lowercase letters, digits and dashes, for example: q4-pitch)');
  process.exit(1);
}

const file = fileURLToPath(new URL(`../decks/${name}.ts`, import.meta.url));
if (existsSync(file)) {
  console.error(`decks/${name}.ts already exists`);
  process.exit(1);
}

const title = name.charAt(0).toUpperCase() + name.slice(1).replaceAll('-', ' ');

writeFileSync(
  file,
  `import { box, deck, slide, text } from 'wag';

// The canvas is 1280 x 720. Positions and sizes are in pixels from the top left.
const rise = { dy: 60, opacity: 0 };

const title = slide({ stagger: 0.08 }, [
  text(${JSON.stringify(title)}, { x: 80, y: 250, w: 1120, h: 120, fontSize: 96, weight: 800, enter: rise }),
  text('Arrow keys to move', { x: 84, y: 390, w: 1120, h: 40, fontSize: 28, color: '#94a3b8', enter: rise }),
]);

// \`transition\` is how the slide arrives: fade, push, zoom, iris or morph.
// A state is a layout: a set of overrides, keyed by element id.
// \`hover: 'lit'\` puts the slide in the "lit" state while the pointer is over the card.
// \`click: 'lit'\` would switch to it on click instead, and back on the next click.
const example = slide(
  {
    transition: 'push',
    states: {
      lit: { card: { scale: 1.1, rotate: -3, fill: '#fbbf24' }, note: { opacity: 1, y: 560 } },
    },
  },
  [
    text('Hover the card', { x: 80, y: 56, w: 1120, h: 60, fontSize: 44, weight: 700 }),
    box({ id: 'card', x: 470, y: 220, w: 340, h: 260, radius: 28, fill: '#38bdf8', color: '#0f172a', fontSize: 40, weight: 800, text: 'Card', hover: 'lit' }),
    text('Now it is lit.', { id: 'note', x: 80, y: 590, w: 1120, h: 40, fontSize: 28, color: '#94a3b8', align: 'center', opacity: 0 }),
  ]
);

export default deck({}, [title, example]);
`
);

console.log(`Created decks/${name}.ts`);
console.log(`Open http://localhost:5179/?deck=${name} (run "npm run dev" first if the server is not up)`);
