// .pptx export. PowerPoint cannot run wag's interactions, so they are translated:
//   entrances -> keyframed animations that start with the slide (springs are baked in)
//   steps     -> click animations on the same slide, or Morph slides when a step changes
//                something PowerPoint can only morph (colour, corner radius, font size, ...)
//   hover     -> a hidden slide per element that drives a declared slide state, reached by a
//                mouse-over action and animated by Morph
//   click     -> a hidden slide per click state, reached by a click action
// PptxGenJS writes the static slides; this file then injects the transitions, animations and
// links it has no API for. Not carried over: whileHover and press tweaks, drag, loops, live
// scenes and working fields.
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { marks, resolve, type Animatable, type Deck, type Element, type MotionConfig, type Slide, type SlideTransition } from './scene';

const PX = 96; // deck pixels per inch
const PT = 0.75; // points per deck pixel
const WINDOWS_FONTS = ['Segoe UI', 'Arial', 'Calibri', 'Georgia', 'Times New Roman', 'Consolas', 'Verdana', 'Tahoma'];

type Kind = 'base' | 'step' | 'hover' | 'click';

/** One PowerPoint slide: a wag slide in one particular layout. */
interface Variant {
  wag: number;
  slide: Slide;
  kind: Kind;
  active: Set<string>;
  hidden: boolean;
  /** hover: the id of the element being hovered. click: the state being shown. */
  of?: string;
  /** base only: where each element is drawn when the steps play as animations on this slide */
  drawn?: Map<string, Animatable>;
  /** base only: whether hover or click slides link back here */
  linkedBack?: boolean;
  /** PowerPoint slide number, from 1 */
  number: number;
}

interface Link {
  click?: number | 'next' | 'prev' | 'back';
  hover?: number;
}

type Span = [from: number, to: number];

/**
 * One PowerPoint animation on one shape. x and y are offsets of its centre from where it is
 * drawn, as fractions of the slide; w and h are multiples of its drawn size.
 */
interface Effect {
  shape: string;
  picture: boolean;
  kind: 'appear' | 'change' | 'vanish';
  reveal?: 'fade' | 'wipe';
  /** seconds */
  delay: number;
  motion: MotionConfig;
  x?: Span;
  y?: Span;
  w?: Span;
  h?: Span;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const visible = (el: Element, a: Animatable) => a.opacity > 0.01 && (el.kind !== 'path' || a.draw > 0.001);

/** The states an element's hover is exported for: declared slide states, not its own whileHover tweak. */
const hoverStates = (el: Element) => el.hover.filter((name) => !name.startsWith('hover:'));

const upTo = (slide: Slide, step: number) => new Set(slide.steps.slice(0, step + 1));

/** Properties a PowerPoint animation here cannot change, so they must hold still across steps. */
const FIXED = ['rotate', 'opacity', 'radius', 'fontSize', 'draw', 'fill', 'color'] as const;

/**
 * Where to draw each element so the slide's steps can play as animations on it: the first
 * layout in which the element shows. Null when some step changes a FIXED property of a
 * showing element, in which case the steps become Morph slides instead.
 */
function drawnForSteps(slide: Slide): Map<string, Animatable> | null {
  const drawn = new Map<string, Animatable>();
  for (const el of slide.elements) {
    const layouts = [-1, ...slide.steps.keys()].map((step) => resolve(slide, el, upTo(slide, step)));
    const shown = layouts.filter((a) => visible(el, a));
    const first = shown[0] ?? layouts[0];
    if (shown.some((a) => FIXED.some((key) => a[key] !== first[key]))) return null;
    drawn.set(el.id, first);
  }
  return drawn;
}

function plan(deck: Deck): Variant[] {
  const out: Variant[] = [];
  deck.slides.forEach((slide, wag) => {
    const add = (kind: Kind, active: string[], hidden: boolean, extra: Partial<Variant> = {}) =>
      out.push({ wag, slide, kind, active: new Set(active), hidden, number: out.length + 1, ...extra });
    const hoverable = slide.elements.filter((el) => hoverStates(el).length);
    const clickStates = [...new Set(slide.elements.flatMap((el) => (typeof el.click === 'string' ? [el.click] : [])))];
    const drawn = slide.steps.length ? drawnForSteps(slide) : null;
    add('base', [], slide.hidden, { drawn: drawn ?? undefined, linkedBack: hoverable.length + clickStates.length > 0 });
    if (!drawn) slide.steps.forEach((_, i) => add('step', slide.steps.slice(0, i + 1), slide.hidden));
    for (const el of hoverable) add('hover', hoverStates(el), true, { of: el.id });
    for (const state of clickStates) add('click', [state], true, { of: state });
  });
  return out;
}

// ---------- colours, fonts, geometry ----------

let canvas: CanvasRenderingContext2D | null = null;
/** Any CSS colour as PowerPoint hex plus alpha. The browser does the parsing. */
function paint(css: string): { hex: string; alpha: number } {
  canvas ??= document.createElement('canvas').getContext('2d')!;
  canvas.fillStyle = '#000000';
  canvas.fillStyle = css;
  const parsed = canvas.fillStyle;
  if (parsed.startsWith('#')) return { hex: parsed.slice(1).toUpperCase(), alpha: 1 };
  const [r, g, b, a = 1] = parsed.slice(parsed.indexOf('(') + 1, -1).split(',').map(Number);
  return { hex: [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase(), alpha: a };
}

const percent = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100);

/** The first colour named in a CSS gradient. */
const firstColour = (gradient?: string) => gradient?.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i)?.[0];

