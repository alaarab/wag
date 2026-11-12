// The wag scene format: plain data that both the web player and the .pptx exporter read.
//
// A slide is a small state machine. Its layout is the base layout plus every active state:
// the steps reached so far, the state picked by a click, and any hover or press states while
// the pointer is involved. Each state is a set of property overrides, so a state is always a
// complete layout: the web player springs between layouts, and an exporter can turn each one
// into its own PowerPoint slide.

import type { createScopedAnimate } from 'motion';

export type Ease = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

/** How an element moves when its layout changes. */
export type MotionConfig =
  | { type: 'spring'; stiffness?: number; damping?: number; mass?: number }
  | { type: 'tween'; duration?: number; ease?: Ease };

/** How a slide arrives. `morph` springs elements that share an id from their old layout to the new one. */
export type SlideTransition = 'none' | 'fade' | 'push' | 'zoom' | 'iris' | 'morph';

/** Everything that animates between states. Positions and sizes are in deck pixels. */
export interface Animatable {
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
  scale: number;
  opacity: number;
  radius: number;
  fontSize: number;
  /** how much of a path's stroke is drawn, 0 to 1 */
  draw: number;
  fill: string;
  color: string;
}

export type StateProps = Partial<Animatable>;

/** Where an element starts when its slide appears. dx and dy are offsets from its resting place. */
export interface Enter {
  dx?: number;
  dy?: number;
  opacity?: number;
  scale?: number;
  rotate?: number;
  draw?: number;
  /** seconds, added to the slide's stagger */
  delay?: number;
}

/**
 * Motion that repeats for as long as the slide is showing, on top of whatever layout the
 * element is in. Each list is a set of keyframes: dx, dy and rotate are added to the layout,
 * scale and opacity multiply it.
 */
export interface Loop {
  dx?: number[];
  dy?: number[];
  rotate?: number[];
  scale?: number[];
  opacity?: number[];
  /** seconds for one pass, default 2 */
  duration?: number;
  delay?: number;
  ease?: Ease;
  /** play back and forth (default) instead of restarting from the first keyframe */
  mirror?: boolean;
}

/**
 * A state name switches the slide to that state, or back if it is already current.
 * `go` routes to another slide: 'next', 'prev', 'back' (the slide you came from), a slide's
 * name, or its number counting from 1.
 * `save` adds the answers gathered so far as a row and downloads every saved row as an Excel
 * file of that name, then puts the slide in `state` if one is given.
 */
export type Click = string | { go: number | string } | { save: string; state?: string };

const ROUTES = ['next', 'prev', 'back'];

export type Kind = 'box' | 'ellipse' | 'text' | 'image' | 'path' | 'scene' | 'field' | 'choice' | 'video';

/** What a deck has gathered from its viewer: one value per name, shared by every slide. */
export interface Answers {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  /** calls `listener` whenever a value changes; returns a function that stops it */
  on(listener: (name: string, value: string) => void): () => void;
}

export interface SceneContext {
  /** the scene's size in deck pixels */
  width: number;
  height: number;
  /** Motion's animate, with selectors limited to the scene and everything it starts stopped when the slide leaves */
  animate: ReturnType<typeof createScopedAnimate>;
  /** read and write the deck's answers; anything set here is saved along with the fields */
  answers: Answers;
}

/** Builds a scene inside `root`. May return a function that undoes anything `animate` does not track, such as listeners. */
export type SceneSetup = (root: HTMLElement, scene: SceneContext) => void | (() => void);

export interface ElementOptions extends StateProps {
  id?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  font?: string;
  weight?: number;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  stroke?: string;
  strokeWidth?: number;
  /** a colour laid over the rest of the slide, outside this element, to pick it out. It fades with the element. */
  shade?: string;
  fit?: 'cover' | 'contain';
  /** video: start again when it ends */
  repeat?: boolean;
  /** video: play with sound. Off by default, because browsers only autoplay muted video. */
  sound?: boolean;
  /** greyed-out hint shown in an empty field */
  placeholder?: string;
  inputType?: 'text' | 'number' | 'email';
  /** slide state that is active while the pointer is over this element */
  hover?: string;
  /** overrides for this element alone while the pointer is over it */
  whileHover?: StateProps;
  /** slide state that is active while this element is held down */
  press?: string;
  /** overrides for this element alone while it is held down */
  whilePress?: StateProps;
  click?: Click;
  /** let the pointer drag it: freely, or along one axis */
  drag?: boolean | 'x' | 'y';
  /** spring back to its place when let go (default true) */
  snapBack?: boolean;
  enter?: Enter;
  loop?: Loop;
  motion?: MotionConfig;
}

