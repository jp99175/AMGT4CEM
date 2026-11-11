/**
 * Page jetable « ?page=tuning-synoptique » : calage du synoptique du réseau (data/synoptique/synoptique-reseau-v17.svg) sur le
 * fond de plan. Deux zones zoomables (2 doigts ou molette) : le fond UrbIS grisé en haut, le synoptique en bas.
 *
 * Ce que l'outil fait
 *  - Choisir une ligne (puces) : sa trace réelle (couche stib_lines de la Région) apparaît sur la carte dans la couleur du
 *    synoptique, avec les stations et les tunnels liés à cette ligne ; la carte et le synoptique se recadrent sur la sélection.
 *    Les arrêts réels ne sont plus affichés avec la ligne : un arrêt n'apparaît que lorsqu'on le touche dans le synoptique.
 *    Choisir la même ligne une seconde fois (ou « Tout désélectionner ») efface la trace.
 *  - Toucher une station ou un tronçon du synoptique : les polygones DITP-DIOV déjà liés (attribut data-p, identifiants P…) sont
 *    montrés sur la carte (aucun lien n'est à créer : ils sont déjà dans le dessin).
 *  - Toucher un arrêt (tram, ou terminus sans polygone) : les arrêts réels de même nom (couche stib_stops) sont proposés ; on
 *    coche ceux qui correspondent, puis « Valider ». Un arrêt dont le nom et la ligne ne donnent qu'un seul emplacement est
 *    proposé automatiquement (état « proposé ») ; plusieurs emplacements distants = « à choisir ».
 *  - « Contrôles » : résumé, arrêts à choisir, tunnels de la Région qui n'apparaissent pas dans le synoptique.
 *  - « Hors ligne » : choix des zones à garder pour le fond de plan hors ligne (lignes entières par leur étiquette ou leur puce,
 *    portions de ligne par leur station de début et de fin) ; l'outil calcule les tuiles UrbIS couvertes (marge de 100 m au zoom 19,
 *    doublée à chaque niveau en moins) et leur poids estimé. Rien n'est téléchargé ; la sélection reste sur l'appareil.
 *
 * Données
 *  - Arrêts réels (stib_stops, hors bus) et tracés (stib_lines, hors bus) : Région d'abord (WFS MobiGIS, Lambert 72), puis copie
 *    de secours du dépôt (config/secours/) si la Région refuse (CORS), ne répond pas ou renvoie un contenu inutilisable.
 *    Même principe que src/ditpDiovPublicLayer.js. Pas de copie de secours des tracés tant qu'aucun export n'a été déposé.
 *  - Polygones stations et tunnels : copie de la Région (config/secours/region-metro.json) reliée aux identifiants P… par
 *    data/ditp-diov/polygones.json (ogc_fid).
 *  - Liens validés : config/synoptique/liens.json (dépôt seul). L'outil garde un brouillon sur l'appareil ; « Télécharger les
 *    liens » donne le fichier à déposer dans le dépôt.
 *
 * Coordonnées en Lambert 72 ; la carte n'affiche qu'une conversion technique (src/crs.js).
 */

// basemap.js appelle ce module quand le fond change : sans objet ici (pas de capture d'écran sur cette page).
const AMGT4CEM_ScreenshotTool = { invalidateBackground() {} };

(function () {
'use strict';

const SVG_URL = './data/synoptique/synoptique-reseau-v17.svg';
const LIENS_URL = './config/synoptique/liens.json';
const POLYGONES_URL = './data/ditp-diov/polygones.json';
const REGION_URL = './config/secours/region-metro.json';
const ARRETS_SECOURS = './config/secours/stib-arrets-tram-metro.json';
const LIGNES_SECOURS = './config/secours/stib-lignes-tram-metro.json';
const CLE_BROUILLON = 'amgt4cem.tuning-synoptique.v1';
const CLE_HL = 'amgt4cem.tuning-synoptique.horsligne.v1';
const { tuilesAutour } = AMGT4CEM_TuilesGeom; // calcul des tuiles : src/tuilesGeom.js
const DISTANCE_MEME_LIEU_M = 150; // deux arrêts plus proches que ça forment un seul emplacement
const COULEURS_ETAT = { valide: '#2e7d32', auto: '#1565c0', ambigu: '#c62828', a_revoir: '#ef6c00', sans: '#6b7280', aucun: '#6b7280' };
const LIBELLES_ETAT = { valide: 'validé', auto: 'proposé', ambigu: 'à choisir', a_revoir: 'à revoir', sans: 'sans correspondance', aucun: 'pas d\'arrêt réel' };

const h = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v);
  }
  for (const c of kids) if (c) n.append(c);
  return n;
};
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tri = (a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b));
const listeLignes = (v) => String(v || '').replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean);

// ------------------------------------------------------------------ état

const S = {
  map: null,
  svg: null,
  pz: null,
  recs: new Map(), // id d'élément du synoptique -> fiche
  lignes: [], // numéros de lignes dessinées
  couleur: {}, // ligne -> couleur du synoptique
  pol: {}, // P… -> { genre, nom, ogc }
  region: new Map(), // ogc_fid -> polygone de la Région
  arrets: [], // arrêts réels
  lignesReelles: null, // promesse { features, source, erreur }
  liens: { arrets: {}, tunnels_hors_schema: {} },
  base: '', // liens du dépôt, en texte, pour repérer un brouillon différent
  sel: null,
  cand: null,
  dom: {},
  g: {},
  chaines: {}, // ligne -> chaîne ordonnée des tronçons (sélection hors ligne)
  hl: { actif: false, mode: 'ligne', etape: null, brouillon: null, lignes: [], portions: [], ps: new Set(), recsDirects: new Set(), items: [], resultat: null, calc: 0, carreaux: '19', segsP: new Map(), dom: {} },
};

// ------------------------------------------------------------------ lecture des données

