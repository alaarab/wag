# wag, for an agent

wag makes slide decks, ads, training videos and app walkthroughs from one TypeScript file each.
This page is how to make a good one. The README has every option; start here.

## The loop

Every job is the same five steps. Do not skip the check: it is how you see your own work.

```sh
npx wag new <name> --kind slides|ad|training|walkthrough   # 1. a whole starter of that kind
#   edit decks/<name>.ts                                   # 2. make it say what is wanted
npx wag check <name>                                       # 3. what does not fit, and a picture of every slide
#   Read wag-check/<name>/sheet.jpg and mend what you see  # 4. look at it yourself
npx wag produce <name> --out <name>.mp4                    # 5. voice, check again, video
```

- `wag check` ends with 1 on a problem (text bigger than its box, a deck that throws) and lists
  warnings (text off the canvas, text over text, text too close in colour to its ground, a line too
  long to follow). Fix every problem and read every warning. Then open `sheet.jpg`: a clean report
  does not mean it looks good. Look for crowding, empty halves, weak hierarchy, and anything cut off.
- `wag produce` runs `make` (audio), `check` and `video`. A problem stops it; `--force` goes on.
- A deck outside this repo lives in a folder named by `WAG_DECKS` (its files in `$WAG_DECKS/public/`).
  Use that for anything private or for another project's material. Every command honours it.
- `npm run dev` plays decks at `http://127.0.0.1:5179/?deck=<name>`; `/?looks` browses looks.
- Before finishing: `npm run typecheck`, and `npm test` if you changed anything under `src/` or `scripts/`.

## Which kind

| The ask | Kind | Comes out as | Length |
|---|---|---|---|
| A talk, a pitch, a report | `slides` | a deck in the browser, a `.pptx`, or a video | one idea a slide |
| An ad, a promo, a teaser | `ad` (`--format wide`, `square`, `tall`) | an mp4 with captions drawn in | 15 to 30 s |
| A lesson, onboarding, a how-to | `training` | a narrated video, Word handouts | 1 to 3 min |
| "Show how to do X in our app" | `walkthrough` | a video of the real app (`wag video <pack> <name>`), and a guided session | 1 to 2 min |

A walkthrough needs a pack (a folder with a `pack.json` naming the app) and a Chromium started with
`--remote-debugging-port`. `examples/snack` is a working one; the starter's first lines say how to run it.
Rehearse before filming: `wag rehearse <pack> <name>` says which steps work.

## Writing the words

The narration is the script. Write it first, then build slides to match it.

- One idea a slide. One sentence a line, under about 25 words: it has to be said in a breath.
- Plain words, said the way a person would say them aloud. No headings read out, no "in this slide".
- A slide's `narration` is a list: the first line is said when the slide arrives, each later line
  after the next step. Use steps to bring in one thing at a time, in time with the voice.
- What is on the slide is not the script. A slide shows three to seven words that the voice explains.
- `pronounce: { 'SQL': 'sequel' }` on the deck mends what a voice gets wrong, without changing what is shown.
- An ad: a hook in the first three seconds (a question or a claim), one promise, at most three
  reasons, one thing to do. About 45 words in all.
- Training: say what they will be able to do, show it on the real screen (`shot()` with callouts),
  give the steps in order, say it back. Offer a handout (`handout: true`).
- A walkthrough step: say what is about to happen and why, then do it. One action a step.

## Making it look good

- **Start from a look, not from colours.** `const t = fresh(seedOr('<name>'))` makes a whole look
  from a word: colours, type, panel shape, motion. Never hard-code a colour or a font; take them
  from `t` (`t.ink`, `t.dim`, `t.faint`, `t.accent`, `t.panel`, `t.gradient`, `t.display`, `t.mono`).
  For a brand: `fresh('<name>', { brand: '#ff5a1f' })`. For a feeling: `{ mood: 'calm' }` (or bold,
  playful, serious, warm, cool). Not happy with it? Change the word, or try
  `wag check <name> --look "another word"` and look at the sheet.
