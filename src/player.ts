// Web player: renders a wag deck to the DOM and drives it with Motion.
// Every animatable property of every element is a motion value, so an interaction only has to
// work out the new target layout and spring each value towards it. Interrupted springs keep
// their velocity, which is what makes hover feel alive.
import { animate, createScopedAnimate, frame, mix, motionValue, type MotionValue } from 'motion';
import { resolve, type Animatable, type Answers, type Deck, type Element, type MotionConfig, type Slide } from './scene';

const KEYS = ['x', 'y', 'w', 'h', 'rotate', 'scale', 'opacity', 'radius', 'fontSize', 'draw', 'fill', 'color'] as const satisfies readonly (keyof Animatable)[];

/** Loop motion sits on top of the layout: these are the values that leave it untouched. */
const NEUTRAL = { dx: 0, dy: 0, rotate: 0, scale: 1, opacity: 1 };
type LoopKey = keyof typeof NEUTRAL;
const LOOP_KEYS = Object.keys(NEUTRAL) as LoopKey[];

type Values = { [K in keyof Animatable]: MotionValue<Animatable[K]> };

interface View {
  el: Element;
  node: HTMLElement;
  values: Values;
  loop: Record<LoopKey, MotionValue<number>>;
  drag: { x: MotionValue<number>; y: MotionValue<number> };
  playing: { stop(): void }[];
  /** ends a scene that is running: stops its animations and empties it */
  leave: (() => void) | null;
  paint: () => void;
}

interface Stage {
  slide: Slide;
  layer: HTMLElement;
  views: View[];
  /** how many of the slide's steps have been taken, -1 for none */
  step: number;
  /** the click-selected state, if any */
  current: string | null;
  /** hover and press states in effect right now */
  transient: Set<string>;
}

export interface Player {
  readonly index: number;
  go(index: number): void;
  /** take the next step on this slide, or move to the next slide when there are none left */
  next(): void;
  prev(): void;
  destroy(): void;
}

const FLEX = { left: 'flex-start', center: 'center', right: 'flex-end', top: 'flex-start', middle: 'center', bottom: 'flex-end' };
const SVG = 'http://www.w3.org/2000/svg';

function motionOptions(t: MotionConfig) {
  return t.type === 'spring'
    ? { type: 'spring' as const, stiffness: t.stiffness ?? 220, damping: t.damping ?? 18, mass: t.mass ?? 1 }
    : { type: 'tween' as const, duration: t.duration ?? 0.3, ease: t.ease ?? ('easeOut' as const) };
}

