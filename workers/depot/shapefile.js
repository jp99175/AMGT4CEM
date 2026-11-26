/**
 * Lecture, contrôle et écriture de fichiers shapefile (polygones, type 5) — lot C (18/11/2026).
 * Fonctions pures, sans R2 ni réseau : testables sous Node. Utilisées par geometries.js.
 *
 * Principe : les contours déjà présents ne sont jamais ré-encodés. Un enregistrement du .shp est copié tel quel (octet pour octet).
 * Seul le .dbf est reconstruit à chaque écriture : id + GENRE, NOM_FR, NOM_NL (copie lisible des attributs, décision A du 17/11/2026),
 * en MAJUSCULES sans accents (décision du 18/11/2026 : plus aucun souci d'encodage sous AutoCAD).
 */

export const LARGEURS_DBF = { id: 12, GENRE: 20, NOM_FR: 100, NOM_NL: 100 };
// Étendue plausible en Lambert 72 (mètres) : écarte les fichiers en degrés (WGS84) ou dans un autre système.
const ETENDUE = { xmin: 20000, xmax: 300000, ymin: 20000, ymax: 300000 };

const dec = new TextDecoder();

/** Texte en MAJUSCULES sans accents, caractères ASCII imprimables seulement. */
export function enMajusculesSansAccents(texte) {
  let t = String(texte ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/[œŒ]/g, 'OE').replace(/[æÆ]/g, 'AE').replace(/ß/g, 'SS').replace(/[’‘`´]/g, "'").replace(/[“”«»]/g, '"').replace(/[–—]/g, '-').replace(/ø/gi, 'O').replace(/đ/gi, 'D').replace(/ł/gi, 'L');
  return t.toUpperCase().replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Parcourt un .shp et renvoie ses enregistrements : { contenu (octets sans l'en-tête de 8 octets), type, bbox, anneaux }. Lève une Error lisible. */
export function lireShp(shp) {
  if (shp.length < 100) throw new Error('Le fichier .shp est trop court.');
  const v = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  if (v.getInt32(0, false) !== 9994) throw new Error("Le fichier .shp n'a pas le bon code d'en-tête (9994).");
  if (v.getInt32(24, false) * 2 !== shp.length) throw new Error('La longueur annoncée par le .shp ne correspond pas à sa taille.');
  if (v.getInt32(32, true) !== 5) throw new Error('Le .shp ne contient pas des polygones (type 5 attendu).');
  const enreg = [];
  let pos = 100;
  while (pos + 8 <= shp.length) {
    const longueur = v.getInt32(pos + 4, false) * 2;
    if (longueur < 4 || pos + 8 + longueur > shp.length) throw new Error(`Le .shp se termine au milieu de l'objet n° ${enreg.length + 1}.`);
    enreg.push(shp.subarray(pos + 8, pos + 8 + longueur));
    pos += 8 + longueur;
  }
  if (pos !== shp.length) throw new Error("Le .shp se termine au milieu d'un enregistrement.");
  return enreg;
}

/** Contrôle d'un enregistrement polygone ; renvoie { bbox, anneaux } ou lève une Error (message sans numéro d'objet). */
export function controlerContour(c) {
  const v = new DataView(c.buffer, c.byteOffset, c.byteLength);
  const type = v.getInt32(0, true);
  if (type === 0) throw new Error('objet vide (sans contour)');
  if (type !== 5) throw new Error(`type de forme ${type} au lieu de 5 (polygone)`);
  if (c.length < 44) throw new Error('enregistrement trop court');
  const nParts = v.getInt32(36, true); const nPts = v.getInt32(40, true);
  if (nParts < 1 || nPts < 4) throw new Error('contour sans surface');
  if (c.length !== 44 + 4 * nParts + 16 * nPts) throw new Error("taille de l'enregistrement incohérente");
  const parts = [];
  for (let i = 0; i < nParts; i++) parts.push(v.getInt32(44 + 4 * i, true));
  const base = 44 + 4 * nParts;
  const pt = (k) => [v.getFloat64(base + 16 * k, true), v.getFloat64(base + 16 * k + 8, true)];
  const anneaux = [];
  for (let i = 0; i < nParts; i++) {
    const a = parts[i]; const b = i + 1 < nParts ? parts[i + 1] : nPts;
    if (a < 0 || b > nPts || b - a < 4 || (i > 0 && a < parts[i - 1])) throw new Error('anneau mal défini');
    anneaux.push([a, b]);
  }
  let xmin = Infinity; let ymin = Infinity; let xmax = -Infinity; let ymax = -Infinity;
  for (const [a, b] of anneaux) {
    const [x0, y0] = pt(a); const [x1, y1] = pt(b - 1);
    if (x0 !== x1 || y0 !== y1) throw new Error('anneau non fermé');
    let aire2 = 0;
    for (let k = a; k < b; k++) {
      const [x, y] = pt(k);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('coordonnée invalide');
      if (x < ETENDUE.xmin || x > ETENDUE.xmax || y < ETENDUE.ymin || y > ETENDUE.ymax) throw new Error('coordonnées hors Lambert 72');
      if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y;
      if (k + 1 < b) { const [xn, yn] = pt(k + 1); aire2 += x * yn - xn * y; }
    }
    if (aire2 === 0) throw new Error('anneau sans surface');
  }
  return { bbox: [xmin, ymin, xmax, ymax], nAnneaux: nParts };
}

/** Anneaux (listes de [x, y]) d'un enregistrement polygone, tels que dans le fichier ; lève une Error si l'enregistrement est invalide. */
export function decoderContour(c) {
  controlerContour(c);
  const v = new DataView(c.buffer, c.byteOffset, c.byteLength);
  const nParts = v.getInt32(36, true); const nPts = v.getInt32(40, true);
  const base = 44 + 4 * nParts;
  const parts = []; for (let i = 0; i < nParts; i++) parts.push(v.getInt32(44 + 4 * i, true));
  const anneaux = [];
  for (let i = 0; i < nParts; i++) {
    const a = parts[i]; const b = i + 1 < nParts ? parts[i + 1] : nPts;
    const r = []; for (let k = a; k < b; k++) r.push([v.getFloat64(base + 16 * k, true), v.getFloat64(base + 16 * k + 8, true)]);
    anneaux.push(r);
  }
  return anneaux;
}

const aire2 = (r) => { let s = 0; for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return s; };
function dansAnneau(pt, r) {
  let dedans = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]; const [xj, yj] = r[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

/**
 * Encode des anneaux (zone dessinée : remplissage « pair-impair », sans sens ni rôle) en enregistrement polygone du shapefile.
 * Un anneau contenu dans un nombre impair d'autres anneaux est un trou. Les contours extérieurs sont écrits dans le sens des aiguilles
 * d'une montre, les trous en sens inverse (convention du format). Anneaux fermés au besoin. Lève une Error si le résultat est invalide.
 */
export function encoderContour(anneaux) {
  if (!Array.isArray(anneaux)) throw new Error('contour absent');
  const bons = anneaux.filter((r) => Array.isArray(r) && r.length >= 3).map((r) => {
    const pts = r.map((q) => [Number(q[0]), Number(q[1])]);
    const a = pts[0]; const z = pts[pts.length - 1];
    if (a[0] !== z[0] || a[1] !== z[1]) pts.push([a[0], a[1]]);
    return pts;
  });
  if (!bons.length) throw new Error('contour sans surface');
  const fin = bons.map((r, i) => {
    const profondeur = bons.reduce((n, autre, j) => n + (j !== i && dansAnneau(r[0], autre) ? 1 : 0), 0);
    const trou = profondeur % 2 === 1;
    const horaire = aire2(r) < 0; // aire signée négative = sens horaire
    return (trou === horaire) ? [...r].reverse() : r;
  });
  const nPts = fin.reduce((n, r) => n + r.length, 0);
  const out = new Uint8Array(44 + 4 * fin.length + 16 * nPts);
  const v = new DataView(out.buffer);
  v.setInt32(0, 5, true);
  let xmin = Infinity; let ymin = Infinity; let xmax = -Infinity; let ymax = -Infinity;
  for (const r of fin) for (const [x, y] of r) { if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  v.setFloat64(4, xmin, true); v.setFloat64(12, ymin, true); v.setFloat64(20, xmax, true); v.setFloat64(28, ymax, true);
  v.setInt32(36, fin.length, true); v.setInt32(40, nPts, true);
  let k = 0;
  fin.forEach((r, i) => {
    v.setInt32(44 + 4 * i, k, true);
    for (const [x, y] of r) { v.setFloat64(44 + 4 * fin.length + 16 * k, x, true); v.setFloat64(44 + 4 * fin.length + 16 * k + 8, y, true); k++; }
  });
  controlerContour(out);
  return out;
}

/** Nombre de points au-delà duquel le contrôle de recoupement est refusé (coût en n²). */
export const POINTS_MAX_RECOUPEMENT = 6000;

/**
 * Cherche un recoupement dans des anneaux (listes de [x, y]) : deux côtés qui se traversent, dans un même anneau ou entre anneaux.
 * Les contacts en un point (sommet commun, côtés consécutifs, bout qui touche un côté) ne comptent pas. Renvoie null si tout est correct,
 * sinon { anneau, point } (numéros à partir de 1, repère approximatif : début du premier côté concerné).
 */
export function trouverRecoupement(anneaux) {
  const rs = anneaux.filter((r) => Array.isArray(r) && r.length >= 3).map((r) => {
    const pts = r.map((q) => [Number(q[0]), Number(q[1])]);
    const a = pts[0]; const z = pts[pts.length - 1];
    if (a[0] !== z[0] || a[1] !== z[1]) pts.push([a[0], a[1]]);
    return pts;
  });
  if (rs.reduce((n, r) => n + r.length, 0) > POINTS_MAX_RECOUPEMENT) return { trop: true };
  const orient = (a, b, c) => { const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); return v > 0 ? 1 : v < 0 ? -1 : 0; };
  const croise = (a, b, c, d) => orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
  for (let i = 0; i < rs.length; i++) {
    for (let j = i; j < rs.length; j++) {
      const A = rs[i]; const B = rs[j];
      for (let k = 0; k + 1 < A.length; k++) {
        const a = A[k]; const b = A[k + 1];
        const xa = Math.min(a[0], b[0]); const xb = Math.max(a[0], b[0]); const ya = Math.min(a[1], b[1]); const yb = Math.max(a[1], b[1]);
        for (let m = i === j ? k + 2 : 0; m + 1 < B.length; m++) {
          if (i === j && k === 0 && m + 1 === A.length - 1) continue; // dernier côté et premier côté : voisins par la fermeture
          const c = B[m]; const d = B[m + 1];
          if (Math.max(c[0], d[0]) < xa || Math.min(c[0], d[0]) > xb || Math.max(c[1], d[1]) < ya || Math.min(c[1], d[1]) > yb) continue;
          if (croise(a, b, c, d)) return { anneau: i + 1, point: k + 1 };
        }
      }
    }
  }
  return null;
}

/** Champs d'un .dbf : { champs: [{nom, debut, longueur}], n, lenEntete, lenEnreg }. */
function enteteDbf(dbf) {
  if (dbf.length < 33) throw new Error('Le fichier .dbf est trop court.');
  const v = new DataView(dbf.buffer, dbf.byteOffset, dbf.byteLength);
  const n = v.getUint32(4, true); const lenEntete = v.getUint16(8, true); const lenEnreg = v.getUint16(10, true);
  if (dbf.length < lenEntete + lenEnreg * n) throw new Error('Le .dbf est tronqué.');
  const champs = [];
  let debut = 1;
  for (let i = 32; i < lenEntete - 1 && dbf[i] !== 0x0d; i += 32) {
    const nom = dec.decode(dbf.subarray(i, i + 11)).replace(/\0.*$/, '');
    const longueur = dbf[i + 16];
    champs.push({ nom, debut, longueur });
    debut += longueur;
  }
  return { champs, n, lenEntete, lenEnreg };
}

/** Identifiants (champ « id », sans tenir compte de la casse) de chaque enregistrement du .dbf ; '' si vide. */
export function lireIdsDbf(dbf) {
  const { champs, n, lenEntete, lenEnreg } = enteteDbf(dbf);
  const c = champs.find((x) => x.nom.toLowerCase() === 'id');
  if (!c) throw new Error("Le .dbf n'a pas de champ « id ».");
  const ids = [];
  for (let i = 0; i < n; i++) {
    const b = lenEntete + i * lenEnreg + c.debut;
    ids.push(dec.decode(dbf.subarray(b, b + c.longueur)).replace(/\0/g, '').trim());
  }
  return ids;
}

/** Lit id, GENRE, NOM_FR, NOM_NL de chaque enregistrement (champ absent : texte vide). */
export function lireChampsDbf(dbf) {
  const { champs, n, lenEntete, lenEnreg } = enteteDbf(dbf);
  const lat = new TextDecoder('windows-1252');
  const trouve = (nom) => champs.find((x) => x.nom.toLowerCase() === nom);
  const cs = { id: trouve('id'), genre: trouve('genre'), nom_fr: trouve('nom_fr'), nom_nl: trouve('nom_nl') };
  const lignes = [];
  for (let i = 0; i < n; i++) {
    const l = {};
    for (const [k, c] of Object.entries(cs)) {
      if (!c) { l[k] = ''; continue; }
      const b = lenEntete + i * lenEnreg + c.debut;
      l[k] = lat.decode(dbf.subarray(b, b + c.longueur)).replace(/\0/g, '').trim();
    }
    lignes.push(l);
  }
  return lignes;
}

/** Octets égaux ? */
export function memesOctets(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Lit un jeu shp/shx/dbf : { objets: [{ id, contenu }] } après contrôle de cohérence (nombres identiques, .shx, .dbf). */
export function lireJeu(f) {
  const contenus = lireShp(f.shp);
  if (f.shx.length !== 100 + 8 * contenus.length) throw new Error(`Le .shx annonce ${Math.max(0, (f.shx.length - 100) / 8)} objets, le .shp en contient ${contenus.length}.`);
  const ids = lireIdsDbf(f.dbf);
  if (ids.length !== contenus.length) throw new Error(`Le .dbf contient ${ids.length} enregistrements, le .shp ${contenus.length} objets.`);
  const champs = lireChampsDbf(f.dbf);
  return { objets: contenus.map((contenu, i) => ({ id: ids[i], contenu, genre: champs[i].genre, nom_fr: champs[i].nom_fr, nom_nl: champs[i].nom_nl })) };
}

/** Assemble .shp et .shx à partir des contenus d'enregistrements (copiés tels quels). */
export function composerShpShx(contenus) {
  let taille = 100;
  for (const c of contenus) taille += 8 + c.length;
  const shp = new Uint8Array(taille); const shx = new Uint8Array(100 + 8 * contenus.length);
  const vp = new DataView(shp.buffer); const vx = new DataView(shx.buffer);
  let xmin = Infinity; let ymin = Infinity; let xmax = -Infinity; let ymax = -Infinity;
  let pos = 100;
  contenus.forEach((c, i) => {
    const b = new DataView(c.buffer, c.byteOffset, c.byteLength);
    xmin = Math.min(xmin, b.getFloat64(4, true)); ymin = Math.min(ymin, b.getFloat64(12, true));
    xmax = Math.max(xmax, b.getFloat64(20, true)); ymax = Math.max(ymax, b.getFloat64(28, true));
    vp.setInt32(pos, i + 1, false); vp.setInt32(pos + 4, c.length / 2, false);
    shp.set(c, pos + 8);
    vx.setInt32(100 + 8 * i, pos / 2, false); vx.setInt32(100 + 8 * i + 4, c.length / 2, false);
    pos += 8 + c.length;
  });
  for (const [v, mots] of [[vp, shp.length / 2], [vx, shx.length / 2]]) {
    v.setInt32(0, 9994, false); v.setInt32(24, mots, false); v.setInt32(28, 1000, true); v.setInt32(32, 5, true);
    if (contenus.length) { v.setFloat64(36, xmin, true); v.setFloat64(44, ymin, true); v.setFloat64(52, xmax, true); v.setFloat64(60, ymax, true); }
  }
  return { shp, shx };
}

/**
 * Assemble le .dbf : id, GENRE, NOM_FR, NOM_NL. `lignes` = [{ id, genre, nom_fr, nom_nl }] (textes quelconques : mis en majuscules
 * sans accents, coupés à la largeur du champ). Renvoie { dbf, coupes } (coupes = nombre de valeurs raccourcies).
 */
export function composerDbf(lignes, maintenant = new Date()) {
  const champs = Object.entries(LARGEURS_DBF);
  const lenEntete = 32 + 32 * champs.length + 1;
  const lenEnreg = 1 + champs.reduce((s, [, l]) => s + l, 0);
  const dbf = new Uint8Array(lenEntete + lenEnreg * lignes.length + 1);
  const v = new DataView(dbf.buffer);
  dbf[0] = 0x03; dbf[1] = maintenant.getUTCFullYear() - 1900; dbf[2] = maintenant.getUTCMonth() + 1; dbf[3] = maintenant.getUTCDate();
  v.setUint32(4, lignes.length, true); v.setUint16(8, lenEntete, true); v.setUint16(10, lenEnreg, true);
  dbf[29] = 0x03; // octet de langue : Windows-1252 (sans effet : tout est en ASCII)
  champs.forEach(([nom, l], i) => {
    const o = 32 + 32 * i;
    for (let k = 0; k < nom.length; k++) dbf[o + k] = nom.charCodeAt(k);
    dbf[o + 11] = 0x43; dbf[o + 16] = l; // type C (texte)
  });
  dbf[lenEntete - 1] = 0x0d;
  let coupes = 0;
  const texte = (s, l) => { const t = enMajusculesSansAccents(s); if (t.length > l) coupes++; return t.slice(0, l); };
  lignes.forEach((ligne, i) => {
    let o = lenEntete + i * lenEnreg;
    dbf[o++] = 0x20;
    for (const [nom, l] of champs) {
      const valeur = nom === 'id' ? String(ligne.id).slice(0, l) : texte(ligne[{ GENRE: 'genre', NOM_FR: 'nom_fr', NOM_NL: 'nom_nl' }[nom]], l);
      for (let k = 0; k < l; k++) dbf[o + k] = k < valeur.length ? valeur.charCodeAt(k) : 0x20;
      o += l;
    }
  });
  dbf[dbf.length - 1] = 0x1a;
  return { dbf, coupes };
}

/**
 * Compare un jeu déposé à la version courante.
 * @param {{objets:{id:string, contenu:Uint8Array}[]}} courant   version courante
 * @param {{objets:{id:string, contenu:Uint8Array}[]}} depose    fichier déposé
 * @param {{motif:RegExp, connu:(id:string)=>boolean}} regle     format des identifiants et test « déjà attribué »
 * @returns {{ erreurs:string[], sansId:number[], doublons:{id:string, attribues:number[]}[], disparus:string[], modifies:string[], inchanges:number,
 *            ids:string[]|null }}
 *   `sansId` = positions (0…) des objets qui recevront un identifiant ; les identifiants sont attribués par l'appelant.
 */
export function analyserDepot(courant, depose, regle) {
  const erreurs = [];
  const parId = new Map(courant.objets.map((o) => [o.id, o]));
  const sansId = []; const vus = new Map(); const inconnus = [];
  depose.objets.forEach((o, i) => {
    if (!o.id) { sansId.push(i); return; }
    if (!regle.motif.test(o.id)) { erreurs.push(`Identifiant « ${o.id} » (objet n° ${i + 1}) : format non reconnu.`); return; }
    if (!parId.has(o.id) && !regle.connu(o.id)) inconnus.push(o.id);
    if (!vus.has(o.id)) vus.set(o.id, []);
    vus.get(o.id).push(i);
  });
  if (inconnus.length) erreurs.push(`Identifiants jamais attribués par l'application : ${inconnus.slice(0, 8).join(', ')}${inconnus.length > 8 ? '…' : ''}.`);
  // Doublons : celui dont le contour est identique à la version courante garde l'identifiant, les autres sont ré-attribués.
  const doublons = []; const reattribuer = new Set();
  for (const [id, positions] of vus) {
    if (positions.length < 2) continue;
    const ref = parId.get(id);
    const gardien = ref ? positions.find((i) => memesOctets(depose.objets[i].contenu, ref.contenu)) : undefined;
    if (gardien === undefined) { erreurs.push(`Identifiant en double ${id} (objets n° ${positions.map((i) => i + 1).join(', ')}) : impossible de savoir lequel est l'original.`); continue; }
    const autres = positions.filter((i) => i !== gardien);
    autres.forEach((i) => reattribuer.add(i));
    doublons.push({ id, attribues: autres });
  }
  const aAttribuer = [...sansId, ...reattribuer].sort((a, b) => a - b);
  const presents = new Set(depose.objets.filter((o, i) => o.id && !reattribuer.has(i)).map((o) => o.id));
  const disparus = courant.objets.map((o) => o.id).filter((id) => !presents.has(id));
  const modifies = []; let inchanges = 0;
  depose.objets.forEach((o, i) => {
    const ref = o.id && !reattribuer.has(i) && parId.get(o.id);
    if (!ref) return;
    if (memesOctets(o.contenu, ref.contenu)) inchanges++; else modifies.push(o.id);
  });
  return { erreurs, sansId: aAttribuer, doublons, disparus, modifies, inchanges };
}
