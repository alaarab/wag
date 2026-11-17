// Starter title: a walkthrough of a real app. One list of steps gives three things: a guided session
// on the live page (`wag live`), a narrated deck, and a video of the app (`wag film <pack> starter-name`).
//
// This starter drives the made-up page that ships with wag, so it works at once:
//   npm run make starter-name && npm run build
//   npm run dev                               (serves the made-up page; leave it running)
//   a Chromium with --remote-debugging-port=9333 and no window (--headless=new)
//   npx wag rehearse examples/snack starter-name     says which steps work
//   npx wag film examples/snack starter-name --out starter-name.mp4
// For your own app: copy examples/snack somewhere outside the repo, point its pack.json at your app,
// and change `app` below and each step's targets. A target is words on the page, or a role and a name.
// The guide never presses a button that saves, posts, sends or deletes: those are the viewer's own
// click (`mine`), which a video rings and leaves alone.
import { fresh, guide, look, seedOr } from 'wag';

const t = fresh(seedOr('starter-name'), { mood: 'calm' });

export default guide({ ...look(t), theme: t, title: 'Starter title', assets: '/starter-name', app: '/guide' }, [
  {
    title: 'What this shows',
    about: 'One sentence on what the viewer will have done by the end.',
    say: 'This walkthrough shows how to find an item and read what it says. It takes a minute.',
  },
  {
    title: 'Open the page',
    about: 'Start where the work starts.',
    say: 'First, open the page.',
    show: [{ go: '/app.html' }, { point: 'Snack budget watch', note: 'This is the page.' }],
    check: [{ label: 'The page is open', read: { page: { css: 'h1' } }, equals: { value: 'Snack budget watch' } }],
  },
  {
    title: 'Pick the month',
    about: 'The page opens on last month. The items are in this one.',
    say: 'Next, pick the month. The page only shows the items for the month you pick.',
    show: [{ choose: 'Marzember', from: { role: 'combobox', name: 'Month' } }],
    check: [{ label: 'The open month', read: { page: { css: '#read' }, pick: 'Open month: (\\w+)' }, equals: { value: 'Marzember' } }],
  },
  {
    title: 'Open the first item',
    about: 'Each row opens to show what it is and how much it is for.',
    say: 'Then open the first item. Its amount is the figure to check.',
    show: [{ click: 'Biscuits bought on the tea budget' }, { wait: { see: { css: '#headline' } } }, { point: { css: '#headline' }, note: 'The amount to check.' }],
    check: [{ label: 'The amount on item 1', read: { page: { css: '#headline' } }, equals: { value: 412.5 } }],
  },
  {
    title: 'That is the whole of it',
    about: 'Say it back in one line.',
    say: 'That is the whole of it. Open the page, pick the month, open the item.',
  },
]);
