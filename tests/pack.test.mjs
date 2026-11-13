// A pack: what a session is told about one app, read by the wag command.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { browser, built, hasBrowser, repo, scratch, serve, tidy } from './helpers.mjs';

const skip = hasBrowser ? false : 'no Chromium found: set WAG_TEST_BROWSER to one';

describe('wag rehearse with a pack', { skip }, () => {
  let site, there;
  before(async () => {
    site = await serve(built);
    there = await browser();
  });
  after(tidy);
  /** Rehearse the made-up walk through a pack that says this much about the app. */
  const rehearse = async (about) => {
    const home = scratch('pack');
    writeFileSync(join(home, 'pack.json'), JSON.stringify({ app: `${site.origin}/guide`, decks: built, browser: { cdp: there.cdp }, ...about }));
    const child = spawn(process.execPath, [join(repo, 'bin/wag.mjs'), 'rehearse', home, 'guided'], { stdio: 'ignore' });
    const code = await new Promise((done) => child.once('exit', done));
    const sessions = join(home, 'sessions');
    const kept = readdirSync(sessions, { withFileTypes: true }).find((entry) => entry.isDirectory()).name;
    return { code, record: JSON.parse(readFileSync(join(sessions, kept, 'rehearsal.json'), 'utf8')) };
  };

  test('plays the walk on the app the pack names', async () => {
    const { code, record } = await rehearse({});
    assert.equal(code, 0);
    assert.equal(record.steps.filter((step) => step.state === 'works').length, 4);
  });

  test('the pack\'s own words for a control that changes something reach the guard', async () => {
    // on this app, say, the list labelled Month is not just a way to look
    const { code, record } = await rehearse({ changes: ['month'] });
    assert.equal(code, 1);
    assert.equal(record.steps[2].state, 'stopped');
    assert.match(record.steps[2].reason, /"Month" changes something/);
  });
});
