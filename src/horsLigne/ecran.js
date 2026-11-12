/**
 * Écran « Carte hors ligne » (Réglages > Mon appareil).
 *
 * Montre le synoptique en grisé ; les tronçons et stations choisis (calage du synoptique > Hors ligne, sinon tout le réseau)
 * se colorent selon leur état sur CET appareil :
 *   - plein       : fond de plan entièrement gardé (disponible hors ligne) ;
 *   - atténué     : téléchargement en cours (60 %) ;
 *   - pointillé   : choisi, pas encore téléchargé ;
 *   - gris        : non choisi (pas disponible hors ligne).
 * Le téléchargement ne démarre qu'après confirmation.
 * Une « unité » est un tronçon ou une station repérée par ses polygones (clé P…+P…), comme dans le calage.
 */
const AMGT4CEM_EcranHorsLigne = (function () {
'use strict';

const SVG_URL = './data/synoptique/synoptique-reseau-v17.svg';
const CLE_SELECTION = 'amgt4cem.horsligne.selection.v1';
const ZOOMS = [19, 18, 17, 16, 15];
const MARGE_19_M = 100; // doublée à chaque niveau en moins (marge constante à l'écran)
const KO_PAR_TUILE = { 19: 7.9, 18: 11.9, 17: 18.2, 16: 9.7, 15: 14.8 }; // poids moyens mesurés le 06/11/2026
const PARALLELE = 6;

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
const koDeCle = (k) => KO_PAR_TUILE[Number(k.split('/')[0])] || 12;

function lireSelection() {
  try {
    const v = JSON.parse(localStorage.getItem(CLE_SELECTION) || 'null');
    if (v && Array.isArray(v.cles)) return v;
  } catch (err) { /* illisible : tout le réseau */ }
  return null;
}

function monter(conteneur) {
  const E = {
    svg: null, unites: [], parCle: new Map(), couleur: {},
    choisies: new Set(), source: 'reseau', calcule: false, calcEnCours: false,
    dl: null, // { arret: bool, faites, total, erreurs }
    msg: '', erreur: false, durable: null,
  };

  // ---- éléments d'écran
  const intro = h('p', { class: 'rgl-note', text: 'Gardez sur cet appareil le fond de plan autour des tunnels et des stations pour consulter la carte sans réseau.' });
  const zoneSyn = h('div', { class: 'hl-syn', 'aria-label': 'Synoptique du réseau' });
  const legende = h('ul', { class: 'hl-legende' },
    h('li', {}, h('i', { class: 'hl-p hl-p--ok' }), ' disponible hors ligne'),
    h('li', {}, h('i', { class: 'hl-p hl-p--cours' }), ' en cours'),
    h('li', {}, h('i', { class: 'hl-p hl-p--att' }), ' à télécharger'),
    h('li', {}, h('i', { class: 'hl-p hl-p--non' }), ' non choisi'));
  const btnZoomPlus = h('button', { type: 'button', class: 'rgl-btn rgl-btn--petit', text: 'Agrandir' });
  const btnZoomMoins = h('button', { type: 'button', class: 'rgl-btn rgl-btn--petit', text: 'Réduire' });
  const resume = h('div', { class: 'hl-resume', role: 'status' });
  const barre = h('div', { class: 'hl-barre' }, h('div', { class: 'hl-barre__plein' }));
  const message = h('p', { class: 'rgl-statut', role: 'status', hidden: '' });
  const actions = h('div', { class: 'rgl-actions' });
  const detail = h('details', { class: 'hl-detail' }, h('summary', { text: 'Détail par tronçon et station' }));
  const liste = h('div', { class: 'hl-liste' });
  detail.append(liste);
  const pied = h('p', { class: 'rgl-note hl-pied' });
  conteneur.append(intro, h('div', { class: 'hl-zooms' }, btnZoomMoins, btnZoomPlus), zoneSyn, legende, resume, barre, message, actions, detail, pied);

  let facteurZoom = 1;
  const majZoom = () => { if (E.svg) E.svg.style.width = `${facteurZoom * 100}%`; };
  btnZoomPlus.addEventListener('click', () => { facteurZoom = Math.min(5, facteurZoom + 0.5); majZoom(); });
  btnZoomMoins.addEventListener('click', () => { facteurZoom = Math.max(1, facteurZoom - 0.5); majZoom(); });

  const dire = (t, erreur) => {
    E.msg = t; E.erreur = !!erreur;
    message.textContent = t;
    message.hidden = !t;
    message.className = `rgl-statut${erreur ? ' rgl-statut--erreur' : ''}`;
  };

  // ---- synoptique et unités
  async function chargerSynoptique() {
    const rep = await fetch(SVG_URL, { cache: 'no-cache' });
    if (!rep.ok) throw new Error('Synoptique introuvable.');
    const doc = new DOMParser().parseFromString(await rep.text(), 'image/svg+xml');
    const svg = document.importNode(doc.documentElement, true);
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.setAttribute('class', 'hl-svg');
    const troncons = svg.querySelector('#troncons');
    const stations = svg.querySelector('#stations');
    if (troncons && stations) stations.parentNode.insertBefore(troncons, stations);
    for (const g of svg.querySelectorAll('#lignes > g[data-ligne]')) {
      const traits = [...g.querySelectorAll('path')].filter((p) => !p.classList.contains('halo'));
      E.couleur[g.getAttribute('data-ligne')] = traits.length ? traits[traits.length - 1].getAttribute('stroke') : '#0b5c75';
    }
    const par = new Map();
    for (const el of svg.querySelectorAll('[data-type]')) {
      const type = el.getAttribute('data-type');
      if (type === 'arret') continue;
      let ps = (el.getAttribute('data-p') || '').split(/\s+/).filter(Boolean);
      if (!ps.length && type === 'terminus') {
        const etq = svg.querySelector(`#etiquettes-lignes > g[data-ligne="${el.getAttribute('data-ligne')}"][data-nom="${el.getAttribute('data-nom')}"][data-p]`);
        if (etq) ps = etq.getAttribute('data-p').split(/\s+/).filter(Boolean);
      }
      if (!ps.length) continue;
      const cle = [...ps].sort().join('+');
      let u = par.get(cle);
      if (!u) { u = { cle, ps: [...ps].sort(), kind: type === 'troncon' ? 'troncon' : 'station', nom: el.getAttribute('data-nom') || cle, lignes: new Set(), els: [], tuiles: null }; par.set(cle, u); }
      const ligne = el.getAttribute('data-ligne');
      if (ligne) u.lignes.add(ligne);
      (el.getAttribute('data-lignes') || '').split(/\s+/).filter(Boolean).forEach((n) => u.lignes.add(n));
      u.els.push(el);
    }
    E.unites = [...par.values()].sort((a, b) => tri([...a.lignes].sort(tri)[0] || '99', [...b.lignes].sort(tri)[0] || '99') || a.nom.localeCompare(b.nom));
    E.parCle = par;
    E.svg = svg;
    zoneSyn.replaceChildren(svg);
    majZoom();
  }

  function lireChoix() {
    const sel = lireSelection();
    if (sel) {
      E.source = 'calage';
      E.choisies = new Set(sel.cles.filter((c) => E.parCle.has(c)));
    } else {
      E.source = 'reseau';
      E.choisies = new Set(E.unites.map((u) => u.cle));
    }
  }

  // ---- calcul des tuiles de chaque unité choisie
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
    if (E.calcEnCours) return;
    E.calcEnCours = true;
    E.calcule = false;
    try {
      const aFaire = E.unites.filter((u) => E.choisies.has(u.cle) && !u.tuiles);
      if (aFaire.length) {
        dire('Calcul des tuiles à garder…');
        const segs = await segmentsParPolygone(new Set(aFaire.flatMap((u) => u.ps)));
        let i = 0;
        for (const u of aFaire) {
          const s = u.ps.flatMap((p) => segs.get(p) || []);
          u.manque = u.ps.filter((p) => !(segs.get(p) || []).length).length;
          u.tuiles = [];
          if (s.length) {
            for (const z of ZOOMS) u.tuiles.push(...AMGT4CEM_TuilesGeom.tuilesAutour(s, z, MARGE_19_M * 2 ** (19 - z)).map(([x, y]) => `${z}/${x}/${y}`));
          }
          i += 1;
          if (i % 4 === 0) { dire(`Calcul des tuiles à garder… ${i} / ${aFaire.length}`); await new Promise((r) => setTimeout(r, 0)); }
        }
        dire('');
      }
      E.calcule = true;
    } catch (err) {
      dire(`Calcul impossible : ${err.message}`, true);
    } finally { E.calcEnCours = false; }
  }

  // ---- état d'une unité sur cet appareil
  function etatUnite(u) {
    if (!E.choisies.has(u.cle)) return { etat: 'non', gardees: 0, total: 0, ko: 0, koTotal: 0 };
    const t = u.tuiles || [];
    let g = 0; let ko = 0; let koT = 0;
    for (const k of t) { const c = koDeCle(k); koT += c; if (AMGT4CEM_HorsLigne.index.has(k)) { g += 1; ko += c; } }
    let etat = 'att';
    if (t.length && g === t.length) etat = 'ok';
    else if (E.dl && !E.dl.arret && g > 0) etat = 'cours';
    else if (E.dl && !E.dl.arret && E.dl.cibles.has(u.cle)) etat = 'cours';
    return { etat, gardees: g, total: t.length, ko, koTotal: koT };
  }

  function totaux() {
    const union = new Set();
    for (const u of E.unites) if (E.choisies.has(u.cle) && u.tuiles) u.tuiles.forEach((k) => union.add(k));
    let gardees = 0; let ko = 0; let koT = 0; let koReste = 0;
    for (const k of union) {
      const c = koDeCle(k); koT += c;
      if (AMGT4CEM_HorsLigne.index.has(k)) { gardees += 1; ko += c; } else koReste += c;
    }
    return { union, total: union.size, gardees, ko, koT, koReste };
  }

  // ---- affichage
  function colorer() {
    for (const u of E.unites) {
      const { etat } = etatUnite(u);
      const couleur = E.couleur[[...u.lignes].sort(tri)[0]] || '#0b5c75';
      for (const el of u.els) {
        el.classList.remove('hl-ok', 'hl-cours', 'hl-att');
        el.style.removeProperty('--hl-c');
        if (etat === 'non') continue;
        el.classList.add(`hl-${etat}`);
        el.style.setProperty('--hl-c', couleur);
      }
    }
  }

  function dessiner() {
    colorer();
    const T = totaux();
    const nbChoisies = [...E.choisies].length;
    const origine = E.source === 'calage'
      ? 'Sélection faite dans le calage du synoptique (mode Hors ligne).'
      : 'Aucune sélection faite dans le calage : tout le réseau est proposé.';
    const lignes = [h('div', { class: 'hl-resume__ligne', text: `${fmtN(nbChoisies)} tronçons et stations choisis. ${origine}` })];
    if (E.calcule) {
      lignes.push(h('div', { class: 'hl-resume__ligne hl-resume__fort', text: `Gardé sur cet appareil : ${fmtN(T.gardees)} / ${fmtN(T.total)} tuiles (${fmtMo(T.ko)} / ${fmtMo(T.koT)})` }));
    } else {
      lignes.push(h('div', { class: 'hl-resume__ligne', text: E.calcEnCours ? 'Calcul en cours…' : 'Calcul des tuiles non fait.' }));
    }
    resume.replaceChildren(...lignes);
    barre.firstChild.style.width = `${T.total ? Math.round((100 * T.gardees) / T.total) : 0}%`;
    dessinerActions(T);
    dessinerListe();
    dessinerPied();
  }

  function dessinerActions(T) {
    const el = [];
    if (E.dl && !E.dl.arret) {
      el.push(h('p', { class: 'rgl-note', text: `Téléchargement : ${fmtN(E.dl.faites)} / ${fmtN(E.dl.total)} tuiles${E.dl.erreurs ? ` (${E.dl.erreurs} en échec)` : ''}` }));
      const stop = h('button', { type: 'button', class: 'rgl-btn', text: 'Arrêter' });
      stop.addEventListener('click', () => { E.dl.arret = true; });
      el.push(stop);
    } else if (E.confirmation) {
      el.push(h('p', { class: 'rgl-note', text: `Télécharger ${fmtN(E.confirmation.tuiles.length)} tuiles (environ ${fmtMo(E.confirmation.ko)}) ? Le wifi est préférable. Ne quittez pas cette page pendant le téléchargement.` }));
      const oui = h('button', { type: 'button', class: 'rgl-btn rgl-btn--primary', text: 'Oui, télécharger' });
      const non = h('button', { type: 'button', class: 'rgl-btn', text: 'Annuler' });
      oui.addEventListener('click', () => telecharger(E.confirmation.tuiles));
      non.addEventListener('click', () => { E.confirmation = null; dessiner(); });
      el.push(oui, non);
    } else {
      const manquantes = [...T.union].filter((k) => !AMGT4CEM_HorsLigne.index.has(k));
      const btn = h('button', { type: 'button', class: 'rgl-btn rgl-btn--primary', text: manquantes.length ? `Télécharger (environ ${fmtMo(T.koReste)})` : 'Tout est déjà téléchargé' });
      if (!manquantes.length || !E.calcule || !AMGT4CEM_HorsLigne.pret) btn.disabled = true;
      btn.addEventListener('click', () => { E.confirmation = { tuiles: manquantes, ko: T.koReste }; dessiner(); });
      el.push(btn);
      if (AMGT4CEM_HorsLigne.pret && AMGT4CEM_HorsLigne.index.size) {
        const eff = h('button', { type: 'button', class: 'rgl-btn', text: 'Effacer les cartes gardées' });
        eff.addEventListener('click', async () => {
          if (!window.confirm('Effacer toutes les cartes gardées sur cet appareil ?')) return;
          await AMGT4CEM_HorsLigne.supprimer();
          dire('Cartes effacées de cet appareil.');
          dessiner();
        });
        el.push(eff);
      }
    }
    actions.replaceChildren(...el);
  }

  function dessinerListe() {
    const lignes = [];
    for (const u of E.unites) {
      if (!E.choisies.has(u.cle)) continue;
      const s = etatUnite(u);
      const etiquette = { ok: 'disponible', cours: 'en cours', att: 'à télécharger' }[s.etat];
      lignes.push(h('div', { class: `hl-ligne hl-ligne--${s.etat}` },
        h('span', { class: 'hl-ligne__nom', text: `${u.kind === 'station' ? 'Station ' : ''}${u.nom}${u.lignes.size ? ` (${[...u.lignes].sort(tri).join(', ')})` : ''}` }),
        h('span', { class: 'hl-ligne__val', text: u.tuiles ? `${fmtN(s.gardees)} / ${fmtN(s.total)} tuiles, ${fmtMo(s.koTotal)} — ${etiquette}` : '…' })));
    }
    liste.replaceChildren(...(lignes.length ? lignes : [h('p', { class: 'rgl-note', text: 'Aucun tronçon choisi. Choisissez-en dans le calage du synoptique (mode Hors ligne).' })]));
  }

  async function dessinerPied() {
    const HL = AMGT4CEM_HorsLigne;
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
  }

  // ---- téléchargement
  function adresse(cfg, z, x, y) {
    const sep = cfg.url.includes('?') ? '&' : '?';
    return `${cfg.url}${sep}service=WMTS&request=GetTile&version=1.0.0&layer=${encodeURIComponent(cfg.layer)}&style=`
      + `&tilematrixset=${encodeURIComponent(cfg.tileMatrixSet)}&tilematrix=${encodeURIComponent(cfg.tileMatrixSet)}:${z}`
      + `&tilerow=${y}&tilecol=${x}&format=${encodeURIComponent(cfg.format || 'image/png')}`;
  }

  async function telecharger(tuiles) {
    E.confirmation = null;
    if (!tuiles.length) { dessiner(); return; }
    const cibles = new Set(E.unites.filter((u) => E.choisies.has(u.cle) && (u.tuiles || []).some((k) => !AMGT4CEM_HorsLigne.index.has(k))).map((u) => u.cle));
    E.dl = { arret: false, faites: 0, total: tuiles.length, erreurs: 0, reussies: 0, cibles };
    dire('');
    E.durable = await AMGT4CEM_HorsLigne.demanderDurable();
    await AMGT4CEM_Services.load();
    const cfg = AMGT4CEM_Services.tuilesConfig();
    if (!cfg) { E.dl = null; dire('Les tuiles de la carte ne sont pas configurées (mode « WMS seul »).', true); dessiner(); return; }
    let i = 0;
    let derniereMaj = 0;
    let fatal = null;
    const rafraichir = (force) => {
      const t = Date.now();
      if (!force && t - derniereMaj < 400) return;
      derniereMaj = t; dessiner();
    };
    async function travailleur() {
      while (i < tuiles.length && !E.dl.arret && !fatal) {
        const cle = tuiles[i]; i += 1;
        const [z, x, y] = cle.split('/').map(Number);
        try {
          const r = await fetch(adresse(cfg, z, x, y), { mode: 'cors', cache: 'no-store' });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const b = await r.blob();
          if (!/^image\//.test(b.type) || b.size < 50) throw new Error('réponse inattendue');
          try { await AMGT4CEM_HorsLigne.ecrire(cle, b); E.dl.reussies += 1; } catch (err) { fatal = 'Le stockage de l\'appareil est plein ou refusé.'; }
        } catch (err) {
          E.dl.erreurs += 1;
          if (E.dl.reussies === 0 && E.dl.erreurs >= 12) fatal = 'Le service de cartes ne répond pas ou n\'autorise pas la lecture depuis cette application.';
        }
        E.dl.faites += 1;
        rafraichir(false);
      }
    }
    await Promise.all(Array.from({ length: PARALLELE }, travailleur));
    const bilan = E.dl;
    E.dl = null;
    if (fatal) dire(`${fatal} ${fmtN(bilan.reussies)} tuiles gardées.`, true);
    else if (bilan.arret) dire(`Téléchargement arrêté. ${fmtN(bilan.reussies)} tuiles gardées, reprenez quand vous voulez.`);
    else if (bilan.erreurs) dire(`Terminé avec ${fmtN(bilan.erreurs)} tuiles en échec. Touchez « Télécharger » pour réessayer ces tuiles.`, true);
    else dire('Téléchargement terminé. La carte est disponible hors ligne.');
    dessiner();
  }

  // ---- démarrage
  async function rafraichirTout() {
    if (E.dl) return; // ne pas défaire un téléchargement en cours
    lireChoix();
    dessiner();
    await calculer();
    dessiner();
  }
  conteneur.__rafraichir = rafraichirTout;

  (async () => {
    try {
      dire('Chargement…');
      await Promise.all([chargerSynoptique(), AMGT4CEM_HorsLigne.ouvrir()]);
      E.durable = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => null) : null;
      dire('');
      await rafraichirTout();
    } catch (err) {
      dire(`Écran indisponible : ${err.message}`, true);
    }
  })();
}

return { monter };
}());
