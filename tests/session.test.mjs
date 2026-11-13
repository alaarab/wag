// A session with the bar on the page: a walk played there, questions asked from the bar, and what
// is kept for later. The session, the bridge and the answerer are separate programs, as for real;
// the bar is read and pressed the way a person with a screen reader and a mouse would.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { askInBar, bar, browser, built, eventually, guideTab, hasBrowser, press, repo, scratch, serve, session, tidy } from './helpers.mjs';

const skip = hasBrowser ? false : 'no Chromium found: set WAG_TEST_BROWSER to one';
const answerer = join(repo, 'tests/support/fake-ask.sh');
const shows = (page, words) => eventually(() => bar(page), (seen) => seen && words.test(seen.text), { ms: 30000 });

describe('a walk on the page, with questions from the bar', { skip }, () => {
  let s, tab, there;
  before(async () => {
    const site = await serve(built);
    there = await browser();
    s = await session({ cdp: there.cdp, app: `${site.origin}/guide`, args: ['--walk', 'guided', '--ask', answerer], bridgeArgs: ['--live'] });
    tab = await guideTab(there.context);
  });
  after(tidy);

  test('plays a step on the page and reads out its check', async () => {
    await shows(tab, /1 of 6/);
    assert.equal((await s.guide('walk', 'goto', '2')).ok, true);
    const seen = await shows(tab, /Check: The page is open: Snack budget watch matches Snack budget watch/);
    assert.match(seen.text, /2 of 6 · Open the page/);
  });

  test('a jump makes the page ready first: the steps it skipped are done on the way', async () => {
    await press(tab, 'Steps');
    await press(tab, '4.');
    // step 3 picks the month; without it item 1 shows another amount
    await shows(tab, /4 of 6[\s\S]*Check: The amount on item 1: 412\.50 matches 412\.50/);
  });

  test('a question pauses the walk, is answered in the bar, and Continue puts the page back on the step', async () => {
    await askInBar(tab, 'and the refund?');
    const answered = await shows(tab, /The tea refund is minus 38\.00\./);
    assert.match(answered.text, /Paused/);
    assert.match(answered.text, /You asked: and the refund\?/);
    // the answer opened another item; the step's own item has to be back before the walk goes on
    assert.match((await s.guide('where')).dialog, /Tea refund/);
    await tab.keyboard.press('F8');
    await shows(tab, /Check: The amount on item 1: 412\.50 matches 412\.50/);
    assert.doesNotMatch((await bar(tab)).text, /Paused/);
  });

  test('what the guide would not do, and what it could not answer, are kept for later', async () => {
    await askInBar(tab, 'post it for me');
    await shows(tab, /Posting is your own click\./);
    assert.equal(await tab.locator('#posted').isVisible(), false);
    await askInBar(tab, 'what was it last year');
    await shows(tab, /does not show last year/);
    const kept = s.kept();
    assert.match(kept, /step 4 \(Open item 1\)\. Asked: "post it for me"\. The guide would not do it\. "Post entry" changes something/);
    assert.match(kept, /Asked: What the snack budget was last year\. Open: the page only shows two months/);
  });

  test('typing and Escape in the bar stay in the bar: the page\'s own dialog is not shut', async () => {
    await tab.keyboard.press('F8');
    await shows(tab, /Check: The amount on item 1/);
    assert.equal(await tab.evaluate(() => document.querySelector('dialog').open), true);
    await tab.keyboard.press('F2');
    await tab.keyboard.type('x');
    await tab.keyboard.press('Escape');
    assert.equal(await tab.evaluate(() => document.querySelector('dialog').open), true);
  });
});

describe('the bar with nothing playing', { skip }, () => {
  let s, tab, asked;
  before(async () => {
    const site = await serve(built);
    const there = await browser();
    asked = join(scratch('asked'), 'context.jsonl');
    s = await session({ cdp: there.cdp, app: `${site.origin}/guide`, args: ['--bar', '/app.html', '--ask', answerer], bridgeArgs: ['--live'], env: { WAG_TEST_ASKED: asked } });
    tab = await guideTab(there.context);
  });
  after(tidy);

  test('answers on the page that shows the answer, and the page stays there with nothing to continue', async () => {
    await shows(tab, /Ready\./);
    await askInBar(tab, 'show marzember');
    const seen = await shows(tab, /This is Marzember\./);
    assert.match(tab.url(), /month=marzember/);
    assert.doesNotMatch(seen.text, /Paused/);
    assert.equal(seen.names.some((name) => name.startsWith('Continue')), false);
    // the answerer was told nothing is playing, and what the page showed
    const context = JSON.parse(readFileSync(asked, 'utf8').trim().split('\n').at(-1));
    assert.equal(context.playing, false);
    assert.equal(context.comesBack, false);
    assert.match(context.page.shows, /Snack budget watch/);
    assert.deepEqual(context.walks.map((walk) => walk.name), ['guided']);
  });

  test('a walk asked for in words starts once the answer has been said', async () => {
    await askInBar(tab, 'start the walk');
    await shows(tab, /Starting the walkthrough\./);
    await shows(tab, /A guided deck · 1 of 6/);
  });

  test('ending the walk leaves the bar up, with the walks to pick from', async () => {
    await press(tab, 'Steps');
    await press(tab, 'End this walk');
    const seen = await shows(tab, /Ready\./);
    assert.ok(seen.names.includes('Walks'));
    await press(tab, 'Walks');
    await press(tab, 'A guided deck');
    await shows(tab, /A guided deck · 1 of 6/);
  });
});

describe('one session to a port', () => {
  after(tidy);
  test('a second start stops before it takes the first one\'s key', async () => {
    // a session with no bridge is enough to hold the port
    const first = await session({ cdp: 'http://127.0.0.1:1', app: 'http://127.0.0.1:1' });
    const key = readFileSync(first.key, 'utf8');
    const second = await session({ cdp: 'http://127.0.0.1:1', app: 'http://127.0.0.1:1', port: first.port, key: first.key });
    assert.equal(await second.exit, 1);
    assert.match(second.out(), /a session is already running there/);
    assert.equal(readFileSync(first.key, 'utf8'), key);
  });
});