function face(stack: string) {
  const families = stack.split(',').map((f) => f.trim().replace(/^["']|["']$/g, ''));
  return families.find((f) => WINDOWS_FONTS.includes(f)) ?? families[0];
}

/** Scale is folded into the size, about the centre, because a PowerPoint shape has no scale. */
function rectOf(a: Animatable): Rect {
  const w = a.w * a.scale;
  const h = a.h * a.scale;
  return { x: a.x + (a.w - w) / 2, y: a.y + (a.h - h) / 2, w, h };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const inches = (r: Rect) => ({ x: r.x / PX, y: r.y / PX, w: r.w / PX, h: r.h / PX });

const rotation = (a: Animatable) => Math.round(((a.rotate % 360) + 360) % 360);

/** Morph pairs shapes whose names start with "!!". Generated ids only ever match within their own slide. */
function shapeName(wag: number, id: string) {
  return `!!${(id.startsWith('_') ? `s${wag}${id}` : id).replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

type Point =
  | { x: number; y: number; moveTo?: boolean }
  | { x: number; y: number; curve: { type: 'cubic'; x1: number; y1: number; x2: number; y2: number } }
  | { x: number; y: number; curve: { type: 'quadratic'; x1: number; y1: number } }
  | { close: true };

/** SVG path data as PptxGenJS points, scaled to inches. Lines and Bezier curves only. */
function pathPoints(d: string, sx: number, sy: number): Point[] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const points: Point[] = [];
  let i = 0;
  let command = '';
  let x = 0;
  let y = 0;
  let start = { x: 0, y: 0 };
  const next = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const at = i;
    if (/[a-zA-Z]/.test(tokens[i])) command = tokens[i++];
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;
    const here = () => ({ x: x * sx, y: y * sy });
    switch (command.toUpperCase()) {
      case 'M':
        x = ox + next();
        y = oy + next();
        start = { x, y };
        points.push({ ...here(), moveTo: true });
        command = relative ? 'l' : 'L';
        break;
      case 'L':
        x = ox + next();
        y = oy + next();
        points.push(here());
        break;
      case 'H':
        x = ox + next();
        points.push(here());
        break;
      case 'V':
        y = oy + next();
        points.push(here());
        break;
      case 'C': {
        const [x1, y1, x2, y2] = [ox + next(), oy + next(), ox + next(), oy + next()];
        x = ox + next();
        y = oy + next();
        points.push({ ...here(), curve: { type: 'cubic', x1: x1 * sx, y1: y1 * sy, x2: x2 * sx, y2: y2 * sy } });
        break;
      }
      case 'Q': {
        const [x1, y1] = [ox + next(), oy + next()];
        x = ox + next();
        y = oy + next();
        points.push({ ...here(), curve: { type: 'quadratic', x1: x1 * sx, y1: y1 * sy } });
        break;
      }
      case 'Z':
        ({ x, y } = start);
        points.push({ close: true });
        break;
      default:
        throw new Error(`wag: the .pptx export cannot draw the path command "${command}"`);
    }
    if (i === at) throw new Error(`wag: could not read the path "${d}"`);
  }
  return points;
}

// ---------- drawing one element ----------

/** Adds the element to the slide and returns the names of the shapes it became. */
function draw(pptx: PptxGenJS, target: PptxGenJS.Slide, deck: Deck, wag: number, el: Element, a: Animatable): string[] {
  // decoration is for the screen: a glow or a moving backdrop has nothing to be in PowerPoint
  if (el.decor) return [];
  const name = shapeName(wag, el.id);
  const rect = rectOf(a);
  const box = { ...inches(rect), rotate: rotation(a), objectName: name };
  // letters coloured by a gradient take its first colour, which is the nearest a slide's text can get
  const ink = paint((el.kind === 'text' && firstColour(el.gradient)) || a.color);
  const size = Math.max(1, a.fontSize * a.scale * PT);
  const type = {
    fontFace: face(el.font ?? deck.font),
    fontSize: size,
    bold: el.weight >= 600,
    italic: el.italic,
    color: ink.hex,
    transparency: percent(1 - ink.alpha * a.opacity),
    align: el.align,
    valign: el.valign,
    margin: 0,
    ...(el.tracking ? { charSpacing: el.tracking * size } : {}),
    ...(el.leading ? { lineSpacingMultiple: el.leading } : {}),
  };
  // marked words become runs of their own, in the accent's face and colour
  const accent = deck.accent;
  const accentInk = firstColour(accent.gradient) ?? accent.color;
  const said = (content: string) => (el.caps ? content.toUpperCase() : content);
  const words = marks(el.text ?? '');
  const runs =
    words.length === 1 && !words[0].em
      ? said(words[0].text)
      : words.map((part) => ({
          text: said(part.text),
          options: part.em
            ? { ...(accent.font ? { fontFace: face(accent.font) } : {}), italic: accent.italic ?? el.italic, bold: (accent.weight ?? (accent.font ? 400 : el.weight)) >= 600, ...(accentInk ? { color: paint(accentInk).hex } : {}) }
            : {},
        }));
  const fill = paint(a.fill);
  const filled = { color: fill.hex, transparency: percent(1 - fill.alpha * a.opacity) };
  const line = el.stroke ? { color: paint(el.stroke).hex, width: el.strokeWidth * PT } : undefined;
  const corner = Math.min(a.radius * a.scale, Math.min(rect.w, rect.h) / 2) / PX;
  const rounded = corner > 0 ? { shape: pptx.ShapeType.roundRect, rectRadius: corner } : { shape: pptx.ShapeType.rect };

  switch (el.kind) {
    case 'text':
      target.addText(runs, { ...box, ...type });
      return [name];
    case 'box':
      target.addText(runs, { ...box, ...type, ...rounded, fill: filled, line });
      return [name];
    case 'ellipse':
      target.addText(runs, { ...box, ...type, shape: pptx.ShapeType.ellipse, fill: filled, line });
      return [name];
    case 'scene':
      // a live scene cannot run in PowerPoint: it leaves its panel with the words it was given, or a note
      if (el.alt) target.addText(el.alt, { ...box, ...type, ...rounded, fill: filled, align: 'center', valign: 'middle' });
      else target.addText('Live scene: open the web version to see it', { ...box, ...type, ...rounded, fill: filled, fontSize: 14, bold: false, italic: false, color: '94A3B8', transparency: 0, align: 'center', valign: 'middle' });
      return [name];
    case 'video':
      target.addText('Video: open the web version to play it', { ...box, ...type, ...rounded, fill: { color: '1E293B' }, fontSize: 14, bold: false, color: '94A3B8', transparency: 0, align: 'center', valign: 'middle' });
      return [name];
    case 'field':
      target.addText(el.placeholder ?? '', { ...box, ...type, ...rounded, fill: filled, line, bold: false, transparency: 55, valign: 'middle', margin: [15, 15, 0, 0] }); // PptxGenJS margins run left, right, bottom, top
      return [name];
    case 'image':
      if (!el.src) return [];
      target.addImage({ ...box, path: el.src, transparency: percent(1 - a.opacity) });
      return [name];
    case 'path': {
      // a partly drawn stroke has no PowerPoint equivalent: it is there or it is not
      if (!el.d || a.draw <= 0.001 || a.opacity <= 0.01) return [];
      const points = pathPoints(el.d, rect.w / el.base.w / PX, rect.h / el.base.h / PX);
      // the library draws custom geometry but its types leave the name out
      target.addShape('custGeom' as PptxGenJS.SHAPE_NAME, { ...box, points, line: { color: ink.hex, width: el.strokeWidth * a.scale * PT }, fill: fill.alpha > 0 ? filled : undefined });
      return [name];
    }
    case 'choice': {
      // options laid out left to right like the web version, with estimated text widths
      const size = a.fontSize * a.scale;
      const names: string[] = [];
      let x = rect.x;
      let y = rect.y;
      (el.options ?? []).forEach((option, i) => {
        const w = option.length * size * 0.58 + size * 2.2;
        const h = size * 2.2;
        if (x > rect.x && x + w > rect.x + rect.w) {
          x = rect.x;
          y += h + 12;
        }
        const pill = `${name}-${i}`;
        target.addText(option, { ...type, ...inches({ x, y, w, h }), objectName: pill, shape: pptx.ShapeType.roundRect, rectRadius: h / 2 / PX, fill: { color: '94A3B8', transparency: percent(1 - 0.2 * a.opacity) }, align: 'center', valign: 'middle' });
        names.push(pill);
        x += w + 12;
      });
      return names;
    }
  }
}

// ---------- animation XML ----------

function transitionXml(kind: SlideTransition, morphMs = 500) {
  const plain = { fade: '<p:fade/>', push: '<p:push dir="l"/>', zoom: '<p:zoom dir="in"/>', iris: '<p:circle/>' };
  if (kind === 'none') return '';
  if (kind !== 'morph') return `<p:transition spd="med">${plain[kind]}</p:transition>`;
  return `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="p159"><p:transition xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" spd="fast" p14:dur="${morphMs}"><p159:morph option="byObject"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="fast"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`;
}

/** Progress from 0 to 1 over time for a spring or tween, and how long it takes to settle. */
function curve(motion: MotionConfig): { seconds: number; samples: number; at: (t: number) => number } {
  if (motion.type === 'tween') {
    const seconds = motion.duration ?? 0.3;
    const eased = { linear: (p: number) => p, easeIn: (p: number) => p * p, easeOut: (p: number) => 1 - (1 - p) ** 2, easeInOut: (p: number) => (p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) ** 2) };
    return { seconds, samples: 20, at: (t) => eased[motion.ease ?? 'easeOut'](Math.min(1, t / seconds)) };
  }
  const { stiffness = 220, damping = 18, mass = 1 } = motion;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = Math.min(1, damping / (2 * Math.sqrt(stiffness * mass)));
  const seconds = Math.min(4, Math.max(0.3, -Math.log(0.002) / (zeta * w0)));
  if (zeta >= 1) return { seconds, samples: 60, at: (t) => 1 - Math.exp(-w0 * t) * (1 + w0 * t) };
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  return { seconds, samples: 60, at: (t) => 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t)) };
}

const signed = (v: number) => (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(5);

/** How one step changes one element, as animations relative to where the element is drawn. */
function stepEffects(deck: Deck, slide: Slide, el: Element, drawn: Animatable, step: number): Omit<Effect, 'shape'>[] {
  const before = resolve(slide, el, upTo(slide, step - 1));
  const after = resolve(slide, el, upTo(slide, step));
  const was = visible(el, before);
  const is = visible(el, after);
  if (!was && !is) return [];
  const base = { picture: el.kind === 'image', delay: 0, motion: el.motion ?? slide.motion ?? deck.motion };
  if (was && !is) return [{ ...base, kind: 'vanish' }];

  const span = (from: number, to: number): Span | undefined => (Math.abs(from - to) < 1e-6 ? undefined : [from, to]);
  const centre = (a: Animatable, axis: 'x' | 'y') =>
    axis === 'x' ? (a.x + a.w / 2 - drawn.x - drawn.w / 2) / deck.width : (a.y + a.h / 2 - drawn.y - drawn.h / 2) / deck.height;
  const size = (a: Animatable, side: 'w' | 'h') => (a[side] * a.scale) / (drawn[side] * drawn.scale || 1);
  const moved = {
    x: span(centre(before, 'x'), centre(after, 'x')),
    y: span(centre(before, 'y'), centre(after, 'y')),
    w: span(size(before, 'w'), size(after, 'w')),
    h: span(size(before, 'h'), size(after, 'h')),
  };
  if (!was) return [{ ...base, kind: 'appear', reveal: el.kind === 'path' && before.draw <= 0.001 ? 'wipe' : 'fade', ...moved }];
  return moved.x || moved.y || moved.w || moved.h ? [{ ...base, kind: 'change', ...moved }] : [];
}

type Placed = Effect & { spid: string };

/**
 * The slide's animations: `auto` plays as soon as the slide appears, then each group in
 * `clicks` waits for one click or arrow press.
 */
function timingXml(auto: Placed[], clicks: Placed[][]) {
  let id = 2; // 1 is the root, 2 the main sequence
  const next = () => ++id;
  const perShape = new Map<string, number>();
  const built: string[] = [];

  const effectXml = (e: Placed, node: string) => {
    const target = `<p:tgtEl><p:spTgt spid="${e.spid}"/></p:tgtEl>`;
    const { seconds, samples, at } = curve(e.motion);
    const ms = Math.round(seconds * 1000);
    const keyframes = (attr: string, [from, to]: Span, formula: (v: number) => string) => {
      let list = '';
      for (let s = 0; s < samples; s++) {
        const frac = s / (samples - 1);
        const p = s === samples - 1 ? 1 : at(frac * seconds);
        list += `<p:tav tm="${Math.round(frac * 100000)}"><p:val><p:strVal val="${formula(from + (to - from) * p)}"/></p:val></p:tav>`;
      }
      return `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${next()}" dur="${ms}" fill="hold"/>${target}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst>${list}</p:tavLst></p:anim>`;
    };
    const filter = (direction: 'in' | 'out', name: string, dur: number) =>
      `<p:animEffect transition="${direction}" filter="${name}"><p:cBhvr><p:cTn id="${next()}" dur="${dur}"/>${target}</p:cBhvr></p:animEffect>`;
    const visibility = (to: 'visible' | 'hidden', delay: number) =>
      `<p:set><p:cBhvr><p:cTn id="${next()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst></p:cTn>${target}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${to}"/></p:to></p:set>`;

    const effectId = next();
    let preset = 'presetID="6" presetClass="emph" presetSubtype="0"';
    let body = '';
    if (e.kind === 'appear') {
      preset = 'presetID="2" presetClass="entr" presetSubtype="4"';
      body += visibility('visible', 0);
      if (e.reveal === 'fade') body += filter('in', 'fade', 300);
      if (e.reveal === 'wipe') body += filter('in', 'wipe(left)', 600);
    } else if (e.kind === 'vanish') {
      preset = 'presetID="10" presetClass="exit" presetSubtype="0"';
      body += filter('out', 'fade', 300) + visibility('hidden', 299);
    }
    if (e.kind !== 'vanish') {
      if (e.x) body += keyframes('ppt_x', e.x, (v) => `#ppt_x${signed(v)}`);
      if (e.y) body += keyframes('ppt_y', e.y, (v) => `#ppt_y${signed(v)}`);
      if (e.w) body += keyframes('ppt_w', e.w, (v) => `#ppt_w*${v.toFixed(5)}`);
      if (e.h) body += keyframes('ppt_h', e.h, (v) => `#ppt_h*${v.toFixed(5)}`);
    }
    // PowerPoint numbers each animation on a shape and lists it in the build list
    let grouping = '';
    if (!e.picture) {
      const group = perShape.get(e.spid) ?? 0;
      perShape.set(e.spid, group + 1);
      grouping = ` grpId="${group}"`;
      built.push(`<p:bldP spid="${e.spid}" grpId="${group}" animBg="1"/>`);
    }
    return `<p:par><p:cTn id="${effectId}" ${preset} fill="hold"${grouping} nodeType="${node}"><p:stCondLst><p:cond delay="${Math.round(e.delay * 1000)}"/></p:stCondLst><p:childTnLst>${body}</p:childTnLst></p:cTn></p:par>`;
  };

  const group = (effects: Placed[], onClick: boolean) => {
    const outer = next();
    const inner = next();
    const start = onClick ? '' : '<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>';
    const body = effects.map((e, i) => effectXml(e, i > 0 ? 'withEffect' : onClick ? 'clickEffect' : 'afterEffect')).join('');
    return `<p:par><p:cTn id="${outer}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/>${start}</p:stCondLst><p:childTnLst><p:par><p:cTn id="${inner}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${body}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
  };

  const groups = (auto.length ? group(auto, false) : '') + clicks.map((effects) => group(effects, true)).join('');
  const slideEvent = (evt: string) => `<p:cond evt="${evt}" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond>`;
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${groups}</p:childTnLst></p:cTn><p:prevCondLst>${slideEvent('onPrev')}</p:prevCondLst><p:nextCondLst>${slideEvent('onNext')}</p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst>${built.join('')}</p:bldLst></p:timing>`;
}

// ---------- the export ----------

export async function toPptx(deck: Deck): Promise<Blob> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WAG', width: deck.width / PX, height: deck.height / PX });
  pptx.layout = 'WAG';

  const variants = plan(deck);
  const find = (wag: number, kind: Kind, of?: string) => variants.find((v) => v.wag === wag && v.kind === kind && v.of === of)!;
  const route = (to: number | string): Link['click'] => {
    if (to === 'next' || to === 'prev' || to === 'back') return to;
    return find(typeof to === 'number' ? to - 1 : deck.slides.findIndex((s) => s.name === to), 'base').number;
  };

  const pages = variants.map((v) => {
    const { slide } = v;
    const target = pptx.addSlide();
    target.hidden = v.hidden;
    const bg = paint(slide.bg ?? deck.bg).hex;
    target.background = { color: bg };

    const links = new Map<string, Link>();
    const auto: Effect[] = [];
    const clicks: Effect[][] = slide.steps.map(() => []);
    const home = find(v.wag, 'base').number;
    const layouts = new Map(slide.elements.map((el) => [el.id, resolve(slide, el, v.active)]));
    const hovered = v.kind === 'hover' ? rectOf(layouts.get(v.of!)!) : null;
    if (hovered) {
      // sits behind everything: moving the pointer off the hovered element lands here
      target.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: deck.width / PX, h: deck.height / PX, fill: { color: bg }, objectName: 'wag-catcher' });
      links.set('wag-catcher', { hover: home });
    }

    let order = 0;
    for (const el of slide.elements) {
      const layout = layouts.get(el.id)!;
      const a = v.drawn?.get(el.id) ?? layout;
      const shapes = draw(pptx, target, deck, v.wag, el, a);
      const onEach = (effects: Omit<Effect, 'shape'>[]) => effects.flatMap((effect) => shapes.map((shape) => ({ ...effect, shape })));

      if (v.kind === 'base') {
        // a link back to this slide would replay its entrances, so a slide that hover or
        // click slides return to arrives by its transition alone
        const e = el.enter;
        if (e && !v.linkedBack && visible(el, layout)) {
          const span = (from: number | undefined, rest: number): Span | undefined => (from === undefined || from === rest ? undefined : [from, rest]);
          auto.push(
            ...onEach([
              {
                picture: el.kind === 'image',
                kind: 'appear',
                reveal: e.opacity !== undefined && e.opacity < 1 ? 'fade' : e.draw !== undefined && e.draw < 1 ? 'wipe' : undefined,
                delay: (e.delay ?? 0) + slide.stagger * order++,
                motion: el.motion ?? slide.motion ?? deck.motion,
                x: span(e.dx && e.dx / deck.width, 0),
                y: span(e.dy && e.dy / deck.height, 0),
                w: span(e.scale, 1),
                h: span(e.scale, 1),
              },
            ])
          );
        }
        if (v.drawn) slide.steps.forEach((_, step) => clicks[step].push(...onEach(stepEffects(deck, slide, el, a, step))));
      }
      if (a.opacity <= 0.01) continue;

      const link: Link = {};
      const click = el.click;
      if (typeof click === 'string') link.click = v.kind === 'click' && v.of === click ? home : find(v.wag, 'click', click).number;
      else if (click && 'go' in click) link.click = route(click.go);
      // hovering is only wired up from the resting layout; from a step or a click state it
      // would throw that state away
      if (v.kind === 'base' || v.kind === 'hover') {
        if (hoverStates(el).length) {
          if (v.of !== el.id) link.hover = find(v.wag, 'hover', el.id).number;
        } else if (hovered && !overlaps(rectOf(a), hovered)) {
          link.hover = home;
        }
      }
      if (link.click !== undefined || link.hover !== undefined) for (const shape of shapes) links.set(shape, link);
    }

    const arriving = v.kind === 'base' ? (slide.transition ?? deck.transition) : 'morph';
    return { links, auto, clicks, transition: transitionXml(arriving, v.kind === 'step' ? 500 : 350) };
  });

  const zip = await JSZip.loadAsync((await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer);
  for (const [i, page] of pages.entries()) {
    const file = `ppt/slides/slide${i + 1}.xml`;
    const relsFile = `ppt/slides/_rels/slide${i + 1}.xml.rels`;
    let xml = await zip.file(file)!.async('string');
    let rels = await zip.file(relsFile)!.async('string');
    const tag = (shape: string) => new RegExp(`(<p:cNvPr id="(\\d+)" name="${shape}"[^>]*?)(/>|>)`);

    const linked = new Set<number>();
    for (const [shape, link] of page.links) {
      let actions = '';
      for (const [element, to] of [['a:hlinkClick', link.click], ['a:hlinkHover', link.hover]] as const) {
        if (to === undefined) continue;
        if (typeof to === 'number') {
          linked.add(to);
          actions += `<${element} r:id="rIdWag${to}" action="ppaction://hlinksldjump"/>`;
        } else {
          const jump = { next: 'nextslide', prev: 'previousslide', back: 'lastslideviewed' }[to];
          actions += `<${element} r:id="" action="ppaction://hlinkshowjump?jump=${jump}"/>`;
        }
      }
      xml = xml.replace(tag(shape), (_, open, _id, close) => (close === '/>' ? `${open}>${actions}</p:cNvPr>` : `${open}>${actions}`));
    }
    for (const to of linked) {
      rels = rels.replace('</Relationships>', `<Relationship Id="rIdWag${to}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slide${to}.xml"/></Relationships>`);
    }

    // an effect whose shape was not drawn (an undrawn path, say) is dropped, and so is a step left with nothing to do
    const placed = (effects: Effect[]): Placed[] =>
      effects.flatMap((e) => {
        const spid = xml.match(tag(e.shape))?.[2];
        return spid ? [{ ...e, spid }] : [];
      });
    const auto = placed(page.auto);
    const clicks = page.clicks.map(placed).filter((effects) => effects.length);
    // the schema wants the transition before the timing, both after the colour map
    const extra = page.transition + (auto.length || clicks.length ? timingXml(auto, clicks) : '');
    if (!xml.includes('</p:clrMapOvr>')) throw new Error('wag: unexpected slide XML from PptxGenJS');
    zip.file(file, xml.replace('</p:clrMapOvr>', `</p:clrMapOvr>${extra}`));
    zip.file(relsFile, rels);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}
