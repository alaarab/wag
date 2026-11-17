// Dev app: plays decks/<name>.ts at /?deck=<name>, and lists every deck at /.
import { FONTS, fresh, mount, type Deck, type Mood, type Theme } from 'wag';

import outside from 'virtual:wag-decks';

const inside = import.meta.glob<{ default: Deck }>('../decks/*.ts');
// decks from the WAG_DECKS folder are listed with the repo's own, and win when a name is in both
const loaders: Record<string, () => Promise<{ default: Deck }>> = {
  ...Object.fromEntries(Object.entries(inside).map(([path, loader]) => [path.slice(path.lastIndexOf('/') + 1, -'.ts'.length), loader])),
  ...outside,
};
const names = Object.keys(loaders).sort();
const load = (name: string) => loaders[name]();

const app = document.getElementById('app')!;
const wanted = new URLSearchParams(location.search).get('deck');

function page(...children: (HTMLElement | string)[]) {
  const wrap = document.createElement('div');
  wrap.style.cssText = `max-width:760px;margin:0 auto;padding:88px 32px;color:#f6f4ff;font:17px/1.5 ${FONTS.body}`;
  wrap.append(...children);
  app.replaceChildren(wrap);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, content: string) {
  const node = document.createElement(tag);
  node.style.cssText = css;
  node.textContent = content;
  return node;
}

/** Build the deck's .pptx in the browser and hand it over as a download. */
async function download(name: string, button: HTMLButtonElement) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Building…';
  try {
    // the exporter is loaded on demand: playing a deck never needs it
    const [{ toPptx }, module] = await Promise.all([import('../src/pptx'), load(name)]);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await toPptx(module.default));
    link.download = `${name}.pptx`;
    link.click();
    // revoking straight away cancels the download before the browser has started it
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    button.textContent = label;
  } catch (error) {
    button.textContent = 'Failed';
    button.title = error instanceof Error ? error.message : String(error);
    console.error(error);
  }
  button.disabled = false;
}

function list(note?: string) {
  const rows = names.map((name) => {
    const row = el('div', 'display:flex;gap:10px;margin:10px 0', '');
    const open = el('a', `flex:1;display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-radius:16px;background:#15131f;border:1px solid #272438;color:#f6f4ff;text-decoration:none;font:600 19px ${FONTS.body};transition:border-color .2s,transform .2s`, name);
    open.href = `?deck=${encodeURIComponent(name)}`;
    open.append(el('span', `font:500 12px ${FONTS.mono};letter-spacing:.16em;text-transform:uppercase;color:#6f6a8a`, 'Play'));
    open.addEventListener('pointerenter', () => Object.assign(open.style, { borderColor: '#8ab4ff', transform: 'translateX(4px)' }));
    open.addEventListener('pointerleave', () => Object.assign(open.style, { borderColor: '#272438', transform: '' }));
    const save = el('button', `padding:0 22px;border:1px solid #272438;border-radius:16px;background:transparent;color:#b3aecb;font:500 15px ${FONTS.body};cursor:pointer`, 'Download .pptx');
    save.addEventListener('click', () => download(name, save));
    row.append(open, save);
    return row;
  });
  const lookLink = el('a', 'display:inline-block;margin-top:8px;color:#8ab4ff;font-size:15px', 'Find a look for it: fresh looks →');
  lookLink.href = '?looks';
  const name = el('h1', `margin:0;font:800 112px/0.9 ${FONTS.display};letter-spacing:-.055em`, 'wag');
  const tail = el('div', 'width:190px;height:9px;margin:10px 0 30px 4px;border-radius:9px;background:linear-gradient(100deg,#ffb86b,#ff7eb6 52%,#8ab4ff)', '');
  page(
    name,
    tail,
    el('p', `margin:0 0 26px;font:500 13px ${FONTS.mono};letter-spacing:.16em;text-transform:uppercase;color:#6f6a8a`, note ?? `${names.length} deck${names.length === 1 ? '' : 's'}`),
    ...rows,
    el('p', 'margin:30px 0 0;color:#6f6a8a;font-size:15px', 'New deck: npm run new <name>'),
    lookLink
  );
}

