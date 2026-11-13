// A rehearsal: a walk played with nobody watching, and the record of which steps work.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { browser, built, hasBrowser, scratch, serve, session, tidy } from './helpers.mjs';

const skip = hasBrowser ? false : 'no Chromium found: set WAG_TEST_BROWSER to one';

describe('a rehearsal', { skip }, () => {
  let site, there;
  before(async () => {
    site = await serve(built);
    there = await browser();
  });
  after(tidy);
  const rehearse = async (decks) => {
    const s = await session({ cdp: there.cdp, app: `${site.origin}/guide`, args: ['--rehearse', 'guided'], decks });
    const code = await s.exit;
    return { code, record: JSON.parse(readFileSync(join(s.dir, 'rehearsal.json'), 'utf8')) };
  };

  test('says of each step whether it works, and never presses the viewer\'s own click', async () => {
    const { code, record } = await rehearse(built);
    assert.equal(code, 0);
    assert.equal(record.ok, true);
    assert.deepEqual(record.steps.map((step) => step.state), ['words only', 'works', 'works', 'works', 'works', 'your click']);
    // the download step fetched its file and the checks added the workbook up
    assert.deepEqual(record.steps[4].checks.map((check) => check.state), ['matches', 'matches', 'matches']);
    assert.match(record.steps[5].reason, /not pressed in a rehearsal/);
  });

  test('ends with 1 and names what was not found when a step does not work', async () => {
    const walk = JSON.parse(readFileSync(join(built, 'guide/walk.json'), 'utf8'));
    walk.steps[1].live.check[0].equals.value = 'Another title';
    walk.steps[3].live.show[0].click = 'A row that is not there';
    const decks = scratch('decks');
    mkdirSync(join(decks, 'guide'));
    writeFileSync(join(decks, 'guide/walk.json'), JSON.stringify(walk));
    const { code, record } = await rehearse(decks);
    assert.equal(code, 1);
    assert.equal(record.ok, false);
    assert.equal(record.steps[1].state, 'check differs');
    assert.match(record.steps[1].reason, /Snack budget watch does not match Another title/);
    assert.equal(record.steps[3].state, 'failed');
    assert.match(record.steps[3].reason, /"A row that is not there" did not show/);
  });
});
