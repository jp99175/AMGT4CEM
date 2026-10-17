import { rollD100, rollDice } from './rng.js';
import { Board, sound, unlockAudio } from './flap.js';
import { DualKnob } from './knob.js';
import { Led } from './led.js';

const $ = (id) => document.getElementById(id);
const history = $('history');
const rollBtn = $('roll');
let rollNo = 0;
let busy = false;

const totalBoard = new Board($('total'), 3);
const countLed = new Led($('led-count'), 2);
const kindLed = new Led($('led-kind'), 4);

// Couronne = type de dé ; bouton central = nombre de dés.
const knob = new DualKnob($('knob'), {
  outer: {
    options: [
      { value: 'd100', text: 'D100 (2 × D10)' },
      ...[4, 6, 8, 10, 12, 20].map((f) => ({ value: f, text: 'D' + f })),
    ],
    onChange: () => updateSelection(),
  },
  inner: {
    options: Array.from({ length: 10 }, (_, i) => ({ value: i + 1, text: `${i + 1} dé${i ? 's' : ''}` })),
    onChange: () => updateSelection(),
  },
});

// Le dé ou la combinaison choisie : « D100 », « D6 », « 3D6 »…
function selection() {
  const isPct = knob.outer.value === 'd100';
  const n = isPct ? 2 : knob.inner.value;
  const faces = isPct ? 10 : knob.outer.value;
  const name = isPct ? 'D100' : n === 1 ? `D${faces}` : `${n}D${faces}`;
  return { isPct, n, faces, name };
}

function updateSelection() {
  const s = selection();
  knob.inner.setDisabled(s.isPct); // le D100 est toujours 2 × D10
  countLed.set(s.isPct ? '--' : s.n);
  countLed.dim(s.isPct);
  kindLed.set(s.isPct ? 'd100' : 'd' + s.faces);
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
