// Afficheur à segments (LED orange sur fond noir, comme les afficheurs d'un panneau radio d'avion).
// Caractères pris en charge : chiffres, « d », « - » et l'espace.
const NS = 'http://www.w3.org/2000/svg';
const SEGMENTS = {
  a: '1.2,0 8.8,0 7.4,1.8 2.6,1.8',
  b: '10,1.2 8.2,2.8 8.2,7.6 10,8.8',
  c: '10,9.2 8.2,10.4 8.2,15.2 10,16.8',
  d: '1.2,18 8.8,18 7.4,16.2 2.6,16.2',
  e: '0,9.2 1.8,10.4 1.8,15.2 0,16.8',
  f: '0,1.2 1.8,2.8 1.8,7.6 0,8.8',
  g: '1.2,9 2.6,7.2 7.4,7.2 8.8,9 7.4,10.8 2.6,10.8',
};
const GLYPHS = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd',
  6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', d: 'bcdeg', '-': 'g', ' ': '',
};
const CELL = 13; // largeur d'une case (10 + espacement)

export class Led {
  constructor(container, digits) {
    this.cells = [];
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `-2 -1 ${digits * CELL + 3} 20`);
    svg.setAttribute('class', 'led-svg');
    svg.setAttribute('aria-hidden', 'true');
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('transform', 'skewX(-6) translate(1.2 0)');
    for (let i = 0; i < digits; i++) {
      const cell = {};
      for (const [name, pts] of Object.entries(SEGMENTS)) {
        const p = document.createElementNS(NS, 'polygon');
        p.setAttribute('points', pts);
        p.setAttribute('transform', `translate(${i * CELL} 0)`);
        p.setAttribute('class', 'seg');
        g.appendChild(p);
        cell[name] = p;
      }
      this.cells.push(cell);
    }
    svg.appendChild(g);
    container.replaceChildren(svg);
    this.container = container;
  }

  set(text) {
    const s = String(text).padStart(this.cells.length, ' ');
    this.cells.forEach((cell, i) => {
      const on = GLYPHS[s[i]] ?? '';
      for (const name of Object.keys(SEGMENTS)) cell[name].classList.toggle('on', on.includes(name));
    });
    this.container.setAttribute('aria-label', String(text));
  }

  dim(d) { this.container.classList.toggle('dim', d); }
}
