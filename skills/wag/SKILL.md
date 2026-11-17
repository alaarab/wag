---
name: wag
description: "Make a slide deck, an ad or promo video, a narrated training video, or a video walkthrough of a real app with wag (decks written in code). Use when asked for slides, a pitch, an ad, a promo, a training or how-to video, an explainer, or an app demo or walkthrough."
---

# Making decks and videos with wag

wag turns one TypeScript file into a deck that plays in the browser, a PowerPoint file, and an
mp4 with a voice, music and captions. It also films a real web app being walked through.

## Find it

wag lives at `$WAG_HOME`, or `~/Projects/wag`. If it is not there, ask before cloning it. Run
`npm install` in it once. Every command is `node <wag>/bin/wag.mjs <command>` (or `npx wag` inside it).

**Read `<wag>/AGENTS.md` before writing a deck.** It is the guide: the loop, how to write the words,
how to make it look good, and the rules. Read the starter of the kind you are making in `<wag>/starters/`.

## Work from another project

Keep the deck with the project it is about, not in the wag repo:

```sh
export WAG_DECKS=<project>/decks-wag        # decks are <name>.ts here; their files go in public/<name>/
node <wag>/bin/wag.mjs new <name> --kind slides|ad|training|walkthrough    # ad takes --format wide|square|tall
# edit $WAG_DECKS/<name>.ts
node <wag>/bin/wag.mjs check <name>         # then Read wag-check/<name>/sheet.jpg and mend what you see
node <wag>/bin/wag.mjs produce <name> --out <name>.mp4
```

Anything with real names, customers or figures must stay in a `WAG_DECKS` folder: never in wag's own `decks/`.

## What good looks like

- The narration is written first: one idea a slide, one short sentence a line.
- The look comes from `fresh(seedOr('<name>'))` (add `{ brand: '#hex' }` or `{ mood }`), never from
  hard-coded colours or fonts. Positions come from `page`, `cols`, `rows` and `grid`, not counted pixels.
- `wag check` reports no problems, and you have looked at `sheet.jpg` yourself.
- The report says what was made: the file, its length, whether it has a voice, and what the check said.

## Voices

`piper` is the default and `kokoro` is the better free one (`npm i --no-save kokoro-js` once); both run
on this machine. `elevenlabs` is paid and sends the lines away: use it only when asked. With no voice
set up the video is silent; say so.
