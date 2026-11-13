// Web player: renders a wag deck to the DOM and drives it with Motion.
// Every animatable property of every element is a motion value, so an interaction only has to
// work out the new target layout and spring each value towards it. Interrupted springs keep
// their velocity, which is what makes hover feel alive.
import { animate, createScopedAnimate, frame, mix, motionValue, type MotionValue } from 'motion';
import { assetUrl, handoutFile, lineKey, resolve, spoken, type Animatable, type Answers, type Deck, type Download, type Element, type MotionConfig, type Slide } from './scene';

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

/** What `npm run make` wrote for a deck: its narration audio by line key, and its Word documents. */
interface Made {
  audio?: Record<string, { file: string; seconds: number }>;
  handouts?: string[];
  whole?: string;
}

const ICON = {
  prev: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  again: 'M4 12a8 8 0 1 0 2.6-5.9M4 4v5h5',
  files: 'M12 4v11m0 0l-4-4m4 4l4-4M5 19h14',
};
const BAR_CSS = `
.wag-bar{position:absolute;left:0;right:0;bottom:0;background:#020617;border-top:1px solid #1e293b;color:#e2e8f0;font:14px/1.3 Inter,"Segoe UI",system-ui,sans-serif;user-select:none}
.wag-bar-row{display:flex;align-items:center;gap:6px;height:52px;padding:0 14px}
.wag-bar button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;min-width:34px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}
.wag-bar [hidden]{display:none!important}
.wag-bar button:hover{background:rgba(148,163,184,.2)}
.wag-bar button[aria-pressed=true]{background:#38bdf8;color:#0f172a}
.wag-bar button:disabled{opacity:.35;cursor:default;background:transparent}
.wag-bar svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.wag-bar svg.wag-solid{fill:currentColor;stroke:none}
.wag-bar-count{min-width:54px;text-align:center;color:#94a3b8;font-variant-numeric:tabular-nums}
.wag-bar-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;padding:0 8px}
.wag-bar-line{display:none;padding:10px 18px 0;font-size:17px;line-height:1.4;color:#f8fafc;text-align:center}
.wag-bar-files{display:none;position:absolute;right:14px;bottom:58px;min-width:280px;max-width:440px;padding:8px;border-radius:12px;background:#0f172a;border:1px solid #334155;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.wag-bar-files a{display:block;padding:9px 12px;border-radius:8px;color:#e2e8f0;text-decoration:none}
.wag-bar-files a:hover{background:rgba(148,163,184,.2)}
.wag-bar-files small{display:block;padding:8px 12px 4px;color:#94a3b8}
.wag-bar button.wag-live{background:#1e293b;padding:0 12px}
.wag-bar button.wag-live:hover:not(:disabled){background:#334155}
.wag-bar-live{display:none;position:absolute;left:14px;bottom:58px;width:min(620px,calc(100% - 28px));max-height:46vh;overflow:auto;padding:12px 14px;border-radius:12px;background:#0f172a;border:1px solid #334155;box-shadow:0 12px 40px rgba(0,0,0,.5);font-size:15px;line-height:1.45}
.wag-bar-live b{display:block;margin-bottom:6px}
.wag-bar-live div{padding:3px 0 3px 24px;position:relative}
.wag-bar-live div::before{position:absolute;left:0;font-weight:700}
.wag-bar-live .ok::before{content:"\\2713";color:#34d399}
.wag-bar-live .no::before{content:"\\2717";color:#f87171}
.wag-bar-live .wait::before{content:"\\2026";color:#fbbf24}
.wag-bar-live .note{color:#94a3b8}
.wag-bar-live small{color:#94a3b8}
.wag-bar button.wag-ask{background:#1e293b;padding:0 12px}
.wag-bar button.wag-ask:hover{background:#334155}
.wag-bar button.wag-ask[aria-pressed=true]{background:#38bdf8;color:#0f172a}
.wag-bar-ask{display:none;position:absolute;right:14px;bottom:58px;width:min(460px,calc(100% - 28px));max-height:56vh;flex-direction:column;border-radius:12px;background:#0f172a;border:1px solid #334155;box-shadow:0 12px 40px rgba(0,0,0,.5);font-size:15px;line-height:1.45;user-select:text}
.wag-bar-ask-log{overflow:auto;padding:12px 14px 2px}
.wag-bar-ask-log p{margin:0 0 10px}
.wag-bar-ask-log .you{color:#94a3b8}
.wag-bar-ask-log .you::before{content:"You: ";font-weight:600}
.wag-bar-ask-log .note{color:#fbbf24}
.wag-bar-ask form{display:flex;gap:8px;padding:10px;border-top:1px solid #1e293b}
.wag-bar-ask input{flex:1;min-width:0;height:36px;padding:0 12px;border-radius:8px;border:1px solid #334155;background:#020617;color:#f8fafc;font:inherit}
.wag-bar-ask input:focus{outline:2px solid #38bdf8;outline-offset:0}
.wag-bar-ask form button,.wag-bar-ask form button:hover:not(:disabled){background:#38bdf8;color:#0f172a;padding:0 14px}
.wag-bar button.wag-nav{padding:0 12px;background:#1e293b}
.wag-bar button.wag-nav:hover{background:#334155}
.wag-bar button.wag-counting{position:relative;overflow:hidden}
.wag-bar button.wag-counting::after{content:"";position:absolute;left:0;bottom:0;height:3px;width:0;background:#38bdf8;animation:wag-count var(--wait) linear forwards}
@keyframes wag-count{from{width:0}to{width:100%}}
.wag-timeline{display:flex;gap:5px;align-items:center;height:20px;padding:6px 14px 0}
.wag-tl-slide{display:flex;gap:2px;min-width:8px;height:16px;align-items:center}
.wag-seg{flex:1 1 0;min-width:3px;height:8px;background:#334155;border-radius:3px;position:relative;overflow:hidden;cursor:pointer;transition:height .12s}
.wag-seg:hover{height:14px;background:#64748b}
.wag-seg.done{background:#0369a1}
.wag-seg.now{height:14px;background:#334155;box-shadow:0 0 0 2px #38bdf8}
.wag-seg i{position:absolute;left:0;top:0;bottom:0;width:0;background:#38bdf8}
.wag-seg.done i{width:100%}
.wag-time{min-width:92px;text-align:right;color:#94a3b8;font-variant-numeric:tabular-nums;font-size:13px}
.wag-edge{position:absolute;width:56px;height:56px;margin-top:-28px;border:0;border-radius:50%;background:rgba(2,6,23,.6);color:#f8fafc;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .2s;cursor:pointer;z-index:4}
.wag-edge.on{opacity:1;pointer-events:auto}
.wag-edge:hover{background:rgba(56,189,248,.9);color:#0f172a}
.wag-edge svg{width:30px;height:30px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.wag-hint{position:absolute;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:999px;background:rgba(2,6,23,.88);color:#e2e8f0;font:15px Inter,"Segoe UI",system-ui,sans-serif;white-space:nowrap;transition:opacity .4s;z-index:5;pointer-events:none}
.wag-hint b{color:#38bdf8}
.wag-start{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:none;align-items:center;gap:10px;padding:16px 28px;border:0;border-radius:999px;background:#38bdf8;color:#0f172a;font:700 20px Inter,"Segoe UI",system-ui,sans-serif;cursor:pointer;box-shadow:0 12px 40px rgba(0,0,0,.5)}
.wag-start svg{width:22px;height:22px;fill:currentColor}`;

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

  // a deck that is narrated or hands out files gets a bar under the slide; other decks keep the whole window
  const guided = deck.slides.some((s) => s.narration.length > 0 || s.downloads.length > 0 || s.handout || s.live);
  const narrated = deck.slides.some((s) => s.narration.length > 0);
  // set once the bar is built: where its arrows and hint go as the window changes size, and how it stops
  let placeEdges = (_middle: number) => {};
  let placeHint = (_fromBottom: number) => {};
  let stopBar = () => {};
  const bar = guided ? document.createElement('div') : null;
  if (bar) {
    bar.className = 'wag-bar';
    root.append(bar);
  }

  let zoom = 1;
  const fit = () => {
    const room = root.clientHeight - (bar?.offsetHeight ?? 0);
    zoom = Math.min(root.clientWidth / deck.width, room / deck.height) || 1;
    frameEl.style.top = `${room / 2}px`;
    placeEdges(room / 2);
    placeHint(bar?.offsetHeight ?? 0);
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

  // Narration. A line is heard from its audio file when `npm run make` has written one, from the
  // browser's own voice when it has not, and is only timed when the browser has no voice at all.
  let made: Made = {};
  const ready: Promise<void> = deck.assets
    ? fetch(assetUrl(deck, 'wag.json'))
        .then((response) => (response.ok ? response.json() : {}))
        .then((json: Made) => void (made = json))
        .catch(() => undefined)
    : Promise.resolve();
  const audio = new Audio();
  /** an answer from Ask is heard through its own player, so the narration can be picked up where it was paused */
  const answerAudio = new Audio();
  const voice = 'speechSynthesis' in window ? window.speechSynthesis : null;
  /** the line for where the deck is now, which the play button speaks */
  let line: string | undefined;
  let hearing: 'nothing' | 'playing' | 'paused' | 'blocked' = 'nothing';
  let through: 'file' | 'voice' | 'timer' = 'timer';
  let auto = deck.auto;
  let captions = false;
  let timer = 0;
  /** how fast the narration plays */
  let speed = 1;
  /** when Auto will move on, while it is waiting to; 0 when it is not */
  let countdown = 0;
  /** how long Auto waits after a line before moving on, so there is time to look */
  const WAIT = 2200;
  /** changes whenever what should be heard changes, so that anything still in flight is ignored */
  let turn = 0;

  function hush() {
    turn++;
    audio.pause();
    answerAudio.pause();
    voice?.cancel();
    window.clearTimeout(timer);
    countdown = 0;
    hearing = 'nothing';
  }

  /** Stop talking and remember `next` as the line for this spot, without saying it. */
  function rest(next: string | undefined) {
    hush();
    line = next;
    drawBar();
  }

  function say(next: string | undefined) {
    rest(next);
    if (!next) return;
    const mine = turn;
    const heard = (now: typeof hearing) => {
      if (mine !== turn) return;
      hearing = now;
      drawBar();
    };
    const done = () => {
      if (mine !== turn) return;
      heard('nothing');
      // only a line that was heard moves the deck on, so a slide with nothing to say waits for the viewer
      // nor does a slide that drives the live page: the viewer has buttons to press there
      if (auto && !atEnd() && !stages[index].slide.live) {
        countdown = Date.now() + WAIT;
        drawBar();
        timer = window.setTimeout(() => {
          if (mine !== turn) return;
          countdown = 0;
          player.next();
        }, WAIT);
      }
    };
    const timed = () => {
      through = 'timer';
      heard('playing');
      timer = window.setTimeout(done, (1500 + next.length * 65) / speed);
    };
    const aloud = () => {
      if (!voice) return timed();
      through = 'voice';
      const utterance = new SpeechSynthesisUtterance(spoken(deck, next));
      utterance.rate = speed;
      utterance.onend = done;
      utterance.onerror = (event) => (event.error === 'not-allowed' ? heard('blocked') : undefined);
      voice.speak(utterance);
      heard('playing');
    };
    void ready.then(() => {
      if (mine !== turn) return;
      const clip = made.audio?.[lineKey(spoken(deck, next))];
      if (!clip) return aloud();
      through = 'file';
      audio.src = assetUrl(deck, `audio/${clip.file}`);
      audio.playbackRate = speed;
      audio.onended = done;
      audio.onerror = () => mine === turn && aloud();
      // a browser holds sound back until the viewer has clicked or pressed a key on the page
      audio.play().then(
        () => heard('playing'),
        (error: Error) => heard(error.name === 'NotAllowedError' ? 'blocked' : 'nothing')
      );
    });
  }

  /** The play button: pause what is playing, carry on what is paused, or say the current line again. */
  function playPause() {
    if (hearing === 'playing' && through !== 'timer') {
      if (through === 'file') audio.pause();
      else voice?.pause();
      hearing = 'paused';
    } else if (hearing === 'paused') {
      if (through === 'file') void audio.play();
      else voice?.resume();
      hearing = 'playing';
    } else if (hearing === 'playing') {
      hush();
    } else return say(line);
    drawBar();
  }

  const lineAt = (stage: Stage) => stage.slide.narration[stage.step + 1];
  const shown = () => deck.slides.filter((s) => !s.hidden);
  const atEnd = () => {
    const stage = stages[index];
    return stage.step >= stage.slide.steps.length - 1 && !deck.slides.slice(index + 1).some((s) => !s.hidden);
  };

  // Guided slides. The bridge (scripts/live.mjs) does the driving; the player only asks it to and
  // shows what came back. With no bridge the buttons are off and the deck is still a deck.
  const drives = deck.slides.some((s) => s.live);
  let bridge: 'unknown' | 'up' | 'no-browser' | 'down' = 'unknown';
  /** what the last button press reported, as lines for the panel */
  type ReportLine = { kind: 'ok' | 'no' | 'wait' | 'note'; text: string };
  let report: { title: string; lines: ReportLine[] } | null = null;
  let busy = false;
  /** changes when the slide does, so a wait that is still going stops reporting */
  let visit = 0;
  /** `app` may be a path on this site, as it is for a practice page: the bridge needs the whole address */
  const app = deck.app ? new URL(deck.app, location.origin).href.replace(/\/$/, '') : undefined;
  // the bridge only answers whoever holds the key it minted at start; the launcher puts it in the address
  const key = new URLSearchParams(location.search).get('key') ?? '';
  const ask = (what: string, body?: unknown): Promise<any> =>
    fetch(`/live/${what}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wag-Key': key }, body: JSON.stringify(body ?? {}) }).then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))));
  const meet = () =>
    ask('status').then(
      (status: { browser: boolean }) => void ((bridge = status.browser ? 'up' : 'no-browser'), drawBar()),
      () => void ((bridge = 'down'), drawBar())
    );
  if (drives) void meet();

  /** Say a result out loud, unless the slide's own narration is talking. */
  const announce = (words: string) => {
    if (hearing !== 'playing' && voice) voice.speak(new SpeechSynthesisUtterance(words));
  };

  async function drive(what: 'show' | 'turn' | 'check') {
    const live = stages[index].slide.live;
    if (!live || busy) return;
    const mine = visit;
    const tell = (next: typeof report) => {
      if (mine !== visit) return;
      report = next;
      drawBar();
    };
    busy = true;
    const title = { show: 'Show me', turn: 'My turn', check: 'Check' }[what];
    tell({ title, lines: [{ kind: 'wait', text: what === 'turn' ? `Waiting for your click. ${live.turn?.says ?? ''}` : 'Working on the live page' }] });
    try {
      if (what === 'show') {
        const answer = await ask('show', { live, app });
        const lines: ReportLine[] = (answer.done as string[]).map((text) => ({ kind: 'ok', text }));
        if (!answer.ok) lines.push({ kind: 'no', text: answer.why });
        // nothing is hidden: if the page itself sent anything other than a read while the deck acted, it is listed
        for (const request of (answer.sent ?? []) as string[]) lines.push({ kind: 'note', text: `The page sent: ${request}` });
        tell({ title: answer.ok ? 'Show me: done' : answer.refused ? 'Show me: stopped, this one is yours' : 'Show me: stopped', lines });
      } else if (what === 'turn') {
        let answer = await ask('turn', { live, app });
        while (answer.ok && !answer.reached && mine === visit) answer = await ask('turn', { live, app, again: true });
        if (answer.ok && answer.reached) {
          tell({ title: 'My turn: done', lines: [{ kind: 'ok', text: 'The page is where this step expects it.' }] });
          announce('Done. The page is where this step expects it.');
        } else if (!answer.ok) tell({ title: 'My turn: stopped', lines: [{ kind: 'no', text: answer.why }] });
      } else {
        const answer = await ask('check', { live });
        const all = answer.results as { label: string; ok: boolean; got: string; want: string; skipped?: boolean }[];
        // a check for a part this page does not have is left out, and said
        const results = all.filter((r) => !r.skipped);
        const good = results.filter((r) => r.ok).length;
        const lines: ReportLine[] = all.map((r) =>
          r.skipped
            ? { kind: 'note', text: `${r.label}: left out, that part is not on this page` }
            : { kind: r.ok ? 'ok' : 'no', text: `${r.label}: ${r.got}${r.want === '' ? '' : r.ok ? ` matches ${r.want}` : ` does not match ${r.want}`}` }
        );
        const summary = !results.length ? 'Check: nothing to compare on this page' : good === results.length ? `Check: all ${results.length} match` : `Check: ${results.length - good} of ${results.length} do not match`;
        tell({ title: summary, lines });
        announce(`${summary}.`);
      }
    } catch {
      bridge = 'down';
      tell({ title: `${title}: no answer`, lines: [{ kind: 'no', text: 'The live bridge did not answer. Start scripts/live.mjs and try again.' }] });
    }
    busy = false;
    drawBar();
  }

  /** Leaving a slide ends whatever its buttons started and takes the ring off the live page. */
  function leaveLive() {
    visit++;
    busy = false;
    if (report && bridge === 'up') void ask('clear').catch(() => undefined);
    report = null;
  }

  // Ask. A live session started with --ask (scripts/session.mjs) can answer questions: one typed here
  // goes to it with where the deck stands, what the slide says and the last result shown, and the
  // answer comes back as lines to show and hear. Without such a session there is no Ask button.
  let canAsk = false;
  let asking = false;
  let askOpen = false;
  const talk: { who: 'you' | 'guide' | 'note'; text: string }[] = [];
  if (key)
    fetch('/ask', { headers: { 'X-Wag-Key': key } })
      .then((response) => (response.ok ? response.json() : null))
      .then((answer: { can?: boolean } | null) => void ((canAsk = answer?.can === true), drawBar()))
      .catch(() => undefined);

  /** Play an answer's lines one after another: the session's audio when it made some, else the browser's voice. */
  async function hear(said: { text: string; audio?: string }[]) {
    const mine = turn;
    for (const part of said) {
      if (mine !== turn) return;
      await new Promise<void>((done) => {
        if (part.audio) {
          answerAudio.src = `/audio/${part.audio}?key=${key}`;
          answerAudio.onended = answerAudio.onerror = answerAudio.onpause = () => done();
          answerAudio.play().catch(() => done());
        } else if (voice) {
          const utterance = new SpeechSynthesisUtterance(part.text);
          utterance.onend = utterance.onerror = () => done();
          voice.speak(utterance);
        } else done();
      });
    }
  }

  async function askGuide(text: string) {
    if (!text.trim() || asking) return;
    // the deck stops and waits while a question is open
    if (auto) setAuto(false);
    if (hearing === 'playing') playPause();
    const stage = stages[index];
    const visible = shown();
    const live = stage.slide.live;
    const where = {
      deck: deck.title,
      slide: stage.slide.title ?? stage.slide.name ?? `slide ${index + 1}`,
      at: `slide ${visible.indexOf(stage.slide) + 1} of ${visible.length}${stage.slide.steps.length ? `, ${stage.step + 1} of its ${stage.slide.steps.length} steps shown` : ''}`,
      line: lineAt(stage),
      words: stage.slide.elements
        .map((el) => el.text)
        .filter(Boolean)
        .join(' | ')
        .slice(0, 1500),
      buttons: live
        ? [live.show && 'Show me does the step on the page', live.turn && `My turn: ${live.turn.says}`, live.check && `Check compares: ${live.check.map((c) => c.label).join('; ')}`].filter(Boolean).join('. ')
        : undefined,
      report: report ? `${report.title}. ${report.lines.map((l) => l.text).join(' ')}`.slice(0, 1200) : undefined,
    };
    talk.push({ who: 'you', text: text.trim() });
    asking = true;
    drawBar();
    try {
      const answer = await fetch('/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wag-Key': key }, body: JSON.stringify({ text: text.trim(), where }) }).then((response) => response.json());
      if (answer.ok) {
        const said = answer.said as { text: string; audio?: string }[];
        for (const part of said) talk.push({ who: 'guide', text: part.text });
        void hear(said);
      } else talk.push({ who: 'note', text: answer.why });
    } catch {
      talk.push({ who: 'note', text: 'The guide did not answer.' });
    }
    asking = false;
    drawBar();
  }

  /** Every place the deck can stand, in order: each shown slide, then each of its steps, with how long its line takes. */
  const secondsOf = (said: string | undefined) => (said ? (made.audio?.[lineKey(spoken(deck, said))]?.seconds ?? 1.5 + said.length * 0.065) : 3);
  const places = () =>
    deck.slides.flatMap((s, i) => (s.hidden ? [] : [-1, ...s.steps.map((_, k) => k)].map((step) => ({ slide: i, step, said: s.narration[step + 1], seconds: secondsOf(s.narration[step + 1]) }))));

  /** Go straight to one step of one slide, and say its line. */
  function jump(target: number, step: number) {
    if (target !== index) show(target);
    const stage = stages[index];
    stage.step = Math.min(step, stage.slide.steps.length - 1);
    retarget(stage, stage.slide.steps);
    say(lineAt(stage));
  }

  /** The viewer going back has taken the wheel: Auto stops so the deck does not run on by itself. */
  function goBack() {
    if (auto) setAuto(false);
    player.prev();
  }

  let drawBar = () => {};
  let openAsk = () => {};
  if (bar) {
    const css = document.createElement('style');
    css.textContent = BAR_CSS;
    bar.append(css);
    const icon = (d: string, solid = false) => `<svg viewBox="0 0 24 24"${solid ? ' class="wag-solid"' : ''}><path d="${d}"/></svg>`;
    const button = (html: string, title: string, act: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = html;
      b.title = title;
      b.addEventListener('click', () => {
        act();
        // the arrow keys and space should keep moving the deck, not press this button again
        b.blur();
      });
      return b;
    };
    const lineEl = document.createElement('div');
    lineEl.className = 'wag-bar-line';
    const row = document.createElement('div');
    row.className = 'wag-bar-row';
    const count = document.createElement('span');
    count.className = 'wag-bar-count';
    const title = document.createElement('span');
    title.className = 'wag-bar-title';
    const files = document.createElement('div');
    files.className = 'wag-bar-files';
    const prev = button(`${icon(ICON.prev)}Back`, 'Back (left arrow). Turns Auto off.', goBack);
    const next = button(`Next${icon(ICON.next)}`, 'Next (right arrow)', () => player.next());
    prev.className = 'wag-nav';
    next.className = 'wag-nav';
    const speedButton = button('1×', 'Narration speed', () => {
      speed = speed === 1 ? 1.25 : speed === 1.25 ? 0.85 : 1;
      audio.playbackRate = speed;
      drawBar();
    });
    const time = document.createElement('span');
    time.className = 'wag-time';
    // the whole deck as a strip: one mark per step, as long as its line takes to say; click one to go there
    const timeline = document.createElement('div');
    timeline.className = 'wag-timeline';
    let marks: { el: HTMLElement; fill: HTMLElement; slide: number; step: number; seconds: number }[] = [];
    const buildTimeline = () => {
      timeline.replaceChildren();
      marks = [];
      let group: HTMLElement | null = null;
      let groupSlide = -1;
      let groupSeconds = 0;
      for (const place of places()) {
        if (place.slide !== groupSlide) {
          if (group) group.style.flexGrow = String(groupSeconds);
          group = document.createElement('div');
          group.className = 'wag-tl-slide';
          timeline.append(group);
          groupSlide = place.slide;
          groupSeconds = 0;
        }
        const el = document.createElement('div');
        el.className = 'wag-seg';
        el.style.flexGrow = String(place.seconds);
        const s = deck.slides[place.slide];
        el.title = `${s.title ?? `Slide ${place.slide + 1}`}${place.said ? `: ${place.said.slice(0, 120)}${place.said.length > 120 ? '…' : ''}` : ''}`;
        const fill = document.createElement('i');
        el.append(fill);
        el.addEventListener('click', () => jump(place.slide, place.step));
        group!.append(el);
        groupSeconds += place.seconds;
        marks.push({ el, fill, slide: place.slide, step: place.step, seconds: place.seconds });
      }
      if (group) group.style.flexGrow = String(groupSeconds);
    };
    const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    // the mark being spoken fills as its line plays
    let ticking = true;
    const tick = () => {
      if (!ticking) return;
      const now = marks.find((m) => m.el.classList.contains('now'));
      if (now) now.fill.style.width = hearing === 'playing' && through === 'file' && audio.duration ? `${Math.min(100, (audio.currentTime / audio.duration) * 100)}%` : hearing === 'nothing' && !line ? '0' : now.fill.style.width;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    stopBar = () => (ticking = false);
    const play = button('', '', playPause);
    const again = button(icon(ICON.again), 'Say this again', () => say(line));
    const autoButton = button('Auto', 'Move on when the narration ends (A)', () => setAuto(!auto));
    const captionButton = button('Text', 'Show the words being said (C)', () => setCaptions(!captions));
    const fileButton = button('', 'Files for this slide', () => (files.style.display = files.style.display === 'block' ? 'none' : 'block'));
    const showButton = button('Show me', '', () => void drive('show'));
    const turnButton = button('My turn', '', () => void drive('turn'));
    const checkButton = button('Check', '', () => void drive('check'));
    const liveButtons = [showButton, turnButton, checkButton];
    for (const b of liveButtons) b.className = 'wag-live';
    const livePanel = document.createElement('div');
    livePanel.className = 'wag-bar-live';
    const askPanel = document.createElement('div');
    askPanel.className = 'wag-bar-ask';
    const askLog = document.createElement('div');
    askLog.className = 'wag-bar-ask-log';
    const askForm = document.createElement('form');
    const askBox = document.createElement('input');
    askBox.placeholder = 'Ask about this step or the page';
    askBox.setAttribute('aria-label', 'Ask the guide');
    const askSend = document.createElement('button');
    askSend.textContent = 'Ask';
    askForm.append(askBox, askSend);
    askPanel.append(askLog, askForm);
    askForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = askBox.value;
      askBox.value = '';
      void askGuide(text);
    });
    askBox.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      askOpen = false;
      askBox.blur();
      drawBar();
    });
    openAsk = () => {
      askOpen = true;
      files.style.display = 'none';
      drawBar();
      askBox.focus();
    };
    const askButton = button('Ask', 'Ask the guide about this step or the page (/)', () => (askOpen ? ((askOpen = false), drawBar()) : openAsk()));
    askButton.className = 'wag-ask';
    row.append(prev, count, next, title, ...liveButtons, askButton, play, again, speedButton, autoButton, captionButton, time, fileButton);
    bar.append(lineEl, timeline, row, files, livePanel, askPanel);

    // big arrows at the sides of the slide while the mouse moves over it
    const edges = [
      [goBack, ICON.prev, 'Back', 'left'],
      [() => player.next(), ICON.next, 'Next', 'right'],
    ] as const;
    const edgeButtons = edges.map(([act, d, label, side]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wag-edge';
      b.title = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
      b.style[side] = '14px';
      b.addEventListener('click', () => {
        act();
        b.blur();
      });
      root.append(b);
      return b;
    });
    let idle = 0;
    const wake = () => {
      for (const b of edgeButtons) b.classList.add('on');
      window.clearTimeout(idle);
      idle = window.setTimeout(() => edgeButtons.forEach((b) => b.classList.remove('on')), 2200);
    };
    root.addEventListener('pointermove', wake);
    placeEdges = (middle: number) => edgeButtons.forEach((b) => (b.style.top = `${middle}px`));

    // say once how to move, then get out of the way
    const hint = document.createElement('div');
    hint.className = 'wag-hint';
    hint.innerHTML = '<b>Back</b> and <b>Next</b>, or the left and right arrow keys. <b>Space</b> pauses the voice. Click the strip at the bottom to jump.';
    root.append(hint);
    const hideHint = () => (hint.style.opacity = '0');
    window.setTimeout(hideHint, 9000);
    window.addEventListener('keydown', hideHint, { once: true });
    root.addEventListener('pointerdown', hideHint, { once: true });
    placeHint = (fromBottom: number) => (hint.style.bottom = `${fromBottom + 12}px`);

    const start = document.createElement('button');
    start.className = 'wag-start';
    start.innerHTML = `<svg viewBox="0 0 24 24"><path d="${ICON.play}"/></svg>Start with sound`;
    start.addEventListener('click', () => say(line));
    root.append(start);

    for (const b of [play, again, speedButton, autoButton, captionButton]) b.hidden = !narrated;
    buildTimeline();
    fit();

    drawBar = () => {
      const stage = stages[index];
      if (!stage) return;
      const visible = shown();
      const at = visible.indexOf(stage.slide);
      count.textContent = at < 0 ? '' : `${at + 1} / ${visible.length}`;
      // the strip: what is behind, where the deck stands, and the time so far of the whole
      const here = marks.findIndex((m) => m.slide === index && m.step === stage.step);
      marks.forEach((m, i) => {
        m.el.classList.toggle('done', here >= 0 && i < here);
        m.el.classList.toggle('now', i === here);
        if (i !== here) m.fill.style.width = '';
      });
      const sum = (list: typeof marks) => list.reduce((total, m) => total + m.seconds, 0);
      time.textContent = marks.length ? `${clock(sum(marks.slice(0, Math.max(0, here))))} / ${clock(sum(marks))}` : '';
      time.hidden = !narrated;
      speedButton.textContent = `${speed}×`;
      const waiting = countdown - Date.now();
      next.classList.toggle('wag-counting', waiting > 0);
      if (waiting > 0) {
        next.style.setProperty('--wait', `${waiting}ms`);
        next.title = 'Moving on by itself in a moment. Back, or Auto off, stops it.';
      } else next.title = 'Next (right arrow)';
      title.textContent = stage.slide.title ?? deck.title ?? '';
      const going = hearing === 'playing';
      play.innerHTML = icon(going ? ICON.pause : ICON.play, true);
      play.title = going ? 'Pause the narration (P)' : 'Play the narration (P)';
      play.disabled = !line;
      again.disabled = !line;
      autoButton.setAttribute('aria-pressed', String(auto));
      captionButton.setAttribute('aria-pressed', String(captions));
      start.style.display = hearing === 'blocked' ? 'inline-flex' : 'none';

      const show = captions && line ? 'block' : 'none';
      lineEl.textContent = line ?? '';
      if (lineEl.style.display !== show) {
        lineEl.style.display = show;
        fit();
      }

      const live = stage.slide.live;
      const why = bridge === 'up' ? '' : bridge === 'no-browser' ? 'The live browser is not open for driving' : 'The live bridge is not running';
      const parts = [
        [showButton, live?.show, 'The deck does this step on the live page'],
        [turnButton, live?.turn, 'You do it: the deck rings what to click and waits'],
        [checkButton, live?.check, 'Read the live page and say whether it matches'],
      ] as const;
      for (const [b, has, hint] of parts) {
        b.hidden = !has;
        b.disabled = busy || bridge !== 'up';
        b.title = why || hint;
      }
      livePanel.style.display = report ? 'block' : 'none';
      livePanel.replaceChildren();
      if (report) {
        const head = document.createElement('b');
        head.textContent = report.title;
        livePanel.append(head);
        for (const item of report.lines) {
          const row = document.createElement('div');
          row.className = item.kind;
          row.textContent = item.text;
          livePanel.append(row);
        }
      } else if (live && why) {
        // say once, quietly, why the three buttons are off
        livePanel.style.display = 'block';
        const note = document.createElement('small');
        note.textContent = `${why}, so this slide can only be read. Start scripts/live.mjs to drive the page.`;
        livePanel.append(note);
      }

      askButton.hidden = !canAsk;
      askButton.setAttribute('aria-pressed', String(askOpen));
      askPanel.style.display = canAsk && askOpen ? 'flex' : 'none';
      askSend.disabled = asking;
      const lines = [...talk.slice(-8), ...(asking ? [{ who: 'note' as const, text: 'Looking…' }] : [])];
      if (!lines.length) lines.push({ who: 'note', text: 'The guide can see which step you are on and the page. It only looks: it never saves or posts.' });
      askLog.replaceChildren(
        ...lines.map((item) => {
          const p = document.createElement('p');
          p.className = item.who;
          p.textContent = item.text;
          return p;
        })
      );
      askLog.scrollTop = askLog.scrollHeight;

      const offered: Download[] = [...stage.slide.downloads];
      const handout = stage.slide.handout ? handoutFile(deck, stage.slide) : undefined;
      if (handout && made.handouts?.includes(handout)) offered.push({ label: 'This slide as a Word document', href: assetUrl(deck, `handouts/${handout}`) });
      files.replaceChildren();
      const link = (item: Download) => {
        const a = document.createElement('a');
        a.href = item.href;
        a.download = '';
        a.textContent = item.label;
        files.append(a);
      };
      offered.forEach(link);
      if (made.whole) {
        const heading = document.createElement('small');
        heading.textContent = 'The whole walkthrough';
        files.append(heading);
        link({ label: 'Every slide as one Word document', href: assetUrl(deck, made.whole) });
      }
      const total = files.querySelectorAll('a').length;
      fileButton.innerHTML = `${icon(ICON.files)}Files${offered.length ? ` (${offered.length})` : ''}`;
      fileButton.hidden = total === 0;
      if (total === 0) files.style.display = 'none';
    };
    // the handout links and the line lengths depend on what was made, which arrives a moment after the first slide
    void ready.then(() => {
      buildTimeline();
      drawBar();
    });
  }

  function setAuto(on: boolean) {
    auto = on;
    if (!on) window.clearTimeout(timer);
    drawBar();
  }

  function setCaptions(on: boolean) {
    captions = on;
    drawBar();
  }

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
    // one shadow with no blur and a spread wider than any slide: everything outside the element
    if (el.shade) node.style.boxShadow = `0 0 0 4000px ${el.shade}`;
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
    leaveLive();
    if (drives && to.slide.live && bridge !== 'up') void meet();
    history.replaceState(null, '', `#${to.slide.name ?? target + 1}`);
    to.layer.style.display = 'block';

    const kind = from ? ((back ? from : to).slide.transition ?? deck.transition) : 'none';
    enter(to, back, kind === 'morph' && from ? from : undefined);
    // going back is for looking again, so the line waits for the play button
    if (back) rest(lineAt(to));
    else say(lineAt(to));
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
    // in a narrated deck Space pauses and carries on, the way it does in a video
    if (e.key === ' ' && bar && narrated) playPause();
    else if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) player.next();
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) (bar ? goBack : player.prev)();
    else if (e.key === 'r' || e.key === 'R') {
      enter(stages[index], false);
      say(lineAt(stages[index]));
    } else if (bar && (e.key === 'p' || e.key === 'P')) playPause();
    else if (bar && (e.key === 'a' || e.key === 'A')) setAuto(!auto);
    else if (bar && (e.key === 'c' || e.key === 'C')) setCaptions(!captions);
    else if (bar && canAsk && e.key === '/') {
      e.preventDefault();
      openAsk();
    }
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
        say(lineAt(stage));
      } else along(1);
    },
    prev() {
      const stage = stages[index];
      if (stage.step >= 0) {
        const undone = stage.slide.steps[stage.step];
        stage.step--;
        retarget(stage, [undone]);
        rest(lineAt(stage));
      } else along(-1);
    },
    destroy() {
      settle?.();
      hush();
      leaveLive();
      stopBar();
      for (const stage of stages) quiet(stage);
      bar?.remove();
      root.querySelectorAll('.wag-edge, .wag-hint').forEach((el) => el.remove());
      root.querySelector('.wag-start')?.remove();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onHash);
      resize.disconnect();
      frameEl.remove();
    },
  };

  player.go(hashIndex());
  return player;
}
