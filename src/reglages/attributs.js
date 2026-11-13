/**
 * Réglages > Avancé > « Attributs » : tableau filtré des attributs des entités du shapefile (stations, tunnels,
 * dépôts, ouvrages atypiques, planches). Réservé au droit « attributs ».
 *
 * Sources : data/ditp-diov/polygones.json et data/plans-patrimoine/polygones.json (référentiels joints au shapefile par
 * `id`). Les identifiants et les géométries ne se modifient pas ici.
 *
 * Fonctionnement :
 *  - copier / coller NATIFS de l'appareil : on colle dans une cellule (texte brut, par défaut) ; un extrait de tableur
 *    (colonnes séparées par des tabulations) remplit les cellules à partir de la cellule active. Si la première ligne
 *    collée contient les titres de colonnes dont « Id », les lignes sont retrouvées par identifiant ;
 *  - flèche retour : annule les modifications une par une ;
 *  - disquette : enregistre via le relais, après avoir relu les fichiers sur le serveur pour détecter un changement
 *    fait entre-temps par un autre administrateur (les lignes en conflit ne sont pas écrasées : l'enregistrement
 *    s'arrête et le dit).
 *
 * Une station n'a qu'UN nom. Plusieurs lignes desservies = plusieurs arrêts de même nom, désignés par des références
 * différentes : `references` est une liste de textes (colonne « Références », séparées par « ; »).
 * Nom NL vide → le nom FR s'affiche en italique dans le champ vide (et inversement) ; la donnée, elle, reste vide.
 */
