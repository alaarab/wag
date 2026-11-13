// Motion pieces: ready-made things that move, to drop into any slide. Each one is a scene, so it
// sits in a slide like a box does (states, hover and transitions move it as a whole) and plays
// from the start every time its slide appears. They take their colours and type from a theme.
//
//   aurora()            light drifting behind a slide
//   wordmark()          the wag name, with a tail that wags
//   stat(412.5, …)      a figure that counts up
//   bars([...], …)      a bar chart that grows
//   trend([...], …)     a line chart that draws itself
//   ring(0.72, …)       a ring that fills
//   code(`...`, …)      code that types itself
//   flow(nodes, links)  boxes joined by lines, with pulses running along them
//   ticker([...], …)    words passing by
//   pointer([...], …)   a cursor that moves and clicks, for showing how something is used
//   confetti(…)         a burst when the slide arrives
import { scene, type ElementOptions, type SceneContext, type slide } from './scene';
import { dark, fade, type Theme } from './theme';

type Draft = Parameters<typeof slide>[1][number];
type Animate = SceneContext['animate'];
/** where a piece goes, plus anything else an element takes */
type Placed = ElementOptions & {
  theme?: Theme;
  /** room between the edge of the box and what is drawn in it, for a piece that is its own card (give it a `fill` and a `radius`) */
  pad?: number;
};

const OUT = [0.16, 1, 0.3, 1] as const;
let made = 0;
/** a name no other piece on the page has, for the gradients an SVG refers to by id */
const unique = (stem: string) => `wag-${stem}-${++made}`;

/** The colours a theme's gradient runs through. */
const hues = (t: Theme) => t.gradient.match(/#[0-9a-f]{6}\b/gi) ?? [t.accent];
const isDark = (t: Theme) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(t.bg.slice(i, i + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 < 128;
};
/** A font stack as it can be written inside a style attribute, whose own quotes are double. */
const face = (stack: string) => stack.replace(/"/g, "'");
const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const figure = (n: number, decimals = 0) => n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const gradientDefs = (id: string, t: Theme, vertical = false) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">${hues(t)
    .map((c, i, all) => `<stop offset="${all.length > 1 ? i / (all.length - 1) : 0}" stop-color="${c}"/>`)
    .join('')}</linearGradient>`;

/** A scene whose contents keep `pad` pixels clear of its edges. */
function piece(o: Placed, alt: string | undefined, build: (stage: HTMLElement, context: SceneContext) => void | (() => void)): Draft {
  const pad = o.pad ?? 0;
  return scene({ alt, ...o }, (root, context) => {
    root.style.overflow = 'visible';
    if (!pad) return build(root, context);
    const stage = document.createElement('div');
    const [width, height] = [context.width - pad * 2, context.height - pad * 2];
    stage.style.cssText = `position:absolute;left:${pad}px;top:${pad}px;width:${width}px;height:${height}px`;
    root.append(stage);
    return build(stage, { ...context, width, height });
  });
}

/** Count `node` from one figure to another. */
function count(animate: Animate, node: Element, from: number, to: number, write: (n: number) => string, seconds: number, delay: number) {
  node.textContent = write(from);
  animate(from, to, { duration: seconds, delay, ease: OUT, onUpdate: (n: number) => (node.textContent = write(n)) });
}

// ---------- light behind a slide ----------

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")";

export interface AuroraOptions {
  theme?: Theme;
  /** how much light: 1 behind a title, about 0.4 behind a slide with a lot on it (the default) */
  strength?: number;
  /** a faint grid over the light (default true) */
  grid?: boolean;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/**
 * Light that drifts behind a slide: three soft glows in the theme's colours, a faint grid and a
 * little grain. It is decoration, so it never takes the pointer and an export leaves it out. Put
 * it first in a slide's list so everything else sits on top. It holds still for a viewer whose
 * system asks for reduced motion, which is also how to record a small GIF of a slide.
 */
export function aurora(o: AuroraOptions = {}): Draft {
  const t = o.theme ?? dark;
  const k = o.strength ?? 0.4;
  const night = isDark(t);
  return scene({ x: o.x ?? 0, y: o.y ?? 0, w: o.w ?? 1280, h: o.h ?? 720, decor: true }, (root, { animate, width, height }) => {
    const size = Math.max(width, height);
    const glow = (colour: string, at: string, scale: number) =>
      `<i style="position:absolute;${at};width:${size * scale}px;height:${size * scale}px;border-radius:50%;background:radial-gradient(closest-side,${fade(colour, (night ? 0.5 : 0.9) * k)},${fade(colour, 0)});opacity:0"></i>`;
    root.innerHTML =
      glow(t.glow[0], `left:${-size * 0.22}px;top:${-size * 0.34}px`, 0.78) +
      glow(t.glow[1], `right:${-size * 0.2}px;top:${-size * 0.12}px`, 0.62) +
      glow(t.glow[2], `left:${size * 0.2}px;bottom:${-size * 0.46}px`, 0.74) +
      (o.grid === false
        ? ''
        : `<b style="position:absolute;inset:0;opacity:0;background-image:linear-gradient(${fade(t.ink, 0.06)} 1px,transparent 1px),linear-gradient(90deg,${fade(t.ink, 0.06)} 1px,transparent 1px);background-size:64px 64px;-webkit-mask-image:radial-gradient(ellipse at 30% 35%,#000 0%,transparent 72%);mask-image:radial-gradient(ellipse at 30% 35%,#000 0%,transparent 72%)"></b>`) +
      `<u style="position:absolute;inset:0;opacity:${night ? 0.1 : 0.16};mix-blend-mode:${night ? 'overlay' : 'multiply'}"></u>` +
      (night ? `<s style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 38%,transparent 52%,rgba(0,0,0,${0.5 * Math.min(1, k + 0.4)}))"></s>` : '');
    // the grain's address has quotes of its own, so it is set here and not in the markup
    root.querySelector<HTMLElement>('u')!.style.backgroundImage = GRAIN;
    const glows = [...root.querySelectorAll<HTMLElement>('i')];
    // someone who has asked their system for less motion gets the light without the drift
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    glows.forEach((node, i) => {
      animate(node, { opacity: [0, 1], scale: [0.7, 1] }, { duration: calm ? 0.01 : 2.2, ease: 'easeOut', delay: calm ? 0 : i * 0.16 });
      if (calm) return;
      const [dx, dy, seconds] = [[90, 60, 13], [-70, 80, 16], [60, -70, 11]][i];
      animate(node, { x: [0, dx], y: [0, dy] }, { duration: seconds, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' });
    });
    const grid = root.querySelector('b');
    if (grid) animate(grid, { opacity: [0, 1] }, { duration: calm ? 0.01 : 1.6, delay: calm ? 0 : 0.2 });
  });
}

