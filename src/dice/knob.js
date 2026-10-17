// Bouton rotatif à crans sur plaque gravée : traits et valeurs imprimés autour d'un bouton cannelé à repère
// noir. On le tourne à la souris ou au doigt (glisser, ou toucher une valeur), à la molette, ou au clavier
// (flèches, Début, Fin). Le bouton (rayon R_FLANGE) ne recouvre jamais les gravures, qui commencent à R_LINE0.
const NS = 'http://www.w3.org/2000/svg';
const ARC = 135; // le bouton couvre de -135° à +135° (le bas reste libre)
const R_FLANGE = 28;
const R_LINE0 = 36;
const R_LINE1 = 50;
const R_TXT = 55;
const C = 100; // centre du bouton dans le repère du dessin (200 × 160)

// Contour festonné (12 cannelures) du corps du bouton.
function scallop(r0, amp, n = 12, steps = 360) {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const r = r0 + amp * Math.cos(n * t);
    d += `${i ? 'L' : 'M'}${(C + r * Math.sin(t)).toFixed(2)} ${(C - r * Math.cos(t)).toFixed(2)}`;
  }
  return `${d}Z`;
}

export class Dial {
  /**
   * @param {SVGSVGElement} svg - élément portant la classe `dial` (viewBox 0 0 200 160)
   * @param {{title: string, options: {value: *, label: string, text: string}[], index?: number,
   *          onChange?: (option, index) => void}} cfg
   */
  constructor(svg, { title, options, index = 0, onChange }) {
    this.svg = svg;
    this.options = options;
    this.index = index;
    this.onChange = onChange;
    this.disabled = false;

    svg.setAttribute('role', 'slider');
    svg.setAttribute('aria-label', title);
    svg.setAttribute('aria-valuemin', '0');
    svg.setAttribute('aria-valuemax', String(options.length - 1));
    svg.tabIndex = 0;
    this.build(title);
    this.listen();
    this.render();
  }

  angle(i) {
    const n = this.options.length;
    return n > 1 ? -ARC + (2 * ARC * i) / (n - 1) : 0;
  }

  build(title) {
    const id = this.svg.id || 'dial';
    let h = `<text class="ttl" x="38" y="14" font-size="17" font-weight="700" letter-spacing="1"></text>`;
    this.options.forEach((o, i) => {
      const a = (this.angle(i) * Math.PI) / 180;
      const s = Math.sin(a);
      const c = Math.cos(a);
      h += `<line data-i="${i}" x1="${C + R_LINE0 * s}" y1="${C - R_LINE0 * c}" x2="${C + R_LINE1 * s}" y2="${C - R_LINE1 * c}"/>`;
      const mid = Math.abs(s) <= 0.3;
      const r = R_TXT + (mid ? 4 : 0);
      const anchor = mid ? 'middle' : s > 0 ? 'start' : 'end';
      const dy = mid ? (c > 0 ? -3 : 11) : 4.5;
      h += `<text class="lab" data-i="${i}" x="${C + r * s}" y="${C - r * c + dy}" text-anchor="${anchor}" font-size="15">${o.label}</text>`;
    });
    h += `<defs>
      <radialGradient id="${id}-fl" cx=".38" cy=".3" r=".9"><stop offset="0" stop-color="#d9dbde"/><stop offset="1" stop-color="#a9acb0"/></radialGradient>
      <radialGradient id="${id}-tp" cx=".38" cy=".3" r=".9"><stop offset="0" stop-color="#eceef0"/><stop offset="1" stop-color="#bfc2c6"/></radialGradient>
      <filter id="${id}-bl"><feGaussianBlur stdDeviation="3"/></filter></defs>
      <circle cx="${C}" cy="${C + 6}" r="${R_FLANGE}" fill="rgba(0,0,0,.5)" filter="url(#${id}-bl)"/>
      <g class="kg">
        <circle cx="${C}" cy="${C}" r="${R_FLANGE}" fill="url(#${id}-fl)" stroke="rgba(0,0,0,.35)" stroke-width="1"/>
        <circle cx="${C}" cy="${C}" r="${R_FLANGE - 2.2}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1"/>
        <path d="${scallop(21.5, 1.5)}" fill="#a7aaae" stroke="rgba(0,0,0,.35)" stroke-width=".9"/>`;
    for (let k = 0; k < 12; k++) {
      const a = ((15 + 30 * k) * Math.PI) / 180;
      h += `<line class="groove" x1="${C + 14 * Math.sin(a)}" y1="${C - 14 * Math.cos(a)}" x2="${C + 20.6 * Math.sin(a)}" y2="${C - 20.6 * Math.cos(a)}"/>`;
    }
    h += `<path d="${scallop(17, 1.1)}" fill="url(#${id}-tp)" stroke="rgba(0,0,0,.25)" stroke-width=".8"/>
        <rect class="pointer" x="98.3" y="${C - R_FLANGE + 1}" width="3.4" height="${R_FLANGE - 5}" rx="1.2"/>
      </g>`;
    this.svg.innerHTML = h;
    this.svg.querySelector('.ttl').textContent = title;
    this.kg = this.svg.querySelector('.kg');
    this.lines = [...this.svg.querySelectorAll('line[data-i]')];
    this.labs = [...this.svg.querySelectorAll('text.lab')];
    // Le titre s'aligne à gauche des textes gravés autour du bouton.
    const left = Math.min(...this.labs.map((t) => t.getBBox().x));
    if (Number.isFinite(left) && left > 0) this.svg.querySelector('.ttl').setAttribute('x', left);
  }