async function lireJson(url, delaiMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), delaiMs || 15000);
  try {
    const r = await fetch(url, { signal: controller.signal, cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`pas de réponse en ${(delaiMs || 15000) / 1000} s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Couche de la Région (WFS, Lambert 72), sinon copie de secours du dépôt. Ne rejette jamais. */
async function lireCouche(couche, filtre, secours) {
  const cfg = AMGT4CEM_CONFIG.ditpDiovPublic || {};
  let raison = 'adresse de la Région non configurée';
  if (cfg.wfsUrl) {
    try {
      const q = new URLSearchParams({
        service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: `bm_public_transport:${couche}`,
        outputFormat: 'application/json', srsName: AMGT4CEM_CONFIG.businessCRS.epsg,
      });
      if (filtre) q.set('cql_filter', filtre);
      const g = await lireJson(`${cfg.wfsUrl}?${q.toString()}`, 25000);
      if (!g || !g.features || !g.features.length) throw new Error('réponse vide');
      return { features: g.features, source: 'Région' };
    } catch (err) {
      raison = err instanceof TypeError ? 'Région refusée ou injoignable (CORS ou réseau)' : String(err.message || err);
    }
  }
  try {
    const g = await lireJson(secours, 15000);
    if (!g || !g.features || !g.features.length) throw new Error('copie vide');
    return { features: g.features, source: `copie de secours du dépôt (${raison})` };
  } catch (err) {
    return { features: [], source: null, erreur: `${raison} ; pas de copie de secours utilisable (${err.message || err})` };
  }
}

function chargerLignesReelles() {
  if (!S.lignesReelles) S.lignesReelles = lireCouche('stib_lines', "mode<>'Bus'", LIGNES_SECOURS);
  return S.lignesReelles;
}

// ------------------------------------------------------------------ brouillon et liens

function normaliserLiens(l) {
  return { arrets: l.arrets || {}, tunnels_hors_schema: l.tunnels_hors_schema || {} };
}
function sauverBrouillon() {
  try { localStorage.setItem(CLE_BROUILLON, JSON.stringify({ liens: S.liens, modifie: Date.now() })); } catch (err) { /* stockage indisponible */ }
  majMessageBrouillon();
}
function brouillonDifferent() { return JSON.stringify(normaliserLiens(S.liens)) !== S.base; }
function majMessageBrouillon() {
  const n = Object.keys(S.liens.arrets).length + Object.keys(S.liens.tunnels_hors_schema).length;
  S.dom.btnTelecharger.textContent = brouillonDifferent() ? 'Télécharger (brouillon)' : 'Télécharger';
  S.dom.btnTelecharger.classList.toggle('tun-btn--on', brouillonDifferent());
  S.dom.nbLiens = n;
}
function telechargerLiens() {
  const sortie = {
    version: 1,
    date: new Date().toISOString().slice(0, 10),
    synoptique: 'synoptique-reseau-v17.svg',
    note: 'Liens validés à la main entre le synoptique et les données réelles. Produit par ?page=tuning-synoptique.',
    ...normaliserLiens(S.liens),
  };
  const blob = new Blob([JSON.stringify(sortie, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'liens.json' });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ------------------------------------------------------------------ le synoptique

const pointUtilisateur = (svg, x, y) => {
  const p = svg.createSVGPoint();
  p.x = x; p.y = y;
  return p.matrixTransform(svg.getScreenCTM().inverse());
};
/** Emprise d'un élément en unités du dessin (tient compte de ses transformations). */
function boite(el) {
  const r = el.getBoundingClientRect();
  const a = pointUtilisateur(S.svg, r.left, r.top);
  const b = pointUtilisateur(S.svg, r.right, r.bottom);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Zoom/déplacement du dessin : pincement à 2 doigts, glisser, molette ; un toucher bref sans mouvement = sélection. */
function PanZoom(zone, svg, complet, surToucher) {
  let vb = { ...complet };
  const pts = new Map();
  let depart = null;
  let bouge = false;
  let cible = null;
  let pince = null;
  let anim = null;
  const appliquer = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const borne = (w) => Math.max(complet.w / 60, Math.min(complet.w * 1.6, w));
  function zoomerAutour(facteur, cx, cy, base) {
    const b = base || vb;
    const avant = pointUtilisateur(svg, cx, cy);
    const w = borne(b.w * facteur);
    const k = w / b.w;
    vb = { x: b.x, y: b.y, w, h: b.h * k };
    appliquer();
    const apres = pointUtilisateur(svg, cx, cy);
    vb.x += avant.x - apres.x;
    vb.y += avant.y - apres.y;
    appliquer();
  }
  zone.addEventListener('pointerdown', (e) => {
    if (anim) { cancelAnimationFrame(anim); anim = null; }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      depart = { x: e.clientX, y: e.clientY };
      bouge = false;
      cible = e.target.closest ? e.target.closest('[data-type],[data-bague],[data-etq]') : null;
    } else if (pts.size === 2) {
      bouge = true;
      const [p, q] = [...pts.values()];
      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2;
      pince = { d0: Math.hypot(p.x - q.x, p.y - q.y), vb0: { ...vb }, u0: pointUtilisateur(svg, mx, my) };
    }
    try { zone.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
    e.preventDefault();
  });
  zone.addEventListener('pointermove', (e) => {
    const avant = pts.get(e.pointerId);
    if (!avant) return;
    if (pts.size === 1) {
      if (!bouge && Math.hypot(e.clientX - depart.x, e.clientY - depart.y) > 6) bouge = true;
      if (bouge) {
        const echelle = svg.getScreenCTM().a;
        vb.x -= (e.clientX - avant.x) / echelle;
        vb.y -= (e.clientY - avant.y) / echelle;
        appliquer();
      }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    } else if (pts.size === 2 && pince) {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [p, q] = [...pts.values()];
      const d = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2;
      const w = borne(pince.vb0.w * (pince.d0 / d));
      vb = { x: pince.vb0.x, y: pince.vb0.y, w, h: pince.vb0.h * (w / pince.vb0.w) };
      appliquer();
      const u = pointUtilisateur(svg, mx, my);
      vb.x += pince.u0.x - u.x;
      vb.y += pince.u0.y - u.y;
      appliquer();
    }
  });
  const fin = (e) => {
    if (!pts.has(e.pointerId)) return;
    const etaitSeul = pts.size === 1;
    pts.delete(e.pointerId);
    if (pts.size < 2) pince = null;
    if (etaitSeul && !bouge && e.type === 'pointerup') surToucher(cible);
    if (pts.size === 1) { // un doigt reste posé après un pincement : repartir de sa position, sans sélection
      const [p] = [...pts.values()];
      depart = { x: p.x, y: p.y };
      bouge = true;
    }
  };
  zone.addEventListener('pointerup', fin);
  zone.addEventListener('pointercancel', fin);
  zone.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomerAutour(Math.exp(e.deltaY * 0.0016), e.clientX, e.clientY);
  }, { passive: false });

  return {
    /** Recadre sur une emprise (unités du dessin), en 250 ms. */
    recadrer(b, marge) {
      const r = zone.getBoundingClientRect();
      const asp = (r.width || 1) / (r.height || 1);
      const m = marge == null ? 1.25 : marge;
      let w = Math.max(b.w * m, b.h * m * asp, complet.w / 40);
      let hh = w / asp;
      const cible2 = { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - hh / 2, w, h: hh };
      const de = { ...vb };
      const t0 = performance.now();
      if (anim) cancelAnimationFrame(anim);
      const pas = (t) => {
        const k = Math.min(1, (t - t0) / 250);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        vb = { x: de.x + (cible2.x - de.x) * e, y: de.y + (cible2.y - de.y) * e, w: de.w + (cible2.w - de.w) * e, h: de.h + (cible2.h - de.h) * e };
        appliquer();
        anim = k < 1 ? requestAnimationFrame(pas) : null;
      };
      anim = requestAnimationFrame(pas);
    },
    tout() { this.recadrer(complet, 1); },
  };
}

function lignesDeCouleur(style) {
  const m = /url\(#grad-([\d-]+)\)/.exec(style || '');
  if (m) return m[1].split('-');
  const c = /stroke:\s*(#[0-9a-fA-F]{6})/.exec(style || '');
  if (!c) return [];
  const pareil = Object.entries(S.couleur).filter(([, v]) => v.toLowerCase() === c[1].toLowerCase()).map(([k]) => k);
  return pareil;
}

function monterSynoptique(texte, zone) {
  const doc = new DOMParser().parseFromString(texte, 'image/svg+xml');
  const svg = document.importNode(doc.documentElement, true);
  if (svg.nodeName.toLowerCase() !== 'svg') throw new Error('synoptique illisible');
  const vb = svg.getAttribute('viewBox').split(/\s+/).map(Number);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  // Les tronçons (zones de toucher invisibles, dessinées en dernier) passent SOUS les stations et les arrêts : sinon ils les masquent.
  const troncons = svg.querySelector('#troncons');
  const stations = svg.querySelector('#stations');
  if (troncons && stations) stations.parentNode.insertBefore(troncons, stations);
  zone.append(svg);
  S.svg = svg;

  for (const g of svg.querySelectorAll('#lignes > g[data-ligne]')) {
    const traits = [...g.querySelectorAll('path')].filter((p) => !p.classList.contains('halo'));
    const n = g.getAttribute('data-ligne');
    S.lignes.push(n);
    S.couleur[n] = traits.length ? traits[traits.length - 1].getAttribute('stroke') : '#444';
  }
  S.lignes.sort(tri);

  for (const el of svg.querySelectorAll('[data-type]')) {
    const type = el.getAttribute('data-type');
    let ps = (el.getAttribute('data-p') || '').split(/\s+/).filter(Boolean);
    if (!ps.length && type === 'terminus') {
      // Un terminus sans data-p hérite du polygone de son étiquette (même nom, même ligne) : ex. Simonis (Leopold II).
      const etq = svg.querySelector(`#etiquettes-lignes > g[data-ligne="${el.getAttribute('data-ligne')}"][data-nom="${el.getAttribute('data-nom')}"][data-p]`);
      if (etq) ps = etq.getAttribute('data-p').split(/\s+/).filter(Boolean);
    }
    let lignes = [];
    if (type === 'station') lignes = (el.getAttribute('data-lignes') || '').split(/\s+/).filter(Boolean);
    else if (type === 'arret') lignes = lignesDeCouleur(el.getAttribute('style'));
    else if (el.getAttribute('data-ligne')) lignes = [el.getAttribute('data-ligne')];
    const kind = type === 'troncon' ? 'troncon' : (ps.length ? 'station' : 'arret');
    S.recs.set(el.id, { id: el.id, el, type, kind, nom: el.getAttribute('data-nom') || el.id, lignes, ps });
  }

  svg.querySelectorAll('#etiquettes-lignes > g').forEach((g) => g.setAttribute('data-etq', '1'));

  // Noms des stations et arrêts : chacun suit l'objet le plus proche (pour être estompé avec lui).
  const centres = [...S.recs.values()].filter((r) => r.type !== 'troncon').map((r) => { const bx = boite(r.el); return { r, x: bx.x + bx.w / 2, y: bx.y + bx.h / 2 }; });
  S.noms = [];
  for (const t of svg.querySelectorAll('text.lbl')) {
    const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(t.getAttribute('transform') || '');
    if (!m || !centres.length) continue;
    const x = Number(m[1]); const y = Number(m[2]);
    let best = null; let d0 = Infinity;
    for (const c of centres) { const d = Math.hypot(c.x - x, c.y - y); if (d < d0) { d0 = d; best = c.r; } }
    if (best) S.noms.push({ t, rec: best });
  }

  // Bagues autour des arrêts à relier (état du lien) : zone de toucher agrandie pour le doigt.
  const marques = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  marques.setAttribute('id', 'tun-marques');
  svg.append(marques);
  S.g.marques = marques;
  S.pz = PanZoom(zone, svg, { x: vb[0], y: vb[1], w: vb[2], h: vb[3] }, surToucherSynoptique);
  for (const rec of S.recs.values()) {
    if (rec.kind !== 'arret') continue;
    const b = boite(rec.el);
    rec.c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const bague = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bague.setAttribute('cx', rec.c.x);
    bague.setAttribute('cy', rec.c.y);
    bague.setAttribute('r', 15);
    bague.setAttribute('class', 'tun-bague');
    bague.setAttribute('data-bague', rec.id);
    marques.append(bague);
    rec.bague = bague;
  }
}