export interface Element {
  id: string;
  kind: Kind;
  base: Animatable;
  text?: string;
  src?: string;
  /** SVG path data, in the element's own box at its base size */
  d?: string;
  /** builds a scene's contents, each time its slide appears */
  setup?: SceneSetup;
  /** the answer a field or choice writes to */
  name?: string;
  options?: string[];
  placeholder?: string;
  inputType: 'text' | 'number' | 'email';
  repeat: boolean;
  sound: boolean;
  font?: string;
  weight: number;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  stroke?: string;
  strokeWidth: number;
  shade?: string;
  fit: 'cover' | 'contain';
  hover: string[];
  press: string[];
  click?: Click;
  drag?: 'x' | 'y' | 'both';
  snapBack: boolean;
  enter?: Enter;
  loop?: Loop;
  motion?: MotionConfig;
}

export type States = Record<string, Record<string, StateProps>>;

/** A file a slide offers its viewer. `href` is a path under `public/`, or any URL. */
export interface Download {
  label: string;
  href: string;
}

/**
 * A Word document about one slide, written by `npm run make`: the slide's title, an opening
 * paragraph, a picture and a list of points. The player links it from the slide's downloads.
 */
export interface Handout {
  intro?: string;
  /** a picture under `public/`, such as the screenshot the slide shows */
  image?: string;
  points?: { label?: string; text: string }[];
}

/**
 * Where something is on the live page a guided deck drives. A plain string is text that shows on
 * the page. `role` and `name` find a control the way a screen reader names it, `css` is a selector,
 * `within` narrows the search to a part of the page ('dialog' for the open dialog, or a selector),
 * and `last` takes the last match instead of the first.
 */
export type Target = string | { text?: string; role?: string; name?: string; css?: string; within?: string; last?: boolean; exact?: boolean };

/** How to tell the live page has reached a state: every part given has to hold. */
export interface Expect {
  /** the address contains this */
  url?: string;
  /** this is showing */
  see?: Target;
  /** this is no longer showing */
  gone?: Target;
}

/**
 * One thing "Show me" does on the live page. None of them may press anything that saves, posts,
 * approves, submits, deletes or sends: those are for the viewer's own hand, as `turn`.
 */
export type LiveAction =
  | { go: string }
  | { point: Target; note?: string }
  | { click: Target }
  | { choose: string; from: Target }
  | { download: Target; as: string }
  | { open: string }
  | { press: 'Escape' }
  | { wait: Expect };

/**
 * Something to read for a check: from the live page (`pick` is a pattern whose first group is the
 * part wanted), from a downloaded workbook (a column of a sheet, `*` in the sheet name takes every
 * sheet that matches, `where` keeps rows whose other columns have these values), or a fixed value.
 */
export type Reading =
  | { page: Target; pick?: string }
  | { file: string; sheet: string; column: string; where?: Record<string, string>; take?: 'sum' | 'all' | 'first' }
  | { value: number | string };

export interface LiveCheck {
  /** what is being checked, as the viewer should hear it */
  label: string;
  read: Reading;
  equals: Reading;
  /** compare sizes and ignore the sign, for a figure one side shows as a credit */
  abs?: boolean;
}

/** What a guided slide can do on the live page. Each part is one button in the player. */
export interface Live {
  /** Show me: the deck does these, in order */
  show?: LiveAction[];
  /**
   * My turn: the deck rings `point`, says what the click will do, and waits until the page is as
   * `until` describes. The deck never clicks it. `says` is required: the viewer is told plainly
   * what their click does before they make it.
   */
  turn?: { point: Target; says: string; until: Expect };
  /** Check: read the page or a file and say whether each pair matches */
  check?: LiveCheck[];
}

/** Words on a control that mean pressing it changes something. "Show me" refuses such a control. */
export const COMMITS = /^(save|post|approve|submit|delete|send|remove|reject|confirm|apply|run|import|sync|void|reverse|pay|create|update|close the period|reopen)\b/i;

