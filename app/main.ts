// Dev app: plays decks/<name>.ts at /?deck=<name>, and lists every deck at /.
import { FONTS, mount, type Deck } from 'wag';

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
  const name = el('h1', `margin:0;font:800 112px/0.9 ${FONTS.display};letter-spacing:-.055em`, 'wag');
  const tail = el('div', 'width:190px;height:9px;margin:10px 0 30px 4px;border-radius:9px;background:linear-gradient(100deg,#ffb86b,#ff7eb6 52%,#8ab4ff)', '');
  page(
    name,
    tail,
    el('p', `margin:0 0 26px;font:500 13px ${FONTS.mono};letter-spacing:.16em;text-transform:uppercase;color:#6f6a8a`, note ?? `${names.length} deck${names.length === 1 ? '' : 's'}`),
    ...rows,
    el('p', 'margin:30px 0 0;color:#6f6a8a;font-size:15px', 'New deck: npm run new <name>')
  );
}

if (!wanted) {
  list();
} else if (!names.includes(wanted)) {
  list(`No deck called "${wanted}". These exist:`);
} else {
  try {
    const module = await load(wanted);
    document.title = `${module.default.title ?? wanted} · wag`;
    mount(module.default, app);
  } catch (error) {
    // deck files are code, so a typo should say what is wrong instead of leaving a blank page
    page(
      el('h1', `font:800 34px ${FONTS.display};letter-spacing:-.03em;margin:0 0 12px`, `decks/${wanted}.ts did not load`),
      el('pre', `white-space:pre-wrap;color:#ff7a8a;font:15px/1.5 ${FONTS.mono}`, error instanceof Error ? error.message : String(error))
    );
  }
}
