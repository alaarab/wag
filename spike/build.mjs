// Fidelity spike: does stock PowerPoint play Motion-style animation that the UI can't author?
// Builds spike.pptx with four tests:
//   1. spring baked into keyframes (2 vs 15 vs 120 samples)
//   2. staggered spring entrance
//   3. click-triggered spring "pop" on the clicked shape itself
//   4. hover: mouse-over action jumping to a hidden slide through a Morph transition
// PptxGenJS writes the static slides; this script injects the animation XML afterwards.
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { writeFile } from 'node:fs/promises';

const OUT = new URL('./spike.pptx', import.meta.url).pathname;

// ---------- spring maths ----------
const SPRING = { stiffness: 170, damping: 12, mass: 1 };

function springParts({ stiffness, damping, mass }) {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  return { w0, zeta, wd };
}

// 0 -> 1 with overshoot (step response of an under-damped spring)
function springProgress(t, cfg = SPRING) {
  const { w0, zeta, wd } = springParts(cfg);
  const env = Math.exp(-zeta * w0 * t);
  return 1 - env * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
}

// 0 -> kick -> 0 (impulse response), peak normalised to about 1
function springImpulse(t, cfg = SPRING) {
  const { w0, zeta, wd } = springParts(cfg);
  const peakT = Math.atan2(wd, zeta * w0) / wd;
  const peak = Math.exp(-zeta * w0 * peakT) * Math.sin(wd * peakT);
  return (Math.exp(-zeta * w0 * t) * Math.sin(wd * t)) / peak;
}

