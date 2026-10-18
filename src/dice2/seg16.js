// Afficheur à 16 segments (vert sur noir) : grille de caractères lumineux, segments éteints encore visibles.
// Caractères pris en charge : chiffres, lettres (sans accent), « : », « - », « = », « / » et l'espace.
const NS = 'http://www.w3.org/2000/svg';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const mx = (p) => p.map(([x, y]) => [12 - x, y]);
const my = (p) => p.map(([x, y]) => [x, 20 - y]);
const bar = (a, b, w = 1.5) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  const nx = (-dy / l) * (w / 2);
  const ny = (dx / l) * (w / 2);
  return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]];
};
const A1 = [[1.2, 0.9], [2.1, 0], [5.6, 0], [5.6, 1.8], [2.1, 1.8]];
const B = [[10.3, 2.3], [12, 1.2], [12, 8.9], [11.15, 9.6], [10.3, 8.9]];
const G1 = [[1.3, 10], [2.2, 9.1], [5.6, 9.1], [5.6, 10.9], [2.2, 10.9]];
const I = [[5.1, 2.4], [6.9, 2.4], [6.9, 8.6], [6, 9.2], [5.1, 8.6]];
const SEG = {
  A1, A2: mx(A1), B, C: my(B), D1: my(A1), D2: my(mx(A1)), E: my(mx(B)), F: mx(B),
  G1, G2: mx(G1), I, L: my(I),
  H: bar([2.7, 2.9], [5.0, 8.2]), J: bar([9.3, 2.9], [7.0, 8.2]), K: bar([2.7, 17.1], [5.0, 11.8]), M: bar([9.3, 17.1], [7.0, 11.8]),
};
const NAMES = Object.keys(SEG);
const GLYPHS = Object.fromEntries(Object.entries({
  0: 'A1 A2 B C D1 D2 E F', 1: 'B C', 2: 'A1 A2 B G1 G2 E D1 D2', 3: 'A1 A2 B C D1 D2 G2', 4: 'F G1 G2 B C',
  5: 'A1 A2 F G1 G2 C D1 D2', 6: 'A1 A2 F G1 G2 E C D1 D2', 7: 'A1 A2 B C', 8: 'A1 A2 B C D1 D2 E F G1 G2',
  9: 'A1 A2 B C D1 D2 F G1 G2',
  A: 'A1 A2 B C E F G1 G2', B: 'A1 A2 B C D1 D2 G2 I L', C: 'A1 A2 F E D1 D2', D: 'A1 A2 B C D1 D2 I L',
  E: 'A1 A2 D1 D2 E F G1 G2', F: 'A1 A2 E F G1 G2', G: 'A1 A2 F E D1 D2 C G2', H: 'B C E F G1 G2',
  I: 'A1 A2 D1 D2 I L', J: 'B C D1 D2 E', K: 'E F G1 J M', L: 'E F D1 D2', M: 'B C E F H J', N: 'B C E F H M',
  O: 'A1 A2 B C D1 D2 E F', P: 'A1 A2 B E F G1 G2', Q: 'A1 A2 B C D1 D2 E F M', R: 'A1 A2 B E F G1 G2 M',
  S: 'A1 A2 F G1 G2 C D1 D2', T: 'A1 A2 I L', U: 'B C D1 D2 E F', V: 'E F K J', W: 'B C E F K M', X: 'H J K M',
  Y: 'H J L', Z: 'A1 A2 J K D1 D2', '-': 'G1 G2', '=': 'G1 G2 D1 D2', '/': 'J K', ' ': '', ':': '',
}).map(([k, v]) => [k, new Set(v.split(' ').filter(Boolean))]));

const normalize = (ch) => ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

function template() {
  const el = document.createElement('div');
  el.className = 'ch';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-.4 -.4 12.8 20.8');
  svg.setAttribute('aria-hidden', 'true');
  for (const name of NAMES) {
    const p = document.createElementNS(NS, 'polygon');
    p.setAttribute('points', SEG[name].map((q) => q.join(',')).join(' '));
    p.setAttribute('class', 'seg');
    svg.appendChild(p);
  }
  for (const y of [6.3, 13.7]) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', 6);
    c.setAttribute('cy', y);
    c.setAttribute('r', 1.15);
    c.setAttribute('class', 'dot');
    svg.appendChild(c);
  }
  el.appendChild(svg);
  return el;
}

const POOL = '0123456789ABCDEFGHIJLNOPRSTUY';

export class Seg16 {
  constructor(container, cols, rows) {
    this.cols = cols;
    this.rows = rows;
    container.style.setProperty('--cols', cols);
    const tpl = template();
    this.lines = [];
    this.timers = new Map();
    for (let r = 0; r < rows; r++) {
      const line = document.createElement('div');
      line.className = 'line';
      const cells = [];
      for (let c = 0; c < cols; c++) {
        const el = tpl.cloneNode(true);
        cells.push({ el, polys: [...el.querySelectorAll('polygon')], dots: [...el.querySelectorAll('circle')], ch: null });
        line.appendChild(el);
      }
      container.appendChild(line);
      this.lines.push({ el: line, cells });
    }
  }

  static pad(cols, ...parts) {
    const a = Array(cols).fill(' ');
    for (const [pos, text] of parts) {
      [...text].forEach((ch, i) => {
        const x = pos < 0 ? cols + pos - text.length + i + 1 : pos + i;
        if (x >= 0 && x < cols) a[x] = ch;
      });
    }
    return a.join('');
  }

  setChar(cell, ch) {
    const g = normalize(ch);
    if (cell.ch === g) return;
    cell.ch = g;
    const on = GLYPHS[g] ?? GLYPHS[' '];
    cell.polys.forEach((p, i) => p.classList.toggle('on', on.has(NAMES[i])));
    cell.dots.forEach((d) => d.classList.toggle('on', g === ':'));
  }

  setRow(r, text, { dim = false } = {}) {
    this.cancel(r);
    const line = this.lines[r];
    line.el.dataset.text = text.trimEnd();
    line.el.classList.toggle('dimline', dim);
    line.cells.forEach((cell, c) => this.setChar(cell, text[c] ?? ' '));
  }

  // Annule l'animation d'une ligne ; la promesse en attente est résolue (sinon un `await` resterait bloqué).
  cancel(r) {
    const t = this.timers.get(r);
    if (!t) return;
    clearInterval(t.id);
    this.timers.delete(r);
    t.resolve();
  }

  /** La ligne se met à jour en « brouillant » ses caractères, qui se figent de gauche à droite. */
  scrambleRow(r, text, { ms = 900 } = {}) {
    this.setRow(r, text);
    if (reduced.matches) return Promise.resolve();
    const line = this.lines[r];
    const t0 = performance.now();
    const settle = (c) => (ms * 0.35 * (c + 1)) / this.cols + ms * 0.45;
    return new Promise((resolve) => {
      const id = setInterval(() => {
        const dt = performance.now() - t0;
        let running = false;
        line.cells.forEach((cell, c) => {
          const ch = text[c] ?? ' ';
          if (ch === ' ' || ch === ':') return;
          if (dt >= settle(c)) this.setChar(cell, ch);
          else { running = true; this.setChar(cell, POOL[Math.floor(Math.random() * POOL.length)]); }
        });
        if (!running) this.cancel(r);
      }, 55);
      this.timers.set(r, { id, resolve });
    });
  }
}
