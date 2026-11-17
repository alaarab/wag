// A new look for every deck, made from a word: `fresh('Q3 launch')`. The word is a seed, so the
// same word always gives the same look (the deck in the browser, its video and its PowerPoint all
// agree), and any other word gives another. A later wag may make a word into another look: to keep
// one for good, copy it as a plain theme (Keep on the looks page). It picks:
//
//   light or dark, and a tinted ground (paper, ink, slate, dusk ...)
//   a colour scheme around one hue: neighbours, opposites, a split or a triad
//   an accent, a gradient and the light behind the slide, all from that scheme
//   a pairing of typefaces from the ones wag ships, and how marked words are set
//   a shape: how round the panels are, how heavy their edges, what kind of shadow
//   how things move: the spring, how elements come in, how slides arrive
//
// Colours are worked out in OKLCH, where equal steps look equal, and text is checked for contrast
// against its ground, so every look reads. `mood` leans it one way; `brand` starts from your colour.
//
//   deck({ ...look(fresh('Q3 launch')) }, ...)
//   fresh('Q3 launch', { mood: 'calm' })     calm, bold, playful, serious, warm, cool
//   fresh('Acme', { brand: '#ff5a1f', dark: false })
import type { Accent, Enter, MotionConfig, SlideTransition } from './scene';
import type { Theme } from './theme';

export type Mood = 'calm' | 'bold' | 'playful' | 'serious' | 'warm' | 'cool';
export interface FreshOptions {
  mood?: Mood;
  /** a colour the look is built around, such as a brand's own */
  brand?: string;
  /** light or dark ground; left out, the seed decides */
  dark?: boolean;
}

// ---------- chance, from a seed ----------

/** A number from a word, the same every time. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** A run of numbers between 0 and 1 that a seed decides (mulberry32). */
function chance(seed: number) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (low: number, high: number) => low + (high - low) * next(),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)],
    /** one of the items, where `weight` says how likely each is */
    weighted: <T>(items: readonly T[], weight: (item: T) => number) => {
      const total = items.reduce((sum, item) => sum + weight(item), 0);
      let at = next() * total;
      for (const item of items) if ((at -= weight(item)) < 0) return item;
      return items[items.length - 1];
    },
  };
}

// ---------- colour ----------

type Lch = [l: number, c: number, h: number];