function surToucherSynoptique(cible) {
  if (S.hl.actif) { surToucherHL(cible); return; }
  if (!cible) { effacerSelection(); return; }
  let id = cible.getAttribute('data-bague') || cible.id;
  if (cible.hasAttribute('data-etq')) {
    // Étiquette de ligne : on retombe sur son terminus, sinon sur la station qu'elle désigne par data-p.
    const p1 = (cible.getAttribute('data-p') || '').split(/\s+/)[0];
    id = S.recs.has(`TERM-${id.slice(4)}`) ? `TERM-${id.slice(4)}` : p1;
  }
  const rec = S.recs.get(id);
  if (!rec) { effacerSelection(); return; }
  if (S.sel && S.sel.id === rec.id) { effacerSelection(); return; }
  selectionner({ kind: rec.kind, id: rec.id });
}

// ------------------------------------------------------------------ arrêts réels : propositions

function noms(f) {
  if (!f._n) f._n = [norm(f.properties.name_fr), norm(f.properties.name_nl)].filter(Boolean);
  return f._n;
}
function xyArret(f) { return f.geometry.coordinates; }

function amas(items) {
  const groupes = [];
  for (const it of items) {
    const [x, y] = xyArret(it.f);
    const g = groupes.find((gr) => gr.some((o) => Math.hypot(xyArret(o.f)[0] - x, xyArret(o.f)[1] - y) < DISTANCE_MEME_LIEU_M));
    if (g) g.push(it); else groupes.push([it]);
  }
  return groupes;
}

function candidatsDe(rec) {
  const complet = norm(rec.nom);
  const sansParentheses = norm(rec.nom.replace(/\(.*?\)/g, ''));
  let trouves = S.arrets.filter((f) => noms(f).includes(complet));
  let genre = 'nom identique';
  if (!trouves.length && sansParentheses) { trouves = S.arrets.filter((f) => noms(f).includes(sansParentheses)); genre = 'nom sans parenthèse'; }
  if (!trouves.length && sansParentheses.length > 3) { trouves = S.arrets.filter((f) => noms(f).some((n) => n.startsWith(`${sansParentheses} `) || sansParentheses.startsWith(`${n} `))); genre = 'nom approché'; }
  return trouves.map((f) => {
    const lignes = listeLignes(f.properties.line);
    return { f, id: f.properties.stop_id, lignes, commun: lignes.filter((l) => rec.lignes.includes(l)), genre };
  });
}

/** État du lien d'un arrêt du synoptique : validé à la main, sinon proposé automatiquement. */
function etatArret(rec) {
  const stocke = S.liens.arrets[rec.id];
  if (stocke) return { etat: stocke.etat, ids: stocke.stops || [], auto: false };
  const prefs = candidatsDe(rec).filter((c) => c.commun.length);
  if (!prefs.length) return { etat: 'sans', ids: [], auto: true };
  return { etat: amas(prefs).length > 1 ? 'ambigu' : 'auto', ids: prefs.map((c) => c.id), auto: true };
}

function majBagues() {
  for (const rec of S.recs.values()) {
    if (!rec.bague) continue;
    const { etat } = etatArret(rec);
    rec.bague.setAttribute('stroke', COULEURS_ETAT[etat]);
    rec.bague.setAttribute('stroke-dasharray', etat === 'sans' || etat === 'aucun' ? '3 3' : '');
    rec.bague.classList.toggle('tun-bague--sel', !!S.sel && S.sel.id === rec.id);
  }
}

// ------------------------------------------------------------------ carte

const enLatLng = (xy) => AMGT4CEM_CRS.lambertToLatLng(xy);
function anneaux(f) { return f.geometry.coordinates.map((r) => r.map(enLatLng)); }
function lignesLatLng(geom) {
  if (!geom) return [];
  if (geom.type === 'LineString') return [geom.coordinates.map(enLatLng)];
  if (geom.type === 'MultiLineString') return geom.coordinates.map((l) => l.map(enLatLng));
  return [];
}
function viderCarte() { for (const k of ['trace', 'poly', 'arrets']) S.g[k].clearLayers(); }

function polygonesDe(ps, couleur, fin) {
  const b = L.latLngBounds([]);
  let manque = 0;
  for (const p of ps) {
    const info = S.pol[p];
    const f = info && S.region.get(info.ogc);
    if (!f) { manque += 1; continue; }
    const tunnel = info.genre === 'tunnel';
    const lay = L.polygon(anneaux(f), fin ? { color: couleur, weight: 1, fillColor: couleur, fillOpacity: 0.06 } : { color: couleur, weight: tunnel ? 2 : 3, fillColor: couleur, fillOpacity: tunnel ? 0.35 : 0.55 });
    lay.bindTooltip(`${info.nom} (${p})`, { className: 'tun-tip' });
    lay.addTo(S.g.poly);
    b.extend(lay.getBounds());
  }
  return { b, manque };
}

function recadrerCarte(b) {
  if (b && b.isValid()) S.map.fitBounds(b, { padding: [24, 24], maxZoom: 19, animate: true });
}

// ------------------------------------------------------------------ sélection

function badges(lignes) {
  const f = document.createDocumentFragment();
  for (const l of lignes) {
    const c = S.couleur[l] || '#6b7280';
    f.append(h('span', { class: 'tun-badge', style: `background:${c};color:${c.toLowerCase() === '#efe047' ? '#1f2933' : '#fff'}`, text: l }));
  }
  return f;
}
const etiquetteEtat = (etat) => h('span', { class: `tun-etat tun-etat--${etat}`, text: LIBELLES_ETAT[etat] });