// ---------- the name ----------

export interface WordmarkOptions extends Placed {
  /** the height of the letters in pixels (default: as tall as fits the box) */
  size?: number;
  /** leave the tail still */
  still?: boolean;
}

/** The wag name with its tail underneath. The tail draws itself in, then wags every few seconds. */
export function wordmark(o: WordmarkOptions): Draft {
  const t = o.theme ?? dark;
  return scene({ alt: 'wag', ...o }, (root, { animate, height }) => {
    const size = o.size ?? height * 0.72;
    const id = unique('tail');
    root.style.overflow = 'visible';
    root.innerHTML = `
      <div style="position:relative;display:inline-block;font-family:${face(t.display)};font-weight:800;font-size:${size}px;line-height:.86;letter-spacing:-.055em;color:${t.ink}">
        <span style="display:block;overflow:hidden;padding:0 .06em .16em 0;margin-bottom:-.16em"><span class="w" style="display:inline-block">wag</span></span>
        <svg viewBox="0 0 340 40" style="display:block;width:${size * 1.72}px;height:${size * 0.2}px;margin-top:${size * 0.04}px;overflow:visible;transform-origin:2% 60%">
          <defs>${gradientDefs(id, t)}</defs>
          <path pathLength="1" d="M6 24 C 70 4, 130 38, 200 18 S 300 6, 334 16" fill="none" stroke="url(#${id})" stroke-width="${Math.max(5, size * 0.062)}" stroke-linecap="round" stroke-dasharray="1" stroke-dashoffset="1"/>
        </svg>
      </div>`;
    animate('.w', { y: ['110%', '0%'] }, { duration: 1, ease: OUT, delay: 0.05 });
    animate('path', { strokeDashoffset: [1, 0] }, { duration: 0.9, ease: OUT, delay: 0.55 });
    if (o.still) return;
    // three quick wags, then a rest
    animate('svg', { rotate: [0, -7, 6, -5, 4, -2, 0, 0] }, { duration: 3.4, times: [0, 0.05, 0.11, 0.17, 0.23, 0.28, 0.33, 1], ease: 'easeInOut', repeat: Infinity, delay: 1.7 });
  });
}

// ---------- figures ----------

