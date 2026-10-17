// Tirage équitable d'un entier dans [0, n[ : source cryptographique + rejet des valeurs
// qui feraient dépasser le plus grand multiple de n (évite le biais du modulo).
export function randomInt(n, getRandomValues = (a) => crypto.getRandomValues(a)) {
  if (!Number.isInteger(n) || n < 1 || n > 0x100000000) throw new RangeError('n invalide : ' + n);
  const limit = 0x100000000 - (0x100000000 % n);
  const buf = new Uint32Array(1);
  do getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

// D100 = 2 D10 : dé des dizaines (0-9) et dé des unités (0-9) ; 00 + 0 se lit 100.
export function rollD100(rand = randomInt) {
  const tens = rand(10);
  const units = rand(10);
  return { dice: [tens, units], total: tens === 0 && units === 0 ? 100 : tens * 10 + units };
}

// `count` dés à `faces` faces (1..faces), total = somme.
export function rollDice(count, faces, rand = randomInt) {
  const dice = Array.from({ length: count }, () => 1 + rand(faces));
  return { dice, total: dice.reduce((s, v) => s + v, 0) };
}
