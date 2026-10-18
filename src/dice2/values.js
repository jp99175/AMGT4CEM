// Logique pure de dice2 (sans DOM) : valeurs des 12 emplacements et leur découpage pour les lames.
import { randomInt, rollD100 } from '../dice/rng.js';

export const SLOTS = 12;

/** Valeur d'un dé → texte des deux lames : dizaines (0 à 10, « 10 » pour 100) et unités (0 à 9). */
export function splitValue(v) {
  if (v == null) return { tens: ' ', units: ' ' };
  return { tens: String(Math.floor(v / 10)), units: String(v % 10) };
}

/**
 * Valeurs des emplacements après un jet. Les dés conservés (HOLD) gardent leur valeur ; les autres sont
 * relancés ; les emplacements au-delà de `count` sont vides (null).
 * @param {{count: number, faces: number, pct: boolean, current: (number|null)[], held: boolean[], rand?: Function}} o
 */
export function rollSlots({ count, faces, pct, current, held, rand = randomInt }) {
  return Array.from({ length: SLOTS }, (_, i) => {
    if (i >= count) return null;
    if (held[i] && current[i] != null) return current[i];
    return pct ? rollD100(rand).total : 1 + rand(faces);
  });
}

export const sum = (values) => values.reduce((s, v) => s + (v ?? 0), 0);

/** Nom de la combinaison : « D100 », « D20 », « 5D20 ». */
export function diceName({ pct, count, faces }) {
  if (pct) return 'D100';
  return count === 1 ? `D${faces}` : `${count}D${faces}`;
}