// ---------- animation XML ----------
const signed = (v) => (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(5);

/** Sample fn(seconds) into a keyframe list. `expr(v)` turns a sample into a PowerPoint formula. */
function tavList(samples, durMs, fn, expr) {
  let out = '';
  for (let i = 0; i < samples; i++) {
    const frac = i / (samples - 1);
    const v = i === samples - 1 ? fn(Infinity) : fn((frac * durMs) / 1000);
    out += `<p:tav tm="${Math.round(frac * 100000)}"><p:val><p:strVal val="${expr(v)}"/></p:val></p:tav>`;
  }
  return `<p:tavLst>${out}</p:tavLst>`;
}

class Timing {
  constructor() {
    this.id = 1; // id 1 is the root node
    this.seqs = [];
    this.built = new Set();
  }
  next() {
    return ++this.id;
  }
  tgt(spid) {
    return `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>`;
  }
  anim(spid, attr, durMs, tavs) {
    return `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${this.next()}" dur="${durMs}" fill="hold"/>${this.tgt(spid)}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr>${tavs}</p:anim>`;
  }
  show(spid) {
    return `<p:set><p:cBhvr><p:cTn id="${this.next()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>${this.tgt(spid)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`;
  }
  fadeIn(spid, durMs) {
    return `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${this.next()}" dur="${durMs}"/>${this.tgt(spid)}</p:cBhvr></p:animEffect>`;
  }
  /** effects: [{ spid, delay, cls: 'entr'|'emph', preset, subtype, build(t) -> xml }] all started by one click on triggerSpid */
  onClick(triggerSpid, effects) {
    const seqId = this.next();
    const outer = this.next();
    const inner = this.next();
    let body = '';
    effects.forEach((e, i) => {
      const effId = this.next();
      this.built.add(e.spid);
      body += `<p:par><p:cTn id="${effId}" presetID="${e.preset}" presetClass="${e.cls}" presetSubtype="${e.subtype ?? 0}" fill="hold" grpId="0" nodeType="${i === 0 ? 'clickEffect' : 'withEffect'}"><p:stCondLst><p:cond delay="${e.delay ?? 0}"/></p:stCondLst><p:childTnLst>${e.build(this)}</p:childTnLst></p:cTn></p:par>`;
    });
    const cond = `<p:cond evt="onClick" delay="0">${this.tgt(triggerSpid)}</p:cond>`;
    this.seqs.push(
      `<p:seq concurrent="1" nextAc="seek"><p:cTn id="${seqId}" restart="whenNotActive" fill="hold" evtFilter="cancelBubble" nodeType="interactiveSeq"><p:stCondLst>${cond}</p:stCondLst><p:endSync evt="end" delay="0"><p:rtn val="all"/></p:endSync><p:childTnLst><p:par><p:cTn id="${outer}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${inner}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${body}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:nextCondLst>${cond}</p:nextCondLst></p:seq>`
    );
  }
  xml() {
    const bld = [...this.built].map((s) => `<p:bldP spid="${s}" grpId="0" animBg="1"/>`).join('');
    return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>${this.seqs.join('')}</p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst>${bld}</p:bldLst></p:timing>`;
  }
}

const morph = (durMs, advClick = true) =>
  `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="p159"><p:transition xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" spd="fast" p14:dur="${durMs}"${advClick ? '' : ' advClick="0"'}><p159:morph option="byObject"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="fast"${advClick ? '' : ' advClick="0"'}><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`;

// ---------- static slides ----------
const C = { bg: '0F172A', panel: '1E293B', ink: 'F8FAFC', dim: '94A3B8', a: '38BDF8', b: 'A78BFA', c: '34D399', d: 'FBBF24' };
const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_16x9'; // 10 x 5.625 in
const FONT = 'Segoe UI';

function base(title, hint) {
  const s = pptx.addSlide();
  s.background = { color: C.bg };
  s.addText(title, { x: 0.5, y: 0.3, w: 9, h: 0.6, fontFace: FONT, fontSize: 26, bold: true, color: C.ink });
  s.addText(hint, { x: 0.5, y: 0.85, w: 9, h: 0.4, fontFace: FONT, fontSize: 13, color: C.dim });
  return s;
}
const button = (s, name, text, x, y) =>
  s.addText(text, { objectName: name, shape: pptx.ShapeType.roundRect, rectRadius: 0.12, x, y, w: 1.5, h: 0.5, fill: { color: C.ink }, color: C.bg, fontFace: FONT, fontSize: 14, bold: true, align: 'center', valign: 'middle' });

// 1. spring fidelity
const s1 = base('1 · Spring baked into keyframes', 'Click Play. Rows 2 and 3 should overshoot and settle. Is row 3 smooth?');
[['2 keyframes (linear)', 'ball2', C.dim], ['15 keyframes', 'ball15', C.b], ['120 keyframes', 'ball120', C.a]].forEach(([label, name, color], i) => {
  const y = 1.6 + i * 1.05;
  s1.addText(label, { x: 0.5, y: y - 0.32, w: 4, h: 0.3, fontFace: FONT, fontSize: 11, color: C.dim });
  s1.addShape(pptx.ShapeType.line, { x: 0.5, y: y + 0.3, w: 9, h: 0, line: { color: C.panel, width: 1 } });
  s1.addShape(pptx.ShapeType.ellipse, { objectName: name, x: 0.6, y, w: 0.6, h: 0.6, fill: { color } });
});
button(s1, 'play1', 'Play', 0.5, 4.8);

// 2. stagger
const s2 = base('2 · Staggered spring entrance', 'Click Play. Six cards should rise in one after another, 70 ms apart, each with a bounce.');
const cardColors = [C.a, C.b, C.c, C.d, C.a, C.b];
cardColors.forEach((color, i) =>
  s2.addShape(pptx.ShapeType.roundRect, { objectName: `card${i}`, rectRadius: 0.1, x: 0.5 + i * 1.52, y: 1.9, w: 1.35, h: 2.2, fill: { color } })
);
button(s2, 'play2', 'Play', 0.5, 4.8);

// 3. click triggers
const s3 = base('3 · Click a card', 'Each card should pop with a springy wobble when you click it, and only that card.');
[C.a, C.b, C.c].forEach((color, i) =>
  s3.addText(['One', 'Two', 'Three'][i], { objectName: `pop${i}`, shape: pptx.ShapeType.roundRect, rectRadius: 0.1, x: 1.0 + i * 2.8, y: 2.0, w: 2.3, h: 2.0, fill: { color }, color: C.bg, fontFace: FONT, fontSize: 22, bold: true, align: 'center', valign: 'middle' })
);

// 4. hover: rest slide + hidden hovered slide
const dog = (s, big) =>
  s.addText('🐶', { objectName: '!!dog', shape: pptx.ShapeType.roundRect, rectRadius: 0.15, x: big ? 3.4 : 3.9, y: big ? 1.75 : 2.2, w: big ? 3.2 : 2.2, h: big ? 3.2 : 2.2, rotate: big ? -6 : 0, fill: { color: big ? C.d : C.panel }, fontSize: big ? 110 : 72, align: 'center', valign: 'middle' });
const s4 = base('4 · Hover the dog', 'No click. Move the mouse onto the dog, then off it. Use the arrow keys to leave this slide.');
dog(s4, false);
const s5 = pptx.addSlide();
s5.hidden = true;
s5.background = { color: C.bg };
// full-slide catcher behind everything: hovering it sends us back to the rest slide
s5.addShape(pptx.ShapeType.rect, { objectName: 'hoverOut', x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.bg } });
s5.addText('4 · Hover the dog', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontFace: FONT, fontSize: 26, bold: true, color: C.ink });
s5.addText('No click. Move the mouse onto the dog, then off it. Use the arrow keys to leave this slide.', { x: 0.5, y: 0.85, w: 9, h: 0.4, fontFace: FONT, fontSize: 13, color: C.dim });
dog(s5, true);
s5.addText('Woof!', { objectName: 'woof', shape: pptx.ShapeType.wedgeRoundRectCallout, x: 6.9, y: 1.4, w: 1.9, h: 0.9, fill: { color: C.ink }, color: C.bg, fontFace: FONT, fontSize: 20, bold: true, align: 'center', valign: 'middle' });

// ---------- inject ----------
const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }));
const path = (n) => `ppt/slides/slide${n}.xml`;
const read = (n) => zip.file(path(n)).async('string');

