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

```sh
npm run make my-deck # narration audio and Word handouts for a guided deck (see below)
npm run build        # a static copy of the player and every deck, in dist/
```

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
| Narration | `slide({ narration: ['said on arrival', 'said after step 1'] })` |
| A story of cause, effect and fix | `story({ title, timeline, cause, effect, fix })` |
| A screenshot with callouts | `shot('/pic.png', { size, callouts: [{ at, label, say }] })` |
| Files to take away | `slide({ downloads: [{ label, href }], handout: true })` |
| Picking an element out | `shade: 'rgba(2,6,23,.55)'` dims the slide outside it |

`decks/demo.ts` uses the first twelve, `decks/scenes/film.ts` is a full-slide scene, `decks/guide.ts` is a narrated walkthrough and `decks/guided.ts` drives a page.

## Walkthrough decks

A deck that walks someone through something: it talks, points at regions of a screenshot, and hands out files. A deck with narration or downloads gets a bar under the slide: Back and Next, play and pause, say again, speed, Auto, Text, Files, and a strip of every step in the deck, sized by how long each is spoken, with the time so far. Click the strip to jump; big arrows at the sides appear when the mouse moves. Arrow keys move; in a narrated deck Space pauses and carries on, `A` switches Auto, `C` shows the words being said. Auto waits about two seconds after each line, with a countdown on Next, and pressing Back turns it off.

**Narration.** `narration` is a list of plain sentences: the first is said when the slide arrives, each later one after the matching step. With Auto on (`deck({ auto: true })` starts that way) the deck moves on when a line ends, so it plays through like a video; a slide with nothing to say waits for the viewer. Going back never talks. `deck({ pronounce: { 'Q&A': 'Q and A,' } })` changes how something is said without changing what is shown.

`npm run make <deck>` turns every line into an audio file with [Piper](https://github.com/OHF-Voice/piper1-gpl), a voice that runs on your own machine, so the words go nowhere. Each file is named after its line, so only changed lines are spoken again. Without those files, or for a line that has none, the player uses the browser's own voice, and with no voice at all it shows the words and waits about as long as reading them takes. Browsers hold sound back until the first click or key press, so a deck opened cold shows a "Start with sound" button.

To set Piper up once:

```sh
python3 -m venv ~/.local/share/wag-voice/venv
~/.local/share/wag-voice/venv/bin/pip install piper-tts
~/.local/share/wag-voice/venv/bin/python -m piper.download_voices en_US-lessac-high --data-dir ~/.local/share/wag-voice/voices
```

`WAG_PIPER` and `WAG_VOICE` point at a different program or voice file. `ffmpeg` is needed too.

**Story.** `story()` is a slide for how something came up: a timeline across the top, then three cards that arrive one step at a time for what caused it, what it did and what fixes it.

**Screenshot with callouts.** `shot()` shows a picture with numbered regions. The whole picture comes first with every region marked; each step zooms in on one, dims the rest and shows that callout's label, and its `say` line is the narration. Regions are in the picture's own pixels, so they can be read straight off the screenshot. `issue: true` marks a callout as a known problem.

**Files.** `downloads` lists files a slide offers, and `shot()` offers its picture by default. `handout: true` adds a Word document of the slide (title, picture, and each point), which `npm run make` writes along with one document of the whole deck. These need `deck({ assets: '/my-deck' })`, the folder under `public/` the made files go in. That folder's `audio/`, `handouts/` and `wag.json` are not committed.

## Guided mode: a deck that drives a real page

A guided slide has up to three buttons in the bar, each one part of `live`:

```ts
slide({
  narration: 'Pick the month.',
  live: {
    show: [{ choose: 'Marzember', from: { role: 'combobox', name: 'Month' } }],
    turn: { point: { role: 'combobox', name: 'Month' }, says: 'Choose Marzember. It only changes what is shown.', until: { url: 'month=marzember' } },
    check: [{ label: 'The open month', read: { page: { css: '#read' }, pick: 'Open month: (\\w+)' }, equals: { value: 'Marzember' } }],
  },
}, [...])
```

- **Show me** does the step on the live page: `go` to an address, `point` at something (a ring and a note), `click`, `choose` an option, `download` a file and keep it under a name, `open` that file, `press` Escape, `wait` for a state.
- **My turn** rings what to click, shows `says` (what the click will do, in plain words) and waits until the page is as `until` describes. The deck never makes that click.
- **Check** reads the page or a downloaded workbook and says whether each pair matches, showing both figures when they do not: a figure on the page against a column total in a sheet, debits against credits, one part of the page against another.

The driving is done by a small bridge, `scripts/live.mjs`, which talks to a browser that is already open and signed in, over its debugging port:

```sh
chromium --remote-debugging-port=9333 &        # or Edge or Chrome, started the same way
npm run build
node scripts/live.mjs --serve dist             # then open http://127.0.0.1:5180/?deck=guided
```

It opens one tab of its own and closes it when it stops. `deck({ app: 'https://the.app' })` is where `go` addresses start; `--app <address>` sends them somewhere else, such as a practice copy of the page. Without the bridge the three buttons are off and the deck still plays. While writing a deck, run the bridge without `--serve` and start the dev server with `WAG_LIVE=http://127.0.0.1:5180 npm run dev`. The bridge needs only Node and Playwright, so the one file can be copied next to any Playwright install.

**What it will not do.** Show me never presses a control whose label says it saves, posts, approves, submits, deletes or sends. `slide()` rejects such a step when the deck is built, and the bridge checks the real control on the page again before every click and refuses, so a wrong label in a deck does not get past it. Those steps are My turn only. The bridge answers only pages on the same machine, and after each Show me the panel lists anything the page itself sent that was not a plain read.

`decks/guided.ts` is a guided deck over a made-up page, `public/guide/app.html`.

## Decks outside the repo

A deck made from private material should not sit in this repo. Set `WAG_DECKS` to a folder elsewhere: its `*.ts` files are listed and played with the repo's own, and its `public/` folder is served the same way.

```sh
WAG_DECKS=~/private-decks npm run dev
WAG_DECKS=~/private-decks npm run make my-deck
WAG_DECKS=~/private-decks WAG_OUT=~/private-decks/out npm run build
```

`WAG_OUT` puts the static build somewhere else too. The build is plain files: any static file server can show it.

## PowerPoint export

The start page has a **Download .pptx** button per deck. PowerPoint cannot run the interactions, so they are translated: entrances and builds become native animations with the springs baked into keyframes, and hover and click states become hidden slides joined by Morph and reached through mouse-over and click actions.

Not carried over: `whileHover` and press tweaks, drag, loops, live scenes, video, working fields, narration, shades, downloads and live steps. The exported file opens in PowerPoint without repair, but how it plays in a live slideshow has not been verified.

## Layout

- `src/scene.ts`: the deck format and its builders
- `src/kit.ts`: ready-made slides (`story`, `shot`) built from the same elements
- `src/player.ts`: the browser player, with the narration bar
- `src/pptx.ts`: the .pptx exporter
- `app/`: the dev page that lists and plays decks
- `decks/`: one file per deck
- `scripts/make.mjs`: writes a guided deck's audio and Word handouts
- `scripts/live.mjs`: the bridge that drives a real browser for Show me, My turn and Check
- `spike/`: the script that first tested which hand-written animation XML PowerPoint accepts