(function () {
const SOURCES = [
  { id: 'ditp-diov', url: './data/ditp-diov/polygones.json', route: 'shared/ditp-diov/polygones' },
  { id: 'plans', url: './data/plans-patrimoine/polygones.json', route: 'shared/plans-patrimoine/polygones' },
];
const VOCAB_URL = './config/ditp-diov/vocabulaires.json';
const COLONNES = [
  { cle: 'id', titre: 'Id', lecture: true },
  { cle: 'genre', titre: 'Genre' },
  { cle: 'name_fr', titre: 'Nom (FR)' },
  { cle: 'name_nl', titre: 'Nom (NL)' },
  { cle: 'references', titre: 'Références' },
  { cle: 'sheet_ref', titre: 'Réf. planche' },
];
const SEP_REF = ';';

const ICONES = { disquette: AMGT4CEM_Icones.svg('disquette'), retour: AMGT4CEM_Icones.svg('annuler') };

const h = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  for (const c of kids) if (c) n.append(c);
  return n;
};

/* ---------- Logique pure (testée sans navigateur) ---------- */

/** Valeurs modifiables d'une entité du référentiel. */
function champsDe(e) {
  return {
    genre: e.genre || '',
    name_fr: e.name_fr || '',
    name_nl: e.name_nl || '',
    references: Array.isArray(e.references) ? e.references.map(String) : [],
    sheet_ref: e.sheet_ref || '',
  };
}
const signature = (c) => JSON.stringify([c.genre, c.name_fr, c.name_nl, c.references, c.sheet_ref]);

const refsEnTexte = (refs) => refs.join(`${SEP_REF} `);
const texteEnRefs = (t) => String(t || '').split(SEP_REF).map((x) => x.trim()).filter(Boolean);

function valeurAffichee(champs, cle) { return cle === 'references' ? refsEnTexte(champs.references) : champs[cle]; }

/** Applique une valeur saisie à une cellule ; renvoie la nouvelle valeur du champ ou `undefined` si la cellule est refusée. */
function appliquerCellule(ligne, cle, texte, genres) {
  const t = String(texte).replace(/[\r\n\t]+/g, ' ').trim();
  const planche = ligne.champs.genre === 'planche';
  if (cle === 'genre') return planche ? undefined : (genres.includes(t) ? t : undefined);
  if (cle === 'sheet_ref') return planche ? t : undefined;
  if (planche && cle !== 'sheet_ref') return undefined; // une planche n'a ni nom ni arrêts
  if (cle === 'references') return texteEnRefs(t);
  if (cle === 'name_fr' || cle === 'name_nl') return t;
  return undefined;
}

/** Découpe un texte collé (tabulations / retours à la ligne) en grille. Une valeur unique = grille 1×1. */
function parserColle(texte) {
  const lignes = String(texte).replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  return lignes.map((l) => l.split('\t'));
}

/** Si la première ligne ressemble à des titres de colonnes (avec « Id »), renvoie la correspondance colonne → rang. */
function reperesEntetes(grille) {
  if (!grille.length) return null;
  const normal = (s) => String(s).trim().toLowerCase();
  const titres = grille[0].map(normal);
  const rang = (cle) => titres.indexOf(normal(COLONNES.find((c) => c.cle === cle).titre));
  if (rang('id') < 0) return null;
  const map = {};
  for (const c of COLONNES) { const r = rang(c.cle); if (r >= 0) map[c.cle] = r; }
  return map;
}

/** Vérifie les règles (un nom au moins, planches uniques). Les noms vides ne sont PAS complétés : l'autre langue ne s'affiche qu'en italique. */
function normaliserEtVerifier(lignes, genres) {
  const problemes = [];
  const planches = new Map();
  for (const l of lignes) {
    const c = l.champs;
    if (c.genre === 'planche') {
      if (!c.sheet_ref) problemes.push(`${l.id} : référence de planche vide.`);
      else if (planches.has(c.sheet_ref)) problemes.push(`${l.id} : référence de planche « ${c.sheet_ref} » déjà utilisée par ${planches.get(c.sheet_ref)}.`);
      else planches.set(c.sheet_ref, l.id);
      continue;
    }
    if (!genres.includes(c.genre)) problemes.push(`${l.id} : genre « ${c.genre} » inconnu.`);
    if (!c.name_fr && !c.name_nl) problemes.push(`${l.id} : aucun nom.`);
  }
  return problemes;
}

/** Reporte les champs modifiables sur une entité du fichier (les autres champs, ex. ids_externes, sont conservés). */
function ecrireChamps(entite, c) {
  delete entite.noms; // ancien modèle (plusieurs noms) abandonné
  entite.genre = c.genre;
  if (c.genre === 'planche') { entite.sheet_ref = c.sheet_ref; return entite; }
  entite.name_fr = c.name_fr;
  entite.name_nl = c.name_nl;
  if (c.references.length) entite.references = c.references.slice(); else delete entite.references;
  return entite;
}

/**
 * Conflits : pour chaque ligne modifiée, la valeur lue sur le serveur doit être celle d'origine, celle déjà envoyée
 * par cet écran, ou celle qu'on s'apprête à écrire. Sinon quelqu'un d'autre l'a changée entre-temps.
 */
function trouverConflits(lignesModifiees, fichier, origine, envoye) {
  const conflits = [];
  for (const l of lignesModifiees) {
    const serveur = fichier.entites[l.id];
    if (!serveur) { conflits.push(`${l.id} : n'existe plus sur le serveur.`); continue; }
    const s = signature(champsDe(serveur));
    const acceptables = [origine.get(l.id), envoye.get(l.id), signature(l.champs)];
    if (!acceptables.includes(s)) conflits.push(`${l.id} : modifié par quelqu'un d'autre depuis votre ouverture.`);
  }
  return conflits;
}

/* ---------- Écran ---------- */

async function lireJson(url) {
  const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Lecture impossible (${url}, HTTP ${r.status}).`);
  return r.json();
}

async function monter(conteneur) {
  conteneur.textContent = '';
  conteneur.append(h('p', { class: 'rgl-note', text: 'Chargement…' }));
  let fichiers, vocab;
  try {
    fichiers = await Promise.all(SOURCES.map((s) => lireJson(s.url)));
    vocab = await lireJson(VOCAB_URL);
  } catch (err) { conteneur.textContent = ''; conteneur.append(h('p', { class: 'rgl-statut rgl-statut--erreur', text: err.message })); return; }
  conteneur.textContent = '';

  const genres = Object.keys(vocab.genres || {});
  const libelle = (g) => (g === 'planche' ? 'Planche' : (vocab.genres[g] && vocab.genres[g].libelle) || g);
  const lignes = []; // { id, source, champs }
  const origine = new Map(); // id → signature à l'ouverture
  const envoye = new Map(); // id → signature déjà envoyée au serveur depuis cet écran
  SOURCES.forEach((s, i) => {
    for (const [id, e] of Object.entries(fichiers[i].entites)) {
      lignes.push({ id, source: s.id, champs: champsDe(e) });
      origine.set(id, signature(champsDe(e)));
    }
  });
  lignes.sort((a, b) => a.id.localeCompare(b.id));
  const parId = new Map(lignes.map((l) => [l.id, l]));

  const historique = []; // pile d'actions : [{ id, avant, apres }]
  let filtreGenres = new Set(); // vide = tous
  let recherche = '';
  let ancrage = null; // { id, cle } cellule active

  const statut = h('p', { class: 'rgl-statut', role: 'status', hidden: '' });
  const dire = (texte, genre) => { statut.textContent = texte; statut.hidden = !texte; statut.className = `rgl-statut${genre ? ` rgl-statut--${genre}` : ''}`; };

  const modifiees = () => lignes.filter((l) => signature(l.champs) !== origine.get(l.id) && signature(l.champs) !== envoye.get(l.id));
  const nonEnvoyees = () => lignes.filter((l) => signature(l.champs) !== (envoye.get(l.id) || origine.get(l.id)));

  /* Barre d'outils */
  const btnRetour = h('button', { type: 'button', class: 'rgl-ic', title: 'Annuler la dernière modification', 'aria-label': 'Annuler la dernière modification' });
  btnRetour.innerHTML = ICONES.retour;
  const btnSauver = h('button', { type: 'button', class: 'rgl-ic', title: 'Enregistrer sur le serveur', 'aria-label': 'Enregistrer sur le serveur' });
  btnSauver.innerHTML = ICONES.disquette;
  const btnExporter = h('button', { type: 'button', class: 'rgl-btn rgl-btn--petit', text: 'Exporter' });
  const compteur = h('span', { class: 'rgl-compteur' });
  const champRecherche = h('input', { type: 'search', class: 'rgl-input rgl-input--large', placeholder: 'Rechercher (id, nom, référence)…', autocomplete: 'off' });
  const puces = h('div', { class: 'rgl-puces' });
  const tbody = h('tbody');
  const table = h('table', { class: 'rgl-tableau' },
    h('thead', null, h('tr', null, ...COLONNES.map((c) => h('th', { text: c.titre })))), tbody);

  const visibles = () => {
    const q = recherche.trim().toLowerCase();
    return lignes.filter((l) => {
      if (filtreGenres.size && !filtreGenres.has(l.champs.genre)) return false;
      if (!q) return true;
      const c = l.champs;
      return [l.id, c.name_fr, c.name_nl, c.sheet_ref, ...c.references].join(' ').toLowerCase().includes(q);
    });
  };

  const majEtat = () => {
    btnRetour.disabled = !historique.length;
    const n = nonEnvoyees().length;
    btnSauver.disabled = !n;
    compteur.textContent = `${visibles().length} ligne(s) affichée(s) sur ${lignes.length} — ${n} modifiée(s) non enregistrée(s)`;
  };

  const genreCellule = (l) => {
    if (l.champs.genre === 'planche') return h('span', { class: 'rgl-ro', text: libelle('planche') });
    const sel = h('select', { class: 'rgl-cell' });
    for (const g of genres) sel.append(h('option', { value: g, text: libelle(g) }));
    sel.value = l.champs.genre;
    sel.addEventListener('change', () => changer(l, 'genre', sel.value));
    return sel;
  };

  const rendre = () => {
    tbody.textContent = '';
    for (const l of visibles()) {
      const tr = h('tr', { 'data-id': l.id });
      for (const col of COLONNES) {
        const td = h('td');
        if (col.cle === 'id') td.append(h('span', { class: 'rgl-ro', text: l.id }));
        else if (col.cle === 'genre') td.append(genreCellule(l));
        else {
          const planche = l.champs.genre === 'planche';
          const editable = col.cle === 'sheet_ref' ? planche : !planche;
          if (!editable) td.append(h('span', { class: 'rgl-ro', text: '' }));
          else {
            const input = h('input', { type: 'text', class: 'rgl-cell', 'data-id': l.id, 'data-cle': col.cle, autocomplete: 'off', spellcheck: 'false' });
            input.value = valeurAffichee(l.champs, col.cle);
            const autre = col.cle === 'name_nl' ? l.champs.name_fr : col.cle === 'name_fr' ? l.champs.name_nl : '';
            if (autre && !input.value) input.placeholder = autre; // texte repris de l'autre langue, en italique (CSS), jamais enregistré
            input.addEventListener('focus', () => { ancrage = { id: l.id, cle: col.cle }; });
            input.addEventListener('change', () => changer(l, col.cle, input.value));
            td.append(input);
          }
        }
        if (signature(l.champs) !== (envoye.get(l.id) || origine.get(l.id))) tr.classList.add('rgl-modif');
        tr.append(td);
      }
      tbody.append(tr);
    }
    majEtat();
  };

  /** Modifie un champ d'une ligne (une action d'historique). Renvoie true si la valeur a changé. */
  function changer(l, cle, texte, groupe) {
    const v = appliquerCellule(l, cle, texte, genres);
    if (v === undefined) { rendre(); return false; }
    const avant = champsDe(l.champs);
    if (JSON.stringify(avant[cle]) === JSON.stringify(v)) { rendre(); return false; }
    const apres = { ...avant, [cle]: v };
    if (cle === 'genre' && v !== 'planche') apres.sheet_ref = '';
    (groupe || (() => { const g = []; historique.push(g); return g; })()).push({ id: l.id, avant, apres });
    l.champs = apres;
    if (!groupe) rendre();
    return true;
  }

  btnRetour.addEventListener('click', () => {
    const action = historique.pop();
    if (!action) return;
    for (const m of action.slice().reverse()) parId.get(m.id).champs = m.avant;
    dire(`Annulé (${action.length} ligne(s)).`);
    rendre();
  });

  /* Coller : texte brut, natif. Une valeur simple suit le comportement normal du champ. */
  table.addEventListener('paste', (ev) => {
    const cible = ev.target.closest && ev.target.closest('input[data-cle]');
    const texte = ev.clipboardData ? ev.clipboardData.getData('text/plain') : '';
    if (!cible || !texte || !/[\t\n\r]/.test(texte.replace(/[\r\n]+$/, ''))) return; // simple valeur : laisser faire
    ev.preventDefault();
    const grille = parserColle(texte);
    const entetes = reperesEntetes(grille);
    const groupe = [];
    historique.push(groupe);
    let cellules = 0; let ignorees = 0; let inconnues = 0;
    const colsEditables = COLONNES.filter((c) => !c.lecture).map((c) => c.cle);
    if (entetes) {
      for (const rangee of grille.slice(1)) {
        const l = parId.get((rangee[entetes.id] || '').trim());
        if (!l) { inconnues++; continue; }
        for (const cle of colsEditables) {
          if (entetes[cle] === undefined) continue;
          const val = rangee[entetes[cle]] === undefined ? '' : rangee[entetes[cle]];
          if (valeurAffichee(l.champs, cle) === val.trim()) continue;
          if (changer(l, cle, val, groupe)) cellules++; else ignorees++;
        }
      }
    } else {
      const vis = visibles();
      const r0 = vis.findIndex((l) => l.id === cible.dataset.id);
      const c0 = colsEditables.indexOf(cible.dataset.cle);
      grille.forEach((rangee, i) => {
        const l = vis[r0 + i];
        if (!l) { inconnues++; return; }
        rangee.forEach((val, j) => {
          const cle = colsEditables[c0 + j];
          if (!cle) { ignorees++; return; }
          if (valeurAffichee(l.champs, cle) === val.trim()) return;
          if (changer(l, cle, val, groupe)) cellules++; else ignorees++;
        });
      });
    }
    if (!groupe.length) historique.pop();
    rendre();
    dire(`${cellules} cellule(s) collée(s)${ignorees ? `, ${ignorees} refusée(s) (cellule non modifiable ou valeur invalide)` : ''}${inconnues ? `, ${inconnues} ligne(s) sans correspondance` : ''}. La flèche retour annule ce collage.`, cellules ? 'ok' : 'erreur');
  });

  /** Exporte les lignes affichées (texte à tabulations, lisible par un tableur) : l'appareil demande où l'enregistrer. */
  btnExporter.addEventListener('click', async () => {
    const tsv = `\ufeff${[COLONNES.map((c) => c.titre).join('\t'),
      ...visibles().map((l) => COLONNES.map((c) => (c.cle === 'id' ? l.id : valeurAffichee(l.champs, c.cle))).join('\t'))].join('\r\n')}\r\n`;
    const nom = 'attributs.tsv'; // nom provisoire, à aligner plus tard sur la convention de nommage
    try {
      if (window.showSaveFilePicker) {
        const fh = await window.showSaveFilePicker({ suggestedName: nom, types: [{ description: 'Texte à tabulations', accept: { 'text/tab-separated-values': ['.tsv'] } }] });
        const w = await fh.createWritable(); await w.write(tsv); await w.close();
      } else {
        const a = h('a', { href: URL.createObjectURL(new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' })), download: nom });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      }
      dire(`${visibles().length} ligne(s) exportée(s).`, 'ok');
    } catch (err) { if (err.name !== 'AbortError') dire(`Export impossible : ${err.message}`, 'erreur'); }
  });

  champRecherche.addEventListener('input', () => { recherche = champRecherche.value; rendre(); });
  const construirePuces = () => {
    puces.textContent = '';
    for (const g of [...genres, 'planche']) {
      const b = h('button', { type: 'button', class: `rgl-puce${filtreGenres.has(g) ? ' rgl-puce--on' : ''}`, text: libelle(g) });
      b.addEventListener('click', () => { if (filtreGenres.has(g)) filtreGenres.delete(g); else filtreGenres.add(g); construirePuces(); rendre(); });
      puces.append(b);
    }
  };

  /* Enregistrer */
  btnSauver.addEventListener('click', async () => {
    const A = AMGT4CEM_PeLabelAnchors;
    const relais = AMGT4CEM_Services.current().relayUrl || AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl;
    if (!relais) { dire('Pour enregistrer : renseigner l\'adresse du relais (Réglages > Avancé > Services et relais).', 'erreur'); return; }
    const code = await A.demanderCode();
    if (!code) { dire('Enregistrement annulé : code administrateur non saisi.', 'erreur'); return; }
    const problemes = normaliserEtVerifier(lignes, genres);
    if (problemes.length) { rendre(); dire(`Enregistrement impossible :\n${problemes.slice(0, 8).join('\n')}`, 'erreur'); return; }
    const aEnvoyer = nonEnvoyees();
    dire('Vérification sur le serveur…');
    btnSauver.disabled = true;
    try {
      const plan = [];
      for (const [i, s] of SOURCES.entries()) {
        const mes = aEnvoyer.filter((l) => l.source === s.id);
        if (!mes.length) continue;
        const frais = await lireJson(s.url);
        const conflits = trouverConflits(mes, frais, origine, envoye);
        if (conflits.length) throw new Error(`Conflit, rien n'a été enregistré pour ce fichier :\n${conflits.slice(0, 8).join('\n')}\nRouvrez l'écran pour voir les valeurs actuelles.`);
        for (const l of mes) ecrireChamps(frais.entites[l.id], l.champs);
        plan.push({ s, frais, mes });
      }
      for (const { s, frais, mes } of plan) {
        dire('Enregistrement sur le serveur…');
        await A.putToRelay(relais, s.route, frais, code);
        for (const l of mes) envoye.set(l.id, signature(l.champs));
      }
      historique.length = 0;
      rendre();
      dire(`${aEnvoyer.length} ligne(s) enregistrée(s). Appliqué à tous après le redéploiement du site (environ 1 minute).`, 'ok');
    } catch (err) { dire(err.message, 'erreur'); } finally { majEtat(); }
  });

  construirePuces();
  rendre();
  ECRAN.modifs = () => nonEnvoyees().length > 0; // lu par le bandeau (reglages.js) avant de quitter l'écran
  conteneur.append(
    h('p', { class: 'rgl-note', text: 'Attributs des entités du shapefile. Coller depuis un tableur : cliquer dans une cellule puis coller (texte brut). Plusieurs lignes desservies = plusieurs arrêts de même nom : indiquer leurs références séparées par « ; ». Un nom FR ou NL vide s\'affiche en italique avec le nom de l\'autre langue, sans être enregistré.' }),
    h('div', { class: 'rgl-barre' }, btnRetour, btnSauver, btnExporter, compteur),
    puces, h('div', { class: 'rgl-recherche' }, champRecherche), statut,
    h('div', { class: 'rgl-tableau-cadre' }, table));
}

/** Écran proposé à Réglages > Avancé (ligne déclarée dans serveur.js, droit « attributs »). */
const ECRAN = { id: 'attributs', titre: 'Attributs', monter, modifs: () => false };
window.AMGT4CEM_AttributsEcran = ECRAN;

window.AMGT4CEM_AttributsLogique = { champsDe, signature, appliquerCellule, parserColle, reperesEntetes, normaliserEtVerifier, ecrireChamps, trouverConflits, texteEnRefs };
})();
