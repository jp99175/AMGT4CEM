import { rollD100, rollDice } from './rng.js';
import { Board, LABEL_CHARSET, sound, unlockAudio } from './flap.js';
import { Knob } from './knob.js';

const $ = (id) => document.getElementById(id);
const history = $('history');
const rollBtn = $('roll');
let rollNo = 0;
let busy = false;

const totalBoard = new Board($('total'), 3);
const labelBoard = new Board($('selection'), 5, LABEL_CHARSET);

const kindKnob = new Knob($('knob-kind'), {
  title: 'Dé',
  options: [
    { value: 'd100', label: '100', text: 'D100 (2 × D10)' },
    ...[4, 6, 8, 10, 12, 20].map((f) => ({ value: f, label: String(f), text: 'D' + f })),
  ],
  onChange: () => updateSelection(),
});
const countKnob = new Knob($('knob-count'), {
  title: 'Nombre',
  options: Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
  onChange: () => updateSelection(),
});

// Le dé ou la combinaison choisie : « D100 », « D6 », « 3D6 »…
function selection() {
  const isPct = kindKnob.value === 'd100';
  const n = isPct ? 2 : countKnob.value;
  const faces = isPct ? 10 : kindKnob.value;
  const name = isPct ? 'D100' : n === 1 ? `D${faces}` : `${n}D${faces}`;
  return { isPct, n, faces, name };
}

function updateSelection() {
  const s = selection();
  countKnob.setDisabled(s.isPct); // le D100 est toujours 2 × D10
  labelBoard.set(s.name, { extra: 5, align: 'start' });
}

// Cellule de tableau d'affichage : une tuile par caractère, qui bascule à l'arrivée de la ligne.
function tiles(text) {
  const frag = document.createDocumentFragment();
  [...text].forEach((ch, i) => {
    const t = document.createElement('span');
    t.className = 'tile' + (ch === ':' ? ' sep' : '');
    t.style.setProperty('--i', i);
    t.textContent = ch === ' ' ? '' : ch;
    frag.appendChild(t);
  });
  return frag;
}

function addHistory(name, total) {
  const time = new Date().toLocaleTimeString('fr-FR', { hour12: false });
  const li = document.createElement('li');
  li.className = 'row';
  for (const [cls, text] of [['c-time', time], ['c-dice', name], ['c-result', String(total)]]) {
    const cell = document.createElement('span');
    cell.className = 'cell ' + cls;
    cell.appendChild(tiles(text));
    li.appendChild(cell);
  }
  li.setAttribute('aria-label', `${time}, ${name}, résultat ${total}`);
  history.prepend(li);
  while (history.children.length > 200) history.lastChild.remove();
  $('empty').hidden = true;
  rollNo++;
}

async function roll() {
  if (busy) return;
  busy = true;
  rollBtn.disabled = true;
  unlockAudio();

  const s = selection();
  const r = s.isPct ? rollD100() : rollDice(s.n, s.faces);
  await totalBoard.set(r.total, { extra: 22 });

  addHistory(s.name, r.total);
  busy = false;
  rollBtn.disabled = false;
}

rollBtn.addEventListener('click', roll);
$('clear').addEventListener('click', () => {
  history.replaceChildren();
  rollNo = 0;
  $('empty').hidden = false;
});
$('sound').addEventListener('click', (e) => {
  sound.on = !sound.on;
  e.currentTarget.textContent = sound.on ? '🔊' : '🔇';
  e.currentTarget.setAttribute('aria-pressed', String(!sound.on));
});

updateSelection();
