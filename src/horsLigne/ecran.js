/**
 * Écran « Carte hors ligne » (Réglages > Mon appareil).
 *
 * Synoptique grisé ; la sélection se fait en le touchant, comme dans « Hors ligne » du calage du synoptique (la logique est
 * recopiée ici : l'outil de calage reste séparé, et la sélection de cet écran est propre à cet appareil et à cet écran) :
 *   - étiquette de ligne = ligne entière ;
 *   - deux arrêts = la portion entre eux (le premier présélectionne les lignes qui y passent, le second doit être sur l'une d'elles ;
 *     même arrêt deux fois = la station seule ; n'importe quel arrêt peut borner, même sans contour : rien n'est gardé de plus).
 * Couleurs : plein = fond de plan entièrement gardé sur l'appareil ; 50 % = choisi, pas (entièrement) téléchargé ; gris = ni l'un ni l'autre.
 * Deux boutons : « Mettre à jour » télécharge seulement (jamais d'effacement, pas de confirmation, la taille est sur le bouton) ;
 * « Vider la corbeille » efface, après confirmation, les tuiles qu'aucune zone choisie n'utilise, puis retire les zones désactivées.
 * Toucher un arrêt ouvre un petit panneau guidé (ligne entière, tronçon, annuler) ; les gestes directs restent des raccourcis.
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
const fmtMo = (ko) => { if (!(ko > 0)) return '0 Mo'; const mo = ko / 1000; return `${mo < 10 ? mo.toFixed(1).replace('.', ',') : fmtN(mo)} Mo`; };
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
    hl: { lignes: [], portions: [], ligneRet: new Set(), etape: null, debut: null, pres: null, ligneCh: null, items: [], selKeys: new Set() },
    calcule: false, calcEnCours: false, dl: null, confirmation: null, durable: null, erreurDl: false, erreursTuiles: 0, vidage: false,
  };

  // ---- éléments d'écran
  const intro = h('p', { class: 'rgl-note', text: 'Choisissez les lignes ou les tronçons à conserver sur votre appareil.' });
  const resume = h('section', { class: 'hl-carte', role: 'status', 'aria-label': 'Disponibles hors ligne' });
  const titrePlan = h('h2', { class: 'hl-titre', text: 'Choisir sur le plan' });
  const zoneSyn = h('div', { class: 'hl-syn', 'aria-label': 'Synoptique du réseau' });
  const legende = h('ul', { class: 'hl-legende' },
    h('li', {}, h('i', { class: 'hl-p hl-p--ok' }), ' couleur pleine : disponible hors ligne'),
    h('li', {}, h('i', { class: 'hl-p hl-p--sel' }), ' couleur pâle : choisi, à télécharger'),
    h('li', {}, h('i', { class: 'hl-p hl-p--non' }), ' grisé : non choisi'));
  const panneau = h('div', { class: 'hl-panneau', role: 'status' });
  const message = h('p', { class: 'rgl-statut', role: 'status', hidden: '' });
  const titreListe = h('h2', { class: 'hl-titre', text: 'Mes lignes enregistrées' });
  const liste = h('div', { class: 'hl-items' });
  const actions = h('div', { class: 'rgl-actions hl-actions' });
  const detailListe = h('div', { class: 'hl-liste' });
  const detailTroncons = h('details', { class: 'hl-detail hl-detail--sous' }, h('summary', { text: 'Détail par tronçon et station' }), detailListe);
  const detailCorps = h('div', { class: 'hl-tech' });
  const detail = h('details', { class: 'hl-detail' }, h('summary', { text: 'Détails techniques' }), detailCorps, detailTroncons);
  conteneur.append(intro, resume, titrePlan, zoneSyn, panneau, legende, message, titreListe, liste, actions, detail);

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

  // Flèche de retour (celle du menu Couches : 23 px, trait de 0,8 px, bleu des icônes).
  const ICONE_ANNULER = '<svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="0.835" stroke-linecap="round" stroke-linejoin="round"><g transform="matrix(-1 0 0 1 24 0)"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.5v4.5h-4.5"/></g></svg>';
  // Icône « Réinitialiser la vue » (copie de src/nav/icone-reinitialiser-vue.svg, bleu des icônes).
  const ICONE_VUE = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 23 23\" width=\"23\" height=\"23\" fill=\"none\" stroke=\"#0b5c75\" stroke-width=\"0.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M5.44 0.4H2.26A1.78 1.78 0 0 0 0.48 2.18V5.17M17.56 0.4H20.74A1.78 1.78 0 0 1 22.52 2.18V5.17M5.44 22.6H2.26A1.78 1.78 0 0 1 0.48 20.82V17.83M17.56 22.6H20.74A1.78 1.78 0 0 0 22.52 20.82V17.83\"/><path d=\"M14.14 2.36 L13.57 2.54 L13.08 2.78 L12.67 3.08 L12.33 3.43 L12.07 3.83 L11.72 4.1 L11.29 4.22 L10.77 4.21 L10.16 4.06 L9.5 4.06 L8.77 4.2 L7.98 4.49 L7.13 4.93 L6.47 5.3 L6.01 5.6 L5.75 5.83 L5.68 6 L5.64 6.17 L5.63 6.34 L5.65 6.51 L5.71 6.69 L5.66 6.92 L5.51 7.22 L5.27 7.57 L4.92 7.99 L4.69 8.37 L4.59 8.73 L4.61 9.07 L4.75 9.38 L4.85 9.7 L4.92 10.02 L4.94 10.35 L4.92 10.68 L4.89 10.96 L4.84 11.18 L4.78 11.35 L4.7 11.46 L4.54 11.57 L4.31 11.68 L4 11.79 L3.61 11.91 L3.25 12.1 L2.91 12.39 L2.61 12.76 L2.33 13.23 L2.13 13.61 L2.02 13.92 L1.99 14.16 L2.05 14.31 L2.17 14.48 L2.35 14.64 L2.59 14.82 L2.89 14.99 L3.17 15.12 L3.43 15.19 L3.66 15.22 L3.88 15.19 L4.09 15.21 L4.29 15.26 L4.49 15.36 L4.68 15.5 L4.92 15.58 L5.23 15.62 L5.58 15.6 L6 15.54 L6.32 15.55 L6.54 15.64 L6.67 15.81 L6.7 16.06 L6.79 16.28 L6.94 16.46 L7.15 16.62 L7.42 16.75 L7.67 16.97 L7.89 17.29 L8.09 17.7 L8.26 18.21 L8.43 18.63 L8.6 18.96 L8.75 19.2 L8.9 19.35 L9.14 19.46 L9.47 19.52 L9.88 19.53 L10.38 19.5 L10.82 19.49 L11.2 19.51 L11.52 19.56 L11.77 19.63 L12 19.76 L12.2 19.96 L12.38 20.21 L12.53 20.53 L12.84 20.68 L13.3 20.65 L13.91 20.45 L14.68 20.08 L15.33 19.79 L15.84 19.58 L16.22 19.47 L16.48 19.44 L16.89 19.27 L17.45 18.98 L18.17 18.56 L19.05 18.02 L19.59 17.53 L19.8 17.11 L19.68 16.75 L19.22 16.46 L18.88 16.2 L18.63 15.97 L18.5 15.78 L18.47 15.62 L18.41 15.48 L18.34 15.36 L18.24 15.26 L18.12 15.18 L18.05 15.07 L18.04 14.93 L18.07 14.75 L18.16 14.55 L18.33 14.36 L18.58 14.19 L18.92 14.04 L19.34 13.92 L19.63 13.73 L19.78 13.5 L19.79 13.2 L19.66 12.85 L19.58 12.52 L19.55 12.2 L19.57 11.9 L19.65 11.61 L19.66 11.32 L19.62 11.03 L19.53 10.74 L19.38 10.45 L19.17 10.21 L18.92 10.02 L18.61 9.89 L18.25 9.81 L17.96 9.71 L17.72 9.59 L17.54 9.46 L17.42 9.31 L17.27 9.2 L17.09 9.13 L16.87 9.09 L16.62 9.1 L16.4 9.07 L16.19 9.01 L15.99 8.9 L15.82 8.76 L15.71 8.58 L15.68 8.37 L15.71 8.12 L15.81 7.85 L15.94 7.61 L16.08 7.42 L16.24 7.27 L16.43 7.17 L16.54 7 L16.57 6.77 L16.53 6.47 L16.42 6.1 L16.37 5.78 L16.37 5.5 L16.43 5.27 L16.55 5.08 L16.59 4.86 L16.54 4.63 L16.41 4.37 L16.2 4.09 L15.99 3.87 L15.81 3.7 L15.63 3.58 L15.48 3.52 L15.37 3.41 L15.31 3.26 L15.3 3.08 L15.34 2.85 L15.34 2.65 L15.31 2.48 L15.24 2.34 L15.14 2.24 L14.92 2.21 L14.59 2.25Z\"/><path d=\"M10.28 8.7 L8.75 10.48 L9.58 12.74 L11.77 11.85 L12.34 10.07Z\"/></svg>";

  /** Zoom/déplacement du dessin : pincement à 2 doigts, glisser, molette ; un toucher bref sans mouvement = sélection. */
  function PanZoom(zone, svg, complet, surToucher) {
    // Limites du dessin : tout ce que le synoptique contient (traits, étiquettes, noms) plus une très petite marge. Le dessin ne sort jamais du cadre.
    const MARGE = 10;
    let lim = { ...complet };
    try {
      // Union des éléments dessinés, sans le grand rectangle de fond ni les définitions.
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
      for (const c of svg.children) {
        if (!/^(g|path|circle|ellipse|line|polyline|polygon|text|use|image)$/i.test(c.tagName)) continue;
        const bb = c.getBBox();
        if (!(bb.width > 0 || bb.height > 0)) continue;
        x0 = Math.min(x0, bb.x); y0 = Math.min(y0, bb.y); x1 = Math.max(x1, bb.x + bb.width); y1 = Math.max(y1, bb.y + bb.height);
      }
      if (x1 > x0 && y1 > y0) lim = { x: x0 - MARGE, y: y0 - MARGE, w: x1 - x0 + 2 * MARGE, h: y1 - y0 + 2 * MARGE };
    } catch (err) { /* repli : zone de départ */ }
    let vb = { ...lim };
    const pts = new Map();
    let depart = null; let bouge = false; let cible = null; let pince = null;
    const borne = (w) => w;
    /** Ramène la zone visible à la forme du cadre, interdit de dézoomer plus que « tout le dessin » et de sortir du dessin. */
    function cadrer() {
      const W = zone.clientWidth; const H = zone.clientHeight;
      if (!W || !H) return;
      const wMax = Math.max(lim.w, (lim.h * W) / H);
      const w = Math.min(wMax, Math.max(lim.w / 60, vb.w, (vb.h * W) / H));
      const h = (w * H) / W;
      let x = vb.x + vb.w / 2 - w / 2;
      let y = vb.y + vb.h / 2 - h / 2;
      x = w >= lim.w ? lim.x + lim.w / 2 - w / 2 : Math.max(lim.x, Math.min(lim.x + lim.w - w, x));
      y = h >= lim.h ? lim.y + lim.h / 2 - h / 2 : Math.max(lim.y, Math.min(lim.y + lim.h - h, y));
      vb = { x, y, w, h };
    }
    const appliquer = () => { cadrer(); svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => appliquer()).observe(zone);
    appliquer();
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
     return { reinit: () => { vb = { ...lim }; appliquer(); } };
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
    // Bouton « Réinitialiser la vue » (même icône que le menu Couches de la carte), en bas à droite du cadre : il remet le synoptique entier.
    const vue = h('button', { type: 'button', class: 'hl-vue', title: 'Réinitialiser la vue', 'aria-label': 'Réinitialiser la vue' });
    vue.innerHTML = ICONE_VUE;
    for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'wheel']) vue.addEventListener(t, (ev) => ev.stopPropagation());
    vue.addEventListener('click', () => E.pz.reinit());
    zoneSyn.append(vue);
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
    // Une zone « à retirer » reste dans la liste (barrée) mais ne compte plus dans la sélection : rien n'est effacé avant « Mettre à jour ».
    for (const n of H.lignes) {
      const sub = new Map();
      const r = resoudreLigne(n, sub);
      const retire = H.ligneRet.has(n);
      if (!retire) sub.forEach((u, k) => H.selKeys.add(k));
      H.items.push({ genre: 'ligne', ligne: n, texte: 'ligne entière', lignes: [n], unites: [...sub.values()], avert: r.avert, retire });
    }
    H.portions.forEach((p, i) => {
      const sub = new Map();
      const r = resoudrePortion(p, sub);
      const retire = !!p.retire;
      if (!retire) sub.forEach((u, k) => H.selKeys.add(k));
      H.items.push({ genre: 'portion', idx: i, texte: r.texte, lignes: r.lignes, unites: [...sub.values()], avert: r.avert, retire });
    });
  }

  function sauverChoix() {
    try { localStorage.setItem(CLE_CHOIX, JSON.stringify({ lignes: E.hl.lignes, portions: E.hl.portions, ligneRet: [...E.hl.ligneRet] })); } catch (err) { /* stockage indisponible */ }
  }
  function restaurerChoix() {
    try {
      const v = JSON.parse(localStorage.getItem(CLE_CHOIX) || 'null');
      if (!v) return;
      E.hl.lignes = (v.lignes || []).filter((n) => E.lignes.includes(n));
      E.hl.ligneRet = new Set((v.ligneRet || []).filter((n) => E.hl.lignes.includes(n)));
      const vus = new Set();
      E.hl.portions = [];
      for (const p of (v.portions || [])) {
        if (!E.recs.has(p.debut) || !E.recs.has(p.fin)) continue;
        const k = [p.debut, p.fin].sort().join('|');
        if (vus.has(k)) continue;
        vus.add(k);
        E.hl.portions.push(p.retire ? { debut: p.debut, fin: p.fin, retire: true } : { debut: p.debut, fin: p.fin });
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
    H.etape = null; H.debut = null; H.pres = null; H.ligneCh = null;
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

  function clicLigne(n) { // raccourci : étiquette de ligne touchée
    const H = E.hl;
    annulerEnCours();
    const i = H.lignes.indexOf(n);
    if (i < 0) { H.lignes.push(n); H.lignes.sort(tri); } else if (H.ligneRet.has(n)) H.ligneRet.delete(n); else H.ligneRet.add(n); // déjà choisie : « à retirer » (retouchée : annulé)
    modifier();
  }

  /** Bouton « Ajouter la ligne entière » du panneau : jamais de doublon, une ligne désactivée est réactivée. */
  function ajouterLigne(n) {
    const H = E.hl;
    annulerEnCours();
    if (!H.lignes.includes(n)) { H.lignes.push(n); H.lignes.sort(tri); } else if (H.ligneRet.has(n)) H.ligneRet.delete(n);
    else { dire(`La ligne ${n} est déjà choisie.`); dessiner(); return; }
    modifier();
  }

  function clicStation(rec) {
    const H = E.hl;
    if (rec.kind === 'troncon') { dire('Touchez un arrêt, pas un tronçon. Pour une ligne entière, touchez son étiquette.'); return; }
    if (H.etape === null) {
      const { out, amb } = lignesDe(rec, E.lignes);
      if (!out.length) {
        dire(amb.length ? `« ${rec.nom} » apparaît à plusieurs endroits d'une même ligne : touchez l'emplacement voulu plus précisément.` : `« ${rec.nom} » n'est sur aucune ligne du synoptique.`, true);
        return;
      }
      H.debut = rec.id; H.pres = new Set(out); H.etape = 'panneau'; H.ligneCh = out.length === 1 ? out[0] : null;
      marquerDebut(); majPres(); dire(''); dessiner();
      return;
    }
    if (H.etape === 'panneau') { // raccourci : un second arrêt touché pendant que le panneau est ouvert
      if (H.ligneCh) H.pres = new Set([H.ligneCh]);
      H.etape = 'fin'; marquerDebut(); majPres();
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
    const memeQue = (q) => (q.debut === debut && q.fin === fin) || (q.debut === fin && q.fin === debut);
    const existante = H.portions.find(memeQue);
    annulerEnCours();
    if (existante && existante.retire) { delete existante.retire; modifier(); return; } // portion « à retirer » rechoisie : annulé
    if (existante) { dire('Cette portion est déjà choisie.'); dessiner(); return; }
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
      const couleurUnite = couleurLigne([...u.lignes].sort(tri)[0]);
      for (const el of u.els) {
        el.classList.remove('hl-ok', 'hl-sel');
        el.style.removeProperty('--hl-c');
        if (!ok && !sel) continue;
        el.classList.add(ok ? 'hl-ok' : 'hl-sel');
        // Chaque trait garde la couleur de sa propre ligne (tunnel partagé : une voie par ligne).
        const rec = E.recs.get(el.id);
        const propre = rec && rec.lignes && rec.lignes.length ? couleurLigne([...rec.lignes].sort(tri)[0]) : couleurUnite;
        el.style.setProperty('--hl-c', propre);
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

  const ICONE_COCHE = '<svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>';

  /** Texte du statut du résumé. */
  function statut(T) {
    if (E.dl) return 'Mise à jour en cours';
    if (E.erreurDl && T && T.manquantes.length) return 'Erreur de téléchargement';
    if (!T) return 'Calcul en cours…';
    if (!E.hl.selKeys.size) return 'Aucune zone choisie';
    return T.manquantes.length ? 'Téléchargement nécessaire' : 'Tout est à jour';
  }

  function dessiner() {
    if (!E.svg) return;
    const H = E.hl;
    colorer();
    const T = E.calcule ? totaux() : null;
    const aJour = !!T && !E.dl && H.selKeys.size > 0 && !T.manquantes.length;

    // Résumé : coche quand tout est disponible, compteurs, état ; barre de progression seulement pendant un téléchargement.
    const tete = h('div', { class: 'hl-carte__tete' });
    const coche = h('span', { class: 'hl-coche', 'aria-hidden': 'true' });
    if (aJour) coche.innerHTML = ICONE_COCHE;
    tete.append(coche, h('span', { class: 'hl-carte__titre', text: 'Disponibles hors ligne' }));
    const lignesRes = [tete, h('div', { class: `hl-carte__etat${E.erreurDl && !aJour && !E.dl ? ' hl-carte__etat--erreur' : ''}`, text: statut(T) })];
    if (T) {
      const n = H.selKeys.size;
      lignesRes.push(h('div', { class: 'hl-carte__chiffres' },
        h('span', { text: `${fmtN(n)} tronçon${n > 1 ? 's' : ''} actif${n > 1 ? 's' : ''}` }),
        h('span', { text: `${fmtN(T.gardees)} / ${fmtN(T.total)} tuiles` }),
        h('span', { text: aJour || !T.manquantes.length ? fmtMo(T.ko) : `${fmtMo(T.ko)} / ${fmtMo(T.koT)}` })));
    }
    if (E.dl) {
      const pct = E.dl.total ? Math.min(100, Math.round((100 * E.dl.faites) / E.dl.total)) : 0;
      lignesRes.push(h('div', { class: 'hl-barre' }, h('div', { class: 'hl-barre__plein', style: `width:${pct}%` })),
        h('div', { class: 'hl-carte__prog', text: `${pct} % · ${fmtN(E.dl.faites)} / ${fmtN(E.dl.total)} tuiles${T ? ` · ${fmtMo(T.ko)}` : ''}${E.dl.erreurs ? ` · ${E.dl.erreurs} en échec` : ''}` }));
    }
    resume.replaceChildren(...lignesRes);

    dessinerPanneau();
    dessinerActions(T);
    dessinerListes();
    dessinerDetails(T);
  }

  /** Petit panneau sous le plan : station touchée, choix de la ligne, trois actions. */
  function dessinerPanneau() {
    const H = E.hl;
    if (H.etape === null) {
      panneau.className = 'hl-panneau hl-panneau--repos';
      panneau.replaceChildren(h('p', { text: 'Touchez une station pour la choisir, ou l\'étiquette d\'une ligne pour la garder entière.' }));
      return;
    }
    const rec = E.recs.get(H.debut);
    const lignes = [...H.pres].sort(tri);
    const el = [h('div', { class: 'hl-panneau__nom', text: rec ? rec.nom : '' })];
    if (H.etape === 'panneau') {
      const bl = h('div', { class: 'hl-panneau__lignes' });
      for (const l of lignes) {
        const c = couleurLigne(l);
        const b = h('button', { type: 'button', class: `hl-badge hl-badge-btn${H.ligneCh === l ? ' hl-badge-btn--ch' : ''}`, style: `background:${c};color:${c.toLowerCase() === '#efe047' ? '#1f2933' : '#fff'}`, text: l, 'aria-pressed': H.ligneCh === l ? 'true' : 'false', 'aria-label': `Ligne ${l}` });
        if (lignes.length > 1) b.addEventListener('click', () => { H.ligneCh = H.ligneCh === l ? null : l; dire(''); dessiner(); });
        else b.disabled = true;
        bl.append(b);
      }
      el.push(bl);
      if (lignes.length > 1) el.push(h('p', { class: 'hl-panneau__aide', text: H.ligneCh ? `Ligne ${H.ligneCh} choisie.` : 'Plusieurs lignes passent ici : touchez celle voulue.' }));
      const entiere = h('button', { type: 'button', class: 'rgl-btn rgl-btn--primary', text: 'Ajouter la ligne entière' });
      entiere.addEventListener('click', () => {
        if (!H.ligneCh) { dire('Choisissez d\'abord la ligne.', true); return; }
        ajouterLigne(H.ligneCh);
      });
      const tronc = h('button', { type: 'button', class: 'rgl-btn', text: 'Délimiter un tronçon' });
      tronc.addEventListener('click', () => {
        if (H.ligneCh) H.pres = new Set([H.ligneCh]);
        H.etape = 'fin'; dire(''); marquerDebut(); majPres(); dessiner();
      });
      el.push(entiere, tronc);
    } else {
      el.push(h('p', { class: 'hl-panneau__aide', text: `Ligne${lignes.length > 1 ? 's' : ''} ${lignes.join(', ')}. Touchez la station d'arrivée sur le plan (la même station pour elle seule).` }));
    }
    const annuler = h('button', { type: 'button', class: 'rgl-btn hl-btn-calme', text: 'Annuler' });
    annuler.addEventListener('click', () => { annulerEnCours(); dessiner(); });
    el.push(annuler);
    const nouveau = panneau.className === 'hl-panneau hl-panneau--repos' || !panneau.firstChild;
    panneau.className = 'hl-panneau';
    panneau.replaceChildren(...el);
    if (nouveau) panneau.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); // à l'ouverture : le panneau reste visible sans défiler
  }

  function dessinerActions(T) {
    const el = [];
    if (E.dl) {
      const stop = h('button', { type: 'button', class: 'rgl-btn', text: 'Arrêter' });
      stop.addEventListener('click', () => { if (E.dl.sw) { const c = navigator.serviceWorker.controller; if (c) c.postMessage({ type: 'arret' }); } else E.dl.arret = true; });
      el.push(stop);
      actions.replaceChildren(...el);
      return;
    }
    // Mettre à jour : télécharge seulement, sans confirmation ; absent quand tout est à jour (le résumé le dit).
    if (T && T.manquantes.length) {
      const maj = h('button', { type: 'button', class: 'rgl-btn rgl-btn--primary', text: `Mettre à jour · ${fmtMo(T.koManque)}` });
      if (!HL.pret || E.vidage) maj.disabled = true;
      maj.addEventListener('click', () => mettreAJour());
      el.push(maj, h('p', { class: 'rgl-note hl-actions__note', text: 'Le wifi est préférable.' }));
    }
    // Vider la corbeille : supprime seulement ce qu'aucune zone choisie n'utilise, après confirmation.
    const aRetirer = E.hl.items.filter((it) => it.retire).length;
    const vide = !T || (!T.aEffacer.length && !aRetirer);
    if (E.confirmation && T && !vide) {
      el.push(h('div', { class: 'hl-confirm' },
        h('div', { class: 'hl-confirm__titre', text: 'Vider la corbeille ?' }),
        h('p', { text: T.aEffacer.length ? `Espace récupérable : ${fmtMo(T.koEfface)}.` : 'Aucune carte à supprimer : elles servent encore à d\'autres zones. Les zones désactivées seront retirées de la liste.' }),
        (() => { const n = h('button', { type: 'button', class: 'rgl-btn', text: 'Annuler' }); n.addEventListener('click', () => { E.confirmation = null; dessiner(); }); return n; })(),
        (() => { const o = h('button', { type: 'button', class: 'rgl-btn rgl-btn--primary', text: 'Confirmer' }); o.addEventListener('click', () => viderCorbeille()); return o; })()));
    } else {
      const vc = h('button', { type: 'button', class: 'rgl-btn', text: `Vider la corbeille${T && !vide && T.aEffacer.length ? ` · ${fmtMo(T.koEfface)}` : ''}` });
      if (vide || !HL.pret || E.vidage) vc.disabled = true;
      vc.addEventListener('click', () => { E.confirmation = true; dessiner(); });
      el.push(vc);
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
      const bouton = h('button', { type: 'button', class: 'hl-ic-btn', title: it.retire ? 'Annuler le retrait' : 'Retirer cette zone', 'aria-label': it.retire ? 'Annuler le retrait' : 'Retirer cette zone' });
      if (it.retire) bouton.innerHTML = ICONE_ANNULER; else bouton.append(h('span', { class: 'hl-ic-poubelle', 'aria-hidden': 'true' }));
      bouton.addEventListener('click', () => {
        if (E.dl) return;
        if (it.genre === 'ligne') { if (it.retire) H.ligneRet.delete(it.ligne); else H.ligneRet.add(it.ligne); } else { const q = H.portions[it.idx]; if (it.retire) delete q.retire; else q.retire = true; }
        modifier();
      });
      const txt = h('span', { class: 'hl-item__txt' },
        h('span', { class: 'hl-item__nom', text: it.texte }),
        st ? h('span', { class: 'hl-item__val', text: `${fmtN(st.gardees)} / ${fmtN(st.total)} tuiles` }) : null,
        ...it.avert.map((a) => h('span', { class: 'hl-item__avert', text: `${a}.` })));
      const poids = h('span', { class: 'hl-item__poids', text: st ? fmtMo(st.koTotal) : '' });
      items.push(h('div', { class: `hl-item${it.retire ? ' hl-item--retire' : ''}` }, h('span', { class: 'hl-item__badges' }, badges(it.lignes)), txt, poids, bouton));
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

  function dessinerDetails(T) {
    const ligne = (k, v) => h('p', { class: 'hl-tech__ligne' }, h('span', { class: 'hl-tech__cle', text: k }), ' ', h('span', { text: v }));
    const el = [];
    const affiche = typeof AMGT4CEM_BUILD_TIMESTAMP === 'string' ? AMGT4CEM_BUILD_TIMESTAMP : null;
    let versionTxt;
    if (E.versionSW) versionTxt = E.versionSW + (affiche && affiche !== E.versionSW ? ` (la version affichée est ${affiche} : relancez l'application pour l'utiliser)` : '');
    else versionTxt = 'pas encore gardée pour l\'ouverture sans réseau : ouvrez l\'application une fois en ligne, puis rechargez cette page';
    el.push(ligne('Version du programme gardée sur l\'appareil :', versionTxt));
    if (!HL.pret) {
      el.push(h('p', { class: 'hl-tech__ligne', text: 'Le stockage de cet appareil n\'est pas disponible (navigation privée ?) : le téléchargement est impossible.' }));
    } else {
      let koTout = 0; for (const k of HL.index.keys()) koTout += koDeCle(k);
      if (T) el.push(ligne('Tuiles des zones actives :', `${fmtN(T.gardees)} gardées sur ${fmtN(T.total)} nécessaires, ${fmtN(E.erreursTuiles)} en erreur.`));
      el.push(ligne('Volume stocké sur l\'appareil :', `${fmtMo(koTout)} (${fmtN(HL.index.size)} tuiles, corbeille comprise).`));
      const t0 = HL.plusAncienne();
      if (t0) {
        const d = (t) => new Date(t).toLocaleDateString('fr-BE');
        el.push(ligne('Carte la plus ancienne :', d(t0)));
        el.push(ligne('À renouveler avant le :', `${d(t0 + HL.VALIDITE_JOURS * 24 * 3600 * 1000)} (les cartes sont valables ${HL.VALIDITE_JOURS} jours, puis effacées).`));
      } else el.push(ligne('Validité :', `les cartes gardées sont valables ${HL.VALIDITE_JOURS} jours, puis effacées.`));
      if (E.durable === true) el.push(ligne('Stockage :', 'protégé par le navigateur.'));
      else if (E.durable === false) el.push(ligne('Stockage :', 'le navigateur peut effacer ces cartes s\'il manque de place (iPhone : après environ 7 jours sans ouvrir l\'application).'));
    }
    el.push(h('p', { class: 'hl-tech__ligne hl-tech__fort', text: 'Ouvrez l\'application avant d\'entrer dans le tunnel : elle doit déjà être ouverte pour utiliser ces cartes sans réseau.' }));
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
    detailCorps.replaceChildren(...el);
  }

  // ---- mise à jour : télécharge seulement ce qui manque (jamais d'effacement)
  function adresse(cfg, z, x, y) {
    const sep = cfg.url.includes('?') ? '&' : '?';
    return `${cfg.url}${sep}service=WMTS&request=GetTile&version=1.0.0&layer=${encodeURIComponent(cfg.layer)}&style=`
      + `&tilematrixset=${encodeURIComponent(cfg.tileMatrixSet)}&tilematrix=${encodeURIComponent(cfg.tileMatrixSet)}:${z}`
      + `&tilerow=${y}&tilecol=${x}&format=${encodeURIComponent(cfg.format || 'image/png')}`;
  }

  /** Vider la corbeille : supprime les tuiles qu'aucune zone choisie n'utilise (les tuiles partagées restent), puis retire les zones désactivées. */
  async function viderCorbeille() {
    E.confirmation = null;
    const T = totaux();
    const cles = T.aEffacer;
    E.vidage = true; dire(''); dessiner();
    if (cles.length) await HL.supprimer(cles);
    const reste = cles.filter((k) => HL.index.has(k));
    E.vidage = false;
    if (reste.length) {
      // Échec partiel : les zones désactivées restent dans la liste, le bouton permet de réessayer.
      dire(`Nettoyage incomplet : ${fmtN(reste.length)} tuiles n'ont pas pu être supprimées. Touchez « Vider la corbeille » pour réessayer.`, true);
      dessiner();
      return;
    }
    E.hl.lignes = E.hl.lignes.filter((n) => !E.hl.ligneRet.has(n));
    E.hl.ligneRet = new Set();
    E.hl.portions = E.hl.portions.filter((q) => !q.retire);
    recalculerChoix(); sauverChoix();
    dire(cles.length ? `Corbeille vidée : ${fmtMo(T.koEfface)} libérés.` : 'Corbeille vidée.');
    dessiner();
  }

  async function mettreAJour() {
    E.confirmation = null;
    E.erreurDl = false; E.erreursTuiles = 0;
    // Les tuiles à télécharger sont recalculées : le choix a pu changer entre-temps.
    const T0 = totaux();
    const tuiles = T0.manquantes;
    // Base commune avec la barre « Gardé sur cet appareil » et l'anneau de la carte : toute la sélection, tuiles déjà gardées comprises.
    const base = Math.max(0, T0.total - tuiles.length);
    if (!tuiles.length) { dire('Rien à télécharger.'); dessiner(); return; }
    E.dl = { arret: false, faites: base, total: base + tuiles.length, erreurs: 0, reussies: 0 };
    dire('');
    E.durable = await HL.demanderDurable();
    await AMGT4CEM_Services.load();
    const cfg = AMGT4CEM_Services.tuilesConfig();
    if (!cfg) { E.dl = null; E.erreurDl = true; dire('Les tuiles de la carte ne sont pas configurées (mode « WMS seul »).', true); dessiner(); return; }
    const ctl = 'serviceWorker' in navigator ? navigator.serviceWorker.controller : null;
    if (ctl) {
      // Le service worker télécharge : on peut quitter l'écran ou la page, il continue et se reprend à la prochaine ouverture.
      E.dl.sw = true;
      ctl.postMessage({ type: 'telecharger', cles: tuiles, cfg, base });
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
    E.erreursTuiles = bilan.erreurs; E.erreurDl = !!(fatal || bilan.erreurs);
    if (fatal) dire(`${fatal} ${fmtN(bilan.reussies)} tuiles gardées.`, true);
    else if (bilan.arret) dire(`Arrêté. ${fmtN(bilan.reussies)} tuiles gardées ; reprenez avec « Mettre à jour ».`);
    else if (bilan.erreurs) dire(`Terminé avec ${fmtN(bilan.erreurs)} tuiles en échec. Touchez « Mettre à jour » pour réessayer.`, true);
    else dire('Mise à jour terminée. Les tronçons choisis sont disponibles hors ligne.');
    dessiner();
  }

  // ---- messages du service worker (téléchargement hors de la page)
  function bilanSW(m) {
    E.erreursTuiles = m.erreurs || 0;
    E.erreurDl = m.etat === 'erreur' || !!m.erreurs;
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
