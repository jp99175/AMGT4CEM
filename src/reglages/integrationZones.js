/**
 * Réglages > Avancé > Adaptations de plans > « Intégrer au shapefile » (droit « plans »).
 *
 * Deux tables aux mêmes colonnes (case, Id, Genre, Nom, État), un filtre commun au-dessus :
 *  - en haut : les zones dessinées avec l'outil « Dessiner une zone » (data/lieux/lieux.json) ;
 *  - en bas : les objets du shapefile (data/ditp-diov/polygones.json). Les planches n'y figurent pas : ce sont des
 *    limites de plan, pas des ouvrages.
 * Entre les deux : Annuler (défait le dernier déplacement), ↓ (zones cochées vers le shapefile), ↑ (objets cochés
 * retirés du shapefile, vers les zones), Appliquer.
 *
 * Identifiants (décisions du 16/11/2026) :
 *  - une zone dessinée n'a pas d'identifiant ; elle reçoit un P… neuf à l'écriture dans le shapefile ;
 *  - un objet retiré du shapefile GARDE son P… (champ `id_shapefile` de la zone) et le retrouve à son retour.
 *
 * Fenêtre d'attributs (droit « attributs ») : toucher le nom d'une ligne ; enregistrement direct à la disquette (zone :
 * data/lieux/lieux.json, `nom` = nom FR, plus `name_nl` et `references` ; objet : data/ditp-diov/polygones.json).
 *
 * Étape 1 : écran et déplacements en attente seulement. « Appliquer » montre le récapitulatif ; l'écriture réelle
 * (d'abord sur la couche d'essai de R2) est la prochaine étape. Rien n'est enregistré.
 */
