// Bouton rotatif double (deux boutons concentriques, comme sur un panneau radio) : la couronne règle
// le type de dé, le bouton central le nombre de dés. On les tourne à la souris ou au doigt, à la
// molette, ou au clavier (flèches, Début, Fin).
const ARC = 135; // chaque bouton couvre de -135° à +135° (le bas reste libre)

export class Dial {
  /**
   * @param {HTMLElement} el - élément qui tourne (reçoit --a) et qui capte les gestes
   * @param {{options: {value: *, text: string}[], index?: number, onChange?: (option, index) => void}} cfg
   */
  constructor(el, { options, index = 0, onChange }) {
    this.el = el;
    this.options = options;
    this.index = index;
    this.onChange = onChange;
    this.disabled = false;

    el.setAttribute('role', 'slider');
    el.tabIndex = 0;
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', String(options.length - 1));

    el.addEventListener('pointerdown', (e) => {
      if (this.disabled) return;
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.fromPointer(e);
    });
    el.addEventListener('pointermove', (e) => { if (this.dragging) this.fromPointer(e); });
    const stop = () => { this.dragging = false; };
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    el.addEventListener('wheel', (e) => {
      if (this.disabled) return;
      e.preventDefault();
      e.stopPropagation();
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
    this.render();
  }

  static angle(i, n) { return n > 1 ? -ARC + (2 * ARC * i) / (n - 1) : 0; }

  fromPointer(e) {
    const r = this.el.getBoundingClientRect();
    const a = (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
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
    this.el.style.setProperty('--a', Dial.angle(this.index, this.options.length) + 'deg');
    this.el.setAttribute('aria-valuenow', String(this.index));
    this.el.setAttribute('aria-valuetext', this.options[this.index].text);
  }

  get value() { return this.options[this.index].value; }

  setDisabled(d) {
    this.disabled = d;
    this.el.classList.toggle('off', d);
    this.el.tabIndex = d ? -1 : 0;
    this.el.setAttribute('aria-disabled', String(d));
  }
}

export class DualKnob {
  /**
   * @param {HTMLElement} container
   * @param {{outer: object, inner: object}} cfg - configurations de Dial (couronne, bouton central)
   */
  constructor(container, { outer, inner }) {
    container.classList.add('dual');
    container.innerHTML = '<div class="ticks"></div><div class="ring" aria-label="Type de dé"><i class="mark"></i></div>' +
      '<div class="core" aria-label="Nombre de dés"><i class="mark"></i></div>';
    const ticks = container.querySelector('.ticks');
    for (let i = 0; i < outer.options.length; i++) {
      const t = document.createElement('i');
      t.style.setProperty('--a', Dial.angle(i, outer.options.length) + 'deg');
      ticks.appendChild(t);
    }
    this.outer = new Dial(container.querySelector('.ring'), outer);
    this.inner = new Dial(container.querySelector('.core'), inner);
  }
}
