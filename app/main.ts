// Dev app: plays decks/<name>.ts at /?deck=<name>, and lists every deck at /.
import { mount, type Deck } from 'wag';

const loaders = import.meta.glob<{ default: Deck }>('../decks/*.ts');
const names = Object.keys(loaders)
  .map((path) => path.slice(path.lastIndexOf('/') + 1, -'.ts'.length))
  .sort();
const load = (name: string) => loaders[`../decks/${name}.ts`]();

const app = document.getElementById('app')!;
const wanted = new URLSearchParams(location.search).get('deck');

function page(...children: (HTMLElement | string)[]) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'max-width:720px;margin:0 auto;padding:72px 32px;color:#f8fafc;font:18px/1.5 Inter,"Segoe UI",system-ui,sans-serif';
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
    const open = el('a', 'flex:1;padding:18px 22px;border-radius:14px;background:#1e293b;color:#f8fafc;text-decoration:none;font-weight:600', name);
    open.href = `?deck=${encodeURIComponent(name)}`;
    const save = el('button', 'padding:0 22px;border:0;border-radius:14px;background:#38bdf8;color:#0f172a;font:inherit;font-weight:700;cursor:pointer', 'Download .pptx');
    save.addEventListener('click', () => download(name, save));
    row.append(open, save);
    return row;
  });
  page(
    el('h1', 'font-size:56px;margin:0 0 4px;font-weight:800', 'wag'),
    el('p', 'margin:0 0 28px;color:#94a3b8', note ?? `${names.length} deck${names.length === 1 ? '' : 's'} in decks/`),
    ...rows,
    el('p', 'margin:28px 0 0;color:#94a3b8;font-size:15px', 'New deck: npm run new <name>')
  );
}

if (!wanted) {
  list();
} else if (!names.includes(wanted)) {
  list(`No deck called "${wanted}". These exist:`);
} else {
  try {
    const module = await load(wanted);
    document.title = `${wanted} · wag`;
    mount(module.default, app);
  } catch (error) {
    // deck files are code, so a typo should say what is wrong instead of leaving a blank page
    page(
      el('h1', 'font-size:28px;margin:0 0 12px', `decks/${wanted}.ts did not load`),
      el('pre', 'white-space:pre-wrap;color:#fca5a5;font:15px/1.5 ui-monospace,Consolas,monospace', error instanceof Error ? error.message : String(error))
    );
  }
}