export interface StatOptions extends Placed {
  /** a few words over the figure */
  label?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  /** where the count starts (default 0) */
  from?: number;
  /** a change to show beside the label, such as '+12%' */
  delta?: string;
  /** how the change reads: good (the default), bad or warn */
  tone?: 'good' | 'bad' | 'warn';
  /** colour the figure with the theme's gradient */
  bright?: boolean;
  seconds?: number;
  delay?: number;
}

/** A figure that counts up to its value, with a label over it. */
export function stat(value: number, o: StatOptions): Draft {
  const t = o.theme ?? dark;
  const write = (n: number) => `${o.prefix ?? ''}${figure(n, o.decimals)}${o.suffix ?? ''}`;
  return piece(o, `${o.label ? `${o.label}: ` : ''}${write(value)}`, (root, { animate, height }) => {
    const size = Math.min(height * (o.label ? 0.56 : 0.8), 150);
    const tone = t[o.tone ?? 'good'];
    const ink = o.bright ? `background-image:${t.gradient};-webkit-background-clip:text;background-clip:text;color:transparent` : `color:${t.ink}`;
    root.style.overflow = 'visible';
    root.innerHTML = `
      <div style="display:flex;flex-direction:column;justify-content:center;height:100%;gap:${size * 0.12}px">
        ${o.label ? `<div class="l" style="display:flex;align-items:center;gap:10px;font-family:${face(t.mono)};font-size:${Math.max(12, size * 0.15)}px;letter-spacing:.14em;text-transform:uppercase;color:${t.faint};opacity:0"><span>${escape(o.label)}</span>${o.delta ? `<span style="padding:.25em .7em;border-radius:99px;letter-spacing:.02em;color:${tone};background:${fade(tone, 0.14)}">${escape(o.delta)}</span>` : ''}</div>` : ''}
        <div class="n" style="font-family:${face(t.display)};font-weight:800;font-size:${size}px;line-height:.9;letter-spacing:-.045em;font-variant-numeric:tabular-nums;white-space:nowrap;${ink}"></div>
      </div>`;
    const delay = o.delay ?? 0;
    if (o.label) animate('.l', { opacity: [0, 1], y: [10, 0] }, { duration: 0.7, ease: OUT, delay });
    animate('.n', { opacity: [0, 1], y: [size * 0.25, 0] }, { duration: 0.8, ease: OUT, delay });
    count(animate, root.querySelector('.n')!, o.from ?? 0, value, write, o.seconds ?? 1.6, delay);
  });
}

export interface BarsOptions extends Placed {
  /** written after each figure, such as '%' */
  unit?: string;
  decimals?: number;
  /** the bar to pick out, counting from 0 */
  mark?: number;
  /** the top of the scale (default: the largest figure) */
  max?: number;
  delay?: number;
}

/** A bar chart: the bars grow from the baseline one after another and their figures count up. */
export function bars(data: { label: string; value: number }[], o: BarsOptions): Draft {
  const t = o.theme ?? dark;
  const write = (n: number) => `${figure(n, o.decimals)}${o.unit ?? ''}`;
  return piece(o, data.map((d) => `${d.label} ${write(d.value)}`).join(', '), (root, { animate, width, height }) => {
    const top = 34;
    const foot = 34;
    const room = height - top - foot;
    const most = o.max ?? Math.max(...data.map((d) => d.value), 1);
    const slot = width / data.length;
    const thick = Math.min(slot * 0.62, 92);
    root.style.overflow = 'visible';
    root.innerHTML =
      [0.25, 0.5, 0.75, 1].map((at) => `<i style="position:absolute;left:0;right:0;top:${top + room * (1 - at)}px;border-top:1px dashed ${fade(t.ink, 0.1)}"></i>`).join('') +
      `<i style="position:absolute;left:0;right:0;top:${top + room}px;border-top:1px solid ${fade(t.ink, 0.22)}"></i>` +
      data
        .map((d, i) => {
          const tall = Math.max(4, (d.value / most) * room);
          const picked = i === o.mark;
          const left = slot * i + (slot - thick) / 2;
          return `
            <div class="bar" style="position:absolute;left:${left}px;top:${top + room - tall}px;width:${thick}px;height:${tall}px;border-radius:${Math.min(12, thick / 4)}px ${Math.min(12, thick / 4)}px 2px 2px;transform-origin:50% 100%;${picked ? `background-image:${t.gradient.replace(/[\d.]+deg/, '180deg')};box-shadow:0 0 44px -6px ${fade(hues(t)[1] ?? t.accent, 0.7)}` : `background:linear-gradient(180deg,${fade(t.ink, 0.3)},${fade(t.ink, 0.1)})`}"></div>
            <b class="val" style="position:absolute;left:${slot * i}px;width:${slot}px;top:${top + room - tall - 28}px;text-align:center;font-family:${face(t.mono)};font-weight:500;font-size:15px;font-variant-numeric:tabular-nums;color:${picked ? t.ink : t.dim};opacity:0"></b>
            <span style="position:absolute;left:${slot * i}px;width:${slot}px;top:${top + room + 10}px;text-align:center;font-family:${face(t.body)};font-size:15px;color:${picked ? t.ink : t.dim};white-space:nowrap">${escape(d.label)}</span>`;
        })
        .join('');
    const start = o.delay ?? 0.15;
    root.querySelectorAll('.bar').forEach((bar, i) => animate(bar, { scaleY: [0, 1] }, { type: 'spring', stiffness: 140, damping: 16, delay: start + i * 0.09 }));
    root.querySelectorAll('.val').forEach((label, i) => {
      animate(label, { opacity: [0, 1] }, { duration: 0.4, delay: start + i * 0.09 + 0.15 });
      count(animate, label, 0, data[i].value, write, 1, start + i * 0.09);
    });
  });
}

