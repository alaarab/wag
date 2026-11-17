// fresh(): a look from a word. The same word, the same look; any word, a look that reads.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fresh } from '../src/fresh.ts';

const lum = (c) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (x, y) => {
  const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (a + 0.05) / (b + 0.05);
};

test('the same word gives the same look, and other words give others', () => {
  assert.deepEqual(fresh('Q3 launch'), fresh('Q3 launch'));
  const looks = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(fresh(`word ${i}`))));
  assert.equal(looks.size, 40);
  const faces = new Set(Array.from({ length: 40 }, (_, i) => fresh(`word ${i}`).display));
  assert.ok(faces.size >= 5, `only ${faces.size} headline faces in 40 looks`);
  // shape and motion change with the word too
  const all = Array.from({ length: 40 }, (_, i) => fresh(`word ${i}`));
  assert.ok(new Set(all.map((t) => t.radius)).size >= 6, 'corners differ');
  assert.ok(new Set(all.map((t) => JSON.stringify(t.motion))).size >= 3, 'the spring differs');
  assert.ok(new Set(all.map((t) => t.transition)).size >= 3, 'slides arrive in different ways');
  assert.ok(new Set(all.map((t) => JSON.stringify(t.enter))).size >= 4, 'elements come in in different ways');
});

test('every look reads: text, second text and the accent stand out from the ground', () => {
  for (let i = 0; i < 300; i++) {
    for (const mood of [undefined, 'calm', 'bold', 'playful', 'serious', 'warm', 'cool']) {
      const t = fresh(`seed ${i}`, mood ? { mood } : {});
      assert.ok(contrast(t.ink, t.bg) >= 7, `ink on ground in ${t.name}`);
      assert.ok(contrast(t.dim, t.bg) >= 4.5, `second text on ground in ${t.name}`);
      assert.ok(contrast(t.accent, t.bg) >= 3, `accent on ground in ${t.name}`);
      assert.ok(contrast(t.ink, t.panel) >= 7, `ink on a panel in ${t.name}`);
    }
  }
});

test('a brand colour is the accent, and a light or dark ground is kept when asked for', () => {
  const t = fresh('Acme', { brand: '#ff5a1f', dark: false });
  assert.ok(lum(t.bg) > 0.7, 'a light ground');
  assert.equal(t.accent.slice(0, 3), '#f8');
  assert.ok(lum(fresh('Acme', { dark: true }).bg) < 0.05, 'a dark ground');
});
