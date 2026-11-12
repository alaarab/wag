// Ready-made slides for walkthroughs. Each one is an ordinary slide made of the same boxes,
// text and states as any other, so the player and the exporter need to know nothing about them.
import { box, ellipse, image, path, slide, text, type Download, type Slide, type SlideTransition, type StateProps } from './scene';

type Drafts = Parameters<typeof slide>[1];

export interface Theme {
  bg: string;
  ink: string;
  dim: string;
  panel: string;
  accent: string;
  /** known problems and causes */
  warn: string;
  bad: string;
  good: string;
}

export const dark: Theme = { bg: '#0f172a', ink: '#f8fafc', dim: '#94a3b8', panel: '#1e293b', accent: '#38bdf8', warn: '#fbbf24', bad: '#f87171', good: '#34d399' };
export const light: Theme = { bg: '#ffffff', ink: '#0f172a', dim: '#475569', panel: '#f1f5f9', accent: '#1d4ed8', warn: '#b45309', bad: '#b91c1c', good: '#15803d' };

const W = 1280;
const H = 720;

export interface StoryOptions {
  name?: string;
  title: string;
  sub?: string;
  /** what happened, in order, along a line. `mark` picks out the turning point. */
  timeline?: { when: string; what: string; mark?: boolean }[];
  cause: string;
  effect: string;
  fix: string;
  /** the words over the three cards */
  labels?: [string, string, string];
  /** up to four lines: when the slide arrives, then with the cause, the effect and the fix */
  narration?: string[];
  downloads?: Download[];
  /** offer the story as a Word handout */
  handout?: boolean;
  theme?: Theme;
  transition?: SlideTransition;
}

/**
 * How something came up: a timeline across the top, then three cards that arrive one step at a
 * time, for what caused it, what it did and what fixes it.
 */
export function story(o: StoryOptions): Slide {
  const t = o.theme ?? dark;
  const labels = o.labels ?? ['What caused it', 'What it did', 'What fixes it'];
  const events = o.timeline ?? [];
  const rise = { dy: 24, opacity: 0 };
  const drafts: Drafts = [
    text(o.title, { x: 64, y: 36, w: 1152, h: 50, fontSize: 38, weight: 700, color: t.ink, enter: rise }),
  ];
  if (o.sub) drafts.push(text(o.sub, { x: 64, y: 92, w: 1152, h: 30, fontSize: 20, color: t.dim, enter: rise }));

  if (events.length) {
    const slot = 1152 / events.length;
    drafts.push(path('M0 2 L1152 2', { x: 64, y: 208, w: 1152, h: 4, color: t.dim, strokeWidth: 3, enter: { draw: 0 }, motion: { type: 'tween', duration: 0.9, ease: 'easeInOut' } }));
    events.forEach((event, i) => {
      const centre = 64 + slot * (i + 0.5);
      const size = event.mark ? 26 : 16;
      const delay = 0.25 + i * 0.18;
      drafts.push(
        ellipse({ x: centre - size / 2, y: 210 - size / 2, w: size, h: size, fill: event.mark ? t.warn : t.accent, enter: { scale: 0, delay } }),
        text(event.when, { x: centre - slot / 2, y: 160, w: slot, h: 30, fontSize: 19, weight: 700, color: event.mark ? t.warn : t.ink, align: 'center', enter: { opacity: 0, delay } }),
        text(event.what, { x: centre - slot / 2 + 10, y: 232, w: slot - 20, h: 66, fontSize: 16, color: t.dim, align: 'center', enter: { opacity: 0, delay } })
      );
    });
  }

  const top = events.length ? 318 : 170;
  const height = H - 56 - top;
  const tones = [t.warn, t.bad, t.good];
  const names = ['cause', 'effect', 'fix'];
  const states: Record<string, Record<string, StateProps>> = {};
  [o.cause, o.effect, o.fix].forEach((body, i) => {
    const x = 64 + i * 400;
    const id = names[i];
    states[id] = { [`${id}-bg`]: { opacity: 1, y: top }, [`${id}-bar`]: { opacity: 1, y: top }, [`${id}-label`]: { opacity: 1, y: top + 26 }, [`${id}-body`]: { opacity: 1, y: top + 64 } };
    drafts.push(
      box({ id: `${id}-bg`, x, y: top + 30, w: 352, h: height, radius: 16, fill: t.panel, opacity: 0 }),
      box({ id: `${id}-bar`, x, y: top + 30, w: 352, h: 6, radius: 3, fill: tones[i], opacity: 0 }),
      text(labels[i], { id: `${id}-label`, x: x + 24, y: top + 56, w: 304, h: 26, fontSize: 17, weight: 700, color: tones[i], opacity: 0 }),
      text(body, { id: `${id}-body`, x: x + 24, y: top + 94, w: 304, h: height - 84, fontSize: 21, color: t.ink, opacity: 0 })
    );
    if (i > 0) {
      states[id][`${id}-arrow`] = { opacity: 1 };
      drafts.push(text('→', { id: `${id}-arrow`, x: x - 48, y: top + height / 2 - 24, w: 48, h: 48, fontSize: 34, color: t.dim, align: 'center', valign: 'middle', opacity: 0 }));
    }
  });

  const points = [
    ...events.map((event) => ({ label: event.when, text: event.what })),
    { label: labels[0], text: o.cause },
    { label: labels[1], text: o.effect },
    { label: labels[2], text: o.fix },
  ];
  return slide(
    {
      name: o.name,
      title: o.title,
      bg: t.bg,
      states,
      steps: names,
      narration: o.narration,
      downloads: o.downloads,
      handout: o.handout ? { intro: o.sub, points } : undefined,
      transition: o.transition,
    },
    drafts
  );
}

