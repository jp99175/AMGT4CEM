/**
 * Écran « Carte hors ligne » (Réglages > Mon appareil).
 *
 * Synoptique grisé ; la sélection se fait en le touchant, comme dans « Hors ligne » du calage du synoptique (la logique est
 * recopiée ici : l'outil de calage reste séparé, et la sélection de cet écran est propre à cet appareil et à cet écran) :
 *   - étiquette de ligne = ligne entière ;
 *   - deux arrêts = la portion entre eux (le premier présélectionne les lignes qui y passent, le second doit être sur l'une d'elles ;
 *     même arrêt deux fois = la station seule ; n'importe quel arrêt peut borner, même sans contour : rien n'est gardé de plus).
 * Couleurs : plein = fond de plan entièrement gardé sur l'appareil ; 50 % = choisi, pas (entièrement) téléchargé ; gris = ni l'un ni l'autre.
 * Rien n'est téléchargé ni effacé sans « Mettre à jour » puis confirmation.
 * Une « unité » est un tronçon ou une station repérée par ses polygones (clé P…+P…) : un tunnel partagé n'est qu'une unité.
 */
const AMGT4CEM_EcranHorsLigne = (function () {
'use strict';

const SVG_URL = './data/synoptique/synoptique-reseau-v17.svg';
const CLE_CHOIX = 'amgt4cem.horsligne.choix.v1';
const ZOOMS = [19, 18, 17, 16, 15];
const MARGE_19_M = 100; // doublée à chaque niveau en moins (marge constante à l'écran)
const KO_PAR_TUILE = { 19: 7.9, 18: 11.9, 17: 18.2, 16: 9.7, 15: 14.8 }; // poids moyens mesurés le 06/11/2026
const PARALLELE = 6;
const TOLERANCE = 3; // unités du dessin : écart toléré entre le bout d'un tronçon et le contour d'une station

const h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'text') el.textContent = v; else el.setAttribute(k, v);
  }
  el.append(...kids.filter((x) => x !== null && x !== undefined && x !== false));
  return el;
};
const fmtN = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const fmtMo = (ko) => { const mo = ko / 1000; return `${mo < 10 ? mo.toFixed(1).replace('.', ',') : fmtN(mo)} Mo`; };
const tri = (a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b));
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const nomSansParentheses = (t) => norm(String(t).replace(/\(.*?\)/g, ''));
const koDeCle = (k) => KO_PAR_TUILE[Number(k.split('/')[0])] || 12;
const distBoite = (p, b) => Math.hypot(Math.max(b.x - p.x, 0, p.x - (b.x + b.w)), Math.max(b.y - p.y, 0, p.y - (b.y + b.h)));

