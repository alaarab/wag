// wag new and wag check: every starter is a deck with nothing out of place, and a deck with
// something out of place is told so.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { hasBrowser, repo, scratch, tidy } from './helpers.mjs';

const skip = hasBrowser ? false : 'no Chromium found: set WAG_TEST_BROWSER to one';
const run = (script, args, decks, cwd) =>
  new Promise((done) => {
    const env = { ...process.env, WAG_DECKS: decks, ...(process.env.WAG_TEST_BROWSER ? { WAG_BROWSER: process.env.WAG_TEST_BROWSER } : {}) };
    execFile(process.execPath, [join(repo, 'scripts', script), ...args], { env, cwd }, (error, stdout, stderr) => done({ code: error?.code ?? 0, out: stdout + stderr }));
  });

describe('starters and the check', { skip }, () => {
  after(tidy);

  const starters = [['slides', 'wide'], ['ad', 'wide'], ['ad', 'square'], ['ad', 'tall'], ['training', 'wide'], ['walkthrough', 'wide']];
  for (const [kind, format] of starters) {
    test(`a new ${kind} deck (${format}) has nothing out of place, and a picture of every slide`, async () => {
      const dir = scratch(`new-${kind}-${format}`);
      const made = await run('new.mjs', ['my-deck', '--kind', kind, '--format', format], dir, dir);
      assert.equal(made.code, 0, made.out);
      const checked = await run('check.mjs', ['my-deck', '--out', join(dir, 'wag-check/my-deck')], dir, dir);
      assert.equal(checked.code, 0, checked.out);
      assert.match(checked.out, /Nothing out of place/);
      const report = JSON.parse(readFileSync(join(dir, 'wag-check/my-deck/report.json'), 'utf8'));
      assert.ok(report.slides.length >= 3 && report.slides.every((slide) => existsSync(slide.picture)));
      assert.ok(existsSync(report.sheet));
    });
  }

  test('text too big for its box is a problem; text off the canvas, over other text or too faint is a warning', async () => {
    const dir = scratch('check-bad');
    mkdirSync(join(dir, 'decks'));
    writeFileSync(join(dir, 'decks/bad.ts'), `import { box, dark, deck, look, slide, text } from 'wag';
const t = dark;
export default deck({ ...look(t) }, [slide({ title: 'Broken' }, [
  text('A heading that is far too long for the little box it was given to sit in', { x: 80, y: 80, w: 400, h: 60, fontSize: 52, color: t.ink }),
  text('Fine text', { x: 80, y: 400, w: 400, h: 40, fontSize: 24, color: t.ink }),
  text('On top of it', { x: 90, y: 404, w: 400, h: 40, fontSize: 24, color: t.dim }),
  text('Too faint to read', { x: 80, y: 500, w: 400, h: 30, fontSize: 18, color: '#1a1826' }),
  box({ x: 1100, y: 600, w: 300, h: 80, fill: t.panel, text: 'Off the edge', color: t.ink }),
])]);
`);
    const { code, out } = await run('check.mjs', ['bad'], join(dir, 'decks'), dir);
    assert.equal(code, 1);
    assert.match(out, /problem .*"A heading that is far too long.*taller than its box/);
    assert.match(out, /warning .*"On top of it" lies over "Fine text"/);
    assert.match(out, /warning .*"Too faint to read" is hard to read/);
    assert.match(out, /warning .*"Off the edge" runs 120 px off the canvas/);
  });

  test('words inside a piece are looked at too: cut off is a problem, out of its box a warning, and words that pass by are left be', async () => {
    const dir = scratch('check-pieces');
    mkdirSync(join(dir, 'decks'));
    writeFileSync(join(dir, 'decks/pieces.ts'), `import { code, dark, deck, look, slide, stat, ticker, wordmark } from 'wag';
const t = dark;
export default deck({ ...look(t) }, [slide({ title: 'Pieces' }, [
  stat(1284567, { x: 80, y: 60, w: 170, h: 200, pad: 10, bright: true, label: 'Sold', theme: t }),
  stat(42, { x: 300, y: 60, w: 300, h: 200, pad: 10, bright: true, label: 'Kept', theme: t }),
  wordmark({ x: 80, y: 320, w: 200, h: 200, size: 190, theme: t, still: true }),
  code('const line = "far too long to fit inside a window as narrow as this one is";', { x: 700, y: 60, w: 320, h: 160, theme: t, still: true }),
  ticker(['Words', 'that', 'pass', 'by', 'and', 'run', 'past', 'the', 'edge'], { x: 0, y: 640, w: 1280, h: 44, theme: t }),
])]);
`);
    const { code, out } = await run('check.mjs', ['pieces', '--out', join(dir, 'wag-check')], join(dir, 'decks'), dir);
    assert.equal(code, 1, out);
    assert.match(out, /problem .*"1,284,567" is cut off inside its piece/);
    assert.match(out, /problem .*"const line = .*is cut off inside its piece/);
    assert.match(out, /warning .*"wag" runs \d+ px out of its piece's box/);
    assert.doesNotMatch(out, /"42"|"Kept"|"Sold"|Words/);
    assert.match(out, /2 problems, 1 warning\./);
  });
});
