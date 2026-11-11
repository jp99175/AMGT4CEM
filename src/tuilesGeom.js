/**
 * Calcul des tuiles du fond de plan (Web Mercator, grille du service WMTS UrbIS) à moins d'une marge donnée d'un ensemble de
 * contours. Partagé par la page de mesure (src/mesureTuiles.js) et par la sélection hors ligne de l'outil de calage
 * (src/tuningSynoptique.js).
 *
 * Marge constante À L'ÉCRAN : la marge saisie vaut pour le zoom 19, elle double à chaque niveau en moins
 * (100 m en zoom 19, 200 m en 18, 400 m en 17, 800 m en 16, 1 600 m en 15).
 *
 * Le contour seul suffit (pas de test « à l'intérieur ») tant qu'aucun polygone n'est plus large que deux fois la marge :
 * le rayon inscrit le plus grand du réseau est d'environ 30 m, la marge minimale est de 100 m.
 */
const AMGT4CEM_TuilesGeom = (function () {
'use strict';

const EQUATEUR_M = 40075016.68557849; // circonférence en Web Mercator
const ORIGINE = EQUATEUR_M / 2;

/** Distance d'un point à un rectangle (0 s'il est dedans). */
function distPointRect(px, py, x0, y0, x1, y1) {
  const dx = Math.max(x0 - px, 0, px - x1);
  const dy = Math.max(y0 - py, 0, py - y1);
  return Math.hypot(dx, dy);
}

/** Distance d'un point à un segment. */
function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Le segment traverse-t-il le rectangle ? (Liang-Barsky) */
function segCoupeRect(ax, ay, bx, by, x0, y0, x1, y1) {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) { if (q[i] < 0) return false; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

/** Distance entre un segment et un rectangle. */
function distSegRect(ax, ay, bx, by, x0, y0, x1, y1) {
  if (segCoupeRect(ax, ay, bx, by, x0, y0, x1, y1)) return 0;
  return Math.min(
    distPointRect(ax, ay, x0, y0, x1, y1),
    distPointRect(bx, by, x0, y0, x1, y1),
    distPointSeg(x0, y0, ax, ay, bx, by),
    distPointSeg(x1, y0, ax, ay, bx, by),
    distPointSeg(x0, y1, ax, ay, bx, by),
    distPointSeg(x1, y1, ax, ay, bx, by),
  );
}

/** Facteur de déformation du Web Mercator à la latitude du réseau (1 m au sol = ~1,58 m en Web Mercator à Bruxelles). */
function facteurMercator(segs) {
  let sy = 0;
  for (const s of segs) sy += s[1];
  const lat = (2 * Math.atan(Math.exp((sy / segs.length) / (EQUATEUR_M / (2 * Math.PI)))) - Math.PI / 2);
  return 1 / Math.cos(lat);
}

/** Liste exacte des tuiles (x, y) du zoom z à moins de `margeSol` mètres (au sol) d'un contour. segs : [x1, y1, x2, y2] en Web Mercator. */
function tuilesAutour(segs, z, margeSol) {
  if (!segs.length) return [];
  const ts = EQUATEUR_M / 2 ** z;
  const marge = margeSol * facteurMercator(segs); // la distance se mesure en mètres Web Mercator
  const cle = (x, y) => x * 1048576 + y;
  // Cellules touchées par chaque segment (pas d'échantillonnage d'un quart de tuile : aucun coin n'est manqué).
  const cellules = new Map();
  for (let i = 0; i < segs.length; i += 1) {
    const [ax, ay, bx, by] = segs[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (ts / 4)));
    for (let k = 0; k <= n; k += 1) {
      const x = Math.floor((ax + ((bx - ax) * k) / n + ORIGINE) / ts);
      const y = Math.floor((ORIGINE - (ay + ((by - ay) * k) / n)) / ts);
      const c = cle(x, y);
      let l = cellules.get(c);
      if (!l) { l = []; cellules.set(c, l); }
      if (l[l.length - 1] !== i) l.push(i);
    }
  }
  const k = Math.ceil(marge / ts) + 1;
  const candidates = new Set();
  for (const c of cellules.keys()) {
    const cx = Math.floor(c / 1048576);
    const cy = c - cx * 1048576;
    for (let dx = -k; dx <= k; dx += 1) for (let dy = -k; dy <= k; dy += 1) candidates.add(cle(cx + dx, cy + dy));
  }
  const retenues = [];
  for (const c of candidates) {
    const x = Math.floor(c / 1048576);
    const y = c - x * 1048576;
    const x0 = x * ts - ORIGINE;
    const x1 = x0 + ts;
    const y1 = ORIGINE - y * ts;
    const y0 = y1 - ts;
    let ok = false;
    for (let dx = -k; dx <= k && !ok; dx += 1) {
      for (let dy = -k; dy <= k && !ok; dy += 1) {
        const l = cellules.get(cle(x + dx, y + dy));
        if (!l) continue;
        for (const i of l) {
          const s = segs[i];
          if (distSegRect(s[0], s[1], s[2], s[3], x0, y0, x1, y1) <= marge) { ok = true; break; }
        }
      }
    }
    if (ok) retenues.push([x, y]);
  }
  return retenues;
}

/** Emprise d'une tuile en Web Mercator : { x0, y0, x1, y1 }. */
function emprise(z, x, y) {
  const ts = EQUATEUR_M / 2 ** z;
  const x0 = x * ts - ORIGINE;
  const y1 = ORIGINE - y * ts;
  return { x0, y0: y1 - ts, x1: x0 + ts, y1 };
}

/** Web Mercator (mètres) -> [latitude, longitude] en degrés. */
function versLatLng(x, y) {
  const R = EQUATEUR_M / (2 * Math.PI);
  return [(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI), (x / R) * (180 / Math.PI)];
}

return { EQUATEUR_M, ORIGINE, tuilesAutour, facteurMercator, emprise, versLatLng };
})();