function spidOf(xml, name) {
  const m = xml.match(new RegExp(`<p:cNvPr id="(\\d+)" name="${name}"`));
  if (!m) throw new Error(`shape "${name}" not found`);
  return m[1];
}
/** transition and timing go after clrMapOvr, in that order */
function inject(xml, extra) {
  if (!xml.includes('</p:clrMapOvr>')) throw new Error('unexpected slide layout: no clrMapOvr');
  return xml.replace('</p:clrMapOvr>', `</p:clrMapOvr>${extra}`);
}
async function addHover(n, shapeName, targetSlide) {
  const relPath = `ppt/slides/_rels/slide${n}.xml.rels`;
  const rid = `rIdHover${targetSlide}`;
  const rels = await zip.file(relPath).async('string');
  zip.file(relPath, rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slide${targetSlide}.xml"/></Relationships>`));
  const xml = await read(n);
  const re = new RegExp(`(<p:cNvPr id="\\d+" name="${shapeName}"[^>]*?)(/>|>)`);
  if (!re.test(xml)) throw new Error(`shape "${shapeName}" not found on slide ${n}`);
  const hover = `<a:hlinkHover r:id="${rid}" action="ppaction://hlinksldjump"/>`;
  zip.file(path(n), xml.replace(re, (_, open, close) => (close === '/>' ? `${open}>${hover}</p:cNvPr>` : `${open}>${hover}`)));
}

const DUR = 1200;
const step = (v) => springProgress(v);

// slide 1
{
  const xml = await read(1);
  const t = new Timing();
  const travel = 0.7; // fraction of slide width
  t.onClick(
    spidOf(xml, 'play1'),
    [['ball2', 2], ['ball15', 15], ['ball120', 120]].map(([name, n]) => {
      const spid = spidOf(xml, name);
      const fn = n === 2 ? (s) => (s === Infinity ? 1 : 0) : step;
      return { spid, cls: 'emph', preset: 6, build: (tm) => tm.anim(spid, 'ppt_x', DUR, tavList(n, DUR, fn, (v) => `#ppt_x${signed(travel * v)}`)) };
    })
  );
  zip.file(path(1), inject(xml, t.xml()));
}
// slide 2
{
  const xml = await read(2);
  const t = new Timing();
  t.onClick(
    spidOf(xml, 'play2'),
    cardColors.map((_, i) => {
      const spid = spidOf(xml, `card${i}`);
      return {
        spid, cls: 'entr', preset: 2, subtype: 4, delay: i * 70,
        build: (tm) => tm.show(spid) + tm.fadeIn(spid, 250) + tm.anim(spid, 'ppt_y', DUR, tavList(60, DUR, step, (v) => `#ppt_y${signed(0.3 * (1 - v))}`)),
      };
    })
  );
  zip.file(path(2), inject(xml, t.xml()));
}
// slide 3
{
  const xml = await read(3);
  const t = new Timing();
  for (let i = 0; i < 3; i++) {
    const spid = spidOf(xml, `pop${i}`);
    const pop = (attr) => t.anim(spid, attr, 900, tavList(60, 900, (s) => (s === Infinity ? 0 : springImpulse(s)), (v) => `#${attr}*${(1 + 0.22 * v).toFixed(5)}`));
    t.onClick(spid, [{ spid, cls: 'emph', preset: 6, build: () => pop('ppt_w') + pop('ppt_h') }]);
  }
  zip.file(path(3), inject(xml, t.xml()));
}
// slides 4 and 5
await addHover(4, '!!dog', 5);
await addHover(5, 'hoverOut', 4);
zip.file(path(4), inject(await read(4), morph(350, false)));
zip.file(path(5), inject(await read(5), morph(350, false)));

await writeFile(OUT, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log('wrote', OUT);