export interface TrendOptions extends Placed {
  /** words under the line, spread evenly: usually the first and last, or one per point */
  labels?: string[];
  /** written beside the end of the line */
  end?: string;
  delay?: number;
  seconds?: number;
}

/** A line chart that draws itself from left to right, with the area under it filling in behind. */
export function trend(points: number[], o: TrendOptions): Draft {
  const t = o.theme ?? dark;
  return piece(o, `${points[0]} to ${points[points.length - 1]}`, (root, { animate, width, height }) => {
    const pad = { top: 22, right: o.end ? 96 : 16, bottom: o.labels ? 32 : 10, left: 4 };
    const w = width - pad.left - pad.right;
    const h = height - pad.top - pad.bottom;
    const low = Math.min(...points);
    const span = Math.max(...points) - low || 1;
    const at = points.map((p, i) => [pad.left + (w * i) / (points.length - 1), pad.top + h - ((p - low) / span) * h * 0.92 - h * 0.04] as const);
    // a smooth curve through every point
    let d = `M${at[0][0]} ${at[0][1]}`;
    for (let i = 0; i < at.length - 1; i++) {
      const [p0, p1, p2, p3] = [at[Math.max(0, i - 1)], at[i], at[i + 1], at[Math.min(at.length - 1, i + 2)]];
      d += ` C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6}, ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6}, ${p2[0]} ${p2[1]}`;
    }
    const [lastX, lastY] = at[at.length - 1];
    const stroke = unique('line');
    const under = unique('area');
    const tip = hues(t)[hues(t).length - 1];
    root.style.overflow = 'visible';
    root.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">
        <defs>${gradientDefs(stroke, t)}<linearGradient id="${under}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${fade(tip, 0.3)}"/><stop offset="1" stop-color="${fade(tip, 0)}"/></linearGradient></defs>
        ${[0, 0.5, 1].map((k) => `<line x1="${pad.left}" x2="${pad.left + w}" y1="${pad.top + h * k}" y2="${pad.top + h * k}" stroke="${fade(t.ink, k === 1 ? 0.22 : 0.1)}" stroke-dasharray="${k === 1 ? '' : '3 6'}"/>`).join('')}
        <path class="area" d="${d} L${lastX} ${pad.top + h} L${at[0][0]} ${pad.top + h} Z" fill="url(#${under})" opacity="0"/>
        <path class="line" pathLength="1" d="${d}" fill="none" stroke="url(#${stroke})" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1" stroke-dashoffset="1"/>
        <circle class="halo" cx="${lastX}" cy="${lastY}" r="9" fill="none" stroke="${tip}" stroke-width="2" opacity="0"/>
        <circle class="dot" cx="${lastX}" cy="${lastY}" r="7" fill="${tip}" stroke="${t.bg}" stroke-width="3" opacity="0"/>
      </svg>
      ${(o.labels ?? []).map((label, i, all) => `<span style="position:absolute;top:${pad.top + h + 9}px;left:${pad.left + (all.length > 1 ? (w * i) / (all.length - 1) : 0)}px;transform:translateX(${i === 0 ? 0 : i === all.length - 1 ? -100 : -50}%);font-family:${face(t.body)};font-size:14px;color:${t.faint};white-space:nowrap">${escape(label)}</span>`).join('')}
      ${o.end ? `<b class="end" style="position:absolute;left:${lastX + 18}px;top:${lastY - 13}px;font-family:${face(t.mono)};font-weight:500;font-size:18px;color:${t.ink};white-space:nowrap;opacity:0">${escape(o.end)}</b>` : ''}`;
    const delay = o.delay ?? 0.2;
    const seconds = o.seconds ?? 1.6;
    animate('.line', { strokeDashoffset: [1, 0] }, { duration: seconds, ease: 'easeInOut', delay });
    animate('.area', { opacity: [0, 1] }, { duration: 1.1, delay: delay + seconds * 0.55 });
    animate('.dot', { opacity: [0, 1], scale: [0, 1] }, { type: 'spring', stiffness: 320, damping: 14, delay: delay + seconds * 0.92 });
    animate('.halo', { opacity: [0.8, 0], scale: [1, 3.2] }, { duration: 1.8, repeat: Infinity, ease: 'easeOut', delay: delay + seconds });
    if (o.end) animate('.end', { opacity: [0, 1], x: [-8, 0] }, { duration: 0.6, ease: OUT, delay: delay + seconds });
  });
}

export interface RingOptions extends Placed {
  /** a few words under the figure */
  label?: string;
  /** how thick the ring is, in pixels (default: an eighth of its width) */
  thickness?: number;
  delay?: number;
  seconds?: number;
}

/** A ring that fills to a share of the whole (0 to 1) while the percentage in its middle counts up. */
export function ring(share: number, o: RingOptions): Draft {
  const t = o.theme ?? dark;
  return piece(o, `${Math.round(share * 100)}%${o.label ? ` ${o.label}` : ''}`, (root, { animate, width, height }) => {
    const size = Math.min(width, height);
    const thick = o.thickness ?? size / 8;
    const r = (size - thick) / 2;
    const id = unique('ring');
    root.style.overflow = 'visible';
    root.innerHTML = `
      <div style="position:absolute;left:${(width - size) / 2}px;top:${(height - size) / 2}px;width:${size}px;height:${size}px">
        <svg viewBox="0 0 ${size} ${size}" style="width:100%;height:100%;transform:rotate(-90deg);overflow:visible">
          <defs>${gradientDefs(id, t)}</defs>
          <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${fade(t.ink, 0.1)}" stroke-width="${thick}"/>
          <circle class="arc" cx="${size / 2}" cy="${size / 2}" r="${r}" pathLength="1" fill="none" stroke="url(#${id})" stroke-width="${thick}" stroke-linecap="round" stroke-dasharray="1" stroke-dashoffset="1"/>
        </svg>
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${size * 0.02}px">
          <b class="n" style="font-family:${face(t.display)};font-weight:800;font-size:${size * 0.27}px;line-height:1;letter-spacing:-.04em;font-variant-numeric:tabular-nums;color:${t.ink}"></b>
          ${o.label ? `<span style="font-family:${face(t.mono)};font-size:${Math.max(11, size * 0.062)}px;letter-spacing:.14em;text-transform:uppercase;color:${t.faint}">${escape(o.label)}</span>` : ''}
        </div>
      </div>`;
    const delay = o.delay ?? 0.2;
    const seconds = o.seconds ?? 1.5;
    animate('.arc', { strokeDashoffset: [1, 1 - Math.min(1, Math.max(0, share))] }, { duration: seconds, ease: OUT, delay });
    count(animate, root.querySelector('.n')!, 0, share * 100, (n) => `${Math.round(n)}%`, seconds, delay);
  });
}

// ---------- code ----------

const KEYWORDS = new Set('import from export default const let var return function new type interface true false null undefined if else for of in await async class extends'.split(' '));

/** Source split into coloured runs: enough of TypeScript to read well on a slide. */
function colourCode(source: string, t: Theme): { text: string; colour: string }[] {
  const [warm, pink, cool] = [hues(t)[0] ?? t.warn, hues(t)[1] ?? t.bad, hues(t)[2] ?? t.accent];
  const out: { text: string; colour: string }[] = [];
  const pattern = /(\/\/[^\n]*)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z_$\d])/g;
  for (const m of source.matchAll(pattern)) {
    const [whole, comment, string, number, word] = m;
    const after = source.slice(m.index + whole.length);
    const colour = comment
      ? t.faint
      : string
        ? warm
        : number
          ? cool
          : word
            ? KEYWORDS.has(word)
              ? pink
              : /^\s*\(/.test(after)
                ? cool
                : /^\s*:/.test(after)
                  ? t.ink
                  : fade(t.ink, 0.86)
            : t.dim;
    out.push({ text: whole, colour });
  }
  return out;
}

export interface CodeOptions extends Placed {
  /** the name on the window's tab */
  file?: string;
  /** the size of the type, in pixels (default 19) */
  size?: number;
  /** how long the typing takes (default: about 45 characters a second) */
  seconds?: number;
  delay?: number;
  /** show it all at once instead of typing it */
  still?: boolean;
}

/** A window of code that types itself, coloured as it goes. */
export function code(source: string, o: CodeOptions): Draft {
  const t = o.theme ?? dark;
  const night = isDark(t);
  return scene({ alt: source, fill: night ? '#100e19' : '#ffffff', radius: 18, stroke: t.line, strokeWidth: 1, shadow: t.shadow, ...o }, (root, { animate }) => {
    const size = o.size ?? 19;
    const runs = colourCode(source.replace(/^\n+|\s+$/g, ''), t);
    root.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;height:44px;padding:0 18px;border-bottom:1px solid ${t.line}">
        ${['#ff5f57', '#febc2e', '#28c840'].map((c) => `<i style="width:12px;height:12px;border-radius:50%;background:${night ? fade(t.ink, 0.16) : c}"></i>`).join('')}
        ${o.file ? `<span style="margin-left:10px;font-family:${face(t.mono)};font-size:13px;color:${t.faint}">${escape(o.file)}</span>` : ''}
      </div>
      <pre style="margin:0;padding:20px 24px;font-family:${face(t.mono)};font-size:${size}px;line-height:1.62;white-space:pre;tab-size:2">${runs
        .map((run) => [...run.text].map((letter) => `<span style="color:${run.colour}">${escape(letter)}</span>`).join(''))
        .join('')}<i class="caret" style="display:inline-block;width:${size * 0.52}px;height:${size * 1.15}px;margin-bottom:-${size * 0.2}px;background:${hues(t)[1] ?? t.accent};border-radius:2px"></i></pre>`;
    const letters = [...root.querySelectorAll<HTMLElement>('pre span')];
    const caret = root.querySelector<HTMLElement>('.caret')!;
    animate(caret, { opacity: [1, 1, 0, 0] }, { duration: 1, times: [0, 0.5, 0.5, 1], repeat: Infinity, ease: 'linear' });
    if (o.still) return;
    for (const letter of letters) letter.style.display = 'none';
    letters[0]?.before(caret);
    let shown = 0;
    animate(0, letters.length, {
      duration: o.seconds ?? Math.max(1.2, letters.length / 45),
      delay: o.delay ?? 0.4,
      ease: 'linear',
      onUpdate(n: number) {
        const upTo = Math.round(n);
        while (shown < upTo) letters[shown++].style.display = '';
        // the caret sits where the next letter will go
        if (shown < letters.length) letters[shown].before(caret);
        else letters[letters.length - 1]?.after(caret);
      },
    });
  });
}

