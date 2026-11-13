// A theme is the look of a deck in one object: its colours, its typefaces and the light behind
// its slides. The ready-made slides in kit.ts and the motion pieces in motion.ts all draw from one.
import { FONTS, type DeckOptions } from './scene';

export interface Theme {
  bg: string;
  ink: string;
  /** second-level text */
  dim: string;
  /** quiet labels, axis lines, anything that should sit back */
  faint: string;
  /** hairlines and the edges of panels */
  line: string;
  panel: string;
  accent: string;
  /** known problems and causes */
  warn: string;
  bad: string;
  good: string;
  /** the signature gradient: marked words, drawn strokes, the bar that stands out */
  gradient: string;
  /** the colours of the light that drifts behind a slide */
  glow: [string, string, string];
  /** depth under a panel */
  shadow: string;
  display: string;
  body: string;
  mono: string;
}

export const dark: Theme = {
  bg: '#0b0a12',
  ink: '#f6f4ff',
  dim: '#b3aecb',
  faint: '#6f6a8a',
  line: '#272438',
  panel: '#15131f',
  accent: '#8ab4ff',
  warn: '#ffc46b',
  bad: '#ff7a8a',
  good: '#6fe3b4',
  gradient: 'linear-gradient(100deg, #ffb86b 0%, #ff7eb6 52%, #8ab4ff 100%)',
  glow: ['#6d4aff', '#ff4d8d', '#2f8bff'],
  shadow: '0 30px 60px -28px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.06)',
  display: FONTS.display,
  body: FONTS.body,
  mono: FONTS.mono,
};

export const light: Theme = {
  bg: '#f6f3ec',
  ink: '#15131d',
  dim: '#565166',
  faint: '#8f899f',
  line: '#e1dccf',
  panel: '#ffffff',
  accent: '#3b5bdb',
  warn: '#b45309',
  bad: '#c0263c',
  good: '#157f5b',
  gradient: 'linear-gradient(100deg, #e8590c 0%, #d6336c 52%, #3b5bdb 100%)',
  glow: ['#ffd8a8', '#fcc2d7', '#bac8ff'],
  shadow: '0 24px 48px -28px rgba(31,26,56,0.35), 0 0 0 1px rgba(31,26,56,0.06)',
  display: FONTS.display,
  body: FONTS.body,
  mono: FONTS.mono,
};

/** The deck options that go with a theme: `deck({ ...look(dark) }, slides)`. */
export const look = (t: Theme): Pick<DeckOptions, 'bg' | 'font' | 'accent'> => ({
  bg: t.bg,
  font: t.body,
  accent: { font: FONTS.accent, italic: true, gradient: t.gradient },
});

/** A colour with some of it taken away: `fade('#8ab4ff', 0.2)`. Takes #rgb, #rrggbb and rgb(). */
export function fade(colour: string, alpha: number): string {
  const hex = colour.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const rgb = colour.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i);
  return rgb ? `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${alpha})` : colour;
}