/** OKLCH to linear sRGB (Björn Ottosson's OKLab). */
function linear([l, c, h]: Lch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_];
}
const inGamut = (rgb: number[]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);
/** As hex, with its chroma eased off until the screen can show it. */
function hex(colour: Lch): string {
  let [l, c, h] = colour;
  let rgb = linear([l, c, h]);
  while (!inGamut(rgb) && c > 0) rgb = linear([l, (c = Math.max(0, c - 0.005)), h]);
  const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, gamma(v))) * 255).toString(16).padStart(2, '0')).join('')}`;
}
/** A hex colour as OKLCH, for starting from a brand colour. */
function lch(colour: string): Lch {
  const full = colour.replace('#', '').replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
/** WCAG contrast between two hex colours. */
function contrast(x: string, y: string): number {
  const lum = (c: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(c.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (a + 0.05) / (b + 0.05);
}
/** The colour moved lighter (on a dark ground) or darker until it reads against `ground` at `least`. */
function readable(colour: Lch, ground: string, least: number, dark: boolean): string {
  let [l, c, h] = colour;
  for (let i = 0; i < 60 && contrast(hex([l, c, h]), ground) < least; i++) l = Math.min(0.99, Math.max(0.05, l + (dark ? 0.01 : -0.01)));
  return hex([l, c, h]);
}
const turn = (h: number, by: number) => (h + by + 360) % 360;
/** How near a hue is to yellow-green, 0 to 1: there a colour dark enough for a light ground turns to olive. */
const olive = (h: number) => Math.max(0, 1 - Math.abs(((h - 100 + 540) % 360) - 180) / 35);

// ---------- type ----------

const F = {
  bricolage: '"Bricolage Grotesque Variable", "Bricolage Grotesque", system-ui, sans-serif',
  fraunces: '"Fraunces Variable", Fraunces, Georgia, serif',
  unbounded: '"Unbounded Variable", Unbounded, system-ui, sans-serif',
  syne: '"Syne Variable", Syne, system-ui, sans-serif',
  space: '"Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif',
  sora: '"Sora Variable", Sora, system-ui, sans-serif',
  playfair: '"Playfair Display Variable", "Playfair Display", Georgia, serif',
  archivo: '"Archivo Variable", Archivo, system-ui, sans-serif',
  geist: '"Geist Variable", Geist, Inter, system-ui, sans-serif',
  inter: '"Inter Variable", Inter, system-ui, sans-serif',
  manrope: '"Manrope Variable", Manrope, system-ui, sans-serif',
  dmsans: '"DM Sans Variable", "DM Sans", system-ui, sans-serif',
  geistMono: '"Geist Mono Variable", "Geist Mono", ui-monospace, monospace',
  jetbrains: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
  spaceMono: '"Space Mono", ui-monospace, monospace',
  instrument: '"Instrument Serif", Georgia, serif',
  caveat: '"Caveat Variable", Caveat, cursive',
};

/** Pairings that work: a face for headlines, one for text, one for labels, and the moods each suits. */
const PAIRS: { name: string; weight: number; tracking: number; display: string; body: string; mono: string; serifDisplay?: boolean; moods: Mood[] }[] = [
  { name: 'Bricolage and Geist', weight: 800, tracking: -0.035, display: F.bricolage, body: F.geist, mono: F.geistMono, moods: ['playful', 'bold', 'warm'] },
  { name: 'Fraunces and Inter', weight: 700, tracking: -0.03, display: F.fraunces, body: F.inter, mono: F.jetbrains, serifDisplay: true, moods: ['calm', 'warm', 'serious'] },
  { name: 'Unbounded and Manrope', weight: 700, tracking: -0.045, display: F.unbounded, body: F.manrope, mono: F.jetbrains, moods: ['bold', 'cool', 'playful'] },
  { name: 'Syne and DM Sans', weight: 800, tracking: -0.03, display: F.syne, body: F.dmsans, mono: F.spaceMono, moods: ['bold', 'playful'] },
  { name: 'Space Grotesk and Inter', weight: 700, tracking: -0.04, display: F.space, body: F.inter, mono: F.spaceMono, moods: ['cool', 'serious'] },
  { name: 'Sora and Manrope', weight: 700, tracking: -0.04, display: F.sora, body: F.manrope, mono: F.geistMono, moods: ['calm', 'cool'] },
  { name: 'Playfair and DM Sans', weight: 800, tracking: -0.02, display: F.playfair, body: F.dmsans, mono: F.jetbrains, serifDisplay: true, moods: ['serious', 'calm', 'warm'] },
  { name: 'Archivo and Geist', weight: 800, tracking: -0.03, display: F.archivo, body: F.geist, mono: F.geistMono, moods: ['bold', 'serious', 'cool'] },
];

// ---------- the look ----------

/** Shapes a look can have: corners, edges and the depth under a panel. */
const SHAPES = {
  soft: { moods: ['calm', 'warm', 'playful'], radius: [20, 28], edge: 1 },
  round: { moods: ['playful', 'calm', 'warm'], radius: [34, 44], edge: 0 },
  crisp: { moods: ['serious', 'cool', 'calm'], radius: [6, 10], edge: 1 },
  sharp: { moods: ['serious', 'bold', 'cool'], radius: [0, 0], edge: 1.5 },
  block: { moods: ['bold', 'playful'], radius: [4, 12], edge: 2.5 },
} as const;
/** How things move from one layout to the next. */
const FEELS: Record<string, { moods: Mood[]; motion: MotionConfig }> = {
  snappy: { moods: ['bold', 'serious', 'cool'], motion: { type: 'spring', stiffness: 380, damping: 30 } },
  bouncy: { moods: ['playful', 'bold', 'warm'], motion: { type: 'spring', stiffness: 210, damping: 12 } },
  smooth: { moods: ['calm', 'serious', 'warm', 'cool'], motion: { type: 'spring', stiffness: 150, damping: 22 } },
  gentle: { moods: ['calm'], motion: { type: 'tween', duration: 0.6, ease: 'easeOut' } },
};
/** How an element comes in. */
const ENTERS: Record<string, Enter> = {
  rising: { dy: 26, opacity: 0 },
  dropping: { dy: -22, opacity: 0 },
  'sliding in': { dx: -40, opacity: 0 },
  growing: { scale: 0.9, opacity: 0 },
  fading: { opacity: 0 },
};

const SCHEMES = { neighbours: [0, 32, -28], opposites: [0, 180, 24], split: [0, 150, 210], triad: [0, 120, 240] } as const;

/** A whole theme from a seed: see the top of this file. */
export function fresh(seed: string, o: FreshOptions = {}): Theme {
  const r = chance(hash(`${seed}|${o.mood ?? ''}|${o.brand ?? ''}|${o.dark ?? ''}`));
  const mood = o.mood;
  const dark = o.dark ?? r.next() < (mood === 'calm' ? 0.3 : mood === 'bold' ? 0.75 : 0.55);
  const brand = o.brand ? lch(o.brand) : null;

  // the hue it is built around
  const hue = brand ? brand[2] : mood === 'warm' ? r.between(10, 85) : mood === 'cool' ? r.between(185, 285) : r.between(0, 360);
  const scheme = r.pick((mood === 'calm' || mood === 'serious' ? ['neighbours', 'opposites'] : mood === 'playful' ? ['triad', 'split'] : Object.keys(SCHEMES)) as (keyof typeof SCHEMES)[]);
  const [h1, h2, h3] = SCHEMES[scheme].map((by) => turn(hue, by));
  // how much colour: muted, rich or loud
  const vivid = mood === 'calm' || mood === 'serious' ? r.between(0.09, 0.13) : mood === 'bold' || mood === 'playful' ? r.between(0.17, 0.22) : r.between(0.12, 0.19);

  // the ground: tinted toward the hue, or toward warm paper on a light look now and then
  const groundHue = !dark && r.next() < 0.35 ? r.between(70, 95) : hue;
  // a dark ground tinted toward orange or yellow turns brown, so there the tint is held back
  const warmGround = dark && groundHue > 20 && groundHue < 115;
  const tint = r.between(0.008, dark ? 0.04 : 0.025) * (warmGround ? 0.4 : 1);
  const bg = hex(dark ? [r.between(0.13, 0.2), tint, groundHue] : [r.between(0.955, 0.985), tint, groundHue]);
  const panel = hex(dark ? [lch(bg)[0] + 0.045, tint * 1.2, groundHue] : [Math.min(0.995, lch(bg)[0] + 0.03), tint * 0.5, groundHue]);
  const line = hex(dark ? [lch(bg)[0] + 0.1, tint, groundHue] : [lch(bg)[0] - 0.09, tint, groundHue]);

  const ink = readable(dark ? [0.97, 0.012, groundHue] : [0.2, 0.02, groundHue], bg, 12, dark);
  const dim = readable(dark ? [0.8, 0.02, groundHue] : [0.43, 0.025, groundHue], bg, 6, dark);
  const faint = readable(dark ? [0.6, 0.025, groundHue] : [0.6, 0.025, groundHue], bg, 3, dark);
  // an accent of yellow-green on a light ground is turned toward green, where a readable one still looks clean
  const tone = (h: number, c = vivid) => readable(dark ? [0.8, c, h] : [0.55, c, olive(h) > 0.2 ? (((h - 100 + 540) % 360) - 180 < 0 ? 58 : 150) : h], bg, 4.5, dark);
  const accent = brand ? readable([brand[0], brand[1], brand[2]], bg, 3.2, dark) : tone(h2);

  // the gradient runs through the scheme; the light behind is the same hues, low and soft
  // on a light ground a yellow-green stop is kept bright, or it would go to olive
  const stop = (h: number) => hex(dark ? [r.between(0.74, 0.84), vivid + 0.02, h] : [r.between(0.56, 0.64) + olive(h) * 0.22, vivid + 0.02 + olive(h) * 0.04, h]);
  // it runs from the main hue toward the second the short way round, and never further than a third
  // of the wheel, so it is a blend and not a rainbow
  const arc = ((h2 - h1 + 540) % 360) - 180;
  const reach = Math.sign(arc || 1) * Math.min(Math.abs(arc), r.between(70, 120));
  const gradient = `linear-gradient(${Math.round(r.between(80, 130))}deg, ${stop(h1)} 0%, ${stop(turn(h1, reach / 2))} 52%, ${stop(turn(h1, reach))} 100%)`;
  const glow: [string, string, string] = [h1, h2, h3].map((h) => hex(dark ? [r.between(0.42, 0.55), vivid + 0.04, h] : [r.between(0.86, 0.92), vivid * 0.5, h])) as [string, string, string];

  const pairs = mood ? PAIRS.filter((p) => p.moods.includes(mood)) : PAIRS;
  const pair = r.pick(pairs);
  // marked words: an italic serif in the gradient, a hand, or the headline face in the accent
  const marking = r.weighted(['serif', 'hand', 'colour'] as const, (m) => (m === 'hand' ? (mood === 'playful' ? 2 : mood === 'serious' ? 0 : 0.6) : m === 'serif' ? (pair.serifDisplay ? 1 : 2) : 1));
  const marked: Accent =
    marking === 'serif'
      ? { font: pair.display === F.playfair ? F.playfair : r.pick([F.instrument, F.fraunces, F.playfair]), italic: true, gradient }
      : marking === 'hand'
        ? { font: F.caveat, weight: 700, color: accent }
        : { color: accent };

  // The shape and the motion are drawn after everything above, so a word keeps the colours and
  // type it had before these existed.
  const fits = <K extends string>(all: Record<K, { moods: readonly Mood[] }>) => r.weighted(Object.keys(all) as K[], (key) => (!mood ? 1 : all[key].moods.includes(mood) ? 3 : 0.25));
  const shape = fits(SHAPES);
  const radius = Math.round(r.between(SHAPES[shape].radius[0], SHAPES[shape].radius[1]));
  const block = shape === 'block';
  // a block look is drawn like print: a heavy edge in the ink, and a shadow that is a solid offset
  const shadow = block
    ? `${Math.round(r.between(5, 9))}px ${Math.round(r.between(5, 9))}px 0 ${dark ? accent : ink}`
    : shape === 'sharp'
      ? 'none'
      : dark
        ? '0 30px 60px -28px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.06)'
        : '0 24px 48px -28px rgba(20,18,40,0.32), 0 0 0 1px rgba(20,18,40,0.05)';
  const feel = fits(FEELS);
  const entering = r.pick(Object.keys(ENTERS));
  const transition = r.weighted(['fade', 'push', 'zoom', 'iris'] as SlideTransition[], (kind) => (kind === 'fade' ? 2 : kind === 'iris' ? (mood === 'serious' || mood === 'calm' ? 0.2 : 0.8) : 1.4));
  // capitals now and then, on a sans headline that is not already wide
  const caps = !pair.serifDisplay && pair.display !== F.unbounded && r.next() < (mood === 'bold' ? 0.3 : 0.12);

  return {
    bg,
    ink,
    dim,
    faint,
    line: block ? (dark ? faint : ink) : line,
    panel,
    accent,
    warn: tone(70, 0.15),
    bad: tone(22, 0.17),
    good: tone(155, 0.14),
    gradient,
    glow,
    shadow,
    display: pair.display,
    body: pair.body,
    mono: pair.mono,
    marked,
    name: `${dark ? 'dark' : 'light'}, ${scheme} around ${Math.round(hue)}°, ${pair.name}, marked in ${marking === 'serif' ? 'an italic serif' : marking === 'hand' ? 'a hand' : 'the accent'}, ${shape}, ${feel}, ${entering}${mood ? `, ${mood}` : ''}`,
    radius,
    edge: SHAPES[shape].edge,
    heading: { weight: pair.weight, tracking: caps ? 0 : pair.tracking, caps },
    enter: ENTERS[entering],
    motion: FEELS[feel].motion,
    transition,
  };
}

/**
 * The seed to use: the page's own `?look=word` when it has one, so any deck written with
 * `fresh(seedOr('my deck'))` can be tried in other looks from the address bar (and from
 * `npm run video <deck> -- --look word`); otherwise `fallback`.
 */
export function seedOr(fallback: string): string {
  const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('look');
  return asked || fallback;
}
