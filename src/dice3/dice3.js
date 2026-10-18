import { Dial } from './knob.js';
import { Seg16 } from './seg16.js';
import { sound, unlockAudio, tick } from './sound.js';
import { SLOTS, rollSlots, sum, diceName, formatValue } from './values.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COLS = 18;
const ROWS = 10; // 1 ligne d'en-tête + 9 lignes d'historique
const HISTORY_MAX = 200;
const DIGITS = '0123456789';

const launchBtn = $('pb-launch');
const lcd = new Seg16($('lcd'), COLS, ROWS);
const history = [];
let busy = false;
let lastKind = null;
const current = Array(SLOTS).fill(null);
const held = Array(SLOTS).fill(false);

// ---------- les 12 emplacements : touche HOLD + afficheur 0-100 à 3 caractères, en 3 colonnes de 4 (1-4, 5-8, 9-12)
const keys = [];
const displays = [];
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
    const dsp = document.createElement('div');
    dsp.className = 'dsp';
    dsp.setAttribute('role', 'img');
    dsp.setAttribute('aria-label', `Dé ${i + 1} : vide`);
    const seg = new Seg16(dsp, 3, 1);
    seg.setRow(0, formatValue(null));
    displays[i] = { el: dsp, seg };
    fcol.appendChild(dsp);
  }
  grp.append(kcol, fcol);
  grp.insertAdjacentHTML('beforeend', '<i class="dome tl"></i><i class="dome tr"></i><i class="dome bl"></i><i class="dome br"></i>');
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
  title: 'COUNT',
  options: Array.from({ length: SLOTS }, (_, i) => ({ value: i + 1, label: String(i + 1), text: `${i + 1} dé${i ? 's' : ''}` })),
  onChange: () => updateSelection(),
});
const kindDial = new Dial($('dial-kind'), {
  title: 'LIMIT',
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
  return lcd.scrambleRow(1, pad(COLS, [0, time], [9, name], [-1, String(total)]), { onTick: tick });
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
  const jobs = [];
  next.forEach((v, i) => {
    const kept = held[i] && current[i] != null; // dé conservé : l'afficheur ne bouge pas
    if (kept || (v == null && current[i] == null)) return;
    current[i] = v;
    displays[i].el.setAttribute('aria-label', v == null ? `Dé ${i + 1} : vide` : `Dé ${i + 1} : ${v}`);
    jobs.push(sleep((i % 4) * 90).then(() => displays[i].seg.scrambleRow(0, formatValue(v), { ms: 800, pool: DIGITS, onTick: tick })));
  });
  await Promise.all(jobs);

  await addHistory(sel.name, sum(next));
  busy = false;
  $('led-run').classList.remove('lit');
  launchBtn.removeAttribute('aria-busy');
}

launchBtn.addEventListener('click', roll);

// ---------- SOUND, CLEAR, RELEASE
$('pb-sound').addEventListener('click', (e) => {
  sound.on = !sound.on;
  $('led-mute').classList.toggle('lit', !sound.on);
  e.currentTarget.setAttribute('aria-pressed', String(!sound.on));
});
$('btn-clear').addEventListener('click', () => {
  history.length = 0;
  renderHistory();
});
$('btn-release').addEventListener('click', () => {
  if (busy) return;
  held.forEach((_, i) => setHold(i, false));
});

updateSelection();
renderHistory();