function effacerSelection() {
  S.sel = null;
  S.cand = null;
  viderCarte();
  S.svg.classList.remove('tun-dim');
  S.svg.querySelectorAll('.tun-on,.tun-sel').forEach((n) => n.classList.remove('tun-on', 'tun-sel'));
  S.dom.detail.replaceChildren();
  majPuces();
  majBagues();
  if (S.hl.actif) rendreHL();
}

function selectionner(sel) {
  effacerSelection();
  S.sel = sel;
  majPuces();
  if (sel.kind === 'ligne') selectionnerLigne(sel.id);
  else if (sel.kind === 'arret') selectionnerArret(S.recs.get(sel.id));
  else selectionnerPolygones(S.recs.get(sel.id));
  majBagues();
}

async function selectionnerLigne(n) {
  const couleur = S.couleur[n];
  const groupe = S.svg.querySelector(`#lignes > g[data-ligne="${n}"]`);
  S.svg.classList.add('tun-dim');
  if (groupe) groupe.classList.add('tun-on');
  const miens = [...S.recs.values()].filter((r) => r.lignes.includes(n) || (r.type === 'troncon' && r.lignes.includes(n)));
  miens.forEach((r) => r.el.classList.add('tun-on'));
  S.noms.forEach((o) => { if (o.rec.lignes.includes(n)) o.t.classList.add('tun-on'); });
  S.svg.querySelectorAll(`#etiquettes-lignes > g[data-ligne="${n}"]`).forEach((g) => g.classList.add('tun-on'));
  if (groupe) S.pz.recadrer(boite(groupe), 1.12);

  const ps = [...new Set(miens.flatMap((r) => r.ps))];
  const { b, manque } = polygonesDe(ps, couleur, true);
  const stats = { valide: 0, auto: 0, ambigu: 0, a_revoir: 0, sans: 0, aucun: 0 };
  miens.filter((r) => r.kind === 'arret').forEach((r) => { stats[etatArret(r).etat] += 1; });
  const nArrets = miens.filter((r) => r.kind === 'arret').length;
  const nStations = new Set(miens.filter((r) => r.kind === 'station').flatMap((r) => r.ps)).size;
  const nTroncons = miens.filter((r) => r.kind === 'troncon').length;

  const carte = h('div', { class: 'tun-d-ligne', text: 'Tracé réel : chargement…' });
  S.dom.detail.append(
    h('p', { class: 'tun-d-titre' }, 'Ligne ', badges([n])),
    h('div', { class: 'tun-d-ligne', text: `${nStations} stations et ${nTroncons} tronçons liés dans le synoptique${manque ? ` (${manque} polygone(s) absent(s) de la copie de la Région)` : ''}.` }),
    h('div', { class: 'tun-d-ligne', text: nArrets ? `${nArrets} arrêts à relier : ${stats.valide} validés, ${stats.auto} proposés, ${stats.ambigu} à choisir, ${stats.a_revoir} à revoir, ${stats.sans + stats.aucun} sans correspondance.` : 'Pas d\'arrêt de tram à relier sur cette ligne.' }),
    carte,
  );
  recadrerCarte(b);

  const res = await chargerLignesReelles();
  if (!S.sel || S.sel.kind !== 'ligne' || S.sel.id !== n) return; // la sélection a changé pendant la lecture
  if (res.erreur) {
    carte.textContent = `Tracé réel indisponible : ${res.erreur}. Envoie l'export de la couche stib_lines (hors bus) pour qu'il soit déposé dans le dépôt.`;
    carte.style.color = '#9b1c1c';
    return;
  }
  const mien = res.features.filter((f) => String(f.properties.line) === String(n));
  if (!mien.length) {
    carte.textContent = `Aucun tracé « ligne ${n} » dans la couche stib_lines (source : ${res.source}).`;
    return;
  }
  const bt = L.latLngBounds([]);
  for (const f of mien) {
    for (const ll of lignesLatLng(f.geometry)) {
      const pl = L.polyline(ll, { color: couleur, weight: 8, opacity: 0.9, lineCap: 'round' });
      pl.addTo(S.g.trace);
      bt.extend(pl.getBounds());
    }
  }
  carte.textContent = `Tracé réel : ${mien.length} variante(s), source ${res.source}.`;
  const tout = L.latLngBounds([]);
  if (b.isValid()) tout.extend(b);
  if (bt.isValid()) tout.extend(bt);
  recadrerCarte(tout);
}

function selectionnerPolygones(rec) {
  rec.el.classList.add('tun-sel');
  const couleur = rec.lignes.length ? (S.couleur[rec.lignes[0]] || '#0b5c75') : '#0b5c75';
  const { b, manque } = polygonesDe(rec.ps, couleur);
  const lignes = h('div', { class: 'tun-d-ligne' }, rec.kind === 'troncon' ? 'Tronçon, ligne ' : 'Station, ligne(s) ', badges(rec.lignes));
  S.dom.detail.append(
    h('p', { class: 'tun-d-titre', text: rec.nom }),
    lignes,
    h('div', { class: 'tun-d-ligne', text: `Polygone(s) de la Région déjà liés : ${rec.ps.map((p) => `${p} (${(S.pol[p] && S.pol[p].nom) || 'inconnu'})`).join(' ; ')}.${manque ? ` ${manque} absent(s) de la copie de la Région.` : ''}` }),
    h('div', { class: 'tun-d-ligne', text: 'Ces liens sont déjà dans le dessin (attribut data-p) : rien à valider ici, seulement à contrôler sur la carte.' }),
  );
  if (rec.kind === 'troncon') S.pz.recadrer(boite(rec.el), 2.2);
  else { const bx = boite(rec.el); S.pz.recadrer({ x: bx.x - 70, y: bx.y - 70, w: bx.w + 140, h: bx.h + 140 }, 1); }
  recadrerCarte(b);
}

function selectionnerArret(rec) {
  rec.el.classList.add('tun-sel');
  const cands = candidatsDe(rec).sort((a, b2) => b2.commun.length - a.commun.length || a.id.localeCompare(b2.id));
  const { ids, auto, etat } = etatArret(rec);
  S.cand = { rec, items: cands.map((c) => ({ ...c, coche: ids.includes(c.id) })), etat, auto };
  dessinerArretsReels();
  const bx = boite(rec.el);
  S.pz.recadrer({ x: bx.x - 80, y: bx.y - 80, w: bx.w + 160, h: bx.h + 160 }, 1);
  rendreDetailArret();
  const b = L.latLngBounds(S.cand.items.map((c) => enLatLng(xyArret(c.f))));
  recadrerCarte(b);
}

function dessinerArretsReels() {
  S.g.arrets.clearLayers();
  if (!S.cand) return;
  const couleur = S.cand.rec.lignes.length ? (S.couleur[S.cand.rec.lignes[0]] || '#0b5c75') : '#0b5c75';
  for (const c of S.cand.items) {
    const m = L.circleMarker(enLatLng(xyArret(c.f)), { radius: 10, color: couleur, weight: 3, fillColor: couleur, fillOpacity: c.coche ? 0.9 : 0.05 });
    m.bindTooltip(`${c.f.properties.name_fr} · ${c.f.properties.mode} ${c.lignes.join(',')} · ${c.id}`, { className: 'tun-tip' });
    m.on('click', () => { c.coche = !c.coche; dessinerArretsReels(); rendreDetailArret(); });
    m.addTo(S.g.arrets);
  }
}

