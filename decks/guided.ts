// A guided deck: its steps drive a real page in a real browser. Everything is made up; the page
// is public/guide/app.html. To try it:
//   chromium --remote-debugging-port=9333 &          (any Chromium browser)
//   npm run build && node scripts/live.mjs --serve dist
//   open http://127.0.0.1:5180/?deck=guided
// Show me does the step, My turn rings what to click and waits for you, Check reads the page and
// the downloaded workbook and says whether they agree. The deck never presses "Post entry".
import { box, dark, deck, slide, text } from 'wag';

const t = dark;
const rise = { dy: 30, opacity: 0 };

/** One guided step: a heading, what it is for, and what each of its buttons will do. */
const step = (name: string, title: string, about: string, buttons: string[], options: Parameters<typeof slide>[0]) =>
  slide({ name, title, stagger: 0.07, ...options }, [
    text(title, { x: 80, y: 90, w: 1120, h: 70, fontSize: 52, weight: 800, color: t.ink, enter: rise }),
    text(about, { x: 80, y: 180, w: 1050, h: 110, fontSize: 26, color: t.dim, enter: rise }),
    ...buttons.flatMap((line, i) => [
      box({ x: 80, y: 330 + i * 86, w: 1120, h: 72, radius: 14, fill: t.panel, enter: rise }),
      text(line, { x: 104, y: 330 + i * 86, w: 1072, h: 72, fontSize: 22, color: t.ink, valign: 'middle', enter: rise }),
    ]),
  ]);

const start = step('start', 'A deck that drives the page', 'Each step from here has up to three buttons in the bar below. The page it drives is a made-up snack budget.', ['Show me: the deck does the step', 'My turn: it rings what to click and waits for you', 'Check: it reads the page and says whether it matches'], {
  narration: 'This deck drives a real page. Each step has up to three buttons. Show me does the step. My turn rings what to click and waits for you. Check reads the page and says whether it matches.',
});

const open = step('open', 'Open the page', 'Start on the snack budget watch.', ['Show me opens the page and points at its heading'], {
  narration: 'First, open the page. Press Show me.',
  live: { show: [{ go: '/app.html' }, { point: 'Snack budget watch', note: 'This is the page.' }], check: [{ label: 'The page is open', read: { page: { css: 'h1' } }, equals: { value: 'Snack budget watch' } }] },
});

const month = step('month', 'Pick the month', 'The page opens on Febtober. The items are in Marzember.', ['Show me picks Marzember', 'My turn waits until you have picked it', 'Check reads the open month off the page'], {
  narration: 'Now pick the month. Press My turn to do it yourself, or Show me to watch.',
  live: {
    show: [{ choose: 'Marzember', from: { role: 'combobox', name: 'Month' } }],
    turn: { point: { role: 'combobox', name: 'Month' }, says: 'Choose Marzember. It only changes what is shown.', until: { url: 'month=marzember' } },
    check: [{ label: 'The open month', read: { page: { css: '#read' }, pick: 'Open month: (\\w+)' }, equals: { value: 'Marzember' } }],
  },
});

const item = step('item', 'Open item 1', 'Biscuits bought on the tea budget: 412.50.', ['Show me opens the item and points at its amount'], {
  narration: 'Open item one, biscuits bought on the tea budget.',
  live: {
    show: [{ click: 'Biscuits bought on the tea budget' }, { wait: { see: { css: '#headline' } } }, { point: { css: '#headline' }, note: 'The amount this entry has to move.' }],
    check: [{ label: 'The amount on item 1', read: { page: { css: '#headline' } }, equals: { value: 412.5 } }],
  },
});

const entry = step('entry', 'Download the correcting entry', 'The entry is a workbook. It is prepared on the page, not posted.', ['Show me downloads it', 'Check adds up the workbook: debits equal credits, and the debits equal the amount on the page'], {
  narration: 'Download the correcting entry, then press Check. Check adds up the workbook and compares it with the page.',
  live: {
    show: [{ download: { role: 'button', name: 'Download the entry', within: 'dialog' }, as: 'snack-entry' }],
    check: [
      { label: 'Debits equal credits', read: { file: 'snack-entry', sheet: 'Lines', column: 'DR' }, equals: { file: 'snack-entry', sheet: 'Lines', column: 'CR' } },
      { label: 'The Check sheet says it balances', read: { file: 'snack-entry', sheet: 'Check', column: 'Balances', take: 'all' }, equals: { value: 'Yes' } },
      { label: 'The entry ties to the amount on the page', read: { file: 'snack-entry', sheet: 'Lines', column: 'DR' }, equals: { page: { css: '#headline' } } },
    ],
  },
});

const post = step('post', 'Post it: your click', 'Posting changes the ledger, so the deck will not do it. There is no Show me on this step.', ['My turn rings Post entry, says what it does, and waits for you'], {
  narration: 'Last, posting. This changes the ledger, so the deck never presses it. Press My turn, read what the click will do, and click it yourself.',
  live: {
    turn: { point: { role: 'button', name: 'Post entry' }, says: 'Post entry writes this entry to the made-up ledger. The deck never presses it.', until: { see: 'Posted to the made-up ledger.' } },
    check: [{ label: 'The page says it is posted', read: { page: { css: '#posted' } }, equals: { value: 'Posted to the made-up ledger.' } }],
  },
});

export default deck({ title: 'A guided deck', assets: '/guide', app: '/guide' }, [start, open, month, item, entry, post]);
