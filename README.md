# wag

Slide decks written in code that move and respond. A deck is a TypeScript file; the browser player runs it with [Motion](https://motion.dev) springs, and slides can react to hover, click and drag, step through builds, route to each other, collect answers, and play video or free-form animation code.

This is an early prototype. It was checked by hand in a browser and has no automated tests yet.

## Quick start

```sh
npm install
npm run dev          # http://localhost:5179 lists the decks
npm run new my-deck  # creates decks/my-deck.ts from a starter
```

Arrow keys move between slides and builds. `R` replays the current slide.

## A slide

```ts
import { box, deck, slide, text } from 'wag';

const dog = slide(
  { states: { woof: { dog: { scale: 1.3, rotate: -6 }, bubble: { opacity: 1 } } } },
  [
    box({ id: 'dog', x: 500, y: 250, w: 280, h: 280, radius: 36, text: '🐶', hover: 'woof' }),
    box({ id: 'bubble', x: 800, y: 210, w: 210, h: 84, radius: 42, text: 'Woof!', opacity: 0 }),
  ]
);

export default deck({}, [dog]);
```

The canvas is 1280 x 720. A slide is a small state machine: a state is a set of overrides keyed by element id, and the player springs between layouts.

## What an element or slide can do

| | How |
|---|---|
| Hover, press | `hover: 'state'`, `whileHover: { scale: 1.05 }`, `press`, `whilePress` |
| Click | `click: 'state'` toggles a state |
| Drag | `drag: true`, `'x'` or `'y'`; `snapBack: false` to stay where dropped |
| Entrances | `enter: { dy: 60, opacity: 0 }`, with a slide `stagger` |
| Looping motion | `loop: { rotate: [-3, 3], duration: 0.5 }` |
| Builds | `steps: ['one', 'two']` on the slide |
| Drawn strokes | `path('M6 20 C …', { enter: { draw: 0 } })` |
| Slide transitions | `transition: 'fade' \| 'push' \| 'zoom' \| 'iris' \| 'morph'` |
| Routing | `slide({ name, hidden })`, `click: { go: 'name' }` (also `next`, `prev`, `back`, a number) |
| Collecting answers | `field(name, …)`, `choice(name, options, …)`, `click: { save: 'file' }` downloads an .xlsx |
| Video | `video('/clip.mp4', { repeat, sound })`, files in `public/` |
| Free-form code | `scene(options, (root, { animate, answers }) => { … })` |

`decks/demo.ts` uses all of these, and `decks/scenes/film.ts` is a full-slide scene.

## PowerPoint export

The start page has a **Download .pptx** button per deck. PowerPoint cannot run the interactions, so they are translated: entrances and builds become native animations with the springs baked into keyframes, and hover and click states become hidden slides joined by Morph and reached through mouse-over and click actions.

Not carried over: `whileHover` and press tweaks, drag, loops, live scenes, video and working fields. The exported file opens in PowerPoint without repair, but how it plays in a live slideshow has not been verified.

## Layout

- `src/scene.ts`: the deck format and its builders
- `src/player.ts`: the browser player
- `src/pptx.ts`: the .pptx exporter
- `app/`: the dev page that lists and plays decks
- `decks/`: one file per deck
- `spike/`: the script that first tested which hand-written animation XML PowerPoint accepts
