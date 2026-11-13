// The bridge: what it will do on a page, and what it refuses. It is run as its own program and
// talked to on its input and output, the way a session talks to it.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { bar, bridge, browser, built, guideTab, hasBrowser, repo, serve, sleep, tidy } from './helpers.mjs';

const skip = hasBrowser ? false : 'no Chromium found: set WAG_TEST_BROWSER to one';
const item = { role: 'button', name: 'Post entry', within: 'dialog' };

describe('the bridge on the made-up page', { skip }, () => {
  let site, there, b, tab;
  before(async () => {
    site = await serve(built);
    there = await browser();
    b = await bridge({ cdp: there.cdp, app: `${site.origin}/guide` });
    await b.cmd('goto', { to: '/app.html?month=marzember' });
    tab = await guideTab(there.context);
  });
  after(tidy);

  test('opens a row to look at it', async () => {
    const opened = await b.cmd('click', { target: { text: 'Biscuits bought on the tea budget' } });
    assert.equal(opened.ok, true);
    assert.match(opened.dialog, /Biscuits bought on the tea budget/);
  });

  test('does not press a button that changes something, and the page stays as it was', async () => {
    const pressed = await b.cmd('click', { target: item });
    assert.equal(pressed.ok, false);
    assert.equal(pressed.refused, true);
    assert.match(pressed.why, /Post entry/);
    assert.equal(await tab.locator('#posted').isVisible(), false);
    await b.cmd('close');
  });

  test('picks a choice by its words, with the list named or not, and says when the choice is not there', async () => {
    assert.match((await b.cmd('choose', { option: 'Febtober' })).address, /month=febtober/);
    // a click on a choice in a list picks it
    assert.match((await b.cmd('click', { target: { text: 'Marzember' } })).address, /month=marzember/);
    const missing = await b.cmd('choose', { option: 'Nonesuch', from: { role: 'combobox', name: 'Month' } });
    assert.equal(missing.ok, false);
    assert.match(missing.why, /"Nonesuch" is not one of the choices of Month/);
  });

  test('says what it was looking for when it is not on the page', async () => {
    const lost = await b.show({ click: 'A row that is not there' });
    assert.equal(lost.ok, false);
    assert.match(lost.why, /"A row that is not there" did not show/);
  });

  test('takes the branch that fits the page, and leaves out a check whose part is not there', async () => {
    const branch = (see) => ({ if: { see }, then: [{ point: 'Snack budget watch' }], else: [{ point: 'Month' }] });
    assert.deepEqual((await b.show(branch('No such part'))).done, ['Pointed at Month']);
    assert.deepEqual((await b.show(branch('Snack budget watch'))).done, ['Pointed at Snack budget watch']);
    const title = { label: 'The title', read: { page: { css: 'h1' } }, equals: { value: 'Snack budget watch' } };
    const read = await b.ask('check', { live: { check: [title, { ...title, when: { see: 'No such part' } }] } });
    assert.equal(read.results[0].ok, true);
    assert.equal(read.results[1].skipped, true);
  });

  test('its own looking and clicking never land on the words in its bar', async () => {
    await b.cmd('choose', { option: 'Febtober' });
    assert.equal((await b.cmd('bar', { state: { head: 'Guide', asked: 'show marzember', caption: 'Marzember was asked about.' } })).shown, true);
    assert.match((await bar(tab)).text, /Marzember was asked about/);
    assert.equal((await b.cmd('find', { text: 'was asked about' })).count, 0);
    // the only Marzember it can reach is the choice in the page's own list
    const clicked = await b.cmd('click', { target: { text: 'Marzember' } });
    assert.match(clicked.address, /month=marzember/);
    await b.cmd('bar', { state: null });
  });
});

