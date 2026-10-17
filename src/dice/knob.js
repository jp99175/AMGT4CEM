// Bouton rotatif à crans (façon boutons du pilote automatique d'un Boeing) : on le tourne à la souris
// ou au doigt, à la molette, ou au clavier (flèches, Début, Fin).
const ARC = 135; // le bouton couvre de -135° à +135° (le bas reste libre)

export class Knob {
  /**
   * @param {HTMLElement} container
   * @param {{title: string, options: {value: *, label: string, text?: string}[], index?: number,
   *          onChange?: (option, index) => void}} cfg
   */
  constructor(container, { title, options, index = 0, onChange }) {
    this.options = options;
    this.onChange = onChange;
    this.index = index;
    this.disabled = false;

    container.className = 'knob-wrap';
    container.innerHTML = `
      <div class="knob-title"></div>
      <div class="knob" role="slider" tabindex="0">
        <div class="scale"></div>
        <div class="cap"><i class="pointer"></i></div>
      </div>`;
    container.querySelector('.knob-title').textContent = title;
    this.el = container.querySelector('.knob');
    this.cap = container.querySelector('.cap');
    this.wrap = container;
    this.el.setAttribute('aria-label', title);
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', String(options.length - 1));

    const scale = container.querySelector('.scale');
    this.labels = options.map((o, i) => {
      const a = this.angle(i);
      const tick = document.createElement('i');
      tick.className = 'tick';
      tick.style.setProperty('--a', a + 'deg');
      const lab = document.createElement('b');
      lab.className = 'lab';
      lab.style.setProperty('--a', a + 'deg');
      lab.textContent = o.label;
      lab.addEventListener('click', () => this.set(i));
      scale.append(tick, lab);
      return lab;
    });

    this.el.addEventListener('pointerdown', (e) => {
      if (this.disabled) return;
      this.el.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.fromPointer(e);
    });
    this.el.addEventListener('pointermove', (e) => { if (this.dragging) this.fromPointer(e); });
    const stop = () => { this.dragging = false; };
    this.el.addEventListener('pointerup', stop);
    this.el.addEventListener('pointercancel', stop);
    this.el.addEventListener('wheel', (e) => {
      if (this.disabled) return;
      e.preventDefault();
      this.set(this.index + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });
    this.el.addEventListener('keydown', (e) => {
      if (this.disabled) return;
      const k = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (k) this.set(this.index + k);
      else if (e.key === 'Home') this.set(0);
      else if (e.key === 'End') this.set(this.options.length - 1);
      else return;
      e.preventDefault();
    });

    this.render();
  }

  angle(i) {
    const n = this.options.length;
    return n > 1 ? -ARC + (2 * ARC * i) / (n - 1) : 0;
  }

  fromPointer(e) {
    const r = this.el.getBoundingClientRect();
    const a = (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
    if (Math.abs(a) > ARC + 20) return; // zone morte du bas : on garde le cran courant
    const n = this.options.length;
    const clamped = Math.max(-ARC, Math.min(ARC, a));
    this.set(Math.round(((clamped + ARC) / (2 * ARC)) * (n - 1)));
  }

  set(i) {
    i = Math.max(0, Math.min(this.options.length - 1, i));
    if (i === this.index) return;
    this.index = i;
    this.render();
    this.onChange?.(this.options[i], i);
  }

  render() {
    this.cap.style.setProperty('--a', this.angle(this.index) + 'deg');
    this.labels.forEach((l, i) => l.classList.toggle('on', i === this.index));
    const o = this.options[this.index];
    this.el.setAttribute('aria-valuenow', String(this.index));
    this.el.setAttribute('aria-valuetext', o.text || o.label);
  }

  get value() { return this.options[this.index].value; }

  setDisabled(d) {
    this.disabled = d;
    this.wrap.classList.toggle('off', d);
    this.el.tabIndex = d ? -1 : 0;
    this.el.setAttribute('aria-disabled', String(d));
  }
}
