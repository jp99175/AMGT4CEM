/**
 * Page jetable « ?page=mesure-tuiles » : mesure, depuis l'appareil de l'agent, le poids des tuiles du fond UrbIS (WMTS)
 * autour des stations et tunnels, pour chiffrer un stockage hors ligne. À retirer quand le cache hors ligne existera.
 *
 * Marge constante À L'ÉCRAN : la marge saisie vaut pour le zoom 19, elle double à chaque niveau en moins
 * (100 m en zoom 19, 200 m en 18, 400 m en 17, 800 m en 16, 1 600 m en 15).
 *
 * Étapes : 1) test de lecture autorisée (CORS) sur une tuile ; 2) liste exacte des tuiles qui touchent la marge
 * (distance tuile-contour des stations et tunnels, en Web Mercator) ; 3) tirage au hasard de N tuiles par zoom ;
 * 4) téléchargement trois par trois, pesée ; 5) estimation = poids moyen x nombre de tuiles.
 *
 * Adresse du service et couche : mêmes réglages que le fond de plan (AMGT4CEM_Services.tuilesConfig()).
 * Géométrie : data/shapefile/polygones + data/ditp-diov/polygones.json (genres station et tunnel).
 * Le contour seul suffit (pas de test « à l'intérieur ») tant qu'aucun polygone n'est plus large que deux fois la
 * marge : le rayon inscrit le plus grand du réseau est d'environ 30 m, la marge minimale est de 100 m.
 */
(function () {
const root = document.getElementById('mesure-tuiles-root');
AMGT4CEM_Auth.init(AMGT4CEM_CONFIG.depot || {});

const h = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  for (const c of kids) if (c) n.append(c);
  return n;
};

const { tuilesAutour } = AMGT4CEM_TuilesGeom; // calcul des tuiles : src/tuilesGeom.js
const ZOOMS = [19, 18, 17, 16, 15];
const COUCHES_PROPOSEES = ['UrbISFrenchLabeledGray', 'UrbISFrenchDutchLabeledGray'];
const PARALLELE = 3;

const fmtKo = (o) => `${(o / 1000).toFixed(1).replace('.', ',')} Ko`;
const fmtMo = (o) => `${Math.round(o / 1e6)} Mo`;
const fmtN = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// ------------------------------------------------------------------ géométrie

/** Segments (x1,y1,x2,y2) des contours des stations et tunnels, en Web Mercator (mètres). */
async function chargerSegments() {
  proj4.defs(AMGT4CEM_CONFIG.businessCRS.epsg, AMGT4CEM_CONFIG.businessCRS.proj4def);
  const [fc, ref] = await Promise.all([
    AMGT4CEM_ShpLoader.load('./data/shapefile/polygones'),
    fetch('./data/ditp-diov/polygones.json', { cache: 'no-cache' }).then((r) => r.json()),
  ]);
  const ents = ref.entites || {};
  const segs = [];
  let objets = 0;
  for (const f of fc.features) {
    const e = ents[f.properties.id];
    if (!e || (e.genre !== 'station' && e.genre !== 'tunnel')) continue;
    objets += 1;
    const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : [].concat(...f.geometry.coordinates);
    for (const ring of rings) {
      const pts = ring.map((c) => proj4(AMGT4CEM_CONFIG.businessCRS.epsg, 'EPSG:3857', [c[0], c[1]]));
      for (let i = 0; i < pts.length - 1; i += 1) segs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]]);
    }
  }
  return { segs, objets };
}

// ------------------------------------------------------------------ réseau

function adresseTuile(t, couche, z, x, y) {
  const sep = t.url.includes('?') ? '&' : '?';
  return `${t.url}${sep}service=WMTS&request=GetTile&version=1.0.0&layer=${encodeURIComponent(couche)}&style=`
    + `&tilematrixset=${encodeURIComponent(t.tileMatrixSet)}&tilematrix=${encodeURIComponent(t.tileMatrixSet)}:${z}`
    + `&tilerow=${y}&tilecol=${x}&format=${encodeURIComponent(t.format || 'image/png')}`;
}

/** Télécharge une tuile : { octets, ms, type } ou { erreur }. Lecture du corps = poids décodé de l'image. */
async function peser(url) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { mode: 'cors', cache: 'no-store' });
    if (!r.ok) return { erreur: `HTTP ${r.status}` };
    const b = await r.blob();
    return { octets: b.size, ms: performance.now() - t0, type: r.headers.get('content-type') || '' };
  } catch (err) {
    return { erreur: 'lecture refusée ou réseau coupé' };
  }
}

