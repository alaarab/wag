// A full-slide motion piece, written as one scene. This is the pattern for a "motion video"
// in a deck: markup and CSS for the look, then a handful of timed animate() calls.
import { stagger } from 'motion';
import type { SceneSetup } from 'wag';

const css = `
.film { position:absolute; inset:0; overflow:hidden; background:#07060b; color:#f5f3ff; font-family:"Space Grotesk","Segoe UI",system-ui,sans-serif; }
.film .glow { position:absolute; border-radius:50%; filter:blur(90px); opacity:0; }
.film .g1 { width:640px; height:640px; left:-180px; top:-260px; background:#7c3aed; }
.film .g2 { width:520px; height:520px; right:-140px; top:60px; background:#f43f5e; }
.film .g3 { width:600px; height:600px; left:340px; bottom:-400px; background:#0ea5e9; }
.film .grid { position:absolute; inset:0; opacity:0; background-image:linear-gradient(rgba(255,255,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.07) 1px,transparent 1px); background-size:64px 64px; -webkit-mask-image:radial-gradient(ellipse at 28% 42%,#000 0%,transparent 68%); mask-image:radial-gradient(ellipse at 28% 42%,#000 0%,transparent 68%); }
.film .eyebrow { position:absolute; left:90px; top:84px; font-size:15px; font-weight:500; letter-spacing:.32em; text-transform:uppercase; color:#c4b5fd; opacity:0; white-space:nowrap; }
.film h1 { position:absolute; left:84px; top:118px; margin:0; font-size:124px; line-height:1; font-weight:700; letter-spacing:-.045em; white-space:nowrap; }
.film .line { display:block; overflow:hidden; padding:0 .1em .12em 0; margin-bottom:-.12em; }
.film .word { display:inline-block; }
.film .serif { font-family:"Instrument Serif",Georgia,serif; font-style:italic; font-weight:400; letter-spacing:-.02em; padding-right:.1em; background:linear-gradient(100deg,#fda4af,#c4b5fd 55%,#7dd3fc); -webkit-background-clip:text; background-clip:text; color:transparent; }
.film .rule { position:absolute; left:90px; top:512px; width:440px; height:24px; overflow:visible; }
.film .rule path { fill:none; stroke:url(#film-stroke); stroke-width:5; stroke-linecap:round; stroke-dasharray:1; stroke-dashoffset:1; }
.film .lede { position:absolute; left:90px; top:552px; width:480px; margin:0; font-size:22px; line-height:1.45; color:#a8a3b8; opacity:0; }
.film .cards { position:absolute; left:780px; top:150px; width:300px; height:380px; }
.film .card { position:absolute; inset:0; border-radius:28px; padding:28px; box-sizing:border-box; opacity:0; display:flex; flex-direction:column; justify-content:space-between; transform-origin:50% 130%; cursor:pointer; box-shadow:0 40px 80px -30px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.28); }
.film .c1 { background:linear-gradient(160deg,#4c1d95,#8b5cf6); }
.film .c2 { background:linear-gradient(160deg,#9f1239,#fb7185); }
.film .c3 { background:linear-gradient(160deg,#0c4a6e,#38bdf8); }
.film .card b { font-size:14px; letter-spacing:.22em; text-transform:uppercase; font-weight:500; opacity:.85; }
.film .card strong { font-size:60px; font-weight:700; letter-spacing:-.04em; line-height:1; }
.film .card span { font-size:17px; line-height:1.35; opacity:.9; }
.film .hint { position:absolute; left:90px; bottom:40px; font-size:13px; letter-spacing:.22em; text-transform:uppercase; color:#6b6880; opacity:0; }
`;

const cards = [
  { label: 'Springs', title: 'Bounce', note: 'Real physics, interruptible mid-flight.', x: -74, rotate: -9 },
  { label: 'States', title: 'React', note: 'Layouts that answer the pointer.', x: 0, rotate: 0 },
  { label: 'Scenes', title: 'Anything', note: 'Free-form Motion code in a slide.', x: 74, rotate: 9 },
];

