// Afficheur à lames rotatives : chaque caractère est une lame qui bascule d'une valeur à la suivante.
const CHARSET = ' 0123456789';
export const LABEL_CHARSET = ' D0123456789';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// Petit « clac » synthétique, limité en cadence (plusieurs lames tournent en même temps).
let audio = null;
let lastTick = 0;
export const sound = { on: true };
export function unlockAudio() {
  try { audio ||= new AudioContext(); if (audio.state === 'suspended') audio.resume(); } catch { /* pas de son */ }
}
function tick() {
  const now = performance.now();
  if (!sound.on || !audio || now - lastTick < 35) return;
  lastTick = now;
  const len = Math.floor(audio.sampleRate * 0.025);
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = audio.createBufferSource();
  const filt = audio.createBiquadFilter();
  const gain = audio.createGain();
  filt.type = 'bandpass'; filt.frequency.value = 1800;
  gain.gain.value = 0.25;
  src.buffer = buf;
  src.connect(filt).connect(gain).connect(audio.destination);
  src.start();
}

const half = (cls) => {
  const h = document.createElement('div');
  h.className = 'half ' + cls;
  h.appendChild(document.createElement('span'));
  return h;
};
const setText = (h, ch) => { h.firstChild.textContent = ch; };

export class Flap {
  constructor(charset = CHARSET) {
    this.charset = charset;
    this.value = charset[0];
    this.el = document.createElement('div');
    this.el.className = 'flap';
    this.top = half('top');
    this.bottom = half('bottom');
    this.leafTop = half('top leaf');
    this.leafBottom = half('bottom leaf');
    this.queue = Promise.resolve();
    this.el.append(this.top, this.bottom, this.leafTop, this.leafBottom);
    this.show(this.value);
  }

  show(ch) {
    this.value = ch;
    for (const h of [this.top, this.bottom, this.leafTop, this.leafBottom]) setText(h, ch);
    this.el.classList.remove('go');
  }

  async step(next, ms) {
    const old = this.value;
    setText(this.top, next);
    setText(this.leafTop, old);
    setText(this.leafBottom, next);
    this.el.style.setProperty('--step', ms + 'ms');
    this.el.classList.remove('go');
    void this.el.offsetWidth;
    this.el.classList.add('go');
    tick();
    await sleep(ms);
    setText(this.bottom, next);
    this.value = next;
  }

  // Tourne de lame en lame (cycle du jeu de caractères) jusqu'à `target`, après `delay` pas,
  // en faisant au moins `extra` pas.
  // Les demandes sont mises en file : une lame ne tourne jamais pour deux cibles à la fois.
  spinTo(target, opts) {
    this.queue = this.queue.then(() => this._spin(target, opts));
    return this.queue;
  }

  async _spin(target, { extra = 0, delay = 0, ms = 55 } = {}) {
    if (reduced.matches) { this.show(target); return; }
    const n = this.charset.length;
    const from = this.charset.indexOf(this.value);
    const to = this.charset.indexOf(target);
    const dist = (to - from + n) % n;
    const steps = dist + Math.ceil(extra / n) * n;
    await sleep(delay * ms);
    for (let i = 1; i <= steps; i++) await this.step(this.charset[(from + i) % n], ms);
  }
}

// Rangée de lames affichant `text` (largeur fixe `width`, complétée par des blancs à gauche).
export class Board {
  constructor(container, width, charset = CHARSET) {
    this.flaps = Array.from({ length: width }, () => new Flap(charset));
    container.replaceChildren(...this.flaps.map((f) => f.el));
  }

  async set(value, { extra = 8, delay = 0, align = 'end' } = {}) {
    const text = align === 'end' ? String(value).padStart(this.flaps.length, ' ') : String(value).padEnd(this.flaps.length, ' ');
    await Promise.all(this.flaps.map((f, i) => f.spinTo(text[i], { extra: extra + i * 3, delay: delay + i * 2 })));
  }
}