export interface Callout {
  /** the region to point at, in the picture's own pixels: left, top, width, height */
  at: [number, number, number, number];
  /** a few words, shown under the picture while this callout is up */
  label: string;
  /** the narration line for this callout. The label is spoken when it is left out. */
  say?: string;
  /** a known problem with what is shown, rather than a feature of it */
  issue?: boolean;
  /** how far to zoom in on the region. 1 keeps the whole picture in view; the default is as far as fits, up to 2.2. */
  zoom?: number;
}

export interface ShotOptions {
  name?: string;
  title: string;
  /** shown under the picture until the first callout */
  sub?: string;
  /** the narration line for the picture as a whole. `sub` is spoken when it is left out. */
  say?: string;
  /** the picture's size in its own pixels */
  size: [number, number];
  callouts: Callout[];
  downloads?: Download[];
  /** offer a Word handout with the picture and every callout */
  handout?: boolean;
  /** offer the picture itself as a download (default true) */
  offerPicture?: boolean;
  theme?: Theme;
  transition?: SlideTransition;
}

/**
 * A screenshot with numbered callouts. The whole picture shows first with every callout marked;
 * each step then zooms in on one region, dims the rest and shows that callout's words.
 */
export function shot(src: string, o: ShotOptions): Slide {
  const t = o.theme ?? dark;
  const top = 60;
  const bottom = 64;
  const view = { x: 0, y: top, w: W, h: H - top - bottom };
  const [pw, ph] = o.size;
  const fit = Math.min(view.w / pw, view.h / ph);
  const pad = 6;

  /** Where the picture sits at this zoom when `region` is brought to the middle of the view. */
  const place = (zoom: number, region?: Callout['at']) => {
    const k = fit * zoom;
    const w = pw * k;
    const h = ph * k;
    const along = (size: number, room: number, start: number, focus: number) => {
      if (size <= room) return start + (room - size) / 2;
      return Math.min(start, Math.max(start + room - size, start + room / 2 - focus * k));
    };
    const [rx, ry, rw, rh] = region ?? [0, 0, pw, ph];
    return { k, x: along(w, view.w, view.x, rx + rw / 2), y: along(h, view.h, view.y, ry + rh / 2), w, h };
  };
  const ringAt = (p: ReturnType<typeof place>, [rx, ry, rw, rh]: Callout['at']) => ({
    x: p.x + rx * p.k - pad,
    y: p.y + ry * p.k - pad,
    w: rw * p.k + pad * 2,
    h: rh * p.k + pad * 2,
  });
  const badgeAt = (ring: { x: number; y: number }) => ({ x: Math.max(4, ring.x - 16), y: Math.max(view.y + 4, ring.y - 16) });
  /** On the whole picture two regions can start at the same corner: a badge that would cover another moves along. */
  const taken: { x: number; y: number }[] = [];
  const clearOf = (at: { x: number; y: number }) => {
    const spot = { ...at };
    while (taken.some((other) => Math.abs(other.x - spot.x) < 34 && Math.abs(other.y - spot.y) < 34)) spot.x += 36;
    taken.push(spot);
    return spot;
  };

  const whole = place(1);
  const drafts: Drafts = [image(src, { id: 'shot', x: whole.x, y: whole.y, w: whole.w, h: whole.h, fit: 'cover' })];
  // dims the picture around whichever region is up
  drafts.push(box({ id: 'spot', x: view.x, y: view.y, w: view.w, h: view.h, radius: 8, fill: 'rgba(0,0,0,0)', shade: 'rgba(2,6,23,0.55)', opacity: 0 }));

  const states: Record<string, Record<string, StateProps>> = {};
  const steps = o.callouts.map((_, i) => `callout-${i + 1}`);
  o.callouts.forEach((c, i) => {
    const tone = c.issue ? t.warn : t.accent;
    const [, , rw, rh] = c.at;
    const most = Math.min((view.w * 0.72) / (rw * fit), (view.h * 0.62) / (rh * fit), 2.2);
    const near = place(Math.max(1, c.zoom ?? most), c.at);
    const ring = ringAt(near, c.at);
    const overview = ringAt(whole, c.at);
    const state: Record<string, StateProps> = {
      shot: { x: near.x, y: near.y, w: near.w, h: near.h },
      spot: { ...ring, opacity: 1 },
      intro: { opacity: 0 },
      tag: { opacity: c.issue ? 1 : 0 },
    };
    o.callouts.forEach((_, j) => {
      const on = i === j;
      state[`ring-${j + 1}`] = on ? { ...ring, opacity: 1 } : { opacity: 0 };
      state[`badge-${j + 1}`] = on ? { ...badgeAt(ring), opacity: 1, scale: 1.15 } : { opacity: 0 };
      state[`label-${j + 1}`] = { opacity: on ? 1 : 0 };
    });
    states[steps[i]] = state;

    drafts.push(
      box({ id: `ring-${i + 1}`, ...overview, radius: 8, fill: 'rgba(0,0,0,0)', stroke: tone, strokeWidth: 3, enter: { opacity: 0, scale: 1.3, delay: 0.3 + i * 0.12 } }),
      ellipse({ id: `badge-${i + 1}`, ...clearOf(badgeAt(overview)), w: 32, h: 32, fill: tone, color: '#0f172a', fontSize: 17, weight: 800, text: String(i + 1), enter: { opacity: 0, scale: 0, delay: 0.3 + i * 0.12 } })
    );
  });

  drafts.push(
    box({ x: 0, y: 0, w: W, h: top, fill: t.bg }),
    box({ x: 0, y: H - bottom, w: W, h: bottom, fill: t.bg }),
    text(o.title, { x: 32, y: 0, w: W - 64, h: top, fontSize: 26, weight: 700, color: t.ink, valign: 'middle' }),
    text(o.sub ?? '', { id: 'intro', x: 32, y: H - bottom, w: W - 64, h: bottom, fontSize: 20, color: t.dim, valign: 'middle' }),
    box({ id: 'tag', x: W - 32 - 132, y: H - bottom + 16, w: 132, h: 32, radius: 16, fill: t.warn, color: '#0f172a', fontSize: 15, weight: 700, text: 'Known issue', opacity: 0 })
  );
  o.callouts.forEach((c, i) => {
    drafts.push(text(`${i + 1}.  ${c.label}`, { id: `label-${i + 1}`, x: 32, y: H - bottom, w: W - 64 - (c.issue ? 148 : 0), h: bottom, fontSize: 20, weight: 600, color: c.issue ? t.warn : t.ink, valign: 'middle', opacity: 0 }));
  });

  const opening = o.say ?? o.sub ?? o.title;
  const downloads = [...(o.downloads ?? [])];
  if (o.offerPicture !== false) downloads.push({ label: 'This screenshot', href: src });
  return slide(
    {
      name: o.name,
      title: o.title,
      bg: t.bg,
      states,
      steps,
      motion: { type: 'spring', stiffness: 130, damping: 22 },
      narration: [opening, ...o.callouts.map((c) => c.say ?? c.label)],
      downloads,
      handout: o.handout
        ? { intro: opening, image: src, points: o.callouts.map((c, i) => ({ label: `${i + 1}. ${c.label}${c.issue ? ' (known issue)' : ''}`, text: c.say ?? '' })) }
        : undefined,
      transition: o.transition,
    },
    drafts
  );
}