(function () {
const ZONES_URL = './data/lieux/lieux.json';
const SHP_URL = './data/ditp-diov/polygones.json';
const VOCAB_URL = './config/ditp-diov/vocabulaires.json';

const h = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  for (const c of kids) if (c) n.append(c);
  return n;
};

/* ---------- Logique pure (testable sans navigateur) ---------- */

const aContour = (z) => Array.isArray(z.contour) && z.contour.some((anneau) => Array.isArray(anneau) && anneau.length >= 4);

/** Lignes des deux tables. `cote` : 'haut' (zones) ou 'bas' (shapefile) ; `origine` : côté de départ. */
function construireLignes(zones, shp, genres, idsShapefile) {
  const lignes = [];
  for (const [code, z] of Object.entries(zones || {})) {
    let blocage = '';
    if (!aContour(z)) blocage = 'sans contour';
    else if (!genres.includes(z.genre)) blocage = 'genre manquant';
    lignes.push({ cle: `Z:${code}`, origine: 'haut', cote: 'haut', id: z.id_shapefile || '', genre: z.genre || '', nom: z.nom || code, blocage });
  }
  for (const [id, e] of Object.entries(shp || {})) {
    if (e.genre === 'planche') continue;
    // Entrée d'attributs sans contour dans le vrai shapefile (idsShapefile = identifiants du .dbf ; null si illisible) : ligne grisée.
    const orphelin = !!idsShapefile && !idsShapefile.has(id);
    lignes.push({ cle: `S:${id}`, origine: 'bas', cote: 'bas', id, genre: e.genre || '', nom: e.name_fr || e.name_nl || '', blocage: orphelin ? 'sans contour' : '', orphelin });
  }
  return lignes;
}

/** État affiché d'une ligne. */
function etat(l) {
  if (l.cote === 'haut') return l.origine === 'bas' ? 'retrait en attente' : (l.blocage || (l.refus ? 'refusé' : 'à intégrer'));
  if (l.orphelin) return 'sans contour';
  return l.origine === 'haut' ? 'à intégrer' : 'au shapefile';
}
const enAttente = (l) => l.cote !== l.origine;

/** Déplace les lignes cochées d'un côté vers l'autre ; renvoie le groupe d'historique (clés déplacées). */
function deplacer(lignes, cles, vers) {
  const groupe = [];
  for (const l of lignes) {
    if (!cles.has(l.cle) || l.cote === vers) continue;
    if (l.blocage) continue; // zone incomplète (ne peut pas entrer) ou entrée sans contour (ne peut pas sortir)
    l.cote = vers;
    groupe.push(l.cle);
  }
  return groupe;
}

function annuler(lignes, groupe) {
  const par = new Map(lignes.map((l) => [l.cle, l]));
  for (const c of groupe) { const l = par.get(c); l.cote = l.cote === 'haut' ? 'bas' : 'haut'; }
}

/** Récapitulatif des déplacements en attente. */
function recap(lignes) {
  const ajouts = lignes.filter((l) => l.origine === 'haut' && l.cote === 'bas');
  const retraits = lignes.filter((l) => l.origine === 'bas' && l.cote === 'haut');
  return { ajouts, retraits };
}

/* ---------- Écran ---------- */

/** Identifiants (champ « id ») du .dbf du vrai shapefile, lu avec la source en cours ; null si illisible. */
async function lireIdsShapefile() {
  try {
    const url = './data/shapefile/polygones.dbf';
    const r = window.AMGT4CEM_Stockage ? await AMGT4CEM_Stockage.fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' }) : await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const d = new Uint8Array(await r.arrayBuffer());
    const v = new DataView(d.buffer);
    const n = v.getUint32(4, true); const lenEntete = v.getUint16(8, true); const lenEnreg = v.getUint16(10, true);
    let debut = 1; let longueur = 0;
    for (let i = 32; i < lenEntete - 1 && d[i] !== 0x0d; i += 32) {
      const nom = new TextDecoder().decode(d.subarray(i, i + 11)).replace(/\0.*$/, '').toLowerCase();
      if (nom === 'id') { longueur = d[i + 16]; break; }
      debut += d[i + 16];
    }
    if (!longueur) return null;
    const ids = new Set();
    for (let k = 0; k < n; k++) ids.add(new TextDecoder().decode(d.subarray(lenEntete + k * lenEnreg + debut, lenEntete + k * lenEnreg + debut + longueur)).replace(/\0/g, '').trim());
    return ids;
  } catch (err) { return null; }
}

async function lireJson(url) {
  // Source des données (dépôt ou R2) : src/stockage.js. Sans ce module : le dépôt, comme avant.
  if (window.AMGT4CEM_Stockage) return AMGT4CEM_Stockage.lireJson(url);
  const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Lecture impossible (${url}, HTTP ${r.status}).`);
  return r.json();
}

const ETATS_FILTRE = [
  { v: '', t: 'Tous états' },
  { v: 'integrer', t: 'À intégrer' },
  { v: 'bloque', t: 'Incomplètes' },
  { v: 'attente', t: 'En attente' },
  { v: 'shapefile', t: 'Au shapefile' },
];

/**
 * Monte l'écran dans `conteneur`. `opts.retour()` : revenir à Adaptations de plans.
 * Renvoie { modifs() } pour la confirmation avant de quitter.
 */
async function monter(conteneur, opts = {}) {
  const etatEcran = { modifs: () => false };
  conteneur.textContent = '';
  const retour = h('button', { type: 'button', class: 'rgl-retour', text: '‹ Adaptations de plans' });
  retour.addEventListener('click', () => {
    if (etatEcran.modifs() && !window.confirm('Quitter cet écran ? Les déplacements non appliqués seront perdus.')) return;
    if (opts.retour) opts.retour();
  });
  conteneur.append(retour, h('h2', { class: 'rgl-ecran__titre rgl-iz__titre', text: 'Intégrer au shapefile' }), h('p', { class: 'rgl-note', text: 'Chargement…' }));

  let zones, shp, vocab, idsShp;
  try {
    [zones, shp, vocab, idsShp] = await Promise.all([lireJson(ZONES_URL), lireJson(SHP_URL), lireJson(VOCAB_URL), lireIdsShapefile()]);
  } catch (err) { conteneur.lastChild.remove(); conteneur.append(h('p', { class: 'rgl-statut rgl-statut--erreur', text: err.message })); return etatEcran; }
  conteneur.lastChild.remove();

  const genres = Object.keys(vocab.genres || {});
  const libelle = (g) => (vocab.genres[g] && vocab.genres[g].libelle) || g;
  const lignes = construireLignes(zones.lieux, shp.entites, genres, idsShp);
  // Identifiants gardés par les zones (objets retirés par ↑) : jamais proposés au nettoyage.
  const idsZones = new Set(Object.values(zones.lieux || {}).map((z) => z.id_shapefile).filter(Boolean));
  const historique = [];
  const coches = new Set();
  let recherche = ''; let filtreGenre = ''; let filtreEtat = '';

  const statut = h('p', { class: 'rgl-statut', role: 'status', hidden: '' });
  const dire = (texte, genre) => { statut.textContent = texte; statut.hidden = !texte; statut.className = `rgl-statut${genre ? ` rgl-statut--${genre}` : ''}`; };

  /* Filtre */
  const champ = h('input', { type: 'search', class: 'rgl-input rgl-iz__champ', placeholder: 'Filtrer (id, nom)…', autocomplete: 'off' });
  const selGenre = h('select', { class: 'rgl-input rgl-iz__sel' }, h('option', { value: '', text: 'Tous genres' }), ...genres.map((g) => h('option', { value: g, text: libelle(g) })));
  const selEtat = h('select', { class: 'rgl-input rgl-iz__sel' }, ...ETATS_FILTRE.map((e) => h('option', { value: e.v, text: e.t })));
  champ.addEventListener('input', () => { recherche = champ.value; rendre(); });
  selGenre.addEventListener('change', () => { filtreGenre = selGenre.value; rendre(); });
  selEtat.addEventListener('change', () => { filtreEtat = selEtat.value; rendre(); });

  const passe = (l) => {
    if (filtreGenre && l.genre !== filtreGenre) return false;
    if (filtreEtat === 'integrer' && !(l.cote === 'haut' && l.origine === 'haut' && !l.blocage)) return false;
    if (filtreEtat === 'bloque' && !l.blocage && !l.refus) return false;
    if (filtreEtat === 'attente' && !enAttente(l)) return false;
    if (filtreEtat === 'shapefile' && !(l.cote === 'bas' && l.origine === 'bas' && !l.orphelin)) return false;
    const q = recherche.trim().toLowerCase();
    return !q || `${l.id} ${l.nom} ${libelle(l.genre)}`.toLowerCase().includes(q);
  };
  const tri = (a, b) => (enAttente(b) - enAttente(a)) || a.nom.localeCompare(b.nom, 'fr') || a.id.localeCompare(b.id);
  const visibles = (cote) => lignes.filter((l) => l.cote === cote && passe(l)).sort(tri);
  const cochable = (l) => !l.blocage;

  /* Tables */
  const table = (cote) => {
    const tout = h('input', { type: 'checkbox', class: 'rgl-iz__case', 'aria-label': 'Tout cocher' });
    const tbody = h('tbody');
    const titre = h('p', { class: 'rgl-iz__legende' });
    const t = h('table', { class: 'rgl-tableau rgl-iz__table' },
      h('colgroup', null, h('col', { class: 'rgl-iz__c-case' }), h('col', { class: 'rgl-iz__c-id' }), h('col', { class: 'rgl-iz__c-genre' }), h('col'), h('col', { class: 'rgl-iz__c-etat' })),
      h('thead', null, h('tr', null, h('th', null, tout), h('th', { text: 'Id' }), h('th', { text: 'Genre' }), h('th', { text: 'Nom' }), h('th', { text: 'État' }))),
      tbody);
    tout.addEventListener('change', () => {
      for (const l of visibles(cote)) if (cochable(l)) { if (tout.checked) coches.add(l.cle); else coches.delete(l.cle); }
      rendre();
    });
    const remplir = () => {
      const vis = visibles(cote);
      tbody.textContent = '';
      for (const l of vis) {
        const c = h('input', { type: 'checkbox', class: 'rgl-iz__case', 'aria-label': `Cocher ${l.nom}` });
        c.checked = coches.has(l.cle);
        if (!cochable(l)) { c.disabled = true; c.title = l.orphelin ? 'Entrée sans contour dans le shapefile : à supprimer avec « Nettoyer les entrées sans contour ».' : `Zone incomplète (${l.blocage}) : à compléter avec l'outil « Dessiner une zone ».`; }
        c.addEventListener('change', () => { if (c.checked) coches.add(l.cle); else coches.delete(l.cle); majBoutons(); });
        const id = l.id ? h('span', { text: l.id }) : (l.cote === 'bas' ? h('i', { text: 'à l\'écriture' }) : h('span', { class: 'rgl-iz__vide', text: '—' }));
        const genre = l.genre ? h('span', { text: libelle(l.genre) }) : h('i', { text: 'vide' });
        const tr = h('tr', { class: [enAttente(l) ? (l.cote === 'bas' ? 'rgl-iz--ajout' : 'rgl-iz--retrait') : '', l.blocage ? 'rgl-iz--bloque' : ''].join(' ').trim() },
          h('td', null, c), h('td', null, id), h('td', null, genre), h('td', null, celluleNom(l)), h('td', { text: etat(l) }));
        tbody.append(tr);
      }
      if (!vis.length) tbody.append(h('tr', null, h('td', { colspan: '5', class: 'rgl-iz__vide', text: 'Aucune ligne.' })));
      const total = lignes.filter((l) => l.cote === cote).length;
      titre.textContent = `${cote === 'haut' ? 'Zones dessinées' : 'Objets du shapefile (planches non comprises)'} : ${vis.length} affichée(s) sur ${total}`;
      const cochables = vis.filter(cochable);
      tout.checked = cochables.length > 0 && cochables.every((l) => coches.has(l.cle));
    };
    return { el: h('div', null, titre, h('div', { class: 'rgl-tableau-cadre rgl-iz__cadre' }, t)), remplir };
  };
  /* ---- Fenêtre d'attributs (droit « attributs ») : zones dessinées et objets du shapefile ---- */
  const peutEditer = typeof AMGT4CEM_Auth !== 'undefined' && AMGT4CEM_Auth.aDroit('attributs', AMGT4CEM_Auth.session());
  const LOG = window.AMGT4CEM_AttributsLogique;
  const sepRefs = (t) => String(t || '').split(';').map((x) => x.trim()).filter(Boolean);
  /** Champs actuels d'une ligne, lus dans sa source (zone : `nom` = nom FR). */
  const champsLigne = (l) => {
    if (l.cle.startsWith('Z:')) {
      const z = zones.lieux[l.cle.slice(2)] || {};
      return { genre: genres.includes(z.genre) ? z.genre : '', name_fr: z.nom || '', name_nl: z.name_nl || '', references: Array.isArray(z.references) ? z.references.map(String) : [] };
    }
    const e = shp.entites[l.cle.slice(2)] || {};
    return { genre: e.genre || '', name_fr: e.name_fr || '', name_nl: e.name_nl || '', references: Array.isArray(e.references) ? e.references.map(String) : [] };
  };
  const sig = (c) => JSON.stringify([c.genre, c.name_fr, c.name_nl, c.references]);
  const sigZone = (z) => JSON.stringify([z.genre || '', z.nom || '', z.name_nl || '', Array.isArray(z.references) ? z.references.map(String) : []]);
  const sigShp = (e) => JSON.stringify([e.genre || '', e.name_fr || '', e.name_nl || '', Array.isArray(e.references) ? e.references.map(String) : []]);

  function celluleNom(l) {
    let nom;
    if (!peutEditer) nom = h('span', { text: l.nom });
    else {
      nom = h('button', { type: 'button', class: 'rgl-iz__nom', title: 'Modifier les attributs' });
      nom.textContent = l.nom || '(sans nom)';
      nom.addEventListener('click', () => ouvrirFenetre(l));
    }
    if (!l.refus || l.cote !== 'haut') return nom;
    return h('div', null, nom, h('p', { class: 'rgl-iz__refus', text: `Refusée : ${l.refus}` }));
  }

  function ouvrirFenetre(l) {
    const estZone = l.cle.startsWith('Z:');
    const depart = champsLigne(l);
    const sigServeurDepart = estZone ? sigZone(zones.lieux[l.cle.slice(2)] || {}) : sigShp(shp.entites[l.cle.slice(2)] || {});
    const ic = (nom, texte) => { const b = h('button', { type: 'button', class: 'rgl-ic rgl-iz__btn', title: texte, 'aria-label': texte }); b.innerHTML = AMGT4CEM_Icones.svg(nom); return b; };
    const fermer = ic('fermer', 'Fermer');
    const retourBtn = ic('annuler', 'Revenir aux valeurs d\'origine');
    const sauver = ic('disquette', 'Enregistrer');
    const selG = h('select', { class: 'rgl-input' }, h('option', { value: '', text: '— choisir —' }), ...genres.map((g) => h('option', { value: g, text: libelle(g) })));
    const fr = h('input', { type: 'text', class: 'rgl-input', autocomplete: 'off' });
    const nl = h('input', { type: 'text', class: 'rgl-input', autocomplete: 'off' });
    const refs = h('input', { type: 'text', class: 'rgl-input', autocomplete: 'off' });
    const msg = h('p', { class: 'rgl-iz__msg', role: 'status' });
    const remplirChamps = (c) => { selG.value = c.genre; fr.value = c.name_fr; nl.value = c.name_nl; refs.value = c.references.join('; '); croise(); };
    const croise = () => { nl.placeholder = fr.value.trim(); fr.placeholder = estZone ? '' : nl.value.trim(); }; // autre langue en italique, jamais enregistrée
    fr.addEventListener('input', croise); nl.addEventListener('input', croise);
    const lus = () => ({ genre: selG.value, name_fr: fr.value.trim(), name_nl: nl.value.trim(), references: sepRefs(refs.value) });
    const modifie = () => sig(lus()) !== sig(depart);
    const champ = (titre, el) => h('label', { class: 'rgl-iz__champ-f' }, h('span', { text: titre }), el);
    const fenetre = h('div', { class: 'rgl-iz__fenetre', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Attributs' },
      h('div', { class: 'rgl-iz__f-tete' }, h('strong', { text: estZone ? 'Attributs de la zone' : 'Attributs de l\'objet' }), fermer),
      h('p', { class: 'rgl-iz__f-sous', text: `${l.nom || ''} · Id : ${l.id || (estZone ? '— (attribué à l\'écriture)' : '')}` }),
      champ('Genre', selG), champ('Nom (FR)', fr), champ('Nom (NL)', nl), champ('Références (séparées par « ; »)', refs),
      msg,
      h('div', { class: 'rgl-iz__f-pied' }, retourBtn, h('span', { class: 'rgl-iz__f-aide', text: estZone ? 'Genre et nom FR obligatoires.' : 'Genre et un nom obligatoires.' }), sauver));
    const voile = h('div', { class: 'rgl-iz__voile' }, fenetre);
    const quitter = () => { if (modifie() && !window.confirm('Fermer sans enregistrer ?')) return; voile.remove(); };
    fermer.addEventListener('click', quitter);
    voile.addEventListener('click', (ev) => { if (ev.target === voile) quitter(); });
    retourBtn.addEventListener('click', () => { remplirChamps(depart); msg.textContent = ''; });
    sauver.addEventListener('click', async () => {
      const c = lus();
      msg.className = 'rgl-iz__msg rgl-statut--erreur';
      if (!genres.includes(c.genre)) { msg.textContent = 'Choisir un genre.'; return; }
      if (estZone ? !c.name_fr : !(c.name_fr || c.name_nl)) { msg.textContent = estZone ? 'Le nom FR est obligatoire.' : 'Indiquer au moins un nom.'; return; }
      if (!modifie()) { msg.textContent = 'Aucune modification.'; return; }
      const A = window.AMGT4CEM_PeLabelAnchors;
      const relais = (window.AMGT4CEM_Services && AMGT4CEM_Services.current().relayUrl) || AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl;
      // Objet du shapefile avec la source R2 (lot B) : enregistrement par le serveur de dépôt, sans relais. Une zone dessinée passe encore par le relais.
      const r2 = !estZone && !!window.AMGT4CEM_Stockage && AMGT4CEM_Stockage.source() === 'r2';
      // Zone dessinée avec la source R2 et les zones chargées dans R2 : enregistrement par le serveur de dépôt (droit « plans »), sans relais.
      const zr2 = estZone && !!window.AMGT4CEM_Stockage && AMGT4CEM_Stockage.lieuxDansR2();
      if (!r2 && !zr2 && (!A || !relais)) { msg.textContent = 'Relais non configuré (Réglages > Avancé > Services et relais).'; return; }
      sauver.disabled = true; msg.className = 'rgl-iz__msg'; msg.textContent = 'Vérification sur le serveur…';
      try {
        const cle = l.cle.slice(2);
        if (estZone) {
          let etagZones = null; let frais;
          if (zr2) { const lu = await AMGT4CEM_Stockage.lireLieux(); frais = lu.data; etagZones = lu.etag; if (!etagZones) throw new Error('Les zones n\'ont pas pu être lues dans R2 : rouvrez l\'écran.'); } else frais = await lireJson(ZONES_URL);
          const z = frais.lieux && frais.lieux[cle];
          if (!z) throw new Error('Cette zone n\'existe plus sur le serveur. Rouvrez l\'écran.');
          if (sigZone(z) !== sigServeurDepart) throw new Error('Cette zone a été modifiée par quelqu\'un d\'autre depuis l\'ouverture. Rien n\'a été enregistré ; rouvrez l\'écran.');
          z.genre = c.genre; z.nom = c.name_fr;
          if (c.name_nl) z.name_nl = c.name_nl; else delete z.name_nl;
          if (c.references.length) z.references = c.references; else delete z.references;
          msg.textContent = 'Enregistrement…';
          if (zr2) await AMGT4CEM_Stockage.ecrireLieux(frais.lieux, etagZones);
          else await A.putToRelay(relais, 'shared/lieux/lieux', frais, (A.getAdminCode && A.getAdminCode()) || '');
          zones.lieux = frais.lieux;
        } else {
          const frais = await lireJson(SHP_URL);
          const e = frais.entites && frais.entites[cle];
          if (!e) throw new Error('Cet objet n\'existe plus sur le serveur. Rouvrez l\'écran.');
          if (sigShp(e) !== sigServeurDepart) throw new Error('Cet objet a été modifié par quelqu\'un d\'autre depuis l\'ouverture. Rien n\'a été enregistré ; rouvrez l\'écran.');
          // Source R2 (lot B) : `avant` est pris avant d'écrire les nouvelles valeurs dans la copie lue.
          const chg = r2 && LOG ? LOG.changement(cle, e, { ...c, sheet_ref: '' }) : null;
          if (r2 && !chg) throw new Error('Enregistrement vers R2 impossible : module des attributs absent.');
          if (LOG) LOG.ecrireChamps(e, { ...c, sheet_ref: '' });
          else { e.genre = c.genre; e.name_fr = c.name_fr; e.name_nl = c.name_nl; if (c.references.length) e.references = c.references; else delete e.references; }
          msg.textContent = 'Enregistrement…';
          if (r2) await AMGT4CEM_Stockage.ecrireAttributs('ditp-diov', [chg]);
          else await A.putToRelay(relais, 'shared/ditp-diov/polygones', frais, (A.getAdminCode && A.getAdminCode()) || '');
          shp.entites = frais.entites;
        }
        // Mise à jour de la ligne (le déplacement en attente éventuel est conservé).
        l.genre = c.genre; l.nom = estZone ? c.name_fr : (c.name_fr || c.name_nl);
        l.refus = '';
        if (estZone) {
          const z = zones.lieux[cle];
          l.blocage = !aContour(z) ? 'sans contour' : (genres.includes(z.genre) ? '' : 'genre manquant');
          if (l.blocage && l.cote === 'bas') l.cote = 'haut';
        }
        voile.remove();
        rendre();
        dire((r2 || zr2)
          ? `Attributs de « ${l.nom} » enregistrés dans R2 : visibles tout de suite ; les autres agents les verront en rechargeant la page.`
          : `Attributs de « ${l.nom} » enregistrés. Visibles par tous après le redéploiement du site (environ 1 minute).`, 'ok');
      } catch (err) {
        msg.className = 'rgl-iz__msg rgl-statut--erreur'; msg.textContent = err.message; sauver.disabled = false;
      }
    });
    remplirChamps(depart);
    document.body.append(voile);
    selG.focus();
  }

  // Bouton d'icône occupé : grisé et inactif le temps du contrôle (le libellé est une icône : on n'y touche pas).
  function occupe(b) { b.disabled = true; b.style.opacity = '0.6'; return () => { b.style.opacity = ''; majBoutons(); }; }

  const haut = table('haut');
  const bas = table('bas');

  /* Séparateur à 4 boutons */
  const bouton = (icone, texte) => { const b = h('button', { type: 'button', class: 'rgl-ic rgl-iz__btn', title: texte, 'aria-label': texte }); b.innerHTML = AMGT4CEM_Icones.svg(icone); return b; };
  const bAnnuler = bouton('annuler', 'Annuler le dernier déplacement');
  const bBas = bouton('flecheBas', 'Vers le shapefile (zones cochées)');
  const bHaut = bouton('flecheHaut', 'Retirer du shapefile (objets cochés)');
  const bAppliquer = bouton('disquette', 'Appliquer');
  const resume = h('span', { class: 'rgl-compteur' });

  const cochees = (cote) => lignes.filter((l) => l.cote === cote && coches.has(l.cle) && passe(l));
  function majBoutons() {
    bAnnuler.disabled = !historique.length;
    bBas.disabled = !cochees('haut').some((l) => !l.blocage);
    bHaut.disabled = !cochees('bas').length;
    const r = recap(lignes);
    bAppliquer.disabled = !(r.ajouts.length + r.retraits.length);
    const refusees = lignes.filter((l) => l.cote === 'haut' && l.refus).length;
    resume.textContent = `${r.ajouts.length} ajout(s), ${r.retraits.length} retrait(s) en attente${refusees ? `, ${refusees} refusée(s)` : ''}`;
  }
  function rendre() { haut.remplir(); bas.remplir(); majBoutons(); }

  /** ↓ : si la source R2 est active, chaque zone cochée est d'abord contrôlée par le serveur (rien n'est écrit) ; les refusées restent en haut avec leur raison. */
  const controleDispo = () => !!window.AMGT4CEM_Stockage && AMGT4CEM_Stockage.source() === 'r2' && typeof AMGT4CEM_Auth !== 'undefined' && AMGT4CEM_Auth.aDroit('plans', AMGT4CEM_Auth.session());
  const bouger = async (de, vers) => {
    let cles = new Set(cochees(de).map((l) => l.cle));
    if (de === 'haut' && controleDispo()) {
      const aControler = lignes.filter((l) => cles.has(l.cle) && !l.blocage);
      if (!aControler.length) return;
      const fin = occupe(bBas);
      dire('Contrôle sur le serveur…');
      let res;
      try { res = await AMGT4CEM_Stockage.controler(COUCHE_CIBLE, { ajouts: aControler.map((l) => l.cle.slice(2)), retraits: recap(lignes).retraits.map((l) => l.id) }); } catch (err) { dire(err.message, 'erreur'); fin(); return; }
      fin();
      const par = new Map(res.map((x) => [`Z:${x.cle}`, x]));
      cles = new Set();
      for (const l of aControler) {
        const x = par.get(l.cle);
        if (x && x.ok) { l.refus = ''; cles.add(l.cle); } else { l.refus = (x && x.raison) || 'contrôle impossible'; coches.delete(l.cle); }
      }
      const nbRefus = aControler.length - cles.size;
      const groupe = deplacer(lignes, cles, vers);
      for (const c of cles) coches.delete(c);
      if (groupe.length) historique.push(groupe);
      dire(nbRefus ? `${nbRefus} zone(s) refusée(s) sur ${aControler.length}. Les raisons sont écrites en rouge.${groupe.length ? ` ${groupe.length} zone(s) en attente d'écriture.` : ''}` : '', nbRefus ? 'erreur' : '');
      rendre();
      return;
    }
    const groupe = deplacer(lignes, cles, vers);
    for (const c of cles) coches.delete(c);
    if (groupe.length) { historique.push(groupe); dire(''); }
    rendre();
  };
  bBas.addEventListener('click', () => bouger('haut', 'bas'));
  bHaut.addEventListener('click', () => bouger('bas', 'haut'));
  bAnnuler.addEventListener('click', () => {
    const g = historique.pop();
    if (!g) return;
    annuler(lignes, g);
    dire(`Annulé (${g.length} ligne(s)).`);
    rendre();
  });
  /* ---- Appliquer : contrôle sur le serveur, confirmation, écriture (lot C, partie 2) ----
   * Cible : la couche d'essai. Le vrai shapefile (« polygones ») ne sera offert qu'après le feu vert explicite de Jph ; le serveur
   * l'accepte déjà (zones et attributs mis à jour), l'écran n'y mène pas encore. Sur l'essai, ni les zones ni les attributs ne bougent. */
  const COUCHE_CIBLE = 'essai';
  const LIBELLE_CIBLE = { essai: 'Essai (fichier de test)', polygones: 'Shapefile réel' };
  const zoneAppliquer = h('div', {});
  const dateVersion = (v) => { const m = /^v(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/.exec(v || ''); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : (v || ''); };
  const plage = (a, b) => (a ? (a === b ? a : `${a} à ${b}`) : 'aucun');
  bAppliquer.addEventListener('click', async () => {
    const r = recap(lignes);
    zoneAppliquer.textContent = '';
    const pret = !!window.AMGT4CEM_Stockage && AMGT4CEM_Stockage.source() === 'r2' && typeof AMGT4CEM_Auth !== 'undefined' && AMGT4CEM_Auth.aDroit('plans', AMGT4CEM_Auth.session());
    if (!pret) { dire('« Appliquer » demande la source R2 (Réglages > Stockage des données), le chargement des zones dans R2 et le droit « plans ».', 'erreur'); return; }
    const corps = { ajouts: r.ajouts.map((l) => l.cle.slice(2)), retraits: r.retraits.map((l) => l.id) };
    const lance = occupe(bAppliquer);
    let ap;
    try { dire('Contrôle sur le serveur…'); ap = (await AMGT4CEM_Stockage.appliquer(COUCHE_CIBLE, { ...corps, apercu: true })).resume; dire(''); } catch (err) { dire(err.message, 'erreur'); lance(); return; }
    lance();
    const info = (texte) => h('p', { class: 'rgl-note', text: texte });
    const annulerB = h('button', { type: 'button', class: 'rgl-btn', text: 'Annuler' });
    const ecrireB = h('button', { type: 'button', class: 'rgl-btn rgl-btn--primary', text: `Enregistrer sur ${COUCHE_CIBLE === 'essai' ? 'l\'essai' : 'le shapefile'}` });
    annulerB.addEventListener('click', () => { zoneAppliquer.textContent = ''; });
    ecrireB.addEventListener('click', async () => {
      if (ecrireB.disabled) return;
      const avant = ecrireB.textContent; ecrireB.disabled = true; annulerB.disabled = true; ecrireB.textContent = 'Enregistrement…'; ecrireB.style.opacity = '0.6';
      try {
        const out = await AMGT4CEM_Stockage.appliquer(COUCHE_CIBLE, corps);
        zoneAppliquer.textContent = '';
        const num = out.attribues.length ? ` Numéros attribués : ${plage(out.attribues[0], out.attribues[out.attribues.length - 1])}.` : '';
        const suite = COUCHE_CIBLE === 'essai' ? ' Les zones et les attributs réels n\'ont pas été modifiés : vos déplacements restent en attente à l\'écran.' : ' Les zones et les attributs sont à jour : l\'écran se recharge.';
        dire(`Version du ${dateVersion(out.version)} enregistrée sur ${LIBELLE_CIBLE[COUCHE_CIBLE]} : ${out.objets} objets.${num}${out.avertissement ? ` ${out.avertissement}` : ''}${suite}`, out.avertissement ? 'erreur' : 'ok');
        if (COUCHE_CIBLE !== 'essai' && opts.recharger) opts.recharger();
      } catch (err) { ecrireB.disabled = false; annulerB.disabled = false; ecrireB.textContent = avant; ecrireB.style.opacity = ''; dire(err.message, 'erreur'); }
    });
    zoneAppliquer.append(
      h('p', { class: 'rgl-iz__legende', text: `Appliquer sur : ${LIBELLE_CIBLE[COUCHE_CIBLE]}` }),
      info(`Zones ajoutées : ${ap.ajouts.length}${ap.ajouts.length ? ` (${ap.ajouts.map((x) => x.nom).join(', ')})` : ''}`),
      info(`Objets retirés : ${ap.retraits.length}${ap.retraits.length ? ` (${ap.retraits.join(', ')})` : ''}`),
      info(`Numéros attribués : ${plage(ap.premierId, ap.dernierId)}${ap.ajouts.some((x) => x.id) ? ' (les zones qui gardent un identifiant le conservent)' : ''}`),
      info(`Objets dans le fichier après : ${ap.objetsApres}`),
      info(COUCHE_CIBLE === 'essai' ? 'Sur l\'essai, les vraies zones et les vrais attributs ne sont pas modifiés.' : 'Les zones intégrées quittent les zones ; les objets retirés y reviennent avec leur identifiant ; les attributs sont écrits.'),
      h('div', { class: 'rgl-actions' }, annulerB, ecrireB));
  });

  /* ---- Nettoyage des entrées sans contour (source R2, droit « attributs ») ---- */
  const zoneNettoyage = h('div', {});
  const orphelinsNettoyables = () => lignes.filter((l) => l.orphelin && !idsZones.has(l.id));
  function majNettoyage() {
    zoneNettoyage.textContent = '';
    const n = orphelinsNettoyables().length;
    if (!n) return;
    const r2 = !!window.AMGT4CEM_Stockage && AMGT4CEM_Stockage.source() === 'r2';
    if (!(peutEditer && r2)) {
      zoneNettoyage.append(h('p', { class: 'rgl-note', text: `${n} entrée(s) d'attributs sans contour dans le shapefile. Le nettoyage demande le droit « attributs » et la source R2.` }));
      return;
    }
    const b = h('button', { type: 'button', class: 'rgl-btn', text: `Nettoyer les entrées sans contour (${n})` });
    b.addEventListener('click', ouvrirNettoyage);
    zoneNettoyage.append(h('div', { class: 'rgl-actions' }, b));
  }
  function ouvrirNettoyage() {
    zoneNettoyage.textContent = '';
    const cases = orphelinsNettoyables().sort((a, b) => a.id.localeCompare(b.id)).map((l) => {
      const c = h('input', { type: 'checkbox' }); c.checked = true;
      const resume = [l.genre ? libelle(l.genre) : 'genre vide', l.nom || 'sans nom'].join(', ');
      return { l, c, el: h('label', { style: 'display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-top:1px solid #e4e7eb;' }, c, h('span', null, h('span', { text: l.id }), h('br'), h('span', { class: 'rgl-row__aide', text: resume }))) };
    });
    const sup = h('button', { type: 'button', class: 'rgl-btn rgl-btn--primary', text: '' });
    const annulerB = h('button', { type: 'button', class: 'rgl-btn', text: 'Annuler' });
    const maj = () => { const k = cases.filter((x) => x.c.checked).length; sup.textContent = `Supprimer ${k} entrée${k > 1 ? 's' : ''}`; };
    cases.forEach((x) => x.c.addEventListener('change', maj)); maj();
    annulerB.addEventListener('click', majNettoyage);
    sup.addEventListener('click', async () => {
      const ids = cases.filter((x) => x.c.checked).map((x) => x.l.id);
      if (!ids.length) { dire('Cochez au moins une entrée.', 'erreur'); return; }
      if (sup.disabled) return;
      const avant = sup.textContent; sup.disabled = true; sup.textContent = 'Suppression…'; sup.style.opacity = '0.6';
      try {
        const out = await AMGT4CEM_Stockage.supprimerAttributs('ditp-diov', ids);
        for (const id of ids) { delete shp.entites[id]; const i = lignes.findIndex((l) => l.cle === `S:${id}`); if (i >= 0) lignes.splice(i, 1); coches.delete(`S:${id}`); }
        dire(`${out.supprimees} entrée(s) supprimée(s). L'ancien fichier est archivé ; les identifiants restent réservés.`, 'ok');
        majNettoyage(); rendre();
      } catch (err) { sup.disabled = false; sup.textContent = avant; sup.style.opacity = ''; dire(err.message, 'erreur'); }
    });
    zoneNettoyage.append(
      h('p', { class: 'rgl-iz__legende', text: 'Entrées sans contour' }),
      h('p', { class: 'rgl-note', text: 'Ces entrées n\'ont plus de contour dans le shapefile ni dans les zones. Leur identifiant reste réservé ; l\'ancien fichier d\'attributs est archivé et récupérable.' }),
      ...cases.map((x) => x.el),
      h('div', { class: 'rgl-actions' }, annulerB, sup));
  }

  etatEcran.modifs = () => recap(lignes).ajouts.length + recap(lignes).retraits.length > 0;

  conteneur.append(
    h('p', { class: 'rgl-note', text: 'Cocher des zones puis ↓ pour les préparer à l\'ajout au shapefile ; cocher des objets du shapefile puis ↑ pour préparer leur retrait (ils gardent leur identifiant). Rien ne change avant « Appliquer ».' }),
    h('div', { class: 'rgl-iz__filtre' }, champ, selGenre, selEtat),
    haut.el,
    h('div', { class: 'rgl-iz__sep' }, bAnnuler, bBas, bHaut, resume, bAppliquer),
    bas.el,
    zoneNettoyage,
    zoneAppliquer,
    statut);
  majNettoyage();
  rendre();
  return etatEcran;
}

window.AMGT4CEM_IntegrationZones = { monter };
window.AMGT4CEM_IntegrationZonesLogique = { construireLignes, etat, deplacer, annuler, recap, aContour };
})();