function rendreDetailArret() {
  const { rec, items } = S.cand;
  const d = S.dom.detail;
  d.replaceChildren();
  const stocke = S.liens.arrets[rec.id];
  const etat = stocke ? stocke.etat : etatArret(rec).etat;
  d.append(
    h('p', { class: 'tun-d-titre' }, `${rec.nom} `, etiquetteEtat(etat)),
    h('div', { class: 'tun-d-ligne' }, 'Lignes du dessin : ', badges(rec.lignes), ` — ${rec.id}`),
  );
  if (!items.length) d.append(h('div', { class: 'tun-d-ligne', style: 'color:#9b1c1c', text: 'Aucun arrêt réel de ce nom (ni nom approché) dans les données tram et métro.' }));
  else d.append(h('div', { class: 'tun-d-ligne', text: `${items.length} arrêt(s) réel(s) de ce nom (${items[0].genre}). Coche ceux qui correspondent à ce rond du synoptique.` }));
  items.forEach((c, i) => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = c.coche;
    cb.addEventListener('change', () => { c.coche = cb.checked; dessinerArretsReels(); });
    const txt = h('div', { class: 'tun-cand-txt' },
      `${c.f.properties.name_fr} `, badges(c.lignes),
      h('small', { text: ` ${c.f.properties.mode} · arrêt ${c.id}${c.commun.length ? '' : ' · autre ligne que le dessin'}` }));
    txt.addEventListener('click', () => {
      const ll = enLatLng(xyArret(c.f));
      S.map.setView(ll, Math.max(S.map.getZoom(), 18), { animate: true });
    });
    d.append(h('div', { class: 'tun-cand' }, cb, txt));
    c.i = i;
  });
  const valider = h('button', { class: 'tun-btn tun-btn--on', text: 'Valider cette sélection' });
  valider.addEventListener('click', () => enregistrerArret('valide'));
  const revoir = h('button', { class: 'tun-btn', text: 'À revoir' });
  revoir.addEventListener('click', () => enregistrerArret('a_revoir'));
  const aucun = h('button', { class: 'tun-btn', text: 'Pas d\'arrêt réel' });
  aucun.addEventListener('click', () => { items.forEach((c) => { c.coche = false; }); enregistrerArret('aucun'); });
  const actions = h('div', { class: 'tun-d-actions' }, valider, revoir, aucun);
  if (stocke) {
    const effacer = h('button', { class: 'tun-btn tun-btn--danger', text: 'Effacer mon choix' });
    effacer.addEventListener('click', () => { delete S.liens.arrets[rec.id]; sauverBrouillon(); selectionner({ kind: 'arret', id: rec.id }); });
    actions.append(effacer);
  }
  d.append(actions);
}

function enregistrerArret(etat) {
  const { rec, items } = S.cand;
  S.liens.arrets[rec.id] = { stops: items.filter((c) => c.coche).map((c) => c.id), etat };
  sauverBrouillon();
  majBagues();
  rendreDetailArret();
  majMessage(`${rec.nom} : ${LIBELLES_ETAT[etat]}.`);
}

// ------------------------------------------------------------------ sélection pour le fond de plan hors ligne
//
// Rien n'est téléchargé : l'outil désigne des zones (lignes entières, ou portions de ligne entre deux stations) et calcule les
// tuiles du fond UrbIS qui les couvrent, avec leur poids estimé. Décisions du 10 et 11/11/2026 : voir
// claude/specification-cache-hors-ligne.md (projet). Marge de 100 m au zoom 19, doublée à chaque niveau en moins.

const HL_ZOOMS = [19, 18, 17, 16, 15];
const HL_MARGE_19_M = 100;
const HL_KO_PAR_TUILE = { 19: 7.9, 18: 11.9, 17: 18.2, 16: 9.7, 15: 14.8 }; // poids moyens mesurés le 06/11/2026 (couche UrbISFrenchLabeledGray)
const HL_TOLERANCE = 3; // unités du dessin : écart toléré entre le bout d'un tronçon et le contour d'une station

const fmtN = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const fmtMo = (ko) => { const mo = ko / 1000; return `${mo < 10 ? mo.toFixed(1).replace('.', ',') : Math.round(mo)} Mo`; };
const distBoite = (p, b) => Math.hypot(Math.max(b.x - p.x, 0, p.x - (b.x + b.w)), Math.max(b.y - p.y, 0, p.y - (b.y + b.h)));
const nomSansParentheses = (t) => norm(String(t).replace(/\(.*?\)/g, ''));

/**
 * Chaîne ordonnée des tronçons d'une ligne (ordre du dessin). Chaque tronçon va d'une position `pa` à `pa + 1` ; deux tronçons
 * qui se touchent partagent la même position (une station y est), un trou dans le dessin laisse une position sans tronçon.
 */
function chaineDeLigne(n) {
  if (S.chaines[n]) return S.chaines[n];
  const troncons = [];
  const gaps = [];
  let precedent = null;
  for (const rec of S.recs.values()) {
    if (rec.kind !== 'troncon' || !rec.lignes.includes(n)) continue;
    const a = rec.el.getPointAtLength(0);
    const b = rec.el.getPointAtLength(rec.el.getTotalLength());
    let pa = 0;
    if (precedent) {
      if (Math.hypot(a.x - precedent.b.x, a.y - precedent.b.y) <= HL_TOLERANCE) pa = precedent.pb;
      else { pa = precedent.pb + 1; gaps.push({ avant: precedent.rec, apres: rec, pos: precedent.pb }); }
    }
    const t = { rec, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, pa, pb: pa + 1 };
    troncons.push(t);
    precedent = t;
  }
  S.chaines[n] = { troncons, gaps };
  return S.chaines[n];
}

const stationsDeLigne = (n) => [...S.recs.values()].filter((r) => r.kind === 'station' && r.lignes.includes(n));

/** Positions de la chaîne de la ligne n où se trouve cette station (vide si elle n'est pas sur le tunnel de la ligne). */
function positionsSurLigne(rec, n) {
  if (!rec.lignes.includes(n)) return [];
  if (!rec.box) rec.box = boite(rec.el);
  const out = new Set();
  for (const t of chaineDeLigne(n).troncons) {
    if (distBoite(t.a, rec.box) <= HL_TOLERANCE) out.add(t.pa);
    if (distBoite(t.b, rec.box) <= HL_TOLERANCE) out.add(t.pb);
  }
  return [...out].sort((x, y) => x - y);
}

/** Nom d'une station dans la liste : si la ligne y passe à plusieurs emplacements (Simonis), le numéro d'emplacement est ajouté. */
function libelleArret(rec, n) {
  if (/\(.*\)/.test(rec.nom)) return rec.nom;
  const base = nomSansParentheses(rec.nom);
  const emplacements = [...new Set(stationsDeLigne(n).filter((r) => nomSansParentheses(r.nom) === base).flatMap((r) => positionsSurLigne(r, n)))].sort((a, b) => a - b);
  if (emplacements.length < 2) return rec.nom;
  return `${rec.nom} (emplacement ${emplacements.indexOf(positionsSurLigne(rec, n)[0]) + 1}/${emplacements.length})`;
}

function resoudreLigne(n) {
  const ch = chaineDeLigne(n);
  const ps = new Set();
  const recs = new Set();
  const avert = [];
  ch.troncons.forEach((t) => { t.rec.ps.forEach((p) => ps.add(p)); recs.add(t.rec); });
  stationsDeLigne(n).forEach((r) => r.ps.forEach((p) => ps.add(p)));
  const nArrets = [...S.recs.values()].filter((r) => r.kind === 'arret' && r.lignes.includes(n)).length;
  if (!ps.size) avert.push('aucun polygone lié à cette ligne dans le synoptique : rien à garder pour l\'instant');
  else if (nArrets) avert.push(`seule la partie en tunnel est gardée (${nArrets} arrêts sans polygone, calage non validé)`);
  ch.gaps.forEach((g) => avert.push(`tunnel absent du synoptique entre « ${g.avant.nom} » et « ${g.apres.nom} »`));
  return { ps, recs, avert };
}