// ---------- diagrams ----------

export interface FlowNode {
  id: string;
  label: string;
  /** a second, quieter line */
  sub?: string;
  /** the top left corner, in the piece's own pixels */
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** a colour for the node's dot; `bright` gives it the theme's gradient edge */
  tone?: string;
  bright?: boolean;
}

export interface FlowLink {
  from: string;
  to: string;
}

export interface FlowOptions extends Placed {
  delay?: number;
}

/**
 * Boxes joined by lines. The boxes arrive in the order given, each line draws itself from one box
 * to the next, and then pulses run along the lines for as long as the slide is up.
 */
export function flow(nodes: FlowNode[], links: FlowLink[], o: FlowOptions): Draft {
  const t = o.theme ?? dark;
  return scene({ alt: nodes.map((n) => n.label).join(' · '), ...o }, (root, { animate, width, height }) => {
    const boxOf = (n: FlowNode) => ({ x: n.x, y: n.y, w: n.w ?? 220, h: n.h ?? (n.sub ? 84 : 64) });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const id = unique('flow');
    const routes = links.flatMap((link) => {
      const [a, b] = [byId.get(link.from), byId.get(link.to)];
      if (!a || !b) return [];
      const [from, to] = [boxOf(a), boxOf(b)];
      // leave by the side that faces the other box
      const across = Math.abs(to.x + to.w / 2 - (from.x + from.w / 2)) >= Math.abs(to.y + to.h / 2 - (from.y + from.h / 2));
      const forwards = across ? to.x > from.x : to.y > from.y;
      const [x1, y1] = across ? [forwards ? from.x + from.w : from.x, from.y + from.h / 2] : [from.x + from.w / 2, forwards ? from.y + from.h : from.y];
      const [x2, y2] = across ? [forwards ? to.x : to.x + to.w, to.y + to.h / 2] : [to.x + to.w / 2, forwards ? to.y : to.y + to.h];
      const bend = across ? (x2 - x1) / 2 : (y2 - y1) / 2;
      return [across ? `M${x1} ${y1} C${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}` : `M${x1} ${y1} C${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`];
    });
    const spark = hues(t)[1] ?? t.accent;
    root.style.overflow = 'visible';
    root.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">
        <defs>${gradientDefs(id, t)}</defs>
        ${routes.map((d) => `<path class="wire" pathLength="1" d="${d}" fill="none" stroke="${fade(t.ink, 0.26)}" stroke-width="2" stroke-dasharray="1" stroke-dashoffset="1"/>`).join('')}
      </svg>
      ${routes.map((d) => `<i class="pulse" style="position:absolute;left:0;top:0;width:10px;height:10px;margin:-5px;border-radius:50%;background:${spark};box-shadow:0 0 16px 3px ${fade(spark, 0.8)};offset-path:path('${d}');offset-rotate:0deg;offset-distance:0%;opacity:0"></i>`).join('')}
      ${nodes
        .map((n) => {
          const b = boxOf(n);
          const edge = n.bright ? `background:linear-gradient(${t.panel},${t.panel}) padding-box,${t.gradient} border-box;border:1.5px solid transparent` : `background:${t.panel};border:1px solid ${t.line}`;
          return `<div class="node" style="position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:0 18px;border-radius:16px;${edge};box-shadow:${t.shadow};opacity:0">
            <i style="flex:none;width:10px;height:10px;border-radius:50%;background:${n.tone ?? (n.bright ? spark : t.faint)}"></i>
            <div style="min-width:0"><b style="display:block;font-family:${face(t.body)};font-weight:600;font-size:17px;color:${t.ink};white-space:nowrap">${escape(n.label)}</b>${n.sub ? `<span style="display:block;margin-top:3px;font-family:${face(t.mono)};font-size:12.5px;color:${t.faint};white-space:nowrap">${escape(n.sub)}</span>` : ''}</div>
          </div>`;
        })
        .join('')}`;
    const start = o.delay ?? 0.15;
    root.querySelectorAll('.node').forEach((node, i) => animate(node, { opacity: [0, 1], scale: [0.86, 1], y: [14, 0] }, { type: 'spring', stiffness: 220, damping: 18, delay: start + i * 0.12 }));
    const wired = start + nodes.length * 0.12;
    root.querySelectorAll('.wire').forEach((wire, i) => animate(wire, { strokeDashoffset: [1, 0] }, { duration: 0.7, ease: 'easeInOut', delay: wired + i * 0.14 }));
    root.querySelectorAll('.pulse').forEach((pulse, i) =>
      animate(pulse, { offsetDistance: ['0%', '100%'], opacity: [0, 1, 1, 0] }, { duration: 1.9, times: [0, 0.12, 0.88, 1], ease: 'easeInOut', repeat: Infinity, repeatDelay: 0.5, delay: wired + routes.length * 0.14 + 0.5 + i * 0.3 })
    );
  });
}

export interface TickerOptions extends Placed {
  /** seconds for the words to pass once (default 24) */
  seconds?: number;
  /** the size of the type (default: as tall as fits) */
  size?: number;
}

/** Words passing by in a row that never ends, fading out at both edges. */
export function ticker(items: string[], o: TickerOptions): Draft {
  const t = o.theme ?? dark;
  return scene({ alt: items.join(' · '), ...o }, (root, { animate, height }) => {
    const size = o.size ?? height * 0.42;
    const row = items.map((item) => `<span style="display:inline-flex;align-items:center;gap:${size * 0.9}px;padding-right:${size * 0.9}px">${escape(item)}<i style="width:${size * 0.3}px;height:${size * 0.3}px;border-radius:50%;background-image:${t.gradient}"></i></span>`).join('');
    root.style.cssText += `;-webkit-mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent);mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)`;
    root.innerHTML = `<div class="row" style="display:flex;align-items:center;height:100%;width:max-content;font-family:${face(t.display)};font-weight:700;font-size:${size}px;letter-spacing:-.02em;color:${t.dim};white-space:nowrap"><div style="display:flex">${row}</div><div style="display:flex" aria-hidden="true">${row}</div></div>`;
    animate('.row', { x: ['0%', '-50%'] }, { duration: o.seconds ?? 24, ease: 'linear', repeat: Infinity });
  });
}

// ---------- showing how something is used ----------

export interface PointerStop {
  x: number;
  y: number;
  /** click here */
  click?: boolean;
  /** seconds to stay here before moving on (default 0.5) */
  wait?: number;
}

export interface PointerOptions extends Placed {
  delay?: number;
  /** go round again after the last stop (default true) */
  again?: boolean;
}

/**
 * A cursor that travels from stop to stop and clicks where it is told to, with a ripple at each
 * click. It is decoration laid over a slide, so the real pointer still reaches what is underneath.
 */
export function pointer(stops: PointerStop[], o: PointerOptions): Draft {
  const t = o.theme ?? dark;
  return scene({ decor: true, ...o }, (root, { animate }) => {
    root.style.overflow = 'visible';
    root.innerHTML = `
      <i class="ripple" style="position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px;border-radius:50%;border:2px solid ${hues(t)[1] ?? t.accent};opacity:0"></i>
      <svg class="arrow" viewBox="0 0 24 24" style="position:absolute;left:0;top:0;width:30px;height:30px;margin:-3px 0 0 -6px;filter:drop-shadow(0 6px 10px rgba(0,0,0,.45));opacity:0"><path d="M5 2.5v17.2l4.7-4.4 3 6.9 2.9-1.3-3-6.8h6.4z" fill="${t.ink}" stroke="${t.bg}" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    const arrow = root.querySelector('.arrow')!;
    const ripple = root.querySelector('.ripple')!;
    let stopped = false;
    const pause = (seconds: number) => new Promise<void>((done) => window.setTimeout(done, seconds * 1000));
    void (async () => {
      await pause(o.delay ?? 0.6);
      if (stopped || !stops.length) return;
      animate(arrow, { x: stops[0].x, y: stops[0].y }, { duration: 0 });
      animate(arrow, { opacity: [0, 1] }, { duration: 0.3 });
      do {
        for (const stop of stops) {
          if (stopped) return;
          await animate(arrow, { x: stop.x, y: stop.y }, { duration: 0.85, ease: [0.5, 0, 0.2, 1] });
          if (stopped) return;
          if (stop.click) {
            animate(ripple, { x: stop.x, y: stop.y }, { duration: 0 });
            animate(ripple, { opacity: [0.9, 0], scale: [0.3, 1.6] }, { duration: 0.6, ease: 'easeOut' });
            await animate(arrow, { scale: [1, 0.82, 1] }, { duration: 0.28 });
          }
          await pause(stop.wait ?? 0.5);
        }
      } while (o.again !== false && !stopped);
    })();
    return () => {
      stopped = true;
    };
  });
}

