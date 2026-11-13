// Ready-made slides for walkthroughs. Each one is an ordinary slide made of the same boxes,
// text and states as any other, so the player and the exporter need to know nothing about them.
import { aurora } from './motion';
import { box, deck, ellipse, image, path, slide, text, type Deck, type DeckOptions, type Download, type Expect, type LiveAction, type LiveCheck, type Slide, type SlideTransition, type StateProps, type Target } from './scene';
import { dark, fade, look, type Theme } from './theme';

type Drafts = Parameters<typeof slide>[1];

const W = 1280;
const H = 720;

type Options = Parameters<typeof text>[1];
/** Small spaced capitals in the mono face: the line over a heading, the name over a card. */
const label = (content: string, t: Theme, o: Options) => text(content, { font: t.mono, fontSize: 13, weight: 500, tracking: 0.16, caps: true, color: t.faint, ...o });
/** A heading in the display face, pulled tight. */
const heading = (content: string, t: Theme, o: Options) => text(content, { font: t.display, weight: 800, tracking: -0.03, leading: 1.04, color: t.ink, ...o });
/** A card: the theme's panel with a hairline edge and some depth under it. */
const card = (t: Theme, o: Parameters<typeof box>[0]) => box({ fill: t.panel, radius: 20, stroke: t.line, strokeWidth: 1, shadow: t.shadow, ...o });

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
    aurora({ theme: t, strength: 0.32 }),
    heading(o.title, t, { x: 64, y: 34, w: 1152, h: 54, fontSize: 42, reveal: 'words' }),
  ];
  if (o.sub) drafts.push(text(o.sub, { x: 64, y: 94, w: 1152, h: 30, fontSize: 20, color: t.dim, enter: { ...rise, delay: 0.25 } }));

  if (events.length) {
    const slot = 1152 / events.length;
    drafts.push(path('M0 2 L1152 2', { x: 64, y: 208, w: 1152, h: 4, color: fade(t.ink, 0.22), strokeWidth: 2, enter: { draw: 0 }, motion: { type: 'tween', duration: 0.9, ease: 'easeInOut' } }));
    events.forEach((event, i) => {
      const centre = 64 + slot * (i + 0.5);
      const size = event.mark ? 22 : 14;
      const tone = event.mark ? t.warn : t.accent;
      const delay = 0.25 + i * 0.18;
      // the turning point keeps sending out a ring
      if (event.mark) drafts.push(ellipse({ x: centre - 11, y: 199, w: 22, h: 22, fill: 'rgba(0,0,0,0)', stroke: tone, strokeWidth: 2, decor: true, enter: { opacity: 0, delay: delay + 0.4 }, loop: { scale: [1, 2.6], opacity: [0.7, 0], duration: 1.8, mirror: false, ease: 'easeOut' } }));
      drafts.push(
        ellipse({ x: centre - size / 2, y: 210 - size / 2, w: size, h: size, fill: tone, shadow: `0 0 0 6px ${fade(tone, 0.16)}, 0 0 26px ${fade(tone, 0.55)}`, enter: { scale: 0, delay } }),
        label(event.when, t, { x: centre - slot / 2, y: 162, w: slot, h: 26, fontSize: 14, color: event.mark ? t.warn : t.ink, align: 'center', enter: { opacity: 0, delay } }),
        text(event.what, { x: centre - slot / 2 + 12, y: 234, w: slot - 24, h: 66, fontSize: 16, leading: 1.35, color: t.dim, align: 'center', enter: { opacity: 0, delay } })
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
    states[id] = { [`${id}-bg`]: { opacity: 1, y: top }, [`${id}-bar`]: { opacity: 1, y: top + 28 }, [`${id}-label`]: { opacity: 1, y: top + 22 }, [`${id}-body`]: { opacity: 1, y: top + 64 } };
    drafts.push(
      card(t, { id: `${id}-bg`, x, y: top + 30, w: 352, h: height, opacity: 0 }),
      box({ id: `${id}-bar`, x: x + 24, y: top + 58, w: 10, h: 10, radius: 5, fill: tones[i], shadow: `0 0 14px ${fade(tones[i], 0.7)}`, opacity: 0 }),
      label(labels[i], t, { id: `${id}-label`, x: x + 44, y: top + 52, w: 284, h: 24, color: tones[i], valign: 'middle', opacity: 0 }),
      text(body, { id: `${id}-body`, x: x + 24, y: top + 94, w: 304, h: height - 84, fontSize: 21, leading: 1.32, color: t.ink, opacity: 0 })
    );
    if (i > 0) {
      states[id][`${id}-arrow`] = { opacity: 1, draw: 1 };
      drafts.push(path('M4 12 L30 12 M21 3 L30 12 L21 21', { id: `${id}-arrow`, x: x - 41, y: top + height / 2 - 12, w: 34, h: 24, color: t.faint, strokeWidth: 2.5, opacity: 0, draw: 0 }));
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
      box({ id: `ring-${i + 1}`, ...overview, radius: 10, fill: 'rgba(0,0,0,0)', stroke: tone, strokeWidth: 3, shadow: `0 0 0 5px ${fade(tone, 0.16)}, 0 0 34px ${fade(tone, 0.4)}`, enter: { opacity: 0, scale: 1.3, delay: 0.3 + i * 0.12 } }),
      ellipse({ id: `badge-${i + 1}`, ...clearOf(badgeAt(overview)), w: 32, h: 32, fill: tone, color: t.bg, font: t.mono, fontSize: 16, weight: 600, shadow: '0 6px 16px rgba(0,0,0,0.4)', text: String(i + 1), enter: { opacity: 0, scale: 0, delay: 0.3 + i * 0.12 } })
    );
  });

  drafts.push(
    box({ x: 0, y: 0, w: W, h: top, fill: t.bg }),
    box({ x: 0, y: H - bottom, w: W, h: bottom, fill: t.bg }),
    box({ x: 0, y: top - 1, w: W, h: 1, fill: t.line }),
    box({ x: 0, y: H - bottom, w: W, h: 1, fill: t.line }),
    heading(o.title, t, { x: 32, y: 0, w: W - 64, h: top, fontSize: 27, weight: 700, tracking: -0.02, valign: 'middle' }),
    text(o.sub ?? '', { id: 'intro', x: 32, y: H - bottom, w: W - 64, h: bottom, fontSize: 20, color: t.dim, valign: 'middle' }),
    box({ id: 'tag', x: W - 32 - 138, y: H - bottom + 17, w: 138, h: 30, radius: 15, fill: fade(t.warn, 0.16), stroke: fade(t.warn, 0.5), strokeWidth: 1, color: t.warn, font: t.mono, fontSize: 12.5, weight: 500, tracking: 0.1, caps: true, text: 'Known issue', opacity: 0 })
  );
  o.callouts.forEach((c, i) => {
    drafts.push(text(`${i + 1}.  ${c.label}`, { id: `label-${i + 1}`, x: 32, y: H - bottom, w: W - 64 - (c.issue ? 154 : 0), h: bottom, fontSize: 20, weight: 600, color: c.issue ? t.warn : t.ink, valign: 'middle', opacity: 0 }));
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

export interface GuideStep {
  /** a few words, shown as the step's heading and numbered for you */
  title: string;
  /** what the step is for, in a sentence or two, shown under the heading */
  about?: string;
  /** what is said when the step arrives */
  say: string;
  /** Show me: what the guide does on the page */
  show?: LiveAction[];
  /** My turn: the viewer's own click. `says` tells them what the click will do. */
  mine?: { point: Target; says: string; until: Expect };
  /** My turn for a file: the viewer clicks, the file lands in their Downloads, and checks can read it as `as` */
  download?: { point: Target; says: string; file: string; as: string };
  /** Check: pairs to read and compare */
  check?: LiveCheck[];
  /** for the recorded video: what plays on a made-up copy where the viewer would have acted */
  demo?: LiveAction[];
  name?: string;
}

/**
 * A guide written as steps: say, show, my turn, check, download. One list gives three things: a
 * guided session (each step's buttons drive the real page), a narrated deck (the same slides and
 * lines without a browser), and a recorded video (the steps played on a made-up copy, paced by
 * the narration). Each step becomes a slide laid out for you.
 */
export function guide(options: DeckOptions & { theme?: Theme }, steps: GuideStep[]): Deck {
  const t = options.theme ?? dark;
  const rise = { dy: 26, opacity: 0 };
  /** steps that do something on the page are numbered; an opening or closing slide is not */
  let number = 0;
  const acting = steps.filter((s) => s.show || s.mine || s.download || s.check || s.demo).length;
  const slides = steps.map((s, i) => {
    const turn = s.download ? { point: s.download.point, says: s.download.says, until: { file: { like: s.download.file, as: s.download.as } } } : s.mine;
    const live = s.show || turn || s.check || s.demo ? { show: s.show, turn, check: s.check, demo: s.demo } : undefined;
    // each row: the button it goes with, a colour for it, and what pressing it does
    const rows: [string, string, string][] = [
      ...(s.show ? [['Show me', t.accent, 'the guide does this step on the page'] as [string, string, string]] : []),
      ...(turn ? [['My turn', t.warn, turn.says] as [string, string, string]] : []),
      ...(s.check ? [['Check', t.good, s.check.map((c) => c.label).join('; ')] as [string, string, string]] : []),
    ];
    const lines = rows.map(([name, , does]) => `${name}: ${does}`);
    if (live) number++;
    const title = live ? `${number}. ${s.title}` : s.title;
    return slide({ name: s.name ?? `step-${i + 1}`, title, bg: t.bg, stagger: 0.07, narration: s.say, live, handout: { intro: s.about ?? s.say, points: lines.map((line) => ({ text: line })) } }, [
      aurora({ theme: t, strength: live ? 0.3 : 0.55 }),
      // the step's number, large and faint, behind the corner
      ...(live ? [text(String(number).padStart(2, '0'), { x: 880, y: -16, w: 340, h: 230, font: t.display, fontSize: 230, weight: 800, tracking: -0.05, leading: 1, color: fade(t.ink, 0.045), align: 'right', decor: true })] : []),
      ...(live ? [label(`Step ${number} of ${acting}`, t, { x: 80, y: 62, w: 600, h: 22, enter: rise })] : []),
      heading(s.title, t, { x: 80, y: live ? 92 : 78, w: 1000, h: 70, fontSize: 52, reveal: 'words' }),
      text(s.about ?? s.say, { x: 80, y: live ? 172 : 162, w: 1040, h: 124, fontSize: 24, leading: 1.4, color: t.dim, enter: rise }),
      ...rows.flatMap(([name, tone, does], n) => [
        card(t, { x: 80, y: 316 + n * 96, w: 1120, h: 80, radius: 16, enter: rise }),
        box({ x: 102, y: 316 + n * 96 + 25, w: 104, h: 30, radius: 15, fill: fade(tone, 0.14), stroke: fade(tone, 0.4), strokeWidth: 1, color: tone, font: t.mono, fontSize: 12.5, weight: 500, tracking: 0.08, caps: true, text: name, enter: rise }),
        text(does, { x: 226, y: 316 + n * 96, w: 950, h: 80, fontSize: 20, leading: 1.3, color: t.ink, valign: 'middle', enter: rise }),
      ]),
    ]);
  });
  return deck({ ...look(t), ...options }, slides);
}