function resoudrePortion(p) {
  const n = p.ligne;
  const ra = S.recs.get(p.debut);
  const rb = S.recs.get(p.fin);
  const pa = ra ? positionsSurLigne(ra, n) : [];
  const pb = rb ? positionsSurLigne(rb, n) : [];
  const ps = new Set();
  const recs = new Set();
  const avert = [];
  if (!pa.length || !pb.length) return { ps, recs, avert: [`début ou fin introuvable sur la ligne ${n}`], texte: '?' };
  const lo = Math.min(pa[0], pb[0]);
  const hi = Math.max(pa[0], pb[0]);
  const ch = chaineDeLigne(n);
  ch.troncons.forEach((t) => { if (t.pa >= lo && t.pb <= hi) { t.rec.ps.forEach((x) => ps.add(x)); recs.add(t.rec); } });
  stationsDeLigne(n).forEach((r) => { if (positionsSurLigne(r, n).some((x) => x >= lo && x <= hi)) r.ps.forEach((x) => ps.add(x)); });
  ch.gaps.forEach((g) => { if (g.pos >= lo && g.pos + 1 <= hi) avert.push(`tunnel absent du synoptique entre « ${g.avant.nom} » et « ${g.apres.nom} »`); });
  return { ps, recs, avert, texte: `${libelleArret(ra, n)} → ${libelleArret(rb, n)}` };
}

function recalculerSelectionHL() {
  const H = S.hl;
  H.ps = new Set();
  H.recsDirects = new Set();
  H.items = [];
  for (const n of H.lignes) {
    const r = resoudreLigne(n);
    r.ps.forEach((p) => H.ps.add(p));
    r.recs.forEach((x) => H.recsDirects.add(x));
    H.items.push({ genre: 'ligne', ligne: n, texte: 'ligne entière', nb: r.ps.size, avert: r.avert });
  }
  H.portions.forEach((p, i) => {
    const r = resoudrePortion(p);
    r.ps.forEach((x) => H.ps.add(x));
    r.recs.forEach((x) => H.recsDirects.add(x));
    H.items.push({ genre: 'portion', idx: i, ligne: p.ligne, texte: r.texte, nb: r.ps.size, avert: r.avert });
  });
  majHLSynop();
  sauverHL();
  calculerTuilesHL();
}

function sauverHL() {
  try { localStorage.setItem(CLE_HL, JSON.stringify({ lignes: S.hl.lignes, portions: S.hl.portions })); } catch (err) { /* stockage indisponible */ }
}
function restaurerHL() {
  try {
    const v = JSON.parse(localStorage.getItem(CLE_HL) || 'null');
    if (!v) return;
    S.hl.lignes = (v.lignes || []).filter((n) => S.lignes.includes(n));
    S.hl.portions = (v.portions || []).filter((p) => S.lignes.includes(p.ligne) && S.recs.has(p.debut) && S.recs.has(p.fin));
  } catch (err) { /* sélection illisible : ignorée */ }
}

/** Surbrillance de la sélection dans le synoptique : tronçons choisis, tronçons des autres lignes qui partagent le même tunnel, stations. */
function majHLSynop() {
  for (const r of S.recs.values()) {
    if (r.kind === 'troncon') { r.el.classList.remove('tun-hl', 'tun-hl2'); r.el.style.removeProperty('stroke'); } else r.el.classList.remove('tun-hl-st');
  }
  if (!S.hl.actif) return;
  for (const r of S.recs.values()) {
    if (r.kind === 'troncon') {
      const direct = S.hl.recsDirects.has(r);
      if (direct || r.ps.some((p) => S.hl.ps.has(p))) {
        r.el.classList.add(direct ? 'tun-hl' : 'tun-hl2');
        r.el.style.stroke = S.couleur[r.lignes[0]] || '#0b5c75';
      }
    } else if (r.kind === 'station' && r.ps.some((p) => S.hl.ps.has(p))) r.el.classList.add('tun-hl-st');
  }
}

// --- calcul des tuiles

function segmentsDe(p) {
  if (S.hl.segsP.has(p)) return S.hl.segsP.get(p);
  const info = S.pol[p];
  const f = info && S.region.get(info.ogc);
  const segs = [];
  if (f) {
    const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : [].concat(...f.geometry.coordinates);
    for (const ring of rings) {
      const pts = ring.map((c) => proj4(AMGT4CEM_CONFIG.businessCRS.epsg, 'EPSG:3857', [c[0], c[1]]));
      for (let i = 0; i < pts.length - 1; i += 1) segs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]]);
    }
  }
  S.hl.segsP.set(p, segs);
  return segs;
}

async function calculerTuilesHL() {
  const H = S.hl;
  const id = ++H.calc;
  const ps = [...H.ps];
  H.resultat = null;
  if (!ps.length) { rendreResultatHL(); return; }
  const segs = ps.flatMap(segmentsDe);
  const manque = ps.filter((p) => !segmentsDe(p).length).length;
  const res = [];
  rendreResultatHL(null, true);
  for (const z of HL_ZOOMS) {
    await new Promise((r) => setTimeout(r, 0));
    if (id !== H.calc) return; // la sélection a changé pendant le calcul
    res.push({ z, marge: HL_MARGE_19_M * 2 ** (19 - z), liste: tuilesAutour(segs, z, HL_MARGE_19_M * 2 ** (19 - z)) });
  }
  H.resultat = { res, manque, nbPoly: ps.length };
  rendreResultatHL();
}

function rendreResultatHL(_, enCours) {
  const H = S.hl;
  H.dom.res && H.dom.res.replaceChildren();
  S.g.carreaux.clearLayers();
  if (!H.dom.res) return;
  if (!H.ps.size) { H.dom.res.append(h('div', { class: 'tun-d-ligne', text: 'Rien de choisi pour l\'instant.' })); return; }
  if (enCours || !H.resultat) { H.dom.res.append(h('div', { class: 'tun-d-ligne', text: 'Calcul des tuiles…' })); return; }
  const r = H.resultat;
  let total = 0;
  let ko = 0;
  for (const e of r.res) {
    total += e.liste.length;
    ko += e.liste.length * HL_KO_PAR_TUILE[e.z];
    H.dom.res.append(h('div', { class: 'tun-d-ligne', text: `Zoom ${e.z} (marge ${fmtN(e.marge)} m) : ${fmtN(e.liste.length)} tuiles, environ ${fmtMo(e.liste.length * HL_KO_PAR_TUILE[e.z])}` }));
  }
  H.dom.res.append(h('p', { class: 'tun-d-titre', style: 'margin-top:4px', text: `Total : ${fmtN(total)} tuiles, environ ${fmtMo(ko)} (${r.nbPoly} polygones)` }));
  if (r.manque) H.dom.res.append(h('div', { class: 'tun-d-ligne', style: 'color:#9b1c1c', text: `${r.manque} polygone(s) absent(s) de la copie de la Région : non comptés.` }));
  H.dom.res.append(h('div', { class: 'tun-d-ligne tun-petit', text: 'Poids moyens mesurés le 06/11/2026 par zoom. Rien n\'est téléchargé.' }));
  dessinerCarreauxHL();
}

function dessinerCarreauxHL() {
  const H = S.hl;
  S.g.carreaux.clearLayers();
  if (!H.resultat || H.carreaux === 'aucun') return;
  const e = H.resultat.res.find((x) => x.z === Number(H.carreaux));
  if (!e) return;
  for (const [x, y] of e.liste) {
    const b = AMGT4CEM_TuilesGeom.emprise(e.z, x, y);
    L.rectangle([AMGT4CEM_TuilesGeom.versLatLng(b.x0, b.y0), AMGT4CEM_TuilesGeom.versLatLng(b.x1, b.y1)], { weight: 0.6, color: '#0b5c75', fillColor: '#0b5c75', fillOpacity: 0.07, interactive: false }).addTo(S.g.carreaux);
  }
}

// --- gestes et panneau

function marquerDebutHL() {
  S.svg.querySelectorAll('.tun-hl-marque').forEach((n) => n.classList.remove('tun-hl-marque', 'tun-sel'));
  const b = S.hl.brouillon;
  if (b && b.debut) { const r = S.recs.get(b.debut); if (r) r.el.classList.add('tun-hl-marque', 'tun-sel'); }
}

