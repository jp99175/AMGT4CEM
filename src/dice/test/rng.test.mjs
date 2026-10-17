import assert from 'node:assert/strict';
import { randomInt, rollD100, rollDice } from '../rng.js';

const N = 1_000_000;
const counts = new Array(101).fill(0);
for (let i = 0; i < N; i++) counts[rollD100().total]++;
assert.equal(counts[0], 0);
// Khi² d'uniformité sur 100 classes (99 ddl) : seuil 0,1 % ≈ 148,2
const exp = N / 100;
const chi = counts.slice(1).reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
assert.ok(chi < 148.2, 'khi² trop élevé : ' + chi);
const near80 = counts.slice(75, 86).reduce((s, c) => s + c, 0) / N; // 75..85 : 11 %
assert.ok(Math.abs(near80 - 0.11) < 0.003, 'zone ~80 : ' + near80);

// Rejet : une source qui ne renvoie d'abord que des valeurs hors limite doit être ignorée.
let calls = 0;
assert.equal(randomInt(10, (a) => { a[0] = calls++ < 2 ? 0xffffffff : 7; }), 7);
assert.deepEqual(rollD100(() => 0), { dice: [0, 0], total: 100 });
const r = rollDice(3, 6);
assert.equal(r.dice.length, 3);
assert.ok(r.dice.every((v) => v >= 1 && v <= 6));
console.log('OK  khi²=%s  zone 75-85=%s', chi.toFixed(1), (near80 * 100).toFixed(2) + ' %');
