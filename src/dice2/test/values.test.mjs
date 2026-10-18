import assert from 'node:assert/strict';
import { SLOTS, splitValue, rollSlots, sum, diceName } from '../values.js';

// découpage pour les lames : dizaines 0 à 10, unités 0 à 9
assert.deepEqual(splitValue(7), { tens: '0', units: '7' });
assert.deepEqual(splitValue(20), { tens: '2', units: '0' });
assert.deepEqual(splitValue(100), { tens: '10', units: '0' });
assert.deepEqual(splitValue(null), { tens: ' ', units: ' ' });

assert.equal(diceName({ pct: true, count: 1, faces: 100 }), 'D100');
assert.equal(diceName({ pct: false, count: 1, faces: 20 }), 'D20');
assert.equal(diceName({ pct: false, count: 5, faces: 20 }), '5D20');
assert.equal(diceName({ pct: false, count: 12, faces: 20 }), '12D20');

// emplacements : au-delà de `count`, vides ; valeurs dans 1..faces
const none = Array(SLOTS).fill(null);
const noHold = Array(SLOTS).fill(false);
for (let k = 0; k < 2000; k++) {
  const r = rollSlots({ count: 5, faces: 20, pct: false, current: none, held: noHold });
  assert.equal(r.length, SLOTS);
  r.forEach((v, i) => (i < 5 ? assert.ok(Number.isInteger(v) && v >= 1 && v <= 20) : assert.equal(v, null)));
}
// D100 : un seul emplacement, 1..100 (le 100 existe bien)
let seen100 = false;
for (let k = 0; k < 20000; k++) {
  const r = rollSlots({ count: 1, faces: 100, pct: true, current: none, held: noHold });
  assert.ok(r[0] >= 1 && r[0] <= 100);
  assert.equal(r.slice(1).every((v) => v == null), true);
  seen100 ||= r[0] === 100;
}
assert.ok(seen100, 'le 100 doit pouvoir sortir');

// HOLD : les dés conservés gardent leur valeur, les autres sont relancés ; une valeur vide n'est jamais conservée
const cur = [7, 12, 20, 3, 18, ...Array(7).fill(null)];
const hold = [false, true, false, true, false, ...Array(7).fill(false)];
for (let k = 0; k < 500; k++) {
  const r = rollSlots({ count: 5, faces: 20, pct: false, current: cur, held: hold });
  assert.equal(r[1], 12);
  assert.equal(r[3], 3);
}
const holdEmpty = Array(SLOTS).fill(true);
const r2 = rollSlots({ count: 2, faces: 6, pct: false, current: none, held: holdEmpty });
assert.ok(r2[0] >= 1 && r2[1] >= 1);
// rand déterministe : 1 + rand(faces)
assert.deepEqual(rollSlots({ count: 3, faces: 6, pct: false, current: none, held: noHold, rand: () => 4 }).slice(0, 3), [5, 5, 5]);
assert.equal(sum([7, null, 20, 3]), 30);
console.log('OK values');
