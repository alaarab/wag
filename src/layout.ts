// Where things go, worked out instead of counted: a page with margins, split into columns, rows
// or a grid. Every helper gives boxes as { x, y, w, h }, which is what every element takes:
//
//   const area = page('wide', { top: 196 });          // the canvas inside its margins, below a heading
//   const [left, right] = cols(area, [2, 1], 32);     // two columns, 2:1, 32 apart
//   const cards = grid(area, 3, 2, 24);               // six boxes, three across
//   box({ ...panel(t), ...cards[0] }), text('Hi', { ...inset(cards[0], 24), fontSize: 24 })
export type Format = 'wide' | 'square' | 'tall';
/** The canvas each format gives, in deck pixels. */
export const FORMATS: Record<Format, { width: number; height: number }> = { wide: { width: 1280, height: 720 }, square: { width: 1080, height: 1080 }, tall: { width: 720, height: 1280 } };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A format's whole canvas. */
export const canvas = (format: Format | { width: number; height: number } = 'wide'): Rect => {
  const size = typeof format === 'string' ? FORMATS[format] : format;
  return { x: 0, y: 0, w: size.width, h: size.height };
};

/**
 * The canvas inside its margins: the safe place for words and panels. `margin` is the space at
 * every edge (80 on a wide canvas, 64 on a square, 56 on a tall one); `top` and `bottom` move those
 * edges, to leave room for a heading or a footer.
 */
export function page(format: Format | { width: number; height: number } = 'wide', o: { margin?: number; top?: number; bottom?: number } = {}): Rect {
  const all = canvas(format);
  const margin = o.margin ?? (all.w >= 1200 ? 80 : all.w >= 1000 ? 64 : 56);
  const top = o.top ?? margin;
  const bottom = o.bottom ?? margin;
  return { x: margin, y: top, w: all.w - margin * 2, h: all.h - top - bottom };
}

/** Shares of a length: `3` is three equal parts, `[2, 1]` is two parts with the first twice the second. */
function shares(length: number, parts: number | number[], gap: number): { at: number; size: number }[] {
  const weights = typeof parts === 'number' ? Array.from({ length: parts }, () => 1) : parts;
  const room = length - gap * (weights.length - 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let at = 0;
  return weights.map((weight) => {
    const size = (room * weight) / total;
    const part = { at, size };
    at += size + gap;
    return part;
  });
}

/** The area as columns, left to right. */
export const cols = (area: Rect, parts: number | number[], gap = 24): Rect[] => shares(area.w, parts, gap).map(({ at, size }) => ({ x: area.x + at, y: area.y, w: size, h: area.h }));

/** The area as rows, top to bottom. */
export const rows = (area: Rect, parts: number | number[], gap = 24): Rect[] => shares(area.h, parts, gap).map(({ at, size }) => ({ x: area.x, y: area.y + at, w: area.w, h: size }));

/** The area as a grid, row by row: `grid(area, 3, 2)` is six boxes, three across. */
export const grid = (area: Rect, across: number, down: number, gap = 24): Rect[] => rows(area, down, gap).flatMap((row) => cols(row, across, gap));

/** The box with room taken off every side, for what sits inside a panel. */
export const inset = (area: Rect, pad: number | { x?: number; y?: number }): Rect => {
  const [px, py] = typeof pad === 'number' ? [pad, pad] : [pad.x ?? 0, pad.y ?? 0];
  return { x: area.x + px, y: area.y + py, w: area.w - px * 2, h: area.h - py * 2 };
};

/** A slice off one side of a box: `take(area, 'top', 60)` is its first 60 pixels, as wide as it is. */
export function take(area: Rect, side: 'top' | 'bottom' | 'left' | 'right', size: number): Rect {
  if (side === 'top') return { ...area, h: size };
  if (side === 'bottom') return { ...area, y: area.y + area.h - size, h: size };
  if (side === 'left') return { ...area, w: size };
  return { ...area, x: area.x + area.w - size, w: size };
}