export interface ConfettiOptions extends Placed {
  /** how many pieces (default 70) */
  pieces?: number;
  delay?: number;
}

/** A burst of paper from the middle of the box when the slide arrives. Decoration, like `aurora`. */
export function confetti(o: ConfettiOptions): Draft {
  const t = o.theme ?? dark;
  return scene({ decor: true, ...o }, (root, { animate, width, height }) => {
    root.style.overflow = 'visible';
    const colours = [...hues(t), t.good, t.accent, t.ink];
    const pieces = o.pieces ?? 70;
    for (let i = 0; i < pieces; i++) {
      const piece = document.createElement('i');
      // the same burst every time: a made-up scatter that needs no dice
      const turn = (i * 137.508 * Math.PI) / 180;
      const reach = 0.35 + ((i * 53) % 100) / 150;
      const wide = 7 + (i % 4) * 3;
      piece.style.cssText = `position:absolute;left:${width / 2}px;top:${height / 2}px;width:${wide}px;height:${i % 3 === 0 ? wide : wide * 0.45}px;border-radius:${i % 3 === 0 ? '50%' : '2px'};background:${colours[i % colours.length]};opacity:0`;
      root.append(piece);
      const dx = Math.cos(turn) * width * 0.5 * reach;
      const dy = Math.sin(turn) * height * 0.5 * reach - height * 0.18;
      const seconds = 1.6 + (i % 5) * 0.22;
      animate(piece, { x: [0, dx, dx * 1.12], y: [0, dy, dy + height * 0.55], rotate: [0, 260 + i * 9, 520 + i * 17], opacity: [0, 1, 1, 0] }, { duration: seconds, times: [0, 0.28, 1], ease: ['easeOut', 'easeIn'], delay: (o.delay ?? 0.3) + (i % 7) * 0.012 });
    }
  });
}
