/**
 * Calcul des tuiles du fond de plan sur la grille Lambert 72 (EPSG:31370) du service WMTS UrbIS, à moins d'une marge donnée
 * d'un ensemble de contours. Remplace src/tuilesGeom.js (Web Mercator) lors du passage de la carte en Lambert 72.
 *
 * Tout se calcule en mètres Lambert, donc en vrais mètres au sol : plus de facteur de déformation. Les contours du shapefile
 * sont déjà en Lambert 72 : aucune reprojection.
 *
 * Marge constante À L'ÉCRAN : la marge saisie vaut pour le niveau le plus fin, elle double à chaque niveau en moins.
 * Le contour seul suffit (pas de test « à l'intérieur ») tant qu'aucun polygone n'est plus large que deux fois la marge.
 */
const AMGT4CEM_TuilesLambert = (function () {
'use strict';

const GRILLE = { origine: [16478, 304073], echelle0: 3973618.066406251, pixelOGC: 0.00028, taille: 256, niveaux: 16 };
const CLE = 1048576;

/** Mètres au sol par pixel au niveau z. */
function resolution(z) { return (GRILLE.echelle0 * GRILLE.pixelOGC) / 2 ** z; }
/** Côté d'une tuile (mètres) au niveau z. */
function cote(z) { return resolution(z) * GRILLE.taille; }

function distPointRect(px, py, x0, y0, x1, y1) {
  return Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1));
}
function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
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
function distSegRect(ax, ay, bx, by, x0, y0, x1, y1) {
  if (segCoupeRect(ax, ay, bx, by, x0, y0, x1, y1)) return 0;
  return Math.min(
    distPointRect(ax, ay, x0, y0, x1, y1), distPointRect(bx, by, x0, y0, x1, y1),
    distPointSeg(x0, y0, ax, ay, bx, by), distPointSeg(x1, y0, ax, ay, bx, by),
    distPointSeg(x0, y1, ax, ay, bx, by), distPointSeg(x1, y1, ax, ay, bx, by),
  );
}

/** Emprise d'une tuile (colonne x, ligne y, niveau z) en Lambert 72 : { x0, y0, x1, y1 } (y0 = bas). */
function emprise(z, x, y) {
  const ts = cote(z);
  const x0 = GRILLE.origine[0] + x * ts;
  const y1 = GRILLE.origine[1] - y * ts;
  return { x0, y0: y1 - ts, x1: x0 + ts, y1 };
}

/** Liste exacte des tuiles [x, y] du niveau z à moins de `margeSol` mètres d'un contour. segs : [x1, y1, x2, y2] en Lambert 72. */
function tuilesAutour(segs, z, margeSol) {
  if (!segs.length) return [];
  const ts = cote(z);
  const [ox, oy] = GRILLE.origine;
  const cle = (x, y) => x * CLE + y;
  const cellules = new Map();
  for (let i = 0; i < segs.length; i += 1) {
    const [ax, ay, bx, by] = segs[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (ts / 4)));
    for (let k = 0; k <= n; k += 1) {
      const c = cle(Math.floor((ax + ((bx - ax) * k) / n - ox) / ts), Math.floor((oy - (ay + ((by - ay) * k) / n)) / ts));
      let l = cellules.get(c);
      if (!l) { l = []; cellules.set(c, l); }
      if (l[l.length - 1] !== i) l.push(i);
    }
  }
  const k = Math.ceil(margeSol / ts) + 1;
  const candidates = new Set();
  for (const c of cellules.keys()) {
    const cx = Math.floor(c / CLE);
    const cy = c - cx * CLE;
    for (let dx = -k; dx <= k; dx += 1) for (let dy = -k; dy <= k; dy += 1) candidates.add(cle(cx + dx, cy + dy));
  }
  const retenues = [];
  for (const c of candidates) {
    const x = Math.floor(c / CLE);
    const y = c - x * CLE;
    if (x < 0 || y < 0) continue;
    const e = emprise(z, x, y);
    let ok = false;
    for (let dx = -k; dx <= k && !ok; dx += 1) {
      for (let dy = -k; dy <= k && !ok; dy += 1) {
        const l = cellules.get(cle(x + dx, y + dy));
        if (!l) continue;
        for (const i of l) {
          const s = segs[i];
          if (distSegRect(s[0], s[1], s[2], s[3], e.x0, e.y0, e.x1, e.y1) <= margeSol) { ok = true; break; }
        }
      }
    }
    if (ok) retenues.push([x, y]);
  }
  return retenues;
}

return { GRILLE, resolution, cote, emprise, tuilesAutour };
})();
