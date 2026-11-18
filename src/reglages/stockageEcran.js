/**
 * Réglages > Avancé > Adaptations de plans : cadre « Stockage des données » (droit « plans », comme l'écran qui l'accueille).
 *
 * Lot A de l'écriture du shapefile (18/11/2026) :
 *  - voir d'où l'application lit le shapefile et les attributs (dépôt ou R2) et l'état de R2 (version, nombre d'objets) ;
 *  - charger une fois les données actuelles du dépôt dans R2 (refusé par le serveur si R2 les contient déjà) ;
 *  - télécharger le shapefile courant de R2 (5 fichiers dans un ZIP), pour les dessinateurs ;
 *  - choisir la source de lecture, commune à tous (src/stockage.js, workers/depot/geometries.js).
 */
(function () {
const S = () => window.AMGT4CEM_Stockage;

const h = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  for (const c of kids) if (c) n.append(c);
  return n;
};

/** vAAAAMMJJ_HHMMSS -> JJ/MM/AAAA HH:MM */
function dateVersion(v) {
  const m = /^v(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})\d{2}$/.exec(v || '');
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : (v || '—');
}

function enBase64(octets) {
  let s = '';
  for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
  return btoa(s);
}

async function lireDepot(url, binaire) {
  const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Lecture du dépôt impossible (${url}, HTTP ${r.status}).`);
  return binaire ? new Uint8Array(await r.arrayBuffer()) : r.json();
}

function ligne(texte, valeur) {
  return h('div', { class: 'rgl-row' },
    h('span', { class: 'rgl-row__body' },
      h('span', { class: 'rgl-row__text', text: texte }),
      h('span', { class: 'rgl-row__aide', text: valeur })));
}

function cadre() {
  const bloc = h('section', { class: 'rgl-bloc' });
  const statut = h('p', { class: 'rgl-statut', text: 'Lecture de l\'état du serveur…' });
  const corps = h('div', {});
  bloc.append(h('h2', { class: 'rgl-bloc__titre', text: 'Stockage des données' }), statut, corps);

  const dire = (texte, type) => { statut.className = `rgl-statut${type ? ` rgl-statut--${type}` : ''}`; statut.textContent = texte; };

  async function charger() {
    if (!confirm('Charger dans R2 le shapefile et les attributs actuels du dépôt ?\n\nC\'est une copie : le dépôt n\'est pas modifié, et le serveur refuse si R2 contient déjà ces données.')) return;
    try {
      dire('Lecture du dépôt…');
      const fichiers = {};
      for (const ext of ['shp', 'shx', 'dbf', 'prj', 'cpg']) fichiers[ext] = enBase64(await lireDepot(`./data/shapefile/polygones.${ext}`, true));
      const attributs = {
        'ditp-diov': await lireDepot('./data/ditp-diov/polygones.json'),
        'plans-patrimoine': await lireDepot('./data/plans-patrimoine/polygones.json'),
      };
      const ident = await lireDepot('./data/shapefile/identifiants.json');
      dire('Envoi vers R2…');
      await AMGT4CEM_Auth.call('/geometries/charger', { method: 'POST', body: { couche: 'polygones', fichiers, attributs, prochainId: ident.prochain_id } });
      await monter();
      dire('Données chargées dans R2. La source de lecture reste inchangée tant que vous ne la changez pas ci-dessous.', 'ok');
    } catch (err) { dire(err.message, 'erreur'); }
  }

  async function telecharger(etat) {
    try {
      dire('Téléchargement depuis R2…');
      const s = AMGT4CEM_Auth.session();
      const entrees = [];
      for (const ext of ['shp', 'shx', 'dbf', 'prj', 'cpg']) {
        const r = await fetch(`${AMGT4CEM_Auth.serverUrl}/geometries/shapefile/polygones/${ext}`, { cache: 'no-store', headers: { Authorization: `Bearer ${s.jeton}` } });
        if (r.status === 404 && ext === 'cpg') continue; // .cpg facultatif
        if (!r.ok) throw new Error(`Téléchargement impossible (.${ext}, HTTP ${r.status}).`);
        entrees.push({ name: `polygones.${ext}`, data: new Uint8Array(await r.arrayBuffer()) });
      }
      const blob = AMGT4CEM_Signalements.Zip.build(entrees);
      const a = h('a', { href: URL.createObjectURL(blob), download: `polygones_${etat.couches.polygones.version}.zip` });
      document.body.append(a); a.click(); a.remove();
      dire(`Shapefile ${dateVersion(etat.couches.polygones.version)} téléchargé (5 fichiers dans un ZIP).`, 'ok');
    } catch (err) { dire(err.message, 'erreur'); }
  }

  async function monter() {
    corps.textContent = '';
    const etat = await S().actualiser();
    if (!etat) { dire('Le serveur de dépôt ne répond pas (connexion requise, réseau ou serveur).', 'erreur'); return; }
    dire(`Source de lecture actuelle : ${etat.source === 'r2' ? 'R2' : 'dépôt'}.`);
    const p = etat.couches.polygones;
    corps.append(
      ligne('Shapefile dans R2', p ? `Version du ${dateVersion(p.version)} · ${p.objets} objets` : 'Pas encore chargé.'),
      ligne('Attributs (stations, tunnels, dépôts, ouvrages)', etat.attributs['ditp-diov'] ? `${etat.attributs['ditp-diov'].entrees} entrées` : 'Pas encore chargés.'),
      ligne('Attributs (planches)', etat.attributs['plans-patrimoine'] ? `${etat.attributs['plans-patrimoine'].entrees} entrées` : 'Pas encore chargés.'),
      ligne('Prochain identifiant P…', etat.prochainP ? String(etat.prochainP) : '—'));
    const boutons = h('div', { class: 'rgl-actions' });
    if (!p || !etat.attributs['ditp-diov'] || !etat.attributs['plans-patrimoine']) {
      const b = h('button', { type: 'button', class: 'rgl-btn rgl-btn--primary', text: 'Charger les données initiales dans R2' });
      b.addEventListener('click', charger);
      boutons.append(b);
    }
    if (p) {
      const b = h('button', { type: 'button', class: 'rgl-btn', text: 'Télécharger le shapefile' });
      b.addEventListener('click', () => telecharger(etat));
      boutons.append(b);
    }
    corps.append(boutons);

    // Interrupteur de source, commun à tous les agents connectés.
    const choix = h('select', { class: 'rgl-input', 'aria-label': 'Source de lecture des données' },
      h('option', { value: 'depot', text: 'Dépôt (fichiers publiés avec le site)' }),
      h('option', { value: 'r2', text: 'R2 (serveur de dépôt)' }));
    choix.value = etat.source;
    const appliquer = h('button', { type: 'button', class: 'rgl-btn', text: 'Appliquer la source' });
    appliquer.addEventListener('click', async () => {
      if (choix.value === etat.source) { dire('La source est déjà celle-ci.'); return; }
      if (choix.value === 'r2' && !confirm('Passer la lecture sur R2 pour tous les agents connectés ?\n\nTant que l\'enregistrement vers R2 n\'est pas disponible (lots B et C), les modifications d\'attributs seront refusées. Vous pouvez revenir au dépôt à tout moment.')) return;
      try {
        await S().changerSource(choix.value);
        await monter();
        dire(`Source de lecture : ${choix.value === 'r2' ? 'R2' : 'dépôt'}. Rechargez les pages ouvertes pour en tenir compte.`, 'ok');
      } catch (err) { dire(err.message, 'erreur'); }
    });
    corps.append(
      h('div', { class: 'rgl-row' },
        h('span', { class: 'rgl-row__body' },
          h('span', { class: 'rgl-row__text', text: 'Source de lecture' }),
          h('span', { class: 'rgl-row__aide', text: 'Commune à tous les agents connectés. Par défaut : dépôt, comme avant. Un agent non connecté lit toujours le dépôt.' }),
          choix, appliquer)));
  }

  monter();
  return bloc;
}

window.AMGT4CEM_StockageEcran = { cadre };
})();
