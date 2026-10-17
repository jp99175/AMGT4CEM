import { rollD100, rollDice } from './rng.js';
import { Board, sound, unlockAudio } from './flap.js';
import { Dial } from './knob.js';

const $ = (id) => document.getElementById(id);
const historyEl = $('history');
const launchBtn = $('pb-launch');
let rollNo = 0;
let busy = false;

const totalBoard = new Board($('total'), 3);

// Nombre de dés (1 à 10) et type de dé (le D100 = 2 × D10, choisi au départ).
const countDial = new Dial($('dial-count'), {
  title: 'NOMBRE',
  options: Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: String(i + 1), text: `${i + 1} dé${i ? 's' : ''}` })),
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

// Le dé ou la combinaison choisie : « D100 », « D6 », « 3D6 »…
function selection() {
  const isPct = kindDial.value === 'd100';
  const n = isPct ? 2 : countDial.value;
  const faces = isPct ? 10 : kindDial.value;
  const name = isPct ? 'D100' : n === 1 ? `D${faces}` : `${n}D${faces}`;
  return { isPct, n, faces, name };
}

function updateSelection() {
  countDial.setDisabled(selection().isPct); // le D100 est toujours 2 × D10
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
  historyEl.prepend(li);
  while (historyEl.children.length > 200) historyEl.lastChild.remove();
  $('empty').hidden = true;
  rollNo++;
}

async function roll() {
  if (busy) return;
  busy = true;
  $('led-run').classList.add('lit');
  launchBtn.setAttribute('aria-busy', 'true');
  unlockAudio();

  const s = selection();
  const r = s.isPct ? rollD100() : rollDice(s.n, s.faces);
  await totalBoard.set(r.total, { extra: 22 });

  addHistory(s.name, r.total);
  busy = false;
  $('led-run').classList.remove('lit');
  launchBtn.removeAttribute('aria-busy');
}

launchBtn.addEventListener('click', roll);
$('clear').addEventListener('click', () => {
  historyEl.replaceChildren();
  rollNo = 0;
  $('empty').hidden = false;
});

// SOUND : coupe ou rétablit le clac ; le voyant MUTE est rouge quand il n'y a pas de son.
$('pb-sound').addEventListener('click', (e) => {
  sound.on = !sound.on;
  $('led-mute').classList.toggle('lit', !sound.on);
  e.currentTarget.setAttribute('aria-pressed', String(!sound.on));
});

// EXIT : ferme l'onglet s'il a été ouvert par un script ; sinon retour à la page précédente, ou à la carte.
$('pb-exit').addEventListener('click', () => {
  window.close();
  setTimeout(() => {
    if (window.history.length > 1) window.history.back();
    else location.href = 'home.html?app=carto';
  }, 150);
});

updateSelection();