  listen() {
    const el = this.svg;
    el.addEventListener('pointerdown', (e) => {
      if (this.disabled || e.target.closest('.ttl')) return;
      el.setPointerCapture(e.pointerId);
      this.dragging = true;
      const i = e.target.dataset?.i;
      if (i !== undefined) this.set(Number(i));
      else this.fromPointer(e);
    });
    el.addEventListener('pointermove', (e) => { if (this.dragging) this.fromPointer(e); });
    const stop = () => { this.dragging = false; };
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('wheel', (e) => {
      if (this.disabled) return;
      e.preventDefault();
      this.set(this.index + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });
    el.addEventListener('keydown', (e) => {
      if (this.disabled) return;
      const k = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (k) this.set(this.index + k);
      else if (e.key === 'Home') this.set(0);
      else if (e.key === 'End') this.set(this.options.length - 1);
      else return;
      e.preventDefault();
    });
  }

  fromPointer(e) {
    const r = this.svg.getBoundingClientRect();
    const k = r.width / 200;
    const a = (Math.atan2(e.clientX - (r.left + C * k), -(e.clientY - (r.top + C * k))) * 180) / Math.PI;
    if (Math.abs(a) > ARC + 20) return; // zone morte du bas : on garde le cran courant
    const clamped = Math.max(-ARC, Math.min(ARC, a));
    this.set(Math.round(((clamped + ARC) / (2 * ARC)) * (this.options.length - 1)));
  }

  set(i) {
    i = Math.max(0, Math.min(this.options.length - 1, i));
    if (i === this.index) return;
    this.index = i;
    this.render();
    this.onChange?.(this.options[i], i);
  }

  render() {
    this.kg.style.transform = `rotate(${this.angle(this.index)}deg)`;
    this.lines.forEach((l, i) => l.classList.toggle('on', i === this.index));
    this.labs.forEach((t, i) => t.classList.toggle('on', i === this.index));
    this.svg.setAttribute('aria-valuenow', String(this.index));
    this.svg.setAttribute('aria-valuetext', this.options[this.index].text);
  }

  get value() { return this.options[this.index].value; }

  setDisabled(d) {
    this.disabled = d;
    this.svg.classList.toggle('off', d);
    this.svg.tabIndex = d ? -1 : 0;
    this.svg.setAttribute('aria-disabled', String(d));
  }
}