const labelOf = (target: Target) => (typeof target === 'string' ? target : (target.name ?? target.text ?? ''));

export interface SlideOptions {
  /** drive the live page from this slide: see `Live` */
  live?: Live;
  /** lets buttons and links route here: `click: { go: 'name' }`, or #name in the address bar */
  name?: string;
  /** shown in the player's bar, and the heading of the slide's handout */
  title?: string;
  /**
   * What is said, as plain sentences. The first line is spoken when the slide arrives and each
   * later line after the matching step. `npm run make` turns the lines into audio files; without
   * them the browser's own voice reads the lines.
   */
  narration?: string | string[];
  /** files offered with this slide */
  downloads?: Download[];
  /** offer a Word handout: `true` builds it from the title and the narration */
  handout?: boolean | Handout;
  /** skipped by the arrow keys, so only routing reaches it */
  hidden?: boolean;
  bg?: string;
  /** state name -> element id -> overrides. Later states win over earlier ones. */
  states?: States;
  /** states the arrow keys walk through before moving to the next slide. They add up. */
  steps?: string[];
  /** how this slide arrives */
  transition?: SlideTransition;
  motion?: MotionConfig;
  /** seconds between the entrances of successive elements that have `enter` */
  stagger?: number;
}

export interface Slide {
  name?: string;
  title?: string;
  narration: string[];
  downloads: Download[];
  handout?: Handout;
  live?: Live;
  hidden: boolean;
  bg?: string;
  elements: Element[];
  states: States;
  /** resolution order: declared states, then per-element hover states, then press states */
  stateOrder: string[];
  steps: string[];
  transition?: SlideTransition;
  motion?: MotionConfig;
  stagger: number;
}

export interface DeckOptions {
  /** shown in the player's bar and on the deck's handouts */
  title?: string;
  /**
   * Where the files `npm run make` writes for this deck are served from, such as '/my-deck'
   * for `public/my-deck/`. Narration audio and handouts need it.
   */
  assets?: string;
  /** move on by itself when a slide's narration ends. The viewer can switch it off. */
  auto?: boolean;
  /**
   * How to say what a voice would get wrong: written form to spoken form, such as
   * `{ 'Q&A': 'Q and A,' }`. It changes what is heard, never what is shown.
   */
  pronounce?: Record<string, string>;
  /** the app a guided deck drives: `go` addresses are added to it. The bridge can be pointed elsewhere for a rehearsal. */
  app?: string;
  width?: number;
  height?: number;
  bg?: string;
  font?: string;
  /** stylesheets to load with the deck, such as a web font's CSS */
  stylesheets?: string[];
  /** how slides arrive unless a slide says otherwise */
  transition?: SlideTransition;
  motion?: MotionConfig;
}

export interface Deck {
  title?: string;
  assets?: string;
  auto: boolean;
  pronounce: Record<string, string>;
  app?: string;
  width: number;
  height: number;
  bg: string;
  font: string;
  stylesheets: string[];
  transition: SlideTransition;
  motion: MotionConfig;
  slides: Slide[];
}

/** An element as written by a builder, before `slide()` gives it an id and wires its own states. */
interface Draft extends Omit<Element, 'id' | 'hover' | 'press'> {
  id?: string;
  hover?: string;
  whileHover?: StateProps;
  press?: string;
  whilePress?: StateProps;
}

function draft(kind: Kind, o: ElementOptions, defaults: Partial<Animatable>, extra: Partial<Draft> = {}): Draft {
  const base: Animatable = {
    rotate: 0,
    scale: 1,
    opacity: 1,
    radius: 0,
    fontSize: 24,
    draw: 1,
    fill: 'rgba(0,0,0,0)',
    color: '#ffffff',
    ...defaults,
    x: o.x,
    y: o.y,
    w: o.w,
    h: o.h,
  };
  for (const key of Object.keys(base) as (keyof Animatable)[]) {
    if (o[key] !== undefined) (base as unknown as Record<string, unknown>)[key] = o[key];
  }
  return {
    kind,
    base,
    id: o.id,
    text: o.text,
    font: o.font,
    weight: o.weight ?? 400,
    align: o.align ?? 'center',
    valign: o.valign ?? 'middle',
    stroke: o.stroke,
    strokeWidth: o.strokeWidth ?? (kind === 'path' ? 6 : o.stroke ? 2 : 0),
    shade: o.shade,
    fit: o.fit ?? 'cover',
    placeholder: o.placeholder,
    inputType: o.inputType ?? 'text',
    repeat: o.repeat ?? false,
    sound: o.sound ?? false,
    hover: o.hover,
    whileHover: o.whileHover,
    press: o.press,
    whilePress: o.whilePress,
    click: o.click,
    drag: o.drag === true ? 'both' : o.drag || undefined,
    snapBack: o.snapBack ?? true,
    enter: o.enter,
    loop: o.loop,
    motion: o.motion,
    ...extra,
  };
}