export function mount(deck: Deck, root: HTMLElement): Player {
  root.style.position = 'relative';
  root.style.overflow = 'hidden';

  const frameEl = document.createElement('div');
  Object.assign(frameEl.style, {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: `${deck.width}px`,
    height: `${deck.height}px`,
    overflow: 'hidden',
    background: deck.bg,
    fontFamily: deck.font,
    transformOrigin: 'center',
  });
  root.append(frameEl);

  let zoom = 1;
  const fit = () => {
    zoom = Math.min(root.clientWidth / deck.width, root.clientHeight / deck.height) || 1;
    frameEl.style.transform = `translate(-50%, -50%) scale(${zoom})`;
  };
  const resize = new ResizeObserver(fit);
  resize.observe(root);
  fit();

  for (const href of deck.stylesheets) {
    if ([...document.head.querySelectorAll('link')].some((link) => link.href === href)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.append(link);
  }

  const style = document.createElement('style');
  style.textContent =
    '.wag-field:focus-within{box-shadow:0 0 0 3px rgba(56,189,248,.55)}.wag-field input::placeholder{color:currentColor;opacity:.45}.wag-option{transition:background-color .2s,color .2s}';
  frameEl.append(style);

  // answers gathered by fields, choices and scenes. Insertion order is the column order when saved.
  const gathered = new Map<string, string>();
  const listeners = new Set<(name: string, value: string) => void>();
  const answers: Answers = {
    get: (name) => gathered.get(name),
    set(name, next) {
      if (gathered.get(name) === next) return;
      gathered.set(name, next);
      for (const listener of listeners) listener(name, next);
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  /** one row per save, for as long as the page stays open */
  const saved: Record<string, string>[] = [];

  const stages = deck.slides.map((s) => buildStage(s));
  let index = -1;
  /** the slide shown before this one, which is where `go: 'back'` returns to */
  let cameFrom = -1;
  const names = new Map(deck.slides.flatMap((s, i) => (s.name ? [[s.name, i] as const] : [])));
  /** finishes the slide transition in flight, if there is one */
  let settle: (() => void) | null = null;

  const bgOf = (stage: Stage) => stage.slide.bg ?? deck.bg;
  const configOf = (stage: Stage, view: View) => motionOptions(view.el.motion ?? stage.slide.motion ?? deck.motion);
  const value = (view: View, k: keyof Animatable) => view.values[k] as MotionValue<string | number>;
  const activeOf = (stage: Stage) =>
    new Set([...stage.slide.steps.slice(0, stage.step + 1), ...(stage.current ? [stage.current] : []), ...stage.transient]);

  function buildView(el: Element): View {
    const node = document.createElement('div');
    Object.assign(node.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      display: 'flex',
      boxSizing: 'border-box',
      alignItems: FLEX[el.valign],
      justifyContent: FLEX[el.align],
      textAlign: el.align,
      fontWeight: String(el.weight),
      lineHeight: '1.2',
      whiteSpace: 'pre-wrap',
      userSelect: 'none',
      willChange: 'transform',
      cursor: el.drag ? 'grab' : el.click ? 'pointer' : 'default',
    });
    if (el.drag) node.style.touchAction = 'none';
    // a scene starts from plain text defaults, not the centred, pre-wrapped text of a box
    if (el.kind === 'scene') Object.assign(node.style, { display: 'block', overflow: 'hidden', textAlign: 'left', whiteSpace: 'normal', lineHeight: 'normal' });
    if (el.kind === 'field' && el.name) buildField(node, el, el.name);
    if (el.kind === 'choice' && el.name) buildChoice(node, el, el.name);
    if (el.font) node.style.fontFamily = el.font;
    if (el.stroke && el.kind !== 'path') node.style.border = `${el.strokeWidth}px solid ${el.stroke}`;
    if (el.text !== undefined) node.textContent = el.text;
    if (el.kind === 'image' && el.src) {
      const img = document.createElement('img');
      img.src = el.src;
      img.draggable = false;
      Object.assign(img.style, { width: '100%', height: '100%', objectFit: el.fit, borderRadius: 'inherit' });
      node.append(img);
    }
    if (el.kind === 'video' && el.src) {
      const film = document.createElement('video');
      film.src = el.src;
      film.muted = !el.sound;
      film.loop = el.repeat;
      film.playsInline = true;
      film.preload = 'auto';
      Object.assign(film.style, { width: '100%', height: '100%', objectFit: el.fit, borderRadius: 'inherit', display: 'block' });
      node.append(film);
    }
    let stroke: SVGPathElement | null = null;
    if (el.kind === 'path' && el.d) {
      const svg = document.createElementNS(SVG, 'svg');
      svg.setAttribute('viewBox', `0 0 ${el.base.w} ${el.base.h}`);
      svg.setAttribute('preserveAspectRatio', 'none');
      Object.assign(svg.style, { width: '100%', height: '100%', overflow: 'visible', display: 'block' });
      stroke = document.createElementNS(SVG, 'path');
      const attrs = { d: el.d, pathLength: '1', stroke: 'currentColor', 'stroke-width': String(el.strokeWidth), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': '1' };
      for (const [name, v] of Object.entries(attrs)) stroke.setAttribute(name, v);
      svg.append(stroke);
      node.append(svg);
    }
    node.dataset.wag = el.id;

    const values = Object.fromEntries(KEYS.map((k) => [k, motionValue(el.base[k])])) as unknown as Values;
    const loop = Object.fromEntries(LOOP_KEYS.map((k) => [k, motionValue(NEUTRAL[k])])) as Record<LoopKey, MotionValue<number>>;
    const drag = { x: motionValue(0), y: motionValue(0) };
    const interactive = el.hover.length > 0 || el.press.length > 0 || el.click !== undefined || el.drag !== undefined || ['scene', 'field', 'choice'].includes(el.kind);
    const paint = () => {
      const v = <K extends keyof Animatable>(k: K) => values[k].get();
      const st = node.style;
      const opacity = v('opacity') * loop.opacity.get();
      st.width = `${Math.max(0, v('w'))}px`;
      st.height = `${Math.max(0, v('h'))}px`;
      st.transform = `translate(${v('x') + loop.dx.get() + drag.x.get()}px, ${v('y') + loop.dy.get() + drag.y.get()}px) rotate(${v('rotate') + loop.rotate.get()}deg) scale(${v('scale') * loop.scale.get()})`;
      st.opacity = String(opacity);
      st.fontSize = `${Math.max(0, v('fontSize'))}px`;
      st.color = v('color');
      if (stroke) {
        const drawn = Math.min(1, Math.max(0, v('draw')));
        stroke.style.strokeDashoffset = String(1 - drawn);
        // a round cap would leave a dot behind when nothing is drawn
        stroke.style.visibility = drawn > 0.001 ? 'visible' : 'hidden';
        stroke.style.fill = v('fill');
      } else {
        st.borderRadius = el.kind === 'ellipse' ? '50%' : `${Math.max(0, v('radius'))}px`;
        if (!['text', 'image', 'choice'].includes(el.kind)) st.backgroundColor = v('fill');
      }
      // decoration never blocks the pointer, and neither does anything that has faded out
      st.pointerEvents = interactive && opacity > 0.01 ? 'auto' : 'none';
    };
    const repaint = () => frame.render(paint);
    for (const mv of [...Object.values(values), ...Object.values(loop), drag.x, drag.y]) mv.on('change', repaint);
    paint();
    return { el, node, values, loop, drag, playing: [], leave: null, paint };
  }

  function buildField(node: HTMLElement, el: Element, name: string) {
    if (!gathered.has(name)) gathered.set(name, '');
    node.classList.add('wag-field');
    const input = document.createElement('input');
    input.type = el.inputType;
    input.placeholder = el.placeholder ?? '';
    input.value = gathered.get(name) ?? '';
    Object.assign(input.style, { width: '100%', height: '100%', boxSizing: 'border-box', padding: '0 20px', border: '0', outline: '0', background: 'transparent', color: 'inherit', font: 'inherit', textAlign: el.align, userSelect: 'text' });
    input.addEventListener('input', () => answers.set(name, input.value));
    answers.on((changed, next) => {
      if (changed === name && input.value !== next) input.value = next;
    });
    node.append(input);
  }

  function buildChoice(node: HTMLElement, el: Element, name: string) {
    if (!gathered.has(name)) gathered.set(name, '');
    Object.assign(node.style, { gap: '12px', flexWrap: 'wrap', alignContent: 'flex-start' });
    const pills = (el.options ?? []).map((option) => {
      const pill = document.createElement('div');
      pill.className = 'wag-option';
      pill.textContent = option;
      Object.assign(pill.style, { padding: '0.5em 1.1em', borderRadius: '999px', cursor: 'pointer' });
      pill.addEventListener('click', () => {
        answers.set(name, option);
        animate(pill, { scale: [0.88, 1] }, { type: 'spring', stiffness: 420, damping: 14 });
      });
      node.append(pill);
      return pill;
    });
    const mark = () => {
      for (const pill of pills) {
        const picked = pill.textContent === gathered.get(name);
        pill.style.backgroundColor = picked ? el.base.fill : 'rgba(148,163,184,0.2)';
        pill.style.color = picked ? '#0f172a' : '';
      }
    };
    answers.on((changed) => {
      if (changed === name) mark();
    });
    mark();
  }

  /** Add the current answers as a row, then download every row saved so far as one Excel file. */
  async function save(fileName: string) {
    const columns = [...gathered.keys(), 'Saved at'];
    saved.push({ ...Object.fromEntries(gathered), 'Saved at': new Date().toLocaleString() });
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const header = columns.map((value) => ({ value, fontWeight: 'bold' as const }));
    const rows = saved.map((row) => columns.map((column) => row[column] ?? ''));
    await writeXlsxFile([header, ...rows], { columns: columns.map(() => ({ width: 26 })) }).toFile(`${fileName}.xlsx`);
  }

  function buildStage(s: Slide): Stage {
    const layer = document.createElement('div');
    Object.assign(layer.style, { position: 'absolute', inset: '0', display: 'none', background: s.bg ?? deck.bg });
    const stage: Stage = { slide: s, layer, views: [], step: -1, current: null, transient: new Set() };
    for (const el of s.elements) {
      const view = buildView(el);
      const { node } = view;
      stage.views.push(view);
      layer.append(node);

      const during = (names: string[], on: string[], off: string[]) => {
        for (const name of names) {
          for (const event of on) node.addEventListener(event, () => setTransient(stage, name, true));
          for (const event of off) node.addEventListener(event, () => setTransient(stage, name, false));
        }
      };
      during(el.hover, ['pointerenter'], ['pointerleave']);
      during(el.press, ['pointerdown'], ['pointerup', 'pointerleave', 'pointercancel']);

      /** set once a press has moved far enough to count as a drag, so it does not also click */
      let dragged = false;
      if (el.drag) {
        let grab: { px: number; py: number; ox: number; oy: number } | null = null;
        node.addEventListener('pointerdown', (e) => {
          node.setPointerCapture(e.pointerId);
          view.drag.x.stop();
          view.drag.y.stop();
          grab = { px: e.clientX, py: e.clientY, ox: view.drag.x.get(), oy: view.drag.y.get() };
          dragged = false;
          node.style.cursor = 'grabbing';
        });
        node.addEventListener('pointermove', (e) => {
          if (!grab) return;
          const dx = (e.clientX - grab.px) / zoom;
          const dy = (e.clientY - grab.py) / zoom;
          if (Math.hypot(dx, dy) > 4) dragged = true;
          if (el.drag !== 'y') view.drag.x.set(grab.ox + dx);
          if (el.drag !== 'x') view.drag.y.set(grab.oy + dy);
        });
        const release = () => {
          if (!grab) return;
          grab = null;
          node.style.cursor = 'grab';
          if (!el.snapBack) return;
          // the motion values remember how fast they were moving, so a flick carries into the spring
          animate(view.drag.x, 0, configOf(stage, view));
          animate(view.drag.y, 0, configOf(stage, view));
        };
        node.addEventListener('pointerup', release);
        node.addEventListener('pointercancel', release);
      }

      const click = el.click;
      if (click !== undefined) {
        node.addEventListener('click', () => {
          if (dragged) {
            dragged = false;
            return;
          }
          if (typeof click === 'string') setCurrent(stage, stage.current === click ? null : click);
          else if ('save' in click) void save(click.save).then(() => click.state && setCurrent(stage, click.state));
          else route(click.go);
        });
      }
    }
    frameEl.append(layer);
    return stage;
  }

  function moveTo(stage: Stage, view: View, target: Animatable, delay = 0) {
    const config = configOf(stage, view);
    for (const k of KEYS) {
      const mv = value(view, k);
      const to = target[k];
      if (mv.get() === to && !mv.isAnimating()) continue;
      // colours take a plain fade: a spring would overshoot past the target colour
      const options = typeof to === 'string' ? { type: 'tween' as const, duration: 0.3, ease: 'easeOut' as const, delay } : { ...config, delay };
      animate(mv, to, options);
    }
  }

  /** Re-target every element that `changed` states touch. */
  function retarget(stage: Stage, changed: (string | null)[]) {
    const active = activeOf(stage);
    const touched = new Set<string>();
    for (const name of changed) if (name) for (const id of Object.keys(stage.slide.states[name])) touched.add(id);
    for (const view of stage.views) {
      if (touched.has(view.el.id)) moveTo(stage, view, resolve(stage.slide, view.el, active));
    }
  }

  function setTransient(stage: Stage, name: string, on: boolean) {
    if (stage.transient.has(name) === on) return;
    if (on) stage.transient.add(name);
    else stage.transient.delete(name);
    retarget(stage, [name]);
  }

  function setCurrent(stage: Stage, name: string | null) {
    const previous = stage.current;
    if (previous === name) return;
    stage.current = name;
    retarget(stage, [previous, name]);
  }

  /** Stop everything that runs by itself on a slide: its loops, its scenes and its videos. */
  function quiet(stage: Stage) {
    for (const view of stage.views) {
      view.node.querySelector('video')?.pause();
      for (const playing of view.playing) playing.stop();
      view.playing = [];
      view.leave?.();
      view.leave = null;
    }
  }

  function startScene(view: View) {
    const { el, node } = view;
    if (!el.setup) return;
    const scope = { current: node, animations: [] as { stop(): void }[] };
    const stops: (() => void)[] = [];
    const scoped: Answers = {
      get: answers.get,
      set: answers.set,
      on(listener) {
        const stop = answers.on(listener);
        stops.push(stop);
        return stop;
      },
    };
    const undo = el.setup(node, { width: el.base.w, height: el.base.h, animate: createScopedAnimate({ scope }), answers: scoped });
    view.leave = () => {
      if (undo) undo();
      for (const stop of stops) stop();
      for (const animation of scope.animations) animation.stop();
      node.replaceChildren();
    };
  }

  function startLoop(view: View) {
    const loop = view.el.loop;
    for (const key of LOOP_KEYS) {
      const frames = loop?.[key];
      view.loop[key].jump(frames?.length ? frames[0] : NEUTRAL[key]);
      if (!loop || !frames || frames.length < 2) continue;
      view.playing.push(
        animate(view.loop[key], frames, {
          duration: loop.duration ?? 2,
          delay: loop.delay ?? 0,
          ease: loop.ease ?? 'easeInOut',
          repeat: Infinity,
          repeatType: loop.mirror === false ? 'loop' : 'mirror',
        })
      );
    }
  }

  /** Elements of `to` that also exist, by id, on `from`. Generated ids never match. */
  function twinsOf(from: Stage, to: Stage) {
    const named = new Map(from.views.filter((v) => !v.el.id.startsWith('_')).map((v) => [v.el.id, v]));
    return new Map(to.views.flatMap((v) => (named.has(v.el.id) ? [[v.el.id, named.get(v.el.id)!] as const] : [])));
  }

  /**
   * Bring a slide on. Arriving forwards it starts from its base layout and plays its entrances;
   * arriving backwards it shows every step already taken. With `morphFrom`, elements shared
   * with that slide start from where they are on it, and the rest fade in.
   */
  function enter(stage: Stage, back: boolean, morphFrom?: Stage) {
    quiet(stage);
    stage.current = null;
    stage.transient.clear();
    stage.step = back ? stage.slide.steps.length - 1 : -1;
    const active = activeOf(stage);
    const twins = morphFrom ? twinsOf(morphFrom, stage) : undefined;
    let order = 0;
    for (const view of stage.views) {
      const { el } = view;
      const target = resolve(stage.slide, el, active);
      const twin = twins?.get(el.id);
      let start = target;
      let delay = 0;
      if (twin) {
        start = Object.fromEntries(KEYS.map((k) => [k, twin.values[k].get()])) as unknown as Animatable;
      } else if (el.enter && !back) {
        const e = el.enter;
        start = { ...target, x: target.x + (e.dx ?? 0), y: target.y + (e.dy ?? 0) };
        for (const k of ['opacity', 'scale', 'rotate', 'draw'] as const) if (e[k] !== undefined) start[k] = e[k];
        delay = (e.delay ?? 0) + stage.slide.stagger * order++;
      } else if (morphFrom) {
        start = { ...target, opacity: 0 };
      }
      for (const k of KEYS) value(view, k).jump(start[k]);
      view.drag.x.jump(0);
      view.drag.y.jump(0);
      startLoop(view);
      startScene(view);
      const film = view.el.kind === 'video' ? view.node.querySelector('video') : null;
      if (film) {
        film.currentTime = 0;
        // a browser may refuse to autoplay with sound; the video then waits for a click
        film.play().catch(() => (film.controls = true));
      }
      view.paint();
      if (start !== target) moveTo(stage, view, target, delay);
    }
  }

  /** Swap the visible slide, playing the transition of whichever of the two comes later in the deck. */
  function show(target: number) {
    settle?.();
    const from = index >= 0 ? stages[index] : null;
    const to = stages[target];
    const back = target < index;
    cameFrom = index;
    index = target;
    history.replaceState(null, '', `#${to.slide.name ?? target + 1}`);
    to.layer.style.display = 'block';

    const kind = from ? ((back ? from : to).slide.transition ?? deck.transition) : 'none';
    enter(to, back, kind === 'morph' && from ? from : undefined);
    if (!from) return;

    const cleanup: (() => void)[] = [
      () => {
        from.layer.style.display = 'none';
        from.layer.inert = false;
        quiet(from);
        for (const stage of [from, to]) {
          Object.assign(stage.layer.style, { transform: '', opacity: '', clipPath: '', zIndex: '', background: bgOf(stage) });
        }
      },
    ];
    if (kind === 'none') {
      cleanup[0]();
      return;
    }
    from.layer.inert = true;

    let step: (v: number) => void;
    if (kind === 'morph') {
      // the old slide floats on top with no background and fades away, minus the shared
      // elements, which the new slide is already moving
      const twins = twinsOf(from, to);
      for (const twin of twins.values()) {
        twin.node.style.visibility = 'hidden';
        cleanup.push(() => (twin.node.style.visibility = ''));
      }
      const blend = mix(bgOf(from), bgOf(to));
      Object.assign(from.layer.style, { zIndex: '1', background: 'transparent' });
      step = (v) => {
        from.layer.style.opacity = String(1 - Math.min(1, v * 2));
        to.layer.style.background = blend(v);
      };
    } else {
      // written for going forwards (a leaves, b arrives); going back plays it in reverse
      const a = (back ? to : from).layer.style;
      const b = (back ? from : to).layer.style;
      const reach = Math.hypot(deck.width, deck.height) / 2;
      b.zIndex = '1';
      step = (v) => {
        const t = back ? 1 - v : v;
        if (kind === 'fade') {
          b.opacity = String(t);
        } else if (kind === 'push') {
          a.transform = `translateX(${-deck.width * t}px)`;
          b.transform = `translateX(${deck.width * (1 - t)}px)`;
        } else if (kind === 'zoom') {
          a.transform = `scale(${1 + 0.25 * t})`;
          a.opacity = String(1 - t);
          b.transform = `scale(${0.8 + 0.2 * t})`;
          b.opacity = String(t);
        } else {
          b.clipPath = `circle(${reach * t}px at 50% 50%)`;
        }
      };
    }

    const progress = motionValue(0);
    progress.on('change', step);
    step(0);
    const quick = kind === 'fade' || kind === 'morph';
    const controls = animate(progress, 1, quick ? { duration: 0.4, ease: 'easeOut' } : { duration: 0.65, ease: [0.22, 1, 0.36, 1] });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      controls.stop();
      for (const fn of cleanup) fn();
      if (settle === finish) settle = null;
    };
    settle = finish;
    controls.then(finish);
  }

  /** Move to the nearest slide in that direction that is not hidden. */
  function along(direction: 1 | -1) {
    let to = index + direction;
    while (stages[to]?.slide.hidden) to += direction;
    if (stages[to]) show(to);
  }

  function route(to: number | string) {
    if (to === 'next') player.next();
    else if (to === 'prev') player.prev();
    else if (to === 'back') {
      if (cameFrom >= 0) player.go(cameFrom);
    } else player.go(typeof to === 'number' ? to - 1 : (names.get(to) ?? index));
  }

  const onKey = (e: KeyboardEvent) => {
    // keys typed into a field belong to the field
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) player.next();
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) player.prev();
    else if (e.key === 'r' || e.key === 'R') enter(stages[index], false);
    else if (e.key === 'Home') player.go(0);
    else if (e.key === 'End') player.go(stages.length - 1);
    else return;
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);

  // typing a slide number into the address bar jumps there
  const hashIndex = () => {
    const key = decodeURIComponent(location.hash.slice(1));
    return names.get(key) ?? (Number.parseInt(key, 10) || 1) - 1;
  };
  const onHash = () => player.go(hashIndex());
  window.addEventListener('hashchange', onHash);

  const player: Player = {
    get index() {
      return index;
    },
    go(target) {
      const to = Math.max(0, Math.min(stages.length - 1, target));
      if (to !== index) show(to);
    },
    next() {
      const stage = stages[index];
      if (stage.step < stage.slide.steps.length - 1) {
        stage.step++;
        retarget(stage, [stage.slide.steps[stage.step]]);
      } else along(1);
    },
    prev() {
      const stage = stages[index];
      if (stage.step >= 0) {
        const undone = stage.slide.steps[stage.step];
        stage.step--;
        retarget(stage, [undone]);
      } else along(-1);
    },
    destroy() {
      settle?.();
      for (const stage of stages) quiet(stage);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHash);
      resize.disconnect();
      frameEl.remove();
    },
  };

  player.go(hashIndex());
  return player;
}