function clicLigneHL(n) {
  const H = S.hl;
  if (H.mode === 'portion') {
    if (H.etape === 'ligne') { H.brouillon = { ligne: n, debut: null }; H.etape = 'debut'; marquerDebutHL(); rendreHL(); return; }
    majMessage('Une portion est en cours : touche une station ou un arrêt de la ligne ' + H.brouillon.ligne + ', ou annule la portion.');
    return;
  }
  const i = H.lignes.indexOf(n);
  if (i >= 0) H.lignes.splice(i, 1); else H.lignes.push(n);
  H.lignes.sort(tri);
  recalculerSelectionHL();
  rendreHL();
  if (i < 0) recadrerCarte(boundsDe([...H.ps]));
}

function boundsDe(ps) {
  const b = L.latLngBounds([]);
  for (const p of ps) { const info = S.pol[p]; const f = info && S.region.get(info.ogc); if (f) b.extend(L.latLngBounds(anneaux(f).flat())); }
  return b;
}

function clicStationHL(rec) {
  const H = S.hl;
  if (H.mode !== 'portion') { majMessage('Mode « Ligne entière » : touche l\'étiquette ou la puce d\'une ligne. Pour une portion, choisis d\'abord « Portion ».'); return; }
  if (H.etape === 'ligne') { majMessage('Choisis d\'abord la ligne de la portion (étiquette ou puce).'); return; }
  const n = H.brouillon.ligne;
  if (rec.kind === 'troncon') { majMessage('Touche une station ou un arrêt, pas un tronçon.'); return; }
  if (rec.kind !== 'station') { majMessage(`« ${rec.nom} » est un arrêt sans polygone (calage non validé) : portion impossible pour l'instant.`, true); return; }
  if (!rec.lignes.includes(n)) { majMessage(`« ${rec.nom} » n'est pas sur la ligne ${n}.`, true); return; }
  const pos = positionsSurLigne(rec, n);
  if (!pos.length) { majMessage(`« ${rec.nom} » n'est pas sur le tunnel de la ligne ${n} dans le synoptique.`, true); return; }
  if (pos.length > 1) { majMessage(`« ${rec.nom} » apparaît à plusieurs endroits de la ligne ${n} : touche l'emplacement voulu plus précisément.`, true); return; }
  if (H.etape === 'debut') { H.brouillon.debut = rec.id; H.etape = 'fin'; marquerDebutHL(); majMessage(''); rendreHL(); return; }
  const deb = S.recs.get(H.brouillon.debut);
  if (positionsSurLigne(deb, n)[0] === pos[0]) { majMessage('Le début et la fin sont au même endroit : choisis une autre fin.', true); return; }
  H.portions.push({ ligne: n, debut: H.brouillon.debut, fin: rec.id });
  H.brouillon = null;
  H.etape = 'ligne';
  marquerDebutHL();
  majMessage('');
  recalculerSelectionHL();
  rendreHL();
  recadrerCarte(boundsDe([...H.ps]));
}

function surToucherHL(cible) {
  if (!cible) return;
  if (cible.hasAttribute('data-etq')) { clicLigneHL(cible.getAttribute('data-ligne')); return; }
  const rec = S.recs.get(cible.getAttribute('data-bague') || cible.id);
  if (rec) clicStationHL(rec);
}

function changerModeHL(mode) {
  const H = S.hl;
  H.mode = mode;
  H.etape = mode === 'portion' ? 'ligne' : null;
  H.brouillon = null;
  marquerDebutHL();
  majMessage('');
  rendreHL();
}

function rendreHL() {
  const H = S.hl;
  if (!H.actif) return;
  const d = S.dom.detail;
  d.replaceChildren();
  S.g.poly.clearLayers();
  polygonesDe([...H.ps], '#0b5c75');

  const bLigne = h('button', { class: `tun-btn${H.mode === 'ligne' ? ' tun-btn--on' : ''}`, text: 'Ligne entière' });
  bLigne.addEventListener('click', () => changerModeHL('ligne'));
  const bPortion = h('button', { class: `tun-btn${H.mode === 'portion' ? ' tun-btn--on' : ''}`, text: 'Portion' });
  bPortion.addEventListener('click', () => changerModeHL('portion'));
  const bTout = h('button', { class: 'tun-btn tun-btn--danger', text: 'Tout effacer' });
  bTout.addEventListener('click', () => { H.lignes = []; H.portions = []; changerModeHL(H.mode); recalculerSelectionHL(); rendreHL(); });
  d.append(h('p', { class: 'tun-d-titre', text: 'Fond de plan hors ligne : choix des zones' }), h('div', { class: 'tun-d-actions' }, bLigne, bPortion, bTout));

  let consigne = 'Touche l\'étiquette ou la puce d\'une ligne pour la garder, ou pour la retirer.';
  if (H.mode === 'portion') {
    if (H.etape === 'ligne') consigne = 'Portion : choisis d\'abord la ligne (étiquette ou puce).';
    else if (H.etape === 'debut') consigne = `Ligne ${H.brouillon.ligne} : touche la station de DÉBUT.`;
    else consigne = `Ligne ${H.brouillon.ligne}, début : ${libelleArret(S.recs.get(H.brouillon.debut), H.brouillon.ligne)}. Touche la station de FIN.`;
  }
  d.append(h('div', { class: 'tun-d-ligne tun-consigne', text: consigne }));
  if (H.mode === 'portion' && H.etape !== 'ligne') {
    const annuler = h('button', { class: 'tun-btn', text: 'Annuler la portion en cours' });
    annuler.addEventListener('click', () => changerModeHL('portion'));
    d.append(h('div', { class: 'tun-d-actions' }, annuler));
  }

  if (!H.items.length) d.append(h('div', { class: 'tun-d-ligne', text: 'Aucune zone choisie.' }));
  for (const it of H.items) {
    const retirer = h('button', { class: 'tun-btn tun-btn--petit', text: 'Retirer' });
    retirer.addEventListener('click', () => {
      if (it.genre === 'ligne') H.lignes.splice(H.lignes.indexOf(it.ligne), 1); else H.portions.splice(it.idx, 1);
      recalculerSelectionHL();
      rendreHL();
    });
    const ligne = h('div', { class: 'tun-liste-item tun-hl-item' }, badges([it.ligne]), h('span', { class: 'tun-hl-txt', text: `${it.texte} · ${it.nb} polygones` }), retirer);
    d.append(ligne);
    it.avert.forEach((a) => d.append(h('div', { class: 'tun-d-ligne tun-avert', text: `Ligne ${it.ligne} : ${a}.` })));
  }

  const choix = h('select', { class: 'tun-select' }, h('option', { value: 'aucun', text: 'aucun' }), ...HL_ZOOMS.map((z) => h('option', { value: String(z), text: `zoom ${z}` })));
  choix.value = H.carreaux;
  choix.addEventListener('change', () => { H.carreaux = choix.value; dessinerCarreauxHL(); });
  d.append(h('div', { class: 'tun-d-ligne', style: 'margin-top:6px' }, 'Carreaux à garder, affichés sur la carte : ', choix));
  H.dom.res = h('div', { class: 'tun-hl-res' });
  d.append(H.dom.res);
  rendreResultatHL(null, !H.resultat && H.ps.size > 0);
}

function basculerHL() {
  const H = S.hl;
  H.actif = !H.actif;
  S.dom.btnHL.classList.toggle('tun-btn--on', H.actif);
  if (H.actif) {
    H.mode = 'ligne'; H.etape = null; H.brouillon = null;
    recalculerSelectionHL();
    effacerSelection(); // vide le détail et la carte, puis réaffiche le panneau (mode actif)
    if (H.ps.size) recadrerCarte(boundsDe([...H.ps]));
  } else {
    H.calc += 1;
    marquerDebutHL();
    effacerSelection();
    majHLSynop();
    S.g.carreaux.clearLayers();
    majMessage('');
  }
}

// ------------------------------------------------------------------ contrôles

function polygonesNonUtilises() {
  const utilises = new Set([...S.recs.values()].flatMap((r) => r.ps));
  return Object.entries(S.pol).filter(([p]) => !utilises.has(p)).map(([p, v]) => ({ p, ...v }));
}