// ---------- looks: fresh() from many words, side by side ----------

const WORDS = ['amber', 'harbour', 'velvet', 'signal', 'orchard', 'neon', 'quiet', 'summit', 'paper', 'comet', 'tide', 'ember', 'atlas', 'linen', 'static', 'meadow', 'cobalt', 'fable', 'cinder', 'lagoon', 'prism', 'saffron', 'drift', 'granite'];
const MOODS: (Mood | '')[] = ['', 'calm', 'bold', 'playful', 'serious', 'warm', 'cool'];

/** A look as a card: its ground, a headline in its type with a marked word, text, a label, its gradient and colours. */
function specimen(seed: string, look: Theme) {
  // a font stack's own quotes are double, which would end a style attribute: written with single ones
  const q = (stack: string) => stack.replace(/"/g, "'");
  const t = { ...look, display: q(look.display), body: q(look.body), mono: q(look.mono), marked: look.marked && { ...look.marked, font: look.marked.font && q(look.marked.font) } };
  const card = document.createElement('div');
  card.style.cssText = `border-radius:18px;overflow:hidden;background:${t.bg};border:1px solid ${t.line};display:flex;flex-direction:column`;
  const accent: NonNullable<Theme['marked']> = t.marked ?? {};
  const mark = `font-family:${accent.font ?? t.display};${accent.italic ? 'font-style:italic;' : ''}${accent.weight ? `font-weight:${accent.weight};` : ''}${accent.gradient ? `background:${accent.gradient};-webkit-background-clip:text;background-clip:text;color:transparent;` : `color:${accent.color ?? t.accent};`}`;
  const top = document.createElement('div');
  top.style.cssText = `flex:1;position:relative;padding:26px 26px 20px;background:radial-gradient(120% 90% at 0% 0%, ${t.glow[0]}55, transparent 60%), radial-gradient(90% 80% at 100% 10%, ${t.glow[1]}44, transparent 60%), ${t.bg}`;
  top.innerHTML = `
    <div style="font:500 11px ${t.mono};letter-spacing:.18em;text-transform:uppercase;color:${t.faint}">${seed}</div>
    <div style="margin-top:10px;font-family:${t.display};font-weight:800;font-size:38px;line-height:1.02;letter-spacing:-.035em;color:${t.ink}">Slides that <span style="${mark}">move.</span></div>
    <div style="margin-top:10px;font:16px/1.45 ${t.body};color:${t.dim}">One file, a voice, a video. Made from a single word.</div>
    <div style="display:flex;gap:10px;margin-top:16px;align-items:stretch">
      <div style="flex:1;padding:12px 14px;border-radius:12px;background:${t.panel};border:1px solid ${t.line}">
        <div style="font:500 10px ${t.mono};letter-spacing:.16em;text-transform:uppercase;color:${t.faint}">Sign-ups</div>
        <div style="font-family:${t.display};font-weight:800;font-size:26px;letter-spacing:-.03em;color:${t.ink}">3,906 <span style="font:600 11px ${t.mono};color:${t.good}">+12%</span></div>
      </div>
      <div style="width:92px;border-radius:12px;background:${t.gradient}"></div>
    </div>`;
  const bottom = document.createElement('div');
  bottom.style.cssText = `display:flex;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid ${t.line};background:${t.panel}`;
  const swatches = [t.accent, t.ink, t.dim, t.good, t.warn, t.bad].map((c) => `<span style="width:16px;height:16px;border-radius:50%;background:${c};border:1px solid ${t.line}"></span>`).join('');
  bottom.innerHTML = `${swatches}<span style="flex:1"></span>`;
  const button = (label: string, act: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `padding:6px 12px;border-radius:999px;border:1px solid ${t.line};background:transparent;color:${t.ink};font:500 13px ${t.body};cursor:pointer`;
    b.addEventListener('click', act);
    bottom.append(b);
    return b;
  };
  const copy = button('Copy', () => {
    void navigator.clipboard?.writeText(`fresh(${JSON.stringify(seed)}${mood ? `, { mood: '${mood}' }` : ''})`);
    copy.textContent = 'Copied';
  });
  button('Play', () => (location.href = `?deck=looks&look=${encodeURIComponent(seed)}`));
  // a look for good: the theme itself, which no later wag will change
  const keep = button('Keep', () => {
    void navigator.clipboard?.writeText(`const t: Theme = ${JSON.stringify(look, null, 2)};`);
    keep.textContent = 'Copied';
  });
  keep.title = 'Copy this look as a plain theme, to keep it as it is';
  card.title = look.name ?? '';
  card.append(top, bottom);
  return card;
}

let mood: Mood | '' = '';
function looks() {
  const wrap = document.createElement('div');
  wrap.style.cssText = `max-width:1240px;margin:0 auto;padding:56px 28px;color:#f6f4ff;font:16px/1.5 ${FONTS.body}`;
  const head = el('h1', `margin:0 0 6px;font:800 56px/1 ${FONTS.display};letter-spacing:-.04em`, 'Fresh looks');
  const sub = el('p', 'margin:0 0 24px;color:#b3aecb', "Every word makes its own look. Pick one, copy it into your deck as fresh('word'), or type your own.");
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:26px';
  const input = document.createElement('input');
  input.placeholder = 'Your own word, then Enter';
  input.style.cssText = `flex:1;min-width:220px;padding:12px 16px;border-radius:12px;border:1px solid #272438;background:#15131f;color:#f6f4ff;font:16px ${FONTS.body}`;
  const select = document.createElement('select');
  select.style.cssText = `padding:12px;border-radius:12px;border:1px solid #272438;background:#15131f;color:#f6f4ff;font:15px ${FONTS.body}`;
  for (const m of MOODS) select.append(new Option(m ? `Mood: ${m}` : 'Any mood', m));
  select.value = mood;
  const shuffle = el('button', `padding:12px 20px;border-radius:12px;border:0;background:#8ab4ff;color:#0b0a12;font:700 15px ${FONTS.body};cursor:pointer`, 'Shuffle');
  bar.append(input, select, shuffle);
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px';
  const draw = (seeds: string[]) => grid.replaceChildren(...seeds.map((seed) => specimen(seed, fresh(seed, mood ? { mood } : {}))));
  const random = () => Array.from({ length: 12 }, () => `${WORDS[Math.floor(Math.random() * WORDS.length)]} ${Math.floor(Math.random() * 90 + 10)}`);
  let seeds = random();
  shuffle.addEventListener('click', () => draw((seeds = random())));
  select.addEventListener('change', () => {
    mood = select.value as Mood | '';
    draw(seeds);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    seeds = [input.value.trim(), ...seeds.slice(0, 11)];
    draw(seeds);
  });
  draw(seeds);
  wrap.append(head, sub, bar, grid);
  app.replaceChildren(wrap);
  app.style.overflow = 'auto';
}

if (new URLSearchParams(location.search).has('looks')) {
  looks();
} else if (!wanted) {
  list();
} else if (!names.includes(wanted)) {
  list(`No deck called "${wanted}". These exist:`);
} else {
  try {
    const module = await load(wanted);
    document.title = `${module.default.title ?? wanted} · wag`;
    // ?video: npm run video starts the deck itself, once the page is ready and its clock is held
    if (new URLSearchParams(location.search).has('video')) (window as unknown as { wagVideo: unknown }).wagVideo = { deck: module.default, start: () => mount(module.default, app, { video: true }) };
    else mount(module.default, app);
  } catch (error) {
    // deck files are code, so a typo should say what is wrong instead of leaving a blank page
    page(
      el('h1', `font:800 34px ${FONTS.display};letter-spacing:-.03em;margin:0 0 12px`, `decks/${wanted}.ts did not load`),
      el('pre', `white-space:pre-wrap;color:#ff7a8a;font:15px/1.5 ${FONTS.mono}`, error instanceof Error ? error.message : String(error))
    );
  }
}