function monter(conteneur) {
  const HL = AMGT4CEM_HorsLigne;
  const E = {
    svg: null, recs: new Map(), lignes: [], couleur: {}, chaines: {}, noms: [],
    unites: [], parCle: new Map(), // unités du réseau entier
    hl: { lignes: [], portions: [], etape: null, debut: null, pres: null, items: [], selKeys: new Set() },
    calcule: false, calcEnCours: false, dl: null, confirmation: null, durable: null,
  };

  // ---- éléments d'écran
  const intro = h('p', { class: 'rgl-note', text: 'Touchez l\'étiquette d\'une ligne pour la garder entière, ou deux arrêts pour garder la portion entre eux. Rien n\'est téléchargé avant « Mettre à jour ».' });
  const zoneSyn = h('div', { class: 'hl-syn', 'aria-label': 'Synoptique du réseau' });
  const legende = h('ul', { class: 'hl-legende' },
    h('li', {}, h('i', { class: 'hl-p hl-p--ok' }), ' téléchargé (disponible hors ligne)'),
    h('li', {}, h('i', { class: 'hl-p hl-p--sel' }), ' choisi, pas encore téléchargé'),
    h('li', {}, h('i', { class: 'hl-p hl-p--non' }), ' non choisi'));
  const consigne = h('div', { class: 'hl-consigne', role: 'status' });
  const message = h('p', { class: 'rgl-statut', role: 'status', hidden: '' });
  const resume = h('div', { class: 'hl-resume', role: 'status' });
  const barre = h('div', { class: 'hl-barre' }, h('div', { class: 'hl-barre__plein' }));
  const actions = h('div', { class: 'rgl-actions' });
  const liste = h('div', { class: 'hl-items' });
  const detailListe = h('div', { class: 'hl-liste' });
  const detail = h('details', { class: 'hl-detail' }, h('summary', { text: 'Détail par tronçon et station' }), detailListe);
  const pied = h('p', { class: 'rgl-note hl-pied' });
  const appHorsLigne = h('p', { class: 'rgl-note hl-pied' });
  conteneur.append(intro, zoneSyn, legende, consigne, message, resume, barre, actions, liste, detail, appHorsLigne, pied);

  const dire = (t, erreur) => {
    message.textContent = t;
    message.hidden = !t;
    message.className = `rgl-statut${erreur ? ' rgl-statut--erreur' : ''}`;
  };

  // ---- géométrie du dessin
  const pointUtilisateur = (x, y) => {
    const p = E.svg.createSVGPoint();
    p.x = x; p.y = y;
    return p.matrixTransform(E.svg.getScreenCTM().inverse());
  };
  function boite(el) {
    const r = el.getBoundingClientRect();
    const a = pointUtilisateur(r.left, r.top);
    const b = pointUtilisateur(r.right, r.bottom);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }

  /** Zoom/déplacement du dessin : pincement à 2 doigts, glisser, molette ; un toucher bref sans mouvement = sélection. */
  function PanZoom(zone, svg, complet, surToucher) {
    let vb = { ...complet };
    const pts = new Map();
    let depart = null; let bouge = false; let cible = null; let pince = null;
    const appliquer = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    const borne = (w) => Math.max(complet.w / 60, Math.min(complet.w * 1.6, w));
    zone.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        depart = { x: e.clientX, y: e.clientY };
        bouge = false;
        cible = e.target.closest ? e.target.closest('[data-type],[data-bague],[data-etq]') : null;
      } else if (pts.size === 2) {
        bouge = true;
        const [p, q] = [...pts.values()];
        pince = { d0: Math.hypot(p.x - q.x, p.y - q.y), vb0: { ...vb }, u0: pointUtilisateur((p.x + q.x) / 2, (p.y + q.y) / 2) };
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
        const w = borne(pince.vb0.w * (pince.d0 / d));
        vb = { x: pince.vb0.x, y: pince.vb0.y, w, h: pince.vb0.h * (w / pince.vb0.w) };
        appliquer();
        const u = pointUtilisateur((p.x + q.x) / 2, (p.y + q.y) / 2);
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
      if (pts.size === 1) { const [p] = [...pts.values()]; depart = { x: p.x, y: p.y }; bouge = true; }
    };
    zone.addEventListener('pointerup', fin);
    zone.addEventListener('pointercancel', fin);
    zone.addEventListener('wheel', (e) => {
      e.preventDefault();
      const avant = pointUtilisateur(e.clientX, e.clientY);
      const w = borne(vb.w * Math.exp(e.deltaY * 0.0016));
      const k = w / vb.w;
      vb = { x: vb.x, y: vb.y, w, h: vb.h * k };
      appliquer();
      const apres = pointUtilisateur(e.clientX, e.clientY);
      vb.x += avant.x - apres.x;
      vb.y += avant.y - apres.y;
      appliquer();
    }, { passive: false });
  }

  // ---- synoptique : éléments, lignes, arrêts
  function lignesDeCouleur(style) {
    const m = /url\(#grad-([\d-]+)\)/.exec(style || '');
    if (m) return m[1].split('-');
    const c = /stroke:\s*(#[0-9a-fA-F]{6})/.exec(style || '');
    if (!c) return [];
    return Object.entries(E.couleur).filter(([, v]) => v.toLowerCase() === c[1].toLowerCase()).map(([k]) => k);
  }

  async function chargerSynoptique() {
    const rep = await fetch(SVG_URL, { cache: 'no-cache' });
    if (!rep.ok) throw new Error('Synoptique introuvable.');
    const doc = new DOMParser().parseFromString(await rep.text(), 'image/svg+xml');
    const svg = document.importNode(doc.documentElement, true);
    const vb = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.setAttribute('class', 'hl-svg');
    const troncons = svg.querySelector('#troncons');
    const stations = svg.querySelector('#stations');
    if (troncons && stations) stations.parentNode.insertBefore(troncons, stations);
    zoneSyn.append(svg);
    E.svg = svg;
    for (const g of svg.querySelectorAll('#lignes > g[data-ligne]')) {
      const traits = [...g.querySelectorAll('path')].filter((p) => !p.classList.contains('halo'));
      const n = g.getAttribute('data-ligne');
      E.lignes.push(n);
      E.couleur[n] = traits.length ? traits[traits.length - 1].getAttribute('stroke') : '#0b5c75';
    }
    E.lignes.sort(tri);
    for (const el of svg.querySelectorAll('[data-type]')) {
      const type = el.getAttribute('data-type');
      let ps = (el.getAttribute('data-p') || '').split(/\s+/).filter(Boolean);
      if (!ps.length && type === 'terminus') {
        const etq = svg.querySelector(`#etiquettes-lignes > g[data-ligne="${el.getAttribute('data-ligne')}"][data-nom="${el.getAttribute('data-nom')}"][data-p]`);
        if (etq) ps = etq.getAttribute('data-p').split(/\s+/).filter(Boolean);
      }
      let lignes = [];
      if (type === 'station') lignes = (el.getAttribute('data-lignes') || '').split(/\s+/).filter(Boolean);
      else if (type === 'arret') lignes = lignesDeCouleur(el.getAttribute('style'));
      else if (el.getAttribute('data-ligne')) lignes = [el.getAttribute('data-ligne')];
      const kind = type === 'troncon' ? 'troncon' : (ps.length ? 'station' : 'arret');
      E.recs.set(el.id, { id: el.id, el, type, kind, nom: el.getAttribute('data-nom') || el.id, lignes, ps });
    }
    svg.querySelectorAll('#etiquettes-lignes > g').forEach((g) => g.setAttribute('data-etq', '1'));
    // Noms des stations et arrêts : chacun suit l'objet le plus proche (pour être estompé avec lui).
    E.pz = PanZoom(zoneSyn, svg, { x: vb[0], y: vb[1], w: vb[2], h: vb[3] }, surToucher);
    const centres = [...E.recs.values()].filter((r) => r.type !== 'troncon').map((r) => { const bx = boite(r.el); return { r, x: bx.x + bx.w / 2, y: bx.y + bx.h / 2 }; });
    for (const t of svg.querySelectorAll('text.lbl')) {
      const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(t.getAttribute('transform') || '');
      if (!m || !centres.length) continue;
      const x = Number(m[1]); const y = Number(m[2]);
      let best = null; let d0 = Infinity;
      for (const c of centres) { const d = Math.hypot(c.x - x, c.y - y); if (d < d0) { d0 = d; best = c.r; } }
      if (best) E.noms.push({ t, rec: best });
    }
    // Bagues autour des arrêts : zone de toucher agrandie pour le doigt.
    const marques = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.append(marques);
    for (const rec of E.recs.values()) {
      if (rec.kind !== 'arret') continue;
      const b = boite(rec.el);
      rec.c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const bague = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      bague.setAttribute('cx', rec.c.x); bague.setAttribute('cy', rec.c.y); bague.setAttribute('r', 15);
      bague.setAttribute('class', 'hl-bague'); bague.setAttribute('data-bague', rec.id);
      marques.append(bague);
    }
    // Unités du réseau entier (clé = polygones triés).
    const par = new Map();
    for (const r of E.recs.values()) {
      if (!r.ps.length) continue;
      const cle = [...r.ps].sort().join('+');
      let u = par.get(cle);
      if (!u) { u = { cle, ps: [...r.ps].sort(), kind: r.kind === 'troncon' ? 'troncon' : 'station', nom: r.nom, lignes: new Set(), els: [], tuiles: null }; par.set(cle, u); }
      r.lignes.forEach((n) => u.lignes.add(n));
      u.els.push(r.el);
    }
    E.unites = [...par.values()];
    E.parCle = par;
  }

  // ---- chaînes de tronçons, positions des arrêts, résolution (même règles que le calage)
  function chaineDeLigne(n) {
    if (E.chaines[n]) return E.chaines[n];
    const troncons = []; const gaps = [];
    let precedent = null;
    for (const rec of E.recs.values()) {
      if (rec.kind !== 'troncon' || !rec.lignes.includes(n)) continue;
      const a = rec.el.getPointAtLength(0);
      const b = rec.el.getPointAtLength(rec.el.getTotalLength());
      let pa = 0;
      if (precedent) {
        if (Math.hypot(a.x - precedent.b.x, a.y - precedent.b.y) <= TOLERANCE) pa = precedent.pb;
        else { pa = precedent.pb + 1; gaps.push({ avant: precedent.rec, apres: rec, pos: precedent.pb }); }
      }
      const t = { rec, a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, pa, pb: pa + 1 };
      troncons.push(t);
      precedent = t;
    }
    E.chaines[n] = { troncons, gaps };
    return E.chaines[n];
  }
  const stationsDeLigne = (n) => [...E.recs.values()].filter((r) => r.kind === 'station' && r.lignes.includes(n));

  function positionArret(rec, n) {
    if (!rec.posArret) rec.posArret = {};
    if (n in rec.posArret) return rec.posArret[n];
    let meilleur = null;
    for (const t of chaineDeLigne(n).troncons) {
      const L0 = t.rec.el.getTotalLength();
      const pas = Math.max(2, L0 / 40);
      for (let l = 0; l <= L0 + 0.01; l += pas) {
        const q = t.rec.el.getPointAtLength(Math.min(l, L0));
        const d = Math.hypot(q.x - rec.c.x, q.y - rec.c.y);
        if (!meilleur || d < meilleur.d) meilleur = { d, pos: Math.min(l, L0) / (L0 || 1) < 0.5 ? t.pa : t.pb };
      }
    }
    rec.posArret[n] = meilleur ? [meilleur.pos] : [];
    return rec.posArret[n];
  }

  function positionsSurLigne(rec, n) {
    if (!rec.lignes.includes(n)) return [];
    if (!rec.box) rec.box = boite(rec.el);
    if (!rec.c) rec.c = { x: rec.box.x + rec.box.w / 2, y: rec.box.y + rec.box.h / 2 };
    if (rec.kind === 'arret') return positionArret(rec, n);
    const out = new Set();
    for (const t of chaineDeLigne(n).troncons) {
      if (distBoite(t.a, rec.box) <= TOLERANCE) out.add(t.pa);
      if (distBoite(t.b, rec.box) <= TOLERANCE) out.add(t.pb);
    }
    if (!out.size) return positionArret(rec, n);
    return [...out].sort((x, y) => x - y);
  }

  function libelleArret(rec, n) {
    if (/\(.*\)/.test(rec.nom)) return rec.nom;
    const base = nomSansParentheses(rec.nom);
    const emplacements = [...new Set(stationsDeLigne(n).filter((r) => nomSansParentheses(r.nom) === base).flatMap((r) => positionsSurLigne(r, n)))].sort((a, b) => a - b);
    if (emplacements.length < 2) return rec.nom;
    return `${rec.nom} (emplacement ${emplacements.indexOf(positionsSurLigne(rec, n)[0]) + 1}/${emplacements.length})`;
  }

  /** Ajoute au jeu `sub` (clé -> unité du réseau) l'unité de cet élément. */
  function ajouterUnite(sub, rec) {
    if (!rec.ps.length) return;
    const cle = [...rec.ps].sort().join('+');
    const u = E.parCle.get(cle);
    if (u) sub.set(cle, u);
  }

  function resoudreLigne(n, sub) {
    const ch = chaineDeLigne(n);
    const avert = [];
    ch.troncons.forEach((t) => ajouterUnite(sub, t.rec));
    stationsDeLigne(n).forEach((r) => ajouterUnite(sub, r));
    const nArrets = [...E.recs.values()].filter((r) => r.kind === 'arret' && r.lignes.includes(n)).length;
    if (!sub.size) avert.push('aucun contour lié à cette ligne dans le synoptique : rien à garder');
    else if (nArrets) avert.push('seule la partie en tunnel est gardée');
    ch.gaps.forEach((g) => avert.push(`tunnel absent du synoptique entre « ${g.avant.nom} » et « ${g.apres.nom} »`));
    return { avert };
  }

  function resoudrePortion(p, sub) {
    const a = E.recs.get(p.debut);
    const b = E.recs.get(p.fin);
    const avert = []; const lignes = [];
    if (!a || !b) return { avert: ['arrêt introuvable dans le synoptique'], texte: '?', lignes };
    if (a === b) {
      const surLigne = E.lignes.filter((n) => positionsSurLigne(a, n).length);
      (surLigne.length ? surLigne : a.lignes.slice(0, 1)).forEach((n) => { ajouterUnite(sub, a); lignes.push(n); });
      if (!sub.size) avert.push('aucun contour à garder pour cet arrêt (hors tunnel ou partie enterrée)');
      return { avert, texte: `${a.nom} (station seule)`, lignes };
    }
    for (const n of E.lignes) {
      const pa = positionsSurLigne(a, n);
      const pb = positionsSurLigne(b, n);
      if (!pa.length || !pb.length) continue;
      if (pa.length > 1 || pb.length > 1) { avert.push(`ligne ${n} : emplacement ambigu, ligne ignorée`); continue; }
      lignes.push(n);
      if (pa[0] === pb[0]) { ajouterUnite(sub, a); ajouterUnite(sub, b); continue; }
      const lo = Math.min(pa[0], pb[0]);
      const hi = Math.max(pa[0], pb[0]);
      const ch = chaineDeLigne(n);
      ch.troncons.forEach((t) => { if (t.pa >= lo && t.pb <= hi) ajouterUnite(sub, t.rec); });
      stationsDeLigne(n).forEach((r) => { if (positionsSurLigne(r, n).some((x) => x >= lo && x <= hi)) ajouterUnite(sub, r); });
      ch.gaps.forEach((g) => { if (g.pos >= lo && g.pos + 1 <= hi) avert.push(`ligne ${n} : tunnel absent du synoptique entre « ${g.avant.nom} » et « ${g.apres.nom} »`); });
    }
    if (!lignes.length) avert.push('aucune ligne commune entre ces deux arrêts');
    else if (!sub.size) avert.push('aucun contour à garder entre ces deux arrêts (hors tunnel ou partie enterrée)');
    const l0 = lignes[0] || a.lignes[0];
    return { avert, texte: `${libelleArret(a, l0)} → ${libelleArret(b, l0)}`, lignes };
  }

  function recalculerChoix() {
    const H = E.hl;
    H.items = [];
    H.selKeys = new Set();
    for (const n of H.lignes) {
      const sub = new Map();
      const r = resoudreLigne(n, sub);
      sub.forEach((u, k) => H.selKeys.add(k));
      H.items.push({ genre: 'ligne', ligne: n, texte: 'ligne entière', lignes: [n], unites: [...sub.values()], avert: r.avert });
    }
    H.portions.forEach((p, i) => {
      const sub = new Map();
      const r = resoudrePortion(p, sub);
      sub.forEach((u, k) => H.selKeys.add(k));
      H.items.push({ genre: 'portion', idx: i, texte: r.texte, lignes: r.lignes, unites: [...sub.values()], avert: r.avert });
    });
  }

  function sauverChoix() {
    try { localStorage.setItem(CLE_CHOIX, JSON.stringify({ lignes: E.hl.lignes, portions: E.hl.portions })); } catch (err) { /* stockage indisponible */ }
  }
  function restaurerChoix() {
    try {
      const v = JSON.parse(localStorage.getItem(CLE_CHOIX) || 'null');
      if (!v) return;
      E.hl.lignes = (v.lignes || []).filter((n) => E.lignes.includes(n));
      const vus = new Set();
      E.hl.portions = [];
      for (const p of (v.portions || [])) {
        if (!E.recs.has(p.debut) || !E.recs.has(p.fin)) continue;
        const k = [p.debut, p.fin].sort().join('|');
        if (vus.has(k)) continue;
        vus.add(k);
        E.hl.portions.push({ debut: p.debut, fin: p.fin });
      }
    } catch (err) { /* choix illisible : ignoré */ }
  }

  // ---- gestes
  const couleurLigne = (n) => { const c = E.couleur[n]; return c && c.startsWith('#') ? c : '#0b5c75'; };

  function marquerDebut() {
    E.svg.querySelectorAll('.hl-debut').forEach((n) => { n.classList.remove('hl-debut'); n.style.removeProperty('--hl-d'); });
    const r = E.hl.debut && E.recs.get(E.hl.debut);
    if (!r) return;
    r.el.classList.add('hl-debut');
    r.el.style.setProperty('--hl-d', couleurLigne([...E.hl.pres].sort(tri)[0]));
  }

  /** Pendant l'attente du second arrêt : seules les lignes présélectionnées reprennent leur couleur, le reste reste grisé. */
  function majPres() {
    const pres = E.hl.etape === 'fin' ? E.hl.pres : null;
    const hors = (lignes) => !!pres && lignes.some((n) => pres.has(n));
    const mettre = (el, on) => el.classList.toggle('hl-pres', on);
    E.svg.classList.toggle('hl-attente', !!pres);
    E.svg.querySelectorAll('#lignes > g[data-ligne]').forEach((g) => mettre(g, !!pres && pres.has(g.getAttribute('data-ligne'))));
    E.svg.querySelectorAll('#etiquettes-lignes > g').forEach((g) => mettre(g, !!pres && pres.has(g.getAttribute('data-ligne'))));
    for (const r of E.recs.values()) if (r.kind !== 'troncon') mettre(r.el, hors(r.lignes));
    for (const nm of E.noms) mettre(nm.t, nm.rec.kind !== 'troncon' && hors(nm.rec.lignes));
  }

  function annulerEnCours() {
    const H = E.hl;
    H.etape = null; H.debut = null; H.pres = null;
    marquerDebut(); majPres(); dire('');
  }

  function modifier() {
    recalculerChoix();
    sauverChoix();
    E.confirmation = null;
    dessiner();
    calculer().then(dessiner);
  }

  function lignesDe(rec, parmi) {
    const out = []; const amb = [];
    for (const n of parmi) { const pos = positionsSurLigne(rec, n); if (pos.length === 1) out.push(n); else if (pos.length > 1) amb.push(n); }
    return { out, amb };
  }

  function clicLigne(n) {
    const H = E.hl;
    annulerEnCours();
    const i = H.lignes.indexOf(n);
    if (i >= 0) H.lignes.splice(i, 1); else H.lignes.push(n);
    H.lignes.sort(tri);
    modifier();
  }

  function clicStation(rec) {
    const H = E.hl;
    if (rec.kind === 'troncon') { dire('Touchez un arrêt, pas un tronçon. Pour une ligne entière, touchez son étiquette.'); return; }
    if (H.etape !== 'fin') {
      const { out, amb } = lignesDe(rec, E.lignes);
      if (!out.length) {
        dire(amb.length ? `« ${rec.nom} » apparaît à plusieurs endroits d'une même ligne : touchez l'emplacement voulu plus précisément.` : `« ${rec.nom} » n'est sur aucune ligne du synoptique.`, true);
        return;
      }
      H.debut = rec.id; H.pres = new Set(out); H.etape = 'fin';
      marquerDebut(); majPres(); dire(''); dessiner();
      return;
    }
    let fin = rec.id;
    if (rec.id !== H.debut) {
      const { out, amb } = lignesDe(rec, [...H.pres]);
      if (!out.length) {
        dire(amb.length ? `« ${rec.nom} » apparaît à plusieurs endroits d'une même ligne : touchez l'emplacement voulu plus précisément.` : `Pas de ligne commune avec « ${E.recs.get(H.debut).nom} » : touchez un arrêt sur une ligne grisée en couleur, ou « Annuler ».`, true);
        return;
      }
    } else fin = H.debut; // même arrêt deux fois : la station seule
    const debut = H.debut;
    const deja = H.portions.some((q) => (q.debut === debut && q.fin === fin) || (q.debut === fin && q.fin === debut));
    annulerEnCours();
    if (deja) { dire('Cette portion est déjà choisie.'); dessiner(); return; }
    H.portions.push({ debut, fin });
    modifier();
  }

  function surToucher(cible) {
    if (!cible || E.dl) return;
    if (cible.hasAttribute('data-etq')) { clicLigne(cible.getAttribute('data-ligne')); return; }
    const rec = E.recs.get(cible.getAttribute('data-bague') || cible.id);
    if (rec) clicStation(rec);
  }

  // ---- calcul des tuiles de chaque unité du réseau (une fois)
  async function segmentsParPolygone(ids) {
    proj4.defs(AMGT4CEM_CONFIG.businessCRS.epsg, AMGT4CEM_CONFIG.businessCRS.proj4def);
    const fc = await AMGT4CEM_ShpLoader.load('./data/shapefile/polygones');
    const out = new Map();
    for (const f of fc.features) {
      const id = f.properties.id;
      if (!ids.has(id)) continue;
      const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : [].concat(...f.geometry.coordinates);
      const segs = [];
      for (const ring of rings) {
        const pts = ring.map((c) => proj4(AMGT4CEM_CONFIG.businessCRS.epsg, 'EPSG:3857', [c[0], c[1]]));
        for (let i = 0; i < pts.length - 1; i += 1) segs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]]);
      }
      out.set(id, segs);
    }
    return out;
  }

  async function calculer() {
    if (E.calcule || E.calcEnCours) return;
    E.calcEnCours = true;
    try {
      const aFaire = E.unites.filter((u) => !u.tuiles);
      if (aFaire.length) {
        dire('Calcul des tuiles…');
        const segs = await segmentsParPolygone(new Set(aFaire.flatMap((u) => u.ps)));
        let i = 0;
        for (const u of aFaire) {
          const s = u.ps.flatMap((p) => segs.get(p) || []);
          u.tuiles = [];
          if (s.length) for (const z of ZOOMS) u.tuiles.push(...AMGT4CEM_TuilesGeom.tuilesAutour(s, z, MARGE_19_M * 2 ** (19 - z)).map(([x, y]) => `${z}/${x}/${y}`));
          i += 1;
          if (i % 6 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        dire('');
      }
      E.calcule = true;
    } catch (err) {
      dire(`Calcul impossible : ${err.message}`, true);
    } finally { E.calcEnCours = false; }
  }

  // ---- état sur l'appareil
  const gardee = (k) => HL.index.has(k);
  function statsTuiles(tuiles) {
    let g = 0; let ko = 0; let koT = 0;
    for (const k of tuiles) { const c = koDeCle(k); koT += c; if (gardee(k)) { g += 1; ko += c; } }
    return { gardees: g, total: tuiles.length === undefined ? tuiles.size : tuiles.length, ko, koTotal: koT };
  }
  const uniteTelechargee = (u) => !!u.tuiles && u.tuiles.length > 0 && u.tuiles.every(gardee);

  function totaux() {
    const union = new Set();
    for (const k of E.hl.selKeys) { const u = E.parCle.get(k); if (u && u.tuiles) u.tuiles.forEach((t) => union.add(t)); }
    const manquantes = [...union].filter((k) => !gardee(k));
    const aEffacer = [...HL.index.keys()].filter((k) => !union.has(k));
    const st = statsTuiles(union);
    return {
      union, total: st.total, gardees: st.gardees, ko: st.ko, koT: st.koTotal,
      manquantes, koManque: manquantes.reduce((s, k) => s + koDeCle(k), 0),
      aEffacer, koEfface: aEffacer.reduce((s, k) => s + koDeCle(k), 0),
    };
  }

  // ---- affichage
  function colorer() {
    for (const u of E.unites) {
      const ok = E.calcule && uniteTelechargee(u);
      const sel = E.hl.selKeys.has(u.cle);
      const couleur = couleurLigne([...u.lignes].sort(tri)[0]);
      for (const el of u.els) {
        el.classList.remove('hl-ok', 'hl-sel');
        el.style.removeProperty('--hl-c');
        if (!ok && !sel) continue;
        el.classList.add(ok ? 'hl-ok' : 'hl-sel');
        el.style.setProperty('--hl-c', couleur);
      }
    }
  }

  const badges = (lignes) => {
    const f = document.createDocumentFragment();
    for (const l of lignes) {
      const c = couleurLigne(l);
      f.append(h('span', { class: 'hl-badge', style: `background:${c};color:${c.toLowerCase() === '#efe047' ? '#1f2933' : '#fff'}`, text: l }));
    }
    return f;
  };

  function dessiner() {
    if (!E.svg) return;
    const H = E.hl;
    colorer();
    const T = E.calcule ? totaux() : null;

    consigne.textContent = H.etape === 'fin'
      ? `Début : ${E.recs.get(H.debut).nom} (ligne${H.pres.size > 1 ? 's' : ''} ${[...H.pres].sort(tri).join(', ')}). Touchez l'arrêt de FIN, sur ${H.pres.size > 1 ? 'ces lignes' : 'cette ligne'}, ou le même arrêt pour la station seule.`
      : 'Touchez l\'étiquette d\'une ligne pour la garder entière, ou deux arrêts pour garder la portion entre eux.';

    const l1 = h('div', { class: 'hl-resume__ligne', text: `${fmtN(H.selKeys.size)} tronçons et stations choisis.` });
    const l2 = T
      ? h('div', { class: 'hl-resume__ligne hl-resume__fort', text: `Gardé sur cet appareil : ${fmtN(T.gardees)} / ${fmtN(T.total)} tuiles (${fmtMo(T.ko)} / ${fmtMo(T.koT)})` })
      : h('div', { class: 'hl-resume__ligne', text: 'Calcul en cours…' });
    resume.replaceChildren(l1, l2);
    barre.firstChild.style.width = `${T && T.total ? Math.round((100 * T.gardees) / T.total) : 0}%`;
    dessinerActions(T);
    dessinerListes();
    dessinerPied();
  }

  function dessinerActions(T) {
    const H = E.hl;
    const el = [];
    if (E.dl) {
      el.push(h('p', { class: 'rgl-note', text: `Téléchargement : ${fmtN(E.dl.faites)} / ${fmtN(E.dl.total)} tuiles${E.dl.erreurs ? ` (${E.dl.erreurs} en échec)` : ''}` }));
      const stop = h('button', { type: 'button', class: 'rgl-btn', text: 'Arrêter' });
      stop.addEventListener('click', () => { if (E.dl.sw) { const c = navigator.serviceWorker.controller; if (c) c.postMessage({ type: 'arret' }); } else E.dl.arret = true; });
      el.push(stop);
    } else if (E.confirmation && T) {
      const c = E.confirmation;
      const parts = [];
      if (c.manquantes.length) parts.push(`télécharger ${fmtN(c.manquantes.length)} tuiles (environ ${fmtMo(c.koManque)})`);
      if (c.aEffacer.length) parts.push(`effacer ${fmtN(c.aEffacer.length)} tuiles qui ne sont plus choisies (${fmtMo(c.koEfface)} libérés)`);
      el.push(h('p', { class: 'rgl-note', text: `Mettre à jour : ${parts.join(' et ')} ? Le wifi est préférable. Ne quittez pas cette page pendant le téléchargement.` }));
      const oui = h('button', { type: 'button', class: 'rgl-btn rgl-btn--primary', text: 'Oui, mettre à jour' });
      const non = h('button', { type: 'button', class: 'rgl-btn', text: 'Annuler' });
      oui.addEventListener('click', () => mettreAJour(c));
      non.addEventListener('click', () => { E.confirmation = null; dessiner(); });
      el.push(oui, non);
    } else {
      if (H.etape === 'fin') {
        const annuler = h('button', { type: 'button', class: 'rgl-btn', text: 'Annuler le début' });
        annuler.addEventListener('click', () => { annulerEnCours(); dessiner(); });
        el.push(annuler);
      }
      const rien = !T || (!T.manquantes.length && !T.aEffacer.length);
      let texte = 'Mettre à jour';
      if (T && !rien) texte += ` (télécharger ${fmtMo(T.koManque)}, libérer ${fmtMo(T.koEfface)})`;
      else if (T) texte = 'À jour : rien à faire';
      const btn = h('button', { type: 'button', class: 'rgl-btn rgl-btn--primary', text: texte });
      if (rien || !HL.pret) btn.disabled = true;
      btn.addEventListener('click', () => { const t = totaux(); E.confirmation = { manquantes: t.manquantes, aEffacer: t.aEffacer, koManque: t.koManque, koEfface: t.koEfface }; dessiner(); });
      el.push(btn);
      if (H.lignes.length || H.portions.length) {
        const tout = h('button', { type: 'button', class: 'rgl-btn', text: 'Tout désélectionner' });
        tout.addEventListener('click', () => { annulerEnCours(); H.lignes = []; H.portions = []; modifier(); });
        el.push(tout);
      }
      if (HL.pret && HL.index.size) {
        const eff = h('button', { type: 'button', class: 'rgl-btn', text: 'Effacer toutes les cartes gardées' });
        eff.addEventListener('click', async () => {
          if (!window.confirm('Effacer toutes les cartes gardées sur cet appareil ?')) return;
          await HL.supprimer();
          dire('Cartes effacées de cet appareil.');
          dessiner();
        });
        el.push(eff);
      }
    }
    actions.replaceChildren(...el);
  }

  function dessinerListes() {
    const H = E.hl;
    const items = [];
    if (!H.items.length) items.push(h('p', { class: 'rgl-note', text: 'Aucune zone choisie.' }));
    for (const it of H.items) {
      const tuiles = new Set(it.unites.flatMap((u) => u.tuiles || []));
      const st = E.calcule ? statsTuiles(tuiles) : null;
      const retirer = h('button', { type: 'button', class: 'rgl-btn rgl-btn--petit', text: 'Retirer' });
      retirer.addEventListener('click', () => {
        if (E.dl) return;
        if (it.genre === 'ligne') H.lignes.splice(H.lignes.indexOf(it.lignes[0]), 1); else H.portions.splice(it.idx, 1);
        modifier();
      });
      const txt = h('span', { class: 'hl-item__txt' },
        h('span', { text: it.texte }),
        st ? h('span', { class: 'hl-item__val', text: `${fmtN(st.gardees)} / ${fmtN(st.total)} tuiles, ${fmtMo(st.koTotal)}` }) : null,
        ...it.avert.map((a) => h('span', { class: 'hl-item__avert', text: `${a}.` })));
      items.push(h('div', { class: 'hl-item' }, h('span', { class: 'hl-item__badges' }, badges(it.lignes)), txt, retirer));
    }
    liste.replaceChildren(...items);

    const lignes = [];
    for (const u of E.unites) {
      if (!E.hl.selKeys.has(u.cle)) continue;
      const s = u.tuiles ? statsTuiles(u.tuiles) : null;
      const ok = uniteTelechargee(u);
      lignes.push(h('div', { class: `hl-ligne${ok ? ' hl-ligne--ok' : ''}` },
        h('span', { class: 'hl-ligne__nom' }, badges([...u.lignes].sort(tri)), ` ${u.kind === 'station' ? 'Station ' : ''}${u.nom}`),
        h('span', { class: 'hl-ligne__val', text: s ? `${fmtN(s.gardees)} / ${fmtN(s.total)} tuiles, ${fmtMo(s.koTotal)}${ok ? ' — téléchargé' : ''}` : '…' })));
    }
    detailListe.replaceChildren(...(lignes.length ? lignes : [h('p', { class: 'rgl-note', text: 'Aucun tronçon choisi.' })]));
  }

  function dessinerPied() {
    const parts = [];
    if (!HL.pret) parts.push('Le stockage de cet appareil n\'est pas disponible (navigation privée ?) : le téléchargement est impossible.');
    else {
      parts.push('Les cartes gardées sont valables 60 jours, puis effacées : à renouveler avant.');
      const t0 = HL.plusAncienne();
      if (t0) parts.push(`La plus ancienne date du ${new Date(t0).toLocaleDateString('fr-BE')}.`);
      if (E.durable === true) parts.push('Stockage protégé par le navigateur.');
      else if (E.durable === false) parts.push('Le navigateur peut effacer ces cartes s\'il manque de place (iPhone : après environ 7 jours sans ouvrir l\'application).');
      parts.push('Pour l\'instant, l\'application doit déjà être ouverte pour utiliser ces cartes sans réseau.');
    }
    pied.textContent = parts.join(' ');
    appHorsLigne.textContent = E.versionSW
      ? `Application gardée pour l'ouverture sans réseau : version ${E.versionSW}.`
      : ('serviceWorker' in navigator && navigator.serviceWorker.controller
        ? 'Application gardée pour l\'ouverture sans réseau.'
        : 'Application pas encore gardée pour l\'ouverture sans réseau : ouvrez-la une fois en ligne, puis rechargez cette page.');
  }

  // ---- mise à jour : effacer ce qui n'est plus choisi, puis télécharger le manquant
  function adresse(cfg, z, x, y) {
    const sep = cfg.url.includes('?') ? '&' : '?';
    return `${cfg.url}${sep}service=WMTS&request=GetTile&version=1.0.0&layer=${encodeURIComponent(cfg.layer)}&style=`
      + `&tilematrixset=${encodeURIComponent(cfg.tileMatrixSet)}&tilematrix=${encodeURIComponent(cfg.tileMatrixSet)}:${z}`
      + `&tilerow=${y}&tilecol=${x}&format=${encodeURIComponent(cfg.format || 'image/png')}`;
  }

  async function mettreAJour(c) {
    E.confirmation = null;
    if (c.aEffacer.length) { await HL.supprimer(c.aEffacer); }
    // Les tuiles à télécharger sont recalculées : le choix a pu changer entre-temps.
    const tuiles = totaux().manquantes;
    if (!tuiles.length) { dire(c.aEffacer.length ? `${fmtMo(c.koEfface)} libérés.` : 'Rien à télécharger.'); dessiner(); return; }
    E.dl = { arret: false, faites: 0, total: tuiles.length, erreurs: 0, reussies: 0 };
    dire('');
    E.durable = await HL.demanderDurable();
    await AMGT4CEM_Services.load();
    const cfg = AMGT4CEM_Services.tuilesConfig();
    if (!cfg) { E.dl = null; dire('Les tuiles de la carte ne sont pas configurées (mode « WMS seul »).', true); dessiner(); return; }
    const ctl = 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null;
    if (ctl) {
      // Le service worker télécharge : on peut quitter l'écran ou la page, il continue et se reprend à la prochaine ouverture.
      E.dl.sw = true;
      ctl.postMessage({ type: 'telecharger', cles: tuiles, cfg });
      try { const reg = await navigator.serviceWorker.ready; if (reg.sync) await reg.sync.register('hl-tuiles'); } catch (err) { /* synchronisation indisponible (iPad, Firefox) */ }
      dessiner();
      return;
    }
    let i = 0; let derniereMaj = 0; let fatal = null;
    const rafraichir = () => { const t = Date.now(); if (t - derniereMaj < 400) return; derniereMaj = t; dessiner(); };
    async function travailleur() {
      while (i < tuiles.length && !E.dl.arret && !fatal) {
        const cle = tuiles[i]; i += 1;
        const [z, x, y] = cle.split('/').map(Number);
        try {
          const r = await fetch(adresse(cfg, z, x, y), { mode: 'cors', cache: 'no-store' });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const b = await r.blob();
          if (!/^image\//.test(b.type) || b.size < 50) throw new Error('réponse inattendue');
          try { await HL.ecrire(cle, b); E.dl.reussies += 1; } catch (err) { fatal = 'Le stockage de l\'appareil est plein ou refusé.'; }
        } catch (err) {
          E.dl.erreurs += 1;
          if (E.dl.reussies === 0 && E.dl.erreurs >= 12) fatal = 'Le service de cartes ne répond pas ou n\'autorise pas la lecture depuis cette application.';
        }
        E.dl.faites += 1;
        rafraichir();
      }
    }
    await Promise.all(Array.from({ length: PARALLELE }, travailleur));
    const bilan = E.dl;
    E.dl = null;
    if (fatal) dire(`${fatal} ${fmtN(bilan.reussies)} tuiles gardées.`, true);
    else if (bilan.arret) dire(`Arrêté. ${fmtN(bilan.reussies)} tuiles gardées ; reprenez avec « Mettre à jour ».`);
    else if (bilan.erreurs) dire(`Terminé avec ${fmtN(bilan.erreurs)} tuiles en échec. Touchez « Mettre à jour » pour réessayer.`, true);
    else dire('Mise à jour terminée. Les tronçons choisis sont disponibles hors ligne.');
    dessiner();
  }

  // ---- messages du service worker (téléchargement hors de la page)
  function bilanSW(m) {
    if (m.etat === 'fini') {
      if (m.erreurs) dire(`Terminé avec ${fmtN(m.erreurs)} tuiles en échec. Touchez « Mettre à jour » pour réessayer.`, true);
      else dire('Mise à jour terminée. Les tronçons choisis sont disponibles hors ligne.');
    } else if (m.etat === 'arret') dire(`Arrêté. ${fmtN(m.faites)} / ${fmtN(m.total)} tuiles gardées ; reprenez avec « Mettre à jour ».`);
    else if (m.etat === 'erreur') dire(`${m.message || 'Téléchargement interrompu.'} ${fmtN(m.faites)} / ${fmtN(m.total)} tuiles gardées.`, true);
  }
  function surMessageSW(event) {
    const m = event.data || {};
    if (m.type === 'etat') {
      if (m.version) E.versionSW = m.version;
      const t = m.travail;
      HL.recharger().then(() => {
        if (t && t.etat === 'actif') E.dl = { sw: true, arret: false, faites: t.faites, total: t.total, erreurs: t.erreurs };
        dessiner();
      });
      return;
    }
    if (m.type !== 'progression') return;
    for (const [k, o] of (m.ajoutees || [])) HL.index.set(k, { t: Date.now(), o });
    if (m.etat === 'actif') {
      E.dl = { sw: true, arret: false, faites: m.faites, total: m.total, erreurs: m.erreurs };
    } else {
      E.dl = null;
      bilanSW(m);
    }
    dessiner();
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', surMessageSW);
  function demanderEtatSW() {
    const c = 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null;
    if (c) c.postMessage({ type: 'etat' });
  }

  // ---- démarrage
  conteneur.__rafraichir = () => { demanderEtatSW(); if (!E.dl && E.svg) dessiner(); };
  (async () => {
    try {
      dire('Chargement…');
      await Promise.all([chargerSynoptique(), HL.ouvrir()]);
      E.durable = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => null) : null;
      restaurerChoix();
      recalculerChoix();
      demanderEtatSW();
      dire('');
      dessiner();
      await calculer();
      dessiner();
    } catch (err) {
      dire(`Écran indisponible : ${err.message}`, true);
    }
  })();
}

return { monter };
}());