/** A rectangle, optionally rounded and optionally holding centred text. */
export const box = (o: ElementOptions): Draft => draft('box', o, { fill: '#334155' });

export const ellipse = (o: ElementOptions): Draft => draft('ellipse', o, { fill: '#334155' });

/** Text with no background, left aligned and top anchored unless told otherwise. */
export const text = (content: string, o: ElementOptions): Draft =>
  draft('text', { align: 'left', valign: 'top', ...o }, {}, { text: content });

export const image = (src: string, o: ElementOptions): Draft => draft('image', o, {}, { src });

/** A video file. It starts from the beginning when its slide appears and stops when the slide leaves. */
export const video = (src: string, o: ElementOptions): Draft => draft('video', o, {}, { src });

/**
 * A stroked SVG path. `d` is written in the element's own box: 0,0 is its top left and w,h its
 * bottom right. The stroke takes `color`, and `draw` (0 to 1) says how much of it is drawn.
 */
export const path = (d: string, o: ElementOptions): Draft => draft('path', o, {}, { d });

/**
 * A region of the slide that is free-form code: `setup` fills it with any DOM and Motion
 * animation it likes. It runs every time the slide appears and is emptied when the slide leaves.
 * The region itself is still an element, so states, hover and transitions move it as a whole.
 */
export const scene = (o: ElementOptions, setup: SceneSetup): Draft => draft('scene', o, {}, { setup });

/** A box the viewer types into. What they type is kept as the answer called `name`. */
export const field = (name: string, o: ElementOptions): Draft =>
  draft('field', { align: 'left', ...o }, { fill: '#1e293b', radius: 14 }, { name });

/** Pick one of `options`. The pick is kept as the answer called `name`; `fill` colours the chosen option. */
export const choice = (name: string, options: string[], o: ElementOptions): Draft =>
  draft('choice', { align: 'left', valign: 'top', ...o }, { fill: '#38bdf8', fontSize: 22 }, { name, options });

export function slide(options: SlideOptions, drafts: Draft[]): Slide {
  const states: States = { ...options.states };
  const declared = Object.keys(states);
  const hoverOnly: string[] = [];
  const pressOnly: string[] = [];
  const ids = new Set<string>();

  const elements = drafts.map((d, i): Element => {
    const { whileHover, hover, whilePress, press, id: givenId, ...rest } = d;
    // ids that start with "_" are generated, and never match across slides in a morph
    const id = givenId ?? `_${i}`;
    if (ids.has(id)) throw new Error(`wag: two elements share the id "${id}"`);
    ids.add(id);
    const own = (kind: string, overrides: StateProps | undefined, order: string[], names: string[]) => {
      if (!overrides) return;
      const name = `${kind}:${id}`;
      states[name] = { [id]: overrides };
      order.push(name);
      names.push(name);
    };
    const hoverStates = hover ? [hover] : [];
    const pressStates = press ? [press] : [];
    own('hover', whileHover, hoverOnly, hoverStates);
    own('press', whilePress, pressOnly, pressStates);
    return { ...rest, id, hover: hoverStates, press: pressStates };
  });

  for (const name of declared) {
    for (const id of Object.keys(states[name])) {
      if (!ids.has(id)) throw new Error(`wag: state "${name}" changes "${id}", but no element has that id`);
    }
  }
  for (const el of elements) {
    const shown = typeof el.click === 'string' ? el.click : el.click && 'save' in el.click ? el.click.state : undefined;
    const wanted = [...el.hover, ...el.press, ...(shown ? [shown] : [])];
    for (const name of wanted) {
      if (!states[name]) throw new Error(`wag: element "${el.id}" uses state "${name}", which the slide does not define`);
    }
  }
  const steps = options.steps ?? [];
  for (const name of steps) {
    if (!states[name]) throw new Error(`wag: step "${name}" is not one of the slide's states`);
  }

  for (const action of options.live?.show ?? []) {
    const pressed = 'click' in action ? action.click : 'download' in action ? action.download : undefined;
    if (pressed !== undefined && COMMITS.test(labelOf(pressed).trim())) {
      throw new Error(`wag: "Show me" may not press "${labelOf(pressed)}". Anything that saves, posts or sends is the viewer's own click: make it \`turn\``);
    }
  }
  if (options.live?.turn && !options.live.turn.says.trim()) throw new Error('wag: `turn` needs `says`: what the viewer\'s click will do, in plain words');

  const narration = typeof options.narration === 'string' ? [options.narration] : (options.narration ?? []);
  const handout = options.handout === true ? { intro: narration[0], points: narration.slice(1).map((line) => ({ text: line })) } : options.handout || undefined;

  return {
    name: options.name,
    title: options.title,
    narration,
    downloads: options.downloads ?? [],
    handout,
    live: options.live,
    hidden: options.hidden ?? false,
    bg: options.bg,
    elements,
    states,
    stateOrder: [...declared, ...hoverOnly, ...pressOnly],
    steps,
    transition: options.transition,
    motion: options.motion,
    stagger: options.stagger ?? 0,
  };
}