export const film: SceneSetup = (root, { animate }) => {
  const words = (text: string) => text.split(' ').map((w) => `<span class="word">${w}</span>`).join(' ');
  root.innerHTML = `
    <style>${css}</style>
    <div class="film">
      <div class="glow g1"></div><div class="glow g2"></div><div class="glow g3"></div>
      <div class="grid"></div>
      <div class="eyebrow">wag · motion scenes</div>
      <h1>
        <span class="line">${words('Slides')}</span>
        <span class="line">${words('that')} <span class="word serif">move</span></span>
        <span class="line">${words('like film.')}</span>
      </h1>
      <svg class="rule" viewBox="0 0 440 24">
        <defs><linearGradient id="film-stroke" x1="0" x2="1"><stop offset="0" stop-color="#fda4af"/><stop offset="1" stop-color="#7dd3fc"/></linearGradient></defs>
        <path pathLength="1" d="M3 14 C 90 2, 180 24, 280 10 S 400 6, 437 12"/>
      </svg>
      <p class="lede">Any Motion code, running inside a slide. Open a deck the way a film opens.</p>
      <div class="cards">
        ${cards.map((c, i) => `<div class="card c${i + 1}"><b>${c.label}</b><div><strong>${c.title}</strong><br><span>${c.note}</span></div></div>`).join('')}
      </div>
      <div class="hint">Hover a card · press R to replay</div>
    </div>`;

  const out = [0.16, 1, 0.3, 1] as const;

  // light comes up, then drifts for as long as the slide is showing
  animate('.glow', { opacity: [0, 0.6], scale: [0.6, 1] }, { duration: 2.4, ease: 'easeOut', delay: stagger(0.18) });
  animate('.grid', { opacity: [0, 1] }, { duration: 1.8, delay: 0.3 });
  [['.g1', 70, 50, 11], ['.g2', -60, 70, 13], ['.g3', 50, -60, 9]].forEach(([glow, x, y, seconds]) =>
    animate(glow as string, { x: [0, x as number], y: [0, y as number] }, { duration: seconds as number, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' })
  );

  // type rises out of its own line, one word after another
  animate('.eyebrow', { opacity: [0, 1], letterSpacing: ['0.8em', '0.32em'] }, { duration: 1.2, ease: out, delay: 0.15 });
  animate('.word', { y: ['118%', '0%'] }, { duration: 1.05, ease: out, delay: stagger(0.09, { startDelay: 0.3 }) });
  animate('.serif', { rotate: [0, -5, 0], scale: [1, 1.1, 1] }, { duration: 0.9, ease: 'easeInOut', delay: 1.3 });
  animate('.rule path', { strokeDashoffset: [1, 0] }, { duration: 1, ease: out, delay: 1.25 });
  animate('.lede', { opacity: [0, 1], y: [18, 0] }, { duration: 0.9, ease: out, delay: 1.45 });

  // the cards swing up into a fan, and lift when hovered
  root.querySelectorAll<HTMLElement>('.card').forEach((card, i) => {
    const rest = cards[i];
    animate(card, { opacity: [0, 1], y: [160, 0], x: [0, rest.x], rotate: [24, rest.rotate] }, { type: 'spring', stiffness: 120, damping: 15, delay: 0.95 + i * 0.12 });
    const lift = (y: number, scale: number, z: string) => {
      card.style.zIndex = z;
      animate(card, { y, scale }, { type: 'spring', stiffness: 300, damping: 20 });
    };
    card.addEventListener('pointerenter', () => lift(-28, 1.06, '2'));
    card.addEventListener('pointerleave', () => lift(0, 1, ''));
  });

  animate('.hint', { opacity: [0, 1] }, { duration: 1.2, delay: 2.8 });
};
