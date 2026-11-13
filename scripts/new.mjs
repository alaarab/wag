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
  `import { aurora, box, dark, deck, look, slide, text } from 'wag';

// The canvas is 1280 x 720. Positions and sizes are in pixels from the top left.
// \`dark\` is a theme: its colours and typefaces. \`light\` is the other one that ships.
const t = dark;
const rise = { dy: 40, opacity: 0 };

// Words between asterisks are set in the accent face. \`reveal\` brings a line in word by word.
const title = slide({ stagger: 0.08 }, [
  aurora({ theme: t, strength: 0.9 }),
  text(${JSON.stringify(title.replace(/ (\S+)$/, ' *$1*'))}, { x: 80, y: 240, w: 1120, h: 120, font: t.display, fontSize: 104, weight: 800, tracking: -0.04, leading: 1, color: t.ink, reveal: 'words' }),
  text('Arrow keys to move', { x: 84, y: 390, w: 1120, h: 40, fontSize: 26, color: t.dim, enter: { ...rise, delay: 0.5 } }),
]);

// \`transition\` is how the slide arrives: fade, push, zoom, iris or morph.
// A state is a layout: a set of overrides, keyed by element id.
// \`hover: 'lit'\` puts the slide in the "lit" state while the pointer is over the card.
// \`click: 'lit'\` would switch to it on click instead, and back on the next click.
const example = slide(
  {
    transition: 'push',
    states: {
      lit: { card: { scale: 1.1, rotate: -3 }, note: { opacity: 1, y: 560 } },
    },
  },
  [
    aurora({ theme: t }),
    text('Hover the card', { x: 80, y: 64, w: 1120, h: 64, font: t.display, fontSize: 52, weight: 800, tracking: -0.035, color: t.ink, reveal: 'words' }),
    box({ id: 'card', x: 470, y: 220, w: 340, h: 260, radius: 32, fill: '#1b1830', gradient: t.gradient, shadow: t.shadow, color: t.bg, font: t.display, fontSize: 44, weight: 800, text: 'Card', hover: 'lit' }),
    text('Now it is lit.', { id: 'note', x: 80, y: 590, w: 1120, h: 40, fontSize: 26, color: t.dim, align: 'center', opacity: 0 }),
  ]
);

export default deck({ ...look(t) }, [title, example]);
`
);

console.log(`Created decks/${name}.ts`);
console.log(`Open http://localhost:5179/?deck=${name} (run "npm run dev" first if the server is not up)`);