export function deck(options: DeckOptions, slides: Slide[]): Deck {
  const names = new Set<string>();
  for (const s of slides) {
    if (!s.name) continue;
    if (ROUTES.includes(s.name) || /^\d+$/.test(s.name)) throw new Error(`wag: a slide cannot be named "${s.name}"`);
    if (names.has(s.name)) throw new Error(`wag: two slides are named "${s.name}"`);
    names.add(s.name);
  }
  for (const s of slides) {
    for (const el of s.elements) {
      const to = typeof el.click === 'object' && 'go' in el.click ? el.click.go : undefined;
      const missing = typeof to === 'string' ? !ROUTES.includes(to) && !names.has(to) : to !== undefined && (to < 1 || to > slides.length);
      if (missing) throw new Error(`wag: element "${el.id}" goes to slide "${to}", which does not exist`);
    }
  }
  if (!options.assets && slides.some((s) => s.handout)) throw new Error('wag: a slide has a handout, so the deck needs `assets` to say where it is served from');
  return {
    title: options.title,
    assets: options.assets?.replace(/\/$/, ''),
    auto: options.auto ?? false,
    pronounce: options.pronounce ?? {},
    app: options.app?.replace(/\/$/, ''),
    width: options.width ?? 1280,
    height: options.height ?? 720,
    bg: options.bg ?? '#0f172a',
    font: options.font ?? 'Inter, "Segoe UI", system-ui, sans-serif',
    stylesheets: options.stylesheets ?? [],
    transition: options.transition ?? 'fade',
    motion: options.motion ?? { type: 'spring', stiffness: 220, damping: 18 },
    slides,
  };
}

/** The layout of one element given every state that is active on its slide. */
export function resolve(s: Slide, el: Element, active: ReadonlySet<string>): Animatable {
  let out = el.base;
  for (const name of s.stateOrder) {
    if (!active.has(name)) continue;
    const overrides = s.states[name][el.id];
    if (overrides) out = { ...out, ...overrides };
  }
  return out;
}

/** The file name of a slide's handout, without its folder: its name, or its number counting from 1. */
export const handoutFile = (deck: Deck, s: Slide) => `${s.name ?? `slide-${deck.slides.indexOf(s) + 1}`}.docx`;

/** Where the files written by `npm run make` are served from for this deck. */
export const assetUrl = (deck: Deck, file: string) => `${deck.assets ?? ''}/${file}`;

/** A narration line as a voice should be given it. */
export function spoken(deck: Deck, line: string): string {
  let out = line;
  for (const [written, said] of Object.entries(deck.pronounce)) out = out.replaceAll(written, said);
  return out;
}

/**
 * A short, stable name for one narration line. The audio file for a line is named after it, so
 * changing what is said makes a new file and leaves every other line's audio alone.
 */
export function lineKey(line: string): string {
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i);
    a = Math.imul(a ^ code, 2654435761);
    b = Math.imul(b ^ code, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (b >>> 0).toString(16).padStart(8, '0') + (a >>> 0).toString(16).padStart(8, '0');
}
