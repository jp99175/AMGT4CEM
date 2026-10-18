import { Flap, sound, unlockAudio } from './flap.js';
import { Dial } from '../dice/knob.js';
import { Seg16 } from './seg16.js';
import { SLOTS, splitValue, rollSlots, sum, diceName } from './values.js';

const $ = (id) => document.getElementById(id);
const COLS = 18;
const ROWS = 10; // 1 ligne d'en-tête + 9 lignes d'historique
const HISTORY_MAX = 200;
const TENS = [' ', ...Array.from({ length: 11 }, (_, i) => String(i))]; // dizaines : 0 à 10 (« 10 » pour un 100)
const UNITS = [' ', ...Array.from({ length: 10 }, (_, i) => String(i))]; // unités : 0 à 9

const launchBtn = $('pb-launch');
const lcd = new Seg16($('lcd'), COLS, ROWS);
const history = [];
let busy = false;
let lastKind = null;
const current = Array(SLOTS).fill(null);
const held = Array(SLOTS).fill(false);

// ---------- les 12 emplacements : touche HOLD + 2 lames, en 3 colonnes de 4 (1-4, 5-8, 9-12)
const keys = [];
const pairs = [];
const grid = $('flips');
for (let c = 0; c < 3; c++) {
  const grp = document.createElement('div');
  grp.className = 'grp';
  const kcol = document.createElement('div');
  kcol.className = 'kcol';
  const fcol = document.createElement('div');
  fcol.className = 'fcol';
  for (let r = 0; r < 4; r++) {
    const i = c * 4 + r;
    const kr = document.createElement('div');
    kr.className = 'kr';
    kr.innerHTML = `<div class="idx">${i + 1}</div><button class="key" type="button" aria-pressed="false" aria-label="Hold dé ${i + 1}"><span class="face">Hold</span></button>`;
    const key = kr.querySelector('.key');
    key.addEventListener('click', () => toggleHold(i));
    keys[i] = key;
    kcol.appendChild(kr);
    const pair = document.createElement('div');
    pair.className = 'pair';
    const tens = new Flap(TENS);
    const units = new Flap(UNITS);
    pair.append(tens.el, units.el);
    pair.dataset.value = '';
    pairs[i] = { el: pair, tens, units };
    fcol.appendChild(pair);
  }
  grp.append(kcol, fcol);
  grid.appendChild(grp);
}

function toggleHold(i) {
  if (busy || current[i] == null) return;
  setHold(i, !held[i]);
}

function setHold(i, on) {
  held[i] = on;
  keys[i].classList.toggle('lit', on);
  keys[i].setAttribute('aria-pressed', String(on));
}

// ---------- boutons rotatifs : NOMBRE (1 à 12) et DÉ (D100 = 2 × D10 au départ)
const countDial = new Dial($('dial-count'), {
  title: 'NOMBRE',
  options: Array.from({ length: SLOTS }, (_, i) => ({ value: i + 1, label: String(i + 1), text: `${i + 1} dé${i ? 's' : ''}` })),
  onChange: () => updateSelection(),
});
const kindDial = new Dial($('dial-kind'), {
  title: 'DÉ',
  options: [
    ...[4, 6, 8, 10, 12, 20].map((f) => ({ value: f, label: String(f), text: 'D' + f })),
    { value: 'd100', label: '100', text: 'D100 (2 × D10)' },
  ],
  index: 6,
  onChange: () => updateSelection(),
});

function selection() {
  const pct = kindDial.value === 'd100';
  const count = pct ? 1 : countDial.value; // un D100 est un seul jet (2 × D10) : une seule valeur
  const faces = pct ? 100 : kindDial.value;
  return { pct, count, faces, kind: pct ? 'd100' : faces, name: diceName({ pct, count, faces }) };
}

function updateSelection() {
  countDial.setDisabled(selection().pct);
}

// ---------- écran : en-tête + historique (le plus récent en haut)
const pad = Seg16.pad;
function renderHistory() {
  lcd.setRow(0, pad(COLS, [0, 'HEURE'], [9, 'DES'], [-1, 'TOTAL']), { dim: true });
  for (let r = 1; r < ROWS; r++) {
    const e = history[r - 1];
    lcd.setRow(r, e ? pad(COLS, [0, e.time], [9, e.name], [-1, String(e.total)]) : '');
  }
}

function addHistory(name, total) {
  const time = new Date().toLocaleTimeString('fr-FR', { hour12: false });
  history.unshift({ time, name, total });
  if (history.length > HISTORY_MAX) history.pop();
  renderHistory();
  return lcd.scrambleRow(1, pad(COLS, [0, time], [9, name], [-1, String(total)]));
}

// ---------- jet
async function roll() {
  if (busy) return;
  busy = true;
  $('led-run').classList.add('lit');
  launchBtn.setAttribute('aria-busy', 'true');
  unlockAudio();

  const sel = selection();
  if (sel.kind !== lastKind) held.forEach((_, i) => setHold(i, false)); // autre dé : les valeurs conservées n'ont plus de sens
  lastKind = sel.kind;
  for (let i = sel.count; i < SLOTS; i++) setHold(i, false);

  const next = rollSlots({ count: sel.count, faces: sel.faces, pct: sel.pct, current, held });
  const spins = [];
  next.forEach((v, i) => {
    const kept = held[i] && current[i] != null; // dé conservé : la lame ne bouge pas
    if (kept || (v == null && current[i] == null)) return;
    const { tens, units } = splitValue(v);
    const delay = (i % 4) * 4;
    // même valeur qu'au jet précédent : la lame fait quand même un tour (extra >= 1)
    spins.push(pairs[i].tens.spinTo(tens, { extra: 11, delay }), pairs[i].units.spinTo(units, { extra: 10, delay }));
    current[i] = v;
    pairs[i].el.dataset.value = v ?? '';
  });
  await Promise.all(spins);

  await addHistory(sel.name, sum(next));
  busy = false;
  $('led-run').classList.remove('lit');
  launchBtn.removeAttribute('aria-busy');
}

launchBtn.addEventListener('click', roll);

// ---------- SOUND, CLEAR
$('pb-sound').addEventListener('click', (e) => {
  sound.on = !sound.on;
  $('led-mute').classList.toggle('lit', !sound.on);
  e.currentTarget.setAttribute('aria-pressed', String(!sound.on));
});
$('btn-clear').addEventListener('click', () => {
  history.length = 0;
  renderHistory();
});

updateSelection();
renderHistory();