/** Distingue « lecture non autorisée (CORS) » de « service injoignable » : une requête sans lecture passe-t-elle ? */
async function diagnostiquer(url) {
  const essai = await peser(url);
  if (!essai.erreur) return { ok: true };
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store' });
    return { ok: false, motif: 'cors', detail: essai.erreur };
  } catch (err) {
    return { ok: false, motif: 'reseau', detail: essai.erreur };
  }
}

async function parLots(taches, n, surAvancee) {
  const out = new Array(taches.length);
  let i = 0;
  let faites = 0;
  async function travailleur() {
    while (i < taches.length) {
      const mon = i; i += 1;
      out[mon] = await taches[mon]();
      faites += 1;
      surAvancee(faites, taches.length);
    }
  }
  await Promise.all(Array.from({ length: n }, travailleur));
  return out;
}

const tirer = (liste, n) => {
  const copie = liste.slice();
  const out = [];
  while (out.length < n && copie.length) out.push(copie.splice(Math.floor(Math.random() * copie.length), 1)[0]);
  return out;
};

// ------------------------------------------------------------------ interface

function monter() {
  root.textContent = '';
  const s = AMGT4CEM_Auth.session();
  root.append(h('header', { class: 'mt-head' }, h('h1', { text: 'Mesure du poids des tuiles UrbIS' }), h('p', { text: 'Outil provisoire, pour chiffrer un stockage hors ligne.' })));
  if (!s) {
    const b = h('button', { type: 'button', class: 'mt-btn mt-btn--primary', text: 'Se connecter' });
    b.addEventListener('click', demander);
    root.append(h('p', { text: 'Page réservée aux agents identifiés.' }), b);
    return;
  }

  const cfg = AMGT4CEM_Services.tuilesConfig();
  if (!cfg) {
    root.append(h('p', { class: 'mt-erreur', text: 'Aucun service de tuiles configuré (Réglages > Services et relais).' }));
    return;
  }

  const couches = [cfg.layer, ...COUCHES_PROPOSEES].filter((c, i, a) => c && a.indexOf(c) === i);
  const choixCouche = h('select', { class: 'mt-input' }, ...couches.map((c) => h('option', { value: c, text: c === cfg.layer ? `${c} (réglage actuel)` : c })));
  const marge = h('input', { type: 'number', class: 'mt-input', value: '100', min: '20', max: '1000', inputmode: 'numeric' });
  const echantillon = h('input', { type: 'number', class: 'mt-input', value: '20', min: '5', max: '60', inputmode: 'numeric' });
  const cases = ZOOMS.slice().reverse().map((z) => {
    const c = h('input', { type: 'checkbox', checked: '' });
    c.dataset.zoom = String(z);
    return c;
  });
  const lignesZoom = cases.map((c) => h('label', { class: 'mt-case' }, c, h('span', { text: `Zoom ${c.dataset.zoom}` })));

  const statut = h('p', { class: 'mt-statut', role: 'status', hidden: '' });
  const sortie = h('div', { class: 'mt-sortie' });
  const lancer = h('button', { type: 'button', class: 'mt-btn mt-btn--primary', text: 'Lancer la mesure' });
  const copier = h('button', { type: 'button', class: 'mt-btn', text: 'Copier le résultat', hidden: '' });
  let texteResultat = '';

  const dire = (t, erreur) => { statut.textContent = t; statut.hidden = !t; statut.className = `mt-statut${erreur ? ' mt-statut--erreur' : ''}`; };

  lancer.addEventListener('click', async () => {
    const zooms = cases.filter((c) => c.checked).map((c) => Number(c.dataset.zoom));
    const couche = choixCouche.value;
    const m19 = Math.max(20, Number(marge.value) || 100);
    const n = Math.max(5, Math.min(60, Number(echantillon.value) || 20));
    if (!zooms.length) { dire('Cochez au moins un zoom.', true); return; }
    lancer.disabled = true; copier.hidden = true; sortie.textContent = '';
    try {
      dire('Calcul des tuiles autour des stations et tunnels…');
      const { segs, objets } = await chargerSegments();
      const plan = [];
      for (const z of zooms.sort((a, b) => b - a)) {
        const margeZ = m19 * 2 ** (19 - z);
        const liste = tuilesAutour(segs, z, margeZ);
        plan.push({ z, marge: margeZ, liste, tirage: tirer(liste, n) });
      }

      dire('Test de lecture d\'une tuile…');
      const premiere = plan[0].tirage[0];
      const diag = await diagnostiquer(adresseTuile(cfg, couche, plan[0].z, premiere[0], premiere[1]));
      if (!diag.ok) {
        const msg = diag.motif === 'cors'
          ? 'Le service répond mais n\'autorise pas la lecture des tuiles par cette application (CORS absent). Le poids ne peut pas être mesuré ici, et un stockage hors ligne devrait passer par le relais.'
          : `Le service de tuiles ne répond pas depuis cet appareil (${diag.detail}).`;
        dire(msg, true);
        texteResultat = `Mesure des tuiles UrbIS (${AMGT4CEM_BUILD_TIMESTAMP}) — couche ${couche}\n${msg}`;
        copier.hidden = false;
        return;
      }

      const resultats = [];
      for (const p of plan) {
        const taches = p.tirage.map(([x, y]) => () => peser(adresseTuile(cfg, couche, p.z, x, y)));
        const mesures = await parLots(taches, PARALLELE, (f, t) => dire(`Zoom ${p.z} : ${f} / ${t} tuiles pesées…`));
        const ok = mesures.filter((r) => !r.erreur).map((r) => r.octets).sort((a, b) => a - b);
        const erreurs = mesures.length - ok.length;
        const moy = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 0;
        resultats.push({ ...p, ok, erreurs, moy, med: ok.length ? ok[Math.floor(ok.length / 2)] : 0, vides: ok.filter((o) => o < 1500).length });
      }

      const lignes = [];
      let total = 0;
      let totalTuiles = 0;
      for (const r of resultats) {
        const est = r.moy * r.liste.length;
        total += est; totalTuiles += r.liste.length;
        lignes.push(`Zoom ${r.z} (marge ${fmtN(r.marge)} m) : ${fmtN(r.liste.length)} tuiles`
          + (r.ok.length ? ` ; poids moyen ${fmtKo(r.moy)} (médian ${fmtKo(r.med)}, de ${fmtKo(r.ok[0])} à ${fmtKo(r.ok[r.ok.length - 1])}${r.vides ? `, ${r.vides} quasi vide${r.vides > 1 ? 's' : ''}` : ''}) ; estimation ${fmtMo(est)}` : ' ; aucune mesure')
          + (r.erreurs ? ` ; ${r.erreurs} erreur${r.erreurs > 1 ? 's' : ''}` : ''));
      }
      lignes.push(`Total des ${resultats.length} niveaux : ${fmtN(totalTuiles)} tuiles, environ ${fmtMo(total)}`);
      texteResultat = [`Mesure des tuiles UrbIS (build ${AMGT4CEM_BUILD_TIMESTAMP}) — couche ${couche}`,
        `${objets} objets (stations et tunnels), ${n} tuiles pesées par zoom, marge ${fmtN(m19)} m au zoom 19 (doublée à chaque niveau en moins)`, ...lignes].join('\n');

      sortie.append(h('h2', { text: 'Résultat' }), ...lignes.map((l) => h('p', { class: 'mt-ligne', text: l })));
      dire('Mesure terminée.');
      copier.hidden = false;
    } catch (err) {
      dire(`La mesure a échoué : ${err.message}`, true);
    } finally { lancer.disabled = false; }
  });

  copier.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(texteResultat); dire('Résultat copié.'); } catch (err) { dire('Copie impossible : sélectionnez le texte à la main.', true); }
  });

  root.append(
    h('section', { class: 'mt-bloc' },
      h('label', { class: 'mt-champ' }, h('span', { text: 'Couche de tuiles' }), choixCouche),
      h('label', { class: 'mt-champ' }, h('span', { text: 'Marge au zoom 19, en mètres (doublée à chaque niveau en moins)' }), marge),
      h('label', { class: 'mt-champ' }, h('span', { text: 'Tuiles pesées par zoom (au hasard)' }), echantillon),
      h('div', { class: 'mt-champ' }, h('span', { text: 'Zooms' }), h('div', { class: 'mt-cases' }, ...lignesZoom))),
    h('p', { class: 'mt-aide', text: 'Environ 100 tuiles seront téléchargées (quelques Mo).' }),
    h('div', { class: 'mt-actions' }, lancer, copier), statut, sortie,
    h('p', { class: 'mt-pied' }, h('a', { href: 'home.html?page=reglages', text: '‹ Réglages' }), ` · build ${AMGT4CEM_BUILD_TIMESTAMP}`));
}

async function demander() {
  await AMGT4CEM_Auth.ensure({ message: 'Connectez-vous pour utiliser cet outil.' });
  monter();
}

AMGT4CEM_Services.load().then(() => {
  AMGT4CEM_Auth.onChange(monter);
  monter();
  if (!AMGT4CEM_Auth.session()) demander();
  AMGT4CEM_Auth.surveillerExpiration();
});
})();