- **Let the helpers place things.** `page('wide', { top: 216 })` is the canvas inside its margins,
  below a heading. `cols(area, 3, 28)`, `rows(area, [2, 1])`, `grid(area, 3, 2)`, `inset(box, 24)` and
  `take(box, 'top', 60)` give `{ x, y, w, h }` boxes: spread one into any element. Do not count pixels.
- **Use the look's own shapes.** `box({ ...panel(t), ...area })` is a panel,
  `text('Hello', { ...headline(t), ...area, fontSize: 54 })` a heading, `enter: arrive(t, 0.2)` an entrance.
- **Give text room.** A text box needs `h` of at least `fontSize x leading x lines`. Some looks have
  wide type, so leave a title room for one more line than you think. `wag check` tells you when it does not fit.
- **Hierarchy.** One big thing a slide. Sizes on a wide canvas: headline 54 to 104, card title 26 to 32,
  body 20 to 26, label 13 (mono, caps, `t.faint`). Mark one or two words with asterisks: `'Slides that *move*'`.
- **Light and motion.** `aurora({ theme: t, strength: 0.9 })` behind a title, about `0.35` behind a
  busy slide; put it first. On a square or tall canvas give it the canvas: `aurora({ theme: t, ...canvas(FORMAT) })`.
  Bring things in with `enter` and a little `delay` each; do not animate everything.
- **Show, do not list.** Reach for a piece before a bullet list: `stat`, `bars`, `trend`, `ring`,
  `flow`, `code`, `icon(Check)` (lucide), `icon(siGithub)` (simple-icons), `scribble('circle')` to point at something.
- **Captions need the bottom.** With `captions: 'burn'`, keep the bottom clear: about 140 px on a wide
  canvas, 200 on square and tall (`page(FORMAT, { bottom: 200 })`). The ad starter does this.

## Voice, music, captions

Set them in the deck, so the video is the same every time:

```ts
deck({ ...look(t), assets: '/my-deck', voice: 'kokoro', video: { captions: 'burn', music: '/my-deck/bed.mp3' } }, slides)
```

- `voice`: `piper` (default, offline), `kokoro` (offline, better; `npm i --no-save kokoro-js` once),
  `pocket` (offline, can sound like a recording of someone who agreed to it), `elevenlabs` (paid; the
  lines are sent to it, so only when asked for; needs `ELEVENLABS_API_KEY`). `WAG_TTS` in the shell wins.
  With no voice set up, the video is silent and timed as if read: say so, do not pretend it has sound.
- `video`: `captions` (`'srt'` beside the video, `'burn'` drawn in), `music` (a file under
  `public/`, looped, faded, dipping under the voice), `hold`, `gap`, `lead`, `fps`, `size`.
  Only use music the owner has the right to use.
- `format`: `'wide'` 1280x720, `'square'` 1080x1080, `'tall'` 720x1280. The video's shorter side is 1080.

## Rules

- Everything in an example is made up. Never put real names, customers or figures in `decks/`,
  `starters/` or `examples/`: those ship. Private material goes in a `WAG_DECKS` folder.
- The guide never presses a control that saves, posts, sends, approves or deletes. Do not work
  around the guard; make that step the viewer's own click (`mine`).
- Report what was made honestly: the length, whether it has a voice, what the check said, and
  where the file is. If a step failed or was skipped, say so.

## Where things are

- `src/`: the library (`scene.ts` the deck format, `layout.ts`, `theme.ts`, `fresh.ts`, `kit.ts` ready-made
  slides `story`, `shot`, `guide`, `motion.ts` the pieces, `player.ts`, `pptx.ts`)
- `starters/`: the four starters `wag new` copies. Read one before writing a deck of that kind.
- `scripts/`: `new`, `check`, `make`, `video`, `produce`, and `media/` (voices, the stage a deck is
  played on, putting a video together); `session.mjs` and `live.mjs` drive a real app
- `decks/`: example decks (`demo` shows every piece; `looks` shows a fresh look)
