import { rollD100, rollDice } from './rng.js';

const $ = (id) => document.getElementById(id);
const kind = $('kind');
const count = $('count');
const history = $('history');
let rollNo = 0;

kind.addEventListener('change', () => { $('count-label').hidden = kind.value === 'd100'; });

function label() {
  if (kind.value === 'd100') return 'D100';
  return `${clampCount()}D${kind.value}`;
}

function clampCount() {
  const n = Math.min(10, Math.max(1, parseInt(count.value, 10) || 1));
  count.value = n;
  return n;
}

function roll() {
  const isPct = kind.value === 'd100';
  const r = isPct ? rollD100() : rollDice(clampCount(), Number(kind.value));
  const name = label();

  const diceEl = $('dice');
  diceEl.replaceChildren(...r.dice.map((v, i) => {
    const d = document.createElement('div');
    d.className = 'die';
    d.textContent = v;
    if (isPct) d.title = i === 0 ? 'Dizaines' : 'Unités';
    return d;
  }));
  const totalEl = $('total');
  totalEl.textContent = r.total;
  totalEl.classList.remove('pop'); void totalEl.offsetWidth; totalEl.classList.add('pop');

  const li = document.createElement('li');
  li.innerHTML = '<span class="h-kind"></span><span class="h-dice"></span><strong class="h-total"></strong>';
  li.dataset.n = ++rollNo;
  li.querySelector('.h-kind').textContent = name;
  li.querySelector('.h-dice').textContent = r.dice.join(' · ');
  li.querySelector('.h-total').textContent = r.total;
  history.prepend(li);
  $('empty').hidden = true;
}

$('roll').addEventListener('click', roll);
$('clear').addEventListener('click', () => {
  history.replaceChildren();
  rollNo = 0;
  $('empty').hidden = false;
});
