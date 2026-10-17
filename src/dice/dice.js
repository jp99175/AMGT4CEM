import { rollD100, rollDice } from './rng.js';
import { Board, sound, unlockAudio } from './flap.js';

const $ = (id) => document.getElementById(id);
const kind = $('kind');
const count = $('count');
const history = $('history');
const rollBtn = $('roll');
let rollNo = 0;
let busy = false;
let diceBoards = [];
let diceKey = '';
const totalBoard = new Board($('total'), 3);

kind.addEventListener('change', () => { $('count-label').hidden = kind.value === 'd100'; });

function clampCount() {
  const n = Math.min(10, Math.max(1, parseInt(count.value, 10) || 1));
  count.value = n;
  return n;
}

// (Re)construit les afficheurs de dés seulement si la configuration a changé.
function layoutDice(n, width) {
  const key = n + 'x' + width;
  if (key === diceKey) return;
  diceKey = key;
  const row = $('dice');
  row.replaceChildren();
  diceBoards = Array.from({ length: n }, () => {
    const cell = document.createElement('div');
    cell.className = 'board die';
    row.appendChild(cell);
    return new Board(cell, width);
  });
}

async function roll() {
  if (busy) return;
  busy = true;
  rollBtn.disabled = true;
  unlockAudio();

  const isPct = kind.value === 'd100';
  const n = isPct ? 2 : clampCount();
  const faces = isPct ? 10 : Number(kind.value);
  const name = isPct ? 'D100' : `${n}D${faces}`;
  const r = isPct ? rollD100() : rollDice(n, faces);

  layoutDice(n, String(isPct ? 9 : faces).length);
  $('dice').classList.toggle('pct', isPct);
  const labels = isPct ? ['dizaines', 'unités'] : [];
  [...$('dice').children].forEach((c, i) => { c.dataset.label = labels[i] || ''; });

  await Promise.all([
    ...diceBoards.map((b, i) => b.set(r.dice[i], { extra: 14, delay: i * 4 })),
    totalBoard.set(r.total, { extra: 22, delay: n * 4 }),
  ]);

  const li = document.createElement('li');
  li.dataset.n = ++rollNo;
  li.innerHTML = '<span class="h-kind"></span><span class="h-dice"></span><strong class="h-total"></strong>';
  li.querySelector('.h-kind').textContent = name;
  li.querySelector('.h-dice').textContent = r.dice.join(' · ');
  li.querySelector('.h-total').textContent = r.total;
  history.prepend(li);
  $('empty').hidden = true;

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