function afficherControles() {
  if (S.hl.actif) basculerHL(); // le mode hors ligne est quitté : le détail est réservé aux contrôles
  effacerSelection();
  const d = S.dom.detail;
  const arrets = [...S.recs.values()].filter((r) => r.kind === 'arret');
  const par = {};
  arrets.forEach((r) => { (par[etatArret(r).etat] = par[etatArret(r).etat] || []).push(r); });
  d.append(h('p', { class: 'tun-d-titre', text: `Contrôles — ${arrets.length} arrêts du dessin à relier` }));
  for (const etat of ['ambigu', 'a_revoir', 'sans', 'auto', 'valide', 'aucun']) {
    const liste = par[etat] || [];
    if (!liste.length) continue;
    d.append(h('div', { class: 'tun-d-ligne' }, etiquetteEtat(etat), ` ${liste.length}`));
    if (etat === 'ambigu' || etat === 'a_revoir' || etat === 'sans') {
      for (const r of liste) {
        const it = h('div', { class: 'tun-liste-item' }, `${r.nom} `, badges(r.lignes));
        it.addEventListener('click', () => selectionner({ kind: 'arret', id: r.id }));
        d.append(it);
      }
    }
  }
  const libres = polygonesNonUtilises();
  d.append(h('p', { class: 'tun-d-titre', style: 'margin-top:8px', text: `Polygones de la Région absents du synoptique : ${libres.length} sur ${Object.keys(S.pol).length}` }));
  d.append(h('div', { class: 'tun-d-ligne', text: 'Tunnels hors du schéma (prolongements, raccords) : touche le nom pour le voir sur la carte, puis choisis.' }));
  for (const t of libres) {
    const sel = h('select', { class: 'tun-select' },
      h('option', { value: '', text: 'À traiter' }),
      h('option', { value: 'hors_schema', text: 'Hors schéma, voulu' }));
    sel.value = S.liens.tunnels_hors_schema[t.p] || '';
    sel.addEventListener('change', () => {
      if (sel.value) S.liens.tunnels_hors_schema[t.p] = sel.value; else delete S.liens.tunnels_hors_schema[t.p];
      sauverBrouillon();
    });
    const nom = h('span', { text: `${t.nom} (${t.p}) ` });
    nom.addEventListener('click', () => {
      viderCarte();
      const { b } = polygonesDe([t.p], '#c62828');
      recadrerCarte(b);
    });
    d.append(h('div', { class: 'tun-liste-item' }, nom, sel));
  }
}

// ------------------------------------------------------------------ interface

function majPuces() {
  S.dom.puces.querySelectorAll('.tun-puce').forEach((b) => b.classList.toggle('tun-puce--on', !!S.sel && S.sel.kind === 'ligne' && S.sel.id === b.dataset.ligne));
}
function majMessage(t, erreur) {
  S.dom.msg.textContent = t || '';
  S.dom.msg.classList.toggle('tun-msg--erreur', !!erreur);
}

function construireEntete() {
  const e = document.getElementById('tun-entete');
  const btnControles = h('button', { class: 'tun-btn', text: 'Contrôles' });
  btnControles.addEventListener('click', afficherControles);
  const btnTout = h('button', { class: 'tun-btn', text: 'Désélectionner' });
  btnTout.addEventListener('click', () => { effacerSelection(); S.pz.tout(); });
  const btnTelecharger = h('button', { class: 'tun-btn', text: 'Télécharger' });
  btnTelecharger.addEventListener('click', telechargerLiens);
  const btnHL = h('button', { class: 'tun-btn', text: 'Hors ligne' });
  btnHL.addEventListener('click', basculerHL);
  const puces = h('div', { class: 'tun-puces' });
  const msg = h('div', { class: 'tun-msg', text: 'Chargement…' });
  msg.addEventListener('click', () => msg.classList.toggle('tun-msg--ouvert'));
  e.append(
    h('div', { class: 'tun-ligne1' }, h('span', { class: 'tun-titre', text: 'Calage du synoptique' }), btnControles, btnTout, btnHL, btnTelecharger),
    puces, msg,
  );
  S.dom = { ...S.dom, entete: e, puces, msg, btnTelecharger, btnHL, detail: document.getElementById('tun-detail') };
}

function construirePuces() {
  for (const n of S.lignes) {
    const c = S.couleur[n];
    const b = h('button', { class: 'tun-puce', 'data-ligne': n, text: n, style: `background:${c};color:${c.toLowerCase() === '#efe047' ? '#1f2933' : '#fff'}` });
    b.addEventListener('click', () => {
      if (S.hl.actif) { clicLigneHL(n); return; }
      if (S.sel && S.sel.kind === 'ligne' && S.sel.id === n) { effacerSelection(); S.pz.tout(); } else selectionner({ kind: 'ligne', id: n });
    });
    S.dom.puces.append(b);
  }
}

function initCarte() {
  const map = L.map('tun-carte', { zoomControl: true, preferCanvas: true, attributionControl: false, maxZoom: AMGT4CEM_CONFIG.maxZoom, center: [50.85, 4.37], zoom: 12 });
  S.map = map;
  map.attributionControl = L.control.attribution({ prefix: false }).addTo(map);
  AMGT4CEM_BuildInfoControl.init(map);
  AMGT4CEM_Basemap.init(map);
  AMGT4CEM_Basemap.showUrbis();
  for (const k of ['carreaux', 'poly', 'trace', 'arrets']) S.g[k] = L.layerGroup().addTo(map);
  new ResizeObserver(() => map.invalidateSize()).observe(document.getElementById('tun-carte-zone'));
}

async function demarrer() {
  construireEntete();
  try { await AMGT4CEM_Services.load(); } catch (err) { /* repli : réglages par défaut */ }
  initCarte();
  const zone = document.getElementById('tun-synop-zone');
  try {
    const [svgTxt, pol, region, depot, arrets] = await Promise.all([
      fetch(SVG_URL, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`synoptique : HTTP ${r.status}`); return r.text(); }),
      lireJson(POLYGONES_URL, 15000),
      lireJson(REGION_URL, 20000),
      lireJson(LIENS_URL, 10000).catch(() => ({ arrets: {}, tunnels_hors_schema: {} })),
      lireCouche('stib_stops', "mode<>'Bus'", ARRETS_SECOURS),
    ]);
    for (const [p, v] of Object.entries(pol.entites || {})) S.pol[p] = { genre: v.genre, nom: v.name_fr || v.name_nl || p, ogc: v.ids_externes && v.ids_externes.ogc_fid };
    for (const f of region.features || []) S.region.set(f.properties.ogc_fid, f);
    S.arrets = arrets.features;
    S.liens = normaliserLiens(depot);
    S.base = JSON.stringify(normaliserLiens(depot));
    try {
      const brouillon = JSON.parse(localStorage.getItem(CLE_BROUILLON) || 'null');
      if (brouillon && brouillon.liens) S.liens = normaliserLiens(brouillon.liens);
    } catch (err) { /* brouillon illisible : ignoré */ }
    monterSynoptique(svgTxt, zone);
    construirePuces();
    restaurerHL();
    majBagues();
    majPuces();
    majMessageBrouillon();
    const bounds = L.latLngBounds([...S.region.values()].map((f) => anneaux(f)).flat(2));
    recadrerCarte(bounds);
    const brouillonTxt = brouillonDifferent() ? ' Brouillon local différent du dépôt : télécharge les liens pour le conserver.' : '';
    if (arrets.erreur) majMessage(`Arrêts réels indisponibles : ${arrets.erreur}.${brouillonTxt}`, true);
    else majMessage(`${S.arrets.length} arrêts réels lus (source : ${arrets.source}). Choisis une ligne, ou touche un arrêt du synoptique.${brouillonTxt}`);
  } catch (err) {
    majMessage(`Chargement impossible : ${err.message || err}`, true);
  }
}

demarrer();
})();