describe('the bridge in a session the viewer started', { skip }, () => {
  let site, there, b, theirs;
  before(async () => {
    site = await serve(built);
    there = await browser();
    // a tab they have open on something else, in front
    theirs = there.context.pages()[0];
    await theirs.goto(`${site.origin}/index.html?theirs=1`);
    b = await bridge({ cdp: there.cdp, app: `${site.origin}/guide`, args: ['--live'] });
  });
  after(tidy);

  test('reads the tab they had open but will not act in it', async () => {
    assert.match((await b.cmd('where')).address, /theirs=1/);
    const acted = await b.cmd('click', { target: { css: 'body' } });
    assert.equal(acted.refused, true);
  });

  test('goes to a page in a tab of its own, and leaves theirs where it was with no bar on it', async () => {
    const went = await b.cmd('goto', { to: '/app.html?month=marzember' });
    assert.match(went.did ?? went.done, /in a tab of its own/);
    await b.cmd('bar', { state: { head: 'Guide', caption: 'Here.' } });
    assert.match(theirs.url(), /index\.html\?theirs=1$/);
    assert.equal(await bar(theirs), null);
    assert.match((await bar(await guideTab(there.context))).text, /Here\./);
  });

  test('leaves a download to the viewer: a button that says it is one is not pressed', async () => {
    await b.cmd('click', { target: { text: 'Biscuits bought on the tea budget' } });
    const asked = await b.cmd('click', { target: { role: 'button', name: 'Download the entry', within: 'dialog' } });
    assert.equal(asked.refused, true);
    assert.match(asked.why, /hands over a file/);
    const step = await b.show({ download: { role: 'button', name: 'Download the entry', within: 'dialog' }, as: 'entry' });
    assert.equal(step.refused, true);
  });

  test('stops a download that a press sets off, though nothing in the button\'s name says so', async () => {
    const pages = await serve(join(repo, 'tests/pages'));
    await b.cmd('goto', { to: `${pages.origin}/sends.html` });
    const pressed = await b.cmd('click', { target: { role: 'button', name: 'Show the sheet' } });
    assert.equal(pressed.refused, true);
    assert.match(pressed.why, /started a download \(sheet\.csv\)/);
    await sleep(800);
    // the folder downloads go to holds the bridge's own log and key, and no file from the page
    assert.deepEqual(readdirSync(b.files).filter((name) => !/\.(log|token)$/.test(name)), []);
  });

  test('presses a dialog button only when its name says it just looks: "Close" alone, not "Close" and more', async () => {
    await b.cmd('goto', { to: `${site.origin}/guide/app.html?month=marzember` });
    await b.cmd('click', { target: { text: 'Biscuits bought on the tea budget' } });
    await (await guideTab(there.context)).evaluate(() => (document.getElementById('close').textContent = 'Close the books'));
    const more = await b.cmd('click', { target: { role: 'button', name: 'Close the books', within: 'dialog' } });
    assert.equal(more.refused, true);
    assert.match(more.why, /cannot tell what "Close the books" does/);
    await (await guideTab(there.context)).evaluate(() => (document.getElementById('close').textContent = 'Close'));
    assert.equal((await b.cmd('click', { target: { role: 'button', name: 'Close', within: 'dialog' } })).ok, true);
  });
});

describe('the bridge on a page that is not on this machine', { skip }, () => {
  let site, b, state;
  before(async (context) => {
    // any address but this machine's own name: a second loopback address stands in for a real system
    site = await serve(join(repo, 'tests/pages'), '127.0.0.2').catch(() => null);
    if (!site) return context.skip('127.0.0.2 is not an address on this machine');
    const there = await browser();
    b = await bridge({ cdp: there.cdp, app: site.origin });
    await b.cmd('goto', { to: '/sends.html' });
    const tab = await guideTab(there.context, 'sends.html');
    state = () => tab.locator('#state').innerText();
  });
  after(tidy);

  test('stops a press that sends, though its label only looks', async () => {
    const pressed = await b.cmd('click', { target: { role: 'button', name: 'Show details' } });
    assert.equal(pressed.refused, true);
    assert.match(pressed.why, /POST \/save/);
    assert.deepEqual(site.sent, []);
    assert.equal(await state(), 'stopped /save');
  });

  test('stops typing in a box that saves as you type', async () => {
    const typed = await b.show({ fill: 'hello', into: { role: 'textbox', name: 'Note' } });
    assert.equal(typed.refused, true);
    assert.deepEqual(site.sent, []);
  });

  test('stops a pick from a list that saves', async () => {
    const picked = await b.cmd('choose', { option: 'Green', from: { role: 'combobox', name: 'Colour' } });
    assert.equal(picked.refused, true);
    assert.deepEqual(site.sent, []);
  });

  test('lets the browser\'s own report of a broken content rule through: that is not the press sending anything', async () => {
    await b.cmd('goto', { to: '/rules.html' });
    const before = site.sent.length;
    const pressed = await b.cmd('click', { target: { role: 'button', name: 'Show more' } });
    assert.equal(pressed.ok, true);
    // the report reached the page's server, and it was about the page's own style, not about the guide's marks
    assert.deepEqual(site.sent.slice(before), ['POST /rule-report']);
    await b.cmd('goto', { to: '/sends.html' });
  });

  test('does not type in a box that is not for text', async () => {
    const ticked = await b.show({ fill: 'x', into: { css: '#agree' } });
    assert.equal(ticked.refused, true);
    assert.match(ticked.why, /not a text box/);
  });
});
