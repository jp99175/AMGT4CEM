/**
 * Géométries et attributs du réseau dans R2 (lot A de l'écriture du shapefile, 18/11/2026).
 *
 * Module du Worker de dépôt : worker.js l'appelle pour les routes /geometries/… et /attributs/…
 * Les routes des signalements, des comptes et de l'administration ne sont pas concernées.
 *
 * Rangement R2 (jamais modifié en place : une version écrite reste telle quelle) :
 *   prive/geometries/shapefile/<couche>/courant.json                 pointeur { version, origine, fichiers, objets, ... }
 *   prive/geometries/shapefile/<couche>/versions/<version>/<couche>.<ext>   jeu complet (shp, shx, dbf, prj, cpg)
 *   prive/attributs/<nom>.json                                       attributs joints par `id`
 *   prive/referentiels/source-donnees.json                           interrupteur : { source: 'depot' | 'r2' }
 * `<couche>` : polygones (le vrai shapefile). `<version>` : vAAAAMMJJ_HHMMSS (Bruxelles).
 * Un lecteur lit le pointeur puis les fichiers de cette version : il ne voit jamais un jeu à moitié écrit.
 *
 * Routes (jeton exigé ; droit entre parenthèses) :
 *   GET  /geometries/stockage                          état : source, versions, nombre d'objets, compteur P
 *   POST /geometries/source            (plans)         { source: 'depot' | 'r2' }
 *   GET  /geometries/shapefile/<couche>                pointeur courant
 *   GET  /geometries/shapefile/<couche>/<ext>          fichier de la version courante (ETag, 304)
 *   GET  /geometries/identifiants                      { prochain_id } (copie du compteur P)
 *   GET  /attributs/<nom>                              JSON (ETag, 304)
 *   POST /geometries/charger           (plans)         chargement initial (refusé si R2 contient déjà la couche)
 *   POST /attributs/<nom>/modifier     (attributs)     lot B : lignes modifiées { changements: [{ id, avant, apres }] }
 *   POST /attributs/<nom>/supprimer    (attributs)     lot C : supprime des entrées sans contour dans le vrai shapefile { ids: [...] }
 *   GET  /geometries/lieux                             zones dessinées (outil « Dessiner une zone »), ETag, 304
 *   POST /geometries/lieux/charger     (plans)         chargement initial des zones { lieux } (refusé si R2 les contient déjà)
 *   POST /geometries/lieux             (plans)         écrit toutes les zones { lieux, etagBase } (refusé si le fichier a changé depuis la lecture)
 *   POST /geometries/shapefile/<couche>/controler (plans)  contrôle zone par zone (contour, recoupement, genre, nom, doublon), sans écriture
 *   POST /geometries/shapefile/<couche>/appliquer (plans)  lot C partie 2 : zones vers le shapefile (↓) et objets retirés vers les zones (↑)
 *
 * Lot B (écriture des attributs) : le client n'envoie que les lignes modifiées, chacune avec ses anciennes valeurs (`avant`)
 * et les nouvelles (`apres`, `null` = champ retiré). Le serveur relit le fichier, refuse tout si une ligne n'est plus dans l'état
 * `avant` (conflit par ligne), applique, copie l'ancienne version dans prive/attributs/archive/<nom>/, écrit avec If-Match
 * (nouvel essai si quelqu'un a écrit entre-temps) puis ne garde que les archives prévues (CONSERVATION).
 * Seuls genre, name_fr, name_nl, references et sheet_ref d'une ligne existante sont modifiables ; ajouter ou retirer une ligne
 * est réservé au lot C.
 *
 * Lot C (écriture du shapefile, 18/11/2026) :
 *   POST /geometries/shapefile/<couche>/deposer   (plans)  dépôt d'un jeu de fichiers modifié : contrôles, P… attribués, nouvelle version
 *   POST /geometries/shapefile/<couche>/restaurer (plans)  recopie une ancienne version comme nouvelle version courante
 *   GET  /geometries/depots/<couche>                       historique des versions écrites (journal de chaque écriture)
 *   GET  /geometries/depots/<couche>/<version>/zip         ZIP tel que déposé
 * Les contours ne sont jamais ré-encodés (octets copiés). Le .dbf est reconstruit : id + GENRE, NOM_FR, NOM_NL en majuscules sans accents.
 * Ordre d'écriture : fichiers de la version, attributs des nouveaux objets, puis pointeur en dernier (If-Match). Voir shapefile.js.
 */

import { analyserDepot, composerDbf, composerShpShx, controlerContour, decoderContour, encoderContour, lireIdsDbf, lireJeu, memesOctets, trouverRecoupement } from './shapefile.js';

const COUCHES = ['polygones'];
const EXTENSIONS = ['shp', 'shx', 'dbf', 'prj', 'cpg'];
const OBLIGATOIRES = ['shp', 'shx', 'dbf', 'prj'];
const ATTRIBUTS = ['ditp-diov', 'plans-patrimoine'];
const SOURCE_KEY = 'prive/referentiels/source-donnees.json';
const TYPES = { shp: 'application/octet-stream', shx: 'application/octet-stream', dbf: 'application/octet-stream', prj: 'text/plain; charset=utf-8', cpg: 'text/plain; charset=utf-8' };

export const cleCourant = (couche) => `prive/geometries/shapefile/${couche}/courant.json`;
const cleFichier = (couche, version, ext) => `prive/geometries/shapefile/${couche}/versions/${version}/${couche}.${ext}`;
const cleAttributs = (nom) => `prive/attributs/${nom}.json`;
const prefixeArchives = (nom) => (nom === 'lieux' ? 'prive/geometries/json/archive/lieux/' : `prive/attributs/archive/${nom}/`);
const CLE_LIEUX = 'prive/geometries/json/lieux.json';
export const prefixeVersions = (couche) => `prive/geometries/shapefile/${couche}/versions/`;
const cleJournal = (couche, version) => `prive/geometries/depots/${couche}/${version}.json`;
const cleZip = (couche, version) => `prive/geometries/depots/${couche}/${version}.zip`;
export const prefixeDepots = (couche) => `prive/geometries/depots/${couche}/`;
const REGLES_ID = { polygones: /^P\d{6,}$/ };
const nombreId = (id) => Number(id.slice(1));
const idDe = (prefixe, n) => `${prefixe}${String(n).padStart(6, '0')}`;

// Politique de sauvegarde (décidée le 25/11/2026, remplace celle du 18/11) : la version en cours, une sauvegarde (la version
// juste avant) et la dernière version de chaque mois écoulé où quelque chose a changé. Pour les archives (attributs, lieux) :
// 1 archive = la version juste avant ; pour les versions de shapefile (qui comptent la version en cours) : 2 ; pour les
// dépôts : les 2 derniers. Seule l'origine du vrai shapefile (« polygones », copie de départ) est gardée en plus.
// Valeurs fixées dans le code : les changer demande un redéploiement du Worker.
export const CONSERVATION = { shapefile: 2, attributs: 1, depots: 2 };
const CHAMPS_MODIFIABLES = ['genre', 'name_fr', 'name_nl', 'references', 'sheet_ref'];
const MAX_CHANGEMENTS = 500;

/** Horodatage de version à l'heure de Bruxelles : vAAAAMMJJ_HHMMSS. */
export function nomVersion(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((x) => [x.type, x.value]));
  return `v${p.year}${p.month}${p.day}_${p.hour}${p.minute}${p.second}`;
}

function deBase64(texte, nom) {
  try {
    const bin = atob(String(texte || ''));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch (err) { throw new Error(`Fichier .${nom} illisible (base 64 invalide).`); }
}

/**
 * Contrôle d'un jeu de fichiers shapefile (polygones, type 5). Renvoie { objets, ids } ou lève une Error au message lisible.
 * Contrôles : code et longueur de l'en-tête .shp, type de forme, nombre d'enregistrements identique dans .shp, .shx et .dbf,
 * champ `id` présent, identifiants non vides et uniques.
 */
export function verifierShapefile(f) {
  const shp = f.shp; const shx = f.shx; const dbf = f.dbf;
  if (shp.length < 100) throw new Error('Le fichier .shp est trop court.');
  const vs = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  if (vs.getInt32(0, false) !== 9994) throw new Error("Le fichier .shp n'a pas le bon code d'en-tête (9994).");
  if (vs.getInt32(24, false) * 2 !== shp.length) throw new Error("La longueur annoncée par le .shp ne correspond pas à sa taille.");
  if (vs.getInt32(32, true) !== 5) throw new Error('Le .shp ne contient pas des polygones (type 5 attendu).');
  // Nombre d'enregistrements du .shp : on parcourt les enregistrements.
  let objets = 0; let pos = 100;
  while (pos + 8 <= shp.length) { pos += 8 + vs.getInt32(pos + 4, false) * 2; objets++; }
  if (pos !== shp.length) throw new Error('Le .shp se termine au milieu d\'un enregistrement.');
  // .shx : 100 octets d'en-tête + 8 octets par enregistrement.
  if (shx.length !== 100 + 8 * objets) throw new Error(`Le .shx annonce ${(shx.length - 100) / 8} objets, le .shp en contient ${objets}.`);
  // .dbf : en-tête (nombre d'enregistrements, longueurs) puis descripteurs de champs.
  if (dbf.length < 33) throw new Error('Le fichier .dbf est trop court.');
  const vd = new DataView(dbf.buffer, dbf.byteOffset, dbf.byteLength);
  const nDbf = vd.getUint32(4, true); const lenEntete = vd.getUint16(8, true); const lenEnreg = vd.getUint16(10, true);
  if (nDbf !== objets) throw new Error(`Le .dbf contient ${nDbf} enregistrements, le .shp ${objets} objets.`);
  if (dbf.length < lenEntete + lenEnreg * nDbf) throw new Error('Le .dbf est tronqué.');
  let debut = 1; let trouve = false; let longueur = 0;
  for (let i = 32; i < lenEntete - 1 && dbf[i] !== 0x0d; i += 32) {
    const nom = new TextDecoder().decode(dbf.subarray(i, i + 11)).replace(/\0.*$/, '').toLowerCase();
    const len = dbf[i + 16];
    if (nom === 'id') { trouve = true; longueur = len; break; }
    debut += len;
  }
  if (!trouve) throw new Error('Le .dbf n\'a pas de champ « id ».');
  const ids = [];
  const vus = new Set();
  for (let n = 0; n < nDbf; n++) {
    const base = lenEntete + n * lenEnreg + debut;
    const id = new TextDecoder().decode(dbf.subarray(base, base + longueur)).trim();
    if (!id) throw new Error(`L'objet n° ${n + 1} n'a pas d'identifiant.`);
    if (vus.has(id)) throw new Error(`Identifiant en double : ${id}.`);
    vus.add(id); ids.push(id);
  }
  return { objets, ids };
}

/** Valide et normalise la valeur d'un champ modifiable ; null = champ retiré. Lève une Error lisible. */
function champValide(cle, v) {
  if (v === null || v === undefined) return null;
  if (cle === 'references') {
    if (!Array.isArray(v) || v.length > 50 || v.some((x) => typeof x !== 'string' || x.length > 60)) throw new Error('references : liste de textes (50 au plus, 60 caractères chacun).');
    return v;
  }
  if (typeof v !== 'string') throw new Error(`${cle} : texte attendu.`);
  if (v.length > (cle === 'genre' || cle === 'sheet_ref' ? 40 : 200)) throw new Error(`${cle} : texte trop long.`);
  return v;
}

/** Noms des archives à garder : les `n` plus récentes, la plus récente de chaque mois, et (si `avecOrigine`) la plus ancienne. `noms` = noms de version triables. */
export function archivesAGarder(noms, n, avecOrigine = false) {
  const tries = [...noms].sort();
  const garder = new Set(tries.slice(-n));
  const parMois = new Map();
  for (const x of tries) parMois.set(x.slice(1, 7), x); // vAAAAMM… : le dernier écrase les précédents du même mois
  for (const x of parMois.values()) garder.add(x);
  if (avecOrigine && tries.length) garder.add(tries[0]);
  return garder;
}

async function listerCles(env, prefix) {
  const cles = []; let curseur;
  do { const page = await env.DEPOTS.list({ prefix, cursor: curseur }); for (const o of page.objects) cles.push({ cle: o.key, taille: o.size }); curseur = page.truncated ? page.cursor : undefined; } while (curseur);
  return cles;
}

/** Archives d'un jeu (attributs, lieux) hors politique de sauvegarde. */
async function planArchives(env, nom) {
  const cles = await listerCles(env, prefixeArchives(nom));
  const versions = cles.map((o) => o.cle.slice(prefixeArchives(nom).length).replace(/\.json$/, ''));
  const garder = archivesAGarder(versions, CONSERVATION.attributs);
  return cles.filter((o, i) => !garder.has(versions[i]));
}

/** Supprime les archives hors règle ; ne doit jamais faire échouer une écriture. */
async function purgerArchives(env, nom) {
  try {
    const aSupprimer = (await planArchives(env, nom)).map((o) => o.cle);
    for (let i = 0; i < aSupprimer.length; i += 100) await env.DEPOTS.delete(aSupprimer.slice(i, i + 100));
  } catch (err) { console.error('purge des archives', err); }
}

/** Versions et ZIP de dépôt d'une couche shapefile hors politique de sauvegarde (la version courante et, pour « polygones », l'origine sont gardées). */
async function planVersions(env, couche, pointeur) {
  const cles = await listerCles(env, prefixeVersions(couche));
  const nomVersion = (k) => k.slice(prefixeVersions(couche).length).split('/')[0];
  const nomsVersions = [...new Set(cles.map((o) => nomVersion(o.cle)))];
  const depots = await listerCles(env, prefixeDepots(couche));
  const journaux = depots.filter((o) => o.cle.endsWith('.json')).map((o) => o.cle.slice(prefixeDepots(couche).length).replace(/\.json$/, ''));
  const garder = archivesAGarder(nomsVersions, CONSERVATION.shapefile, couche === 'polygones');
  const depotsGardes = archivesAGarder(journaux, CONSERVATION.depots);
  for (const v of depotsGardes) garder.add(v);
  garder.add(pointeur.version);
  if (couche === 'polygones' && pointeur.origine) garder.add(pointeur.origine);
  // ZIP déposés : mêmes règles que les dépôts ; les journaux (quelques centaines d'octets) restent tous.
  const zips = depots.filter((o) => o.cle.endsWith('.zip') && !depotsGardes.has(o.cle.slice(prefixeDepots(couche).length).replace(/\.zip$/, '')));
  return [...cles.filter((o) => !garder.has(nomVersion(o.cle))), ...zips];
}

/** Supprime les versions de shapefile hors règle ; sans échec bloquant. */
async function purgerVersions(env, couche, pointeur) {
  try {
    const aSupprimer = (await planVersions(env, couche, pointeur)).map((o) => o.cle);
    for (let i = 0; i < aSupprimer.length; i += 100) await env.DEPOTS.delete(aSupprimer.slice(i, i + 100));
  } catch (err) { console.error('purge des versions', err); }
}

/** Tout ce que la politique de sauvegarde ferait partir maintenant : [{ id, titre, objets: [{ cle, taille }] }]. */
export async function planSauvegardes(env) {
  const groupes = [];
  const noms = new Set();
  for (const o of await listerCles(env, 'prive/attributs/archive/')) { const m = /^prive\/attributs\/archive\/([^/]+)\//.exec(o.cle); if (m) noms.add(m[1]); }
  for (const nom of [...noms].sort()) groupes.push({ id: `attributs-${nom}`, titre: `Archives des attributs (${nom})`, objets: await planArchives(env, nom) });
  groupes.push({ id: 'lieux', titre: 'Archives des zones dessinées (lieux)', objets: await planArchives(env, 'lieux') });
  for (const couche of COUCHES) {
    const o = await env.DEPOTS.get(cleCourant(couche));
    let pointeur = null;
    if (o) { try { pointeur = await o.json(); } catch (err) { pointeur = null; } }
    if (!pointeur || !pointeur.version) continue;
    groupes.push({ id: `shapefile-${couche}`, titre: 'Versions du shapefile des polygones', objets: await planVersions(env, couche, pointeur) });
  }
  return groupes;
}

/**
 * @param {object} ctx  outils de worker.js : HttpError, intervenantCourant, exigerDroit, aDroit, compteur, lireJson
 * @returns {(request, env, url) => Promise<null | {status, body} | {status, raw, type, headers}>}
 */
export function creerRoutesGeometries(ctx) {
  const { HttpError, intervenantCourant, exigerDroit, compteur, lireJson } = ctx;

  async function lireSource(env) {
    const o = await env.DEPOTS.get(SOURCE_KEY);
    if (!o) return { source: 'depot' };
    try { const s = await o.json(); return { source: s.source === 'r2' ? 'r2' : 'depot', date: s.date, par: s.par }; } catch (err) { return { source: 'depot' }; }
  }

  async function lirePointeur(env, couche) {
    const o = await env.DEPOTS.get(cleCourant(couche));
    if (!o) return null;
    try { return { pointeur: await o.json(), etag: o.httpEtag, etagBrut: o.etag }; } catch (err) { throw new HttpError(500, `Pointeur illisible (${couche}).`); }
  }

  /** Lecture d'un objet R2 avec ETag et 304 (If-None-Match). */
  async function servir(request, env, cle, type) {
    const o = await env.DEPOTS.get(cle, { onlyIf: request.headers });
    if (!o) throw new HttpError(404, 'Introuvable dans R2.');
    const entetes = { ETag: o.httpEtag, 'Cache-Control': 'private, no-cache' };
    if (!('body' in o) || o.body === undefined) return { status: 304, raw: null, type, headers: entetes }; // précondition vérifiée : inchangé
    return { status: 200, raw: o.body, type, headers: entetes };
  }

  async function nombreAttributs(env, nom) {
    const o = await env.DEPOTS.get(cleAttributs(nom));
    if (!o) return null;
    try { const j = await o.json(); return { entrees: Object.keys(j.entites || {}).length, etag: o.httpEtag }; } catch (err) { return { entrees: null, etag: o.httpEtag }; }
  }

  async function etat(env) {
    const couches = {};
    for (const c of COUCHES) {
      const p = await lirePointeur(env, c);
      couches[c] = p ? { version: p.pointeur.version, origine: p.pointeur.origine || null, objets: p.pointeur.objets, chargeLe: p.pointeur.date || null, par: p.pointeur.par || null } : null;
    }
    const attributs = {};
    for (const n of ATTRIBUTS) attributs[n] = await nombreAttributs(env, n);
    let prochainP = null;
    try { prochainP = (await compteur(env, { action: 'etat' })).etat.identifiants.P; } catch (err) { console.error('compteur P', err); }
    let lieux = null;
    try { const o = await env.DEPOTS.get(CLE_LIEUX); if (o) { const j = await o.json(); lieux = { entrees: Object.keys(j.lieux || {}).length, etag: o.httpEtag }; } } catch (err) { lieux = { entrees: null }; }
    return { ...(await lireSource(env)), couches, attributs, lieux, prochainP };
  }


  async function lireJeuR2(env, couche, version) {
    const f = {};
    for (const ext of ['shp', 'shx', 'dbf']) {
      const o = await env.DEPOTS.get(cleFichier(couche, version, ext));
      if (!o) throw new HttpError(500, `Le fichier .${ext} de la version ${version} est introuvable dans R2.`);
      f[ext] = new Uint8Array(await o.arrayBuffer());
    }
    return lireJeu(f);
  }

  async function nomVersionLibre(env, couche) {
    let version = nomVersion();
    for (let n = 2; await env.DEPOTS.head(cleFichier(couche, version, 'shp')); n++) version = `${nomVersion()}_${n}`;
    return version;
  }

  /** Ajoute des entrées vides pour de nouveaux identifiants dans un fichier d'attributs (archive + écriture conditionnelle). */
  async function ajouterEntrees(env, nom, ids, matricule, valeurs = {}) {
    for (let tentative = 0; tentative < 4; tentative++) {
      const o = await env.DEPOTS.get(cleAttributs(nom));
      if (!o) throw new HttpError(409, `Les attributs ${nom} ne sont pas dans R2.`);
      const brut = await o.text();
      const data = JSON.parse(brut);
      data.entites = data.entites || {};
      let ajoutees = 0;
      for (const id of ids) {
        if (!data.entites[id]) { data.entites[id] = {}; ajoutees++; }
        const v = valeurs[id];
        if (v) for (const [k, x] of Object.entries(v)) if (x !== undefined && JSON.stringify(data.entites[id][k]) !== JSON.stringify(x)) { data.entites[id][k] = x; ajoutees++; }
      }
      if (!ajoutees) return;
      data.date = new Date().toISOString(); data.modifiePar = matricule;
      let version = nomVersion();
      for (let n = 2; await env.DEPOTS.head(`${prefixeArchives(nom)}${version}.json`); n++) version = `${nomVersion()}_${n}`;
      const cleArchive = `${prefixeArchives(nom)}${version}.json`;
      await env.DEPOTS.put(cleArchive, brut, { httpMetadata: { contentType: 'application/json' } });
      const ecrit = await env.DEPOTS.put(cleAttributs(nom), JSON.stringify(data), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: o.etag } });
      if (!ecrit) { await env.DEPOTS.delete(cleArchive); continue; }
      await purgerArchives(env, nom);
      return;
    }
    throw new HttpError(409, 'Les attributs sont modifiés en continu par d\'autres écritures ; réessayez dans un instant.');
  }

  async function lireAttributsR2(env) {
    const att = {};
    for (const nom of ATTRIBUTS) {
      const o = await env.DEPOTS.get(cleAttributs(nom));
      if (!o) throw new HttpError(409, `Les attributs ${nom} ne sont pas dans R2 : chargez d'abord les données initiales.`);
      att[nom] = await o.json();
    }
    return att;
  }

  /** Bascule du pointeur (If-Match) puis journal et purge. Renvoie false si quelqu'un a écrit entre-temps. */
  async function basculer(env, couche, cur, pointeur, journal) {
    const ok = await env.DEPOTS.put(cleCourant(couche), JSON.stringify(pointeur), { httpMetadata: { contentType: 'application/json' }, onlyIf: cur ? { etagMatches: cur.etagBrut } : { etagDoesNotMatch: '*' } });
    if (!ok) return false;
    await env.DEPOTS.put(cleJournal(couche, pointeur.version), JSON.stringify(journal), { httpMetadata: { contentType: 'application/json' } });
    await purgerVersions(env, couche, pointeur);
    return true;
  }

  async function supprimerVersion(env, couche, version) {
    try { await env.DEPOTS.delete(EXTENSIONS.map((e) => cleFichier(couche, version, e))); } catch (err) { console.error('nettoyage', err); }
  }

  /** Genre et nom (FR) d'un objet existant, d'après les attributs. */
  function genreNom(id, att) {
    const e = att['ditp-diov'].entites[id] || att['plans-patrimoine'].entites[id] || {};
    return { genre: e.genre || '', nom: e.name_fr || '' };
  }

  async function deposer(env, u, couche, d) {
    const f = {};
    for (const ext of EXTENSIONS) {
      if (d.fichiers && d.fichiers[ext] !== undefined) f[ext] = deBase64(d.fichiers[ext], ext);
      else if (OBLIGATOIRES.includes(ext)) throw new HttpError(400, `Fichier .${ext} manquant.`);
    }
    const deposePar = String(d.deposePar || '').trim();
    if (!deposePar) throw new HttpError(400, 'Indiquez qui a déposé le fichier (« Déposé par »).');
    if (deposePar.length > 100) throw new HttpError(400, '« Déposé par » : 100 caractères au plus.');
    const refus = (erreurs, resume) => ({ status: 400, body: { erreur: 'Le fichier est refusé : rien n\'a été enregistré.', erreurs, resume } });
    if (!/31370|lambert[_ ]?72|belge[_ ]lambert|lambert[_ ]belge|belgian lambert/i.test(new TextDecoder().decode(f.prj))) return refus(['Le fichier .prj n\'indique pas le Lambert 72 (EPSG:31370).']);
    let depose;
    try { depose = lireJeu(f); } catch (err) { return refus([err.message]); }
    if (!depose.objets.length) return refus(['Le fichier ne contient aucun objet.']);
    const erreurs = [];
    depose.objets.forEach((o, i) => { try { controlerContour(o.contenu); } catch (err) { erreurs.push(`Objet n° ${i + 1}${o.id ? ` (${o.id})` : ''} : ${err.message}.`); } });

    const cur = await lirePointeur(env, couche);
    if (!cur && couche === 'polygones') throw new HttpError(409, 'Le vrai shapefile n\'est pas encore dans R2 : chargez d\'abord les données initiales.');
    const courant = cur ? await lireJeuR2(env, couche, cur.pointeur.version) : { objets: [] };
    const att = await lireAttributsR2(env);
    const prochainP = (await compteur(env, { action: 'etat' })).etat.identifiants.P;
    const prochainT = (cur && cur.pointeur.prochainT) || 1;
    const regle = { motif: REGLES_ID[couche], connu: (id) => (id[0] === 'P' ? nombreId(id) < prochainP : nombreId(id) < prochainT) };
    const analyse = analyserDepot(courant, depose, regle);
    erreurs.push(...analyse.erreurs);

    const prefixe = couche === 'polygones' ? 'P' : 'T';
    const premier = prefixe === 'P' ? prochainP : prochainT;
    const versionBase = typeof d.versionBase === 'string' && d.versionBase ? d.versionBase : null;
    const ancienne = !!cur && versionBase !== cur.pointeur.version;
    const resume = {
      objetsDeposes: depose.objets.length, versionCourante: cur ? cur.pointeur.version : null, versionBase, versionAncienne: ancienne,
      sansId: analyse.sansId.length, premierId: analyse.sansId.length ? idDe(prefixe, premier) : null, dernierId: analyse.sansId.length ? idDe(prefixe, premier + analyse.sansId.length - 1) : null,
      doublons: analyse.doublons.map((x) => ({ id: x.id, copies: x.attribues.length })), disparus: analyse.disparus, modifies: analyse.modifies.length, inchanges: analyse.inchanges,
      listeAjoutes: analyse.sansId.map((pos, k) => ({ id: idDe(prefixe, premier + k), genre: depose.objets[pos].genre || '', nom: depose.objets[pos].nom_fr || '' })),
      listeModifies: analyse.modifies.map((id) => ({ id, ...genreNom(id, att) })),
      listeDisparus: analyse.disparus.map((id) => ({ id, ...genreNom(id, att) })),
    };
    if (erreurs.length) return refus(erreurs, resume);
    if (d.apercu) return { status: 200, body: { apercu: true, resume } };
    const manque = [];
    if (!(d.confirmations && d.confirmations.mot === 'POLYGONES')) manque.push('mot');
    if (analyse.disparus.length && !(d.confirmations && d.confirmations.retraits)) manque.push('retraits');
    if (ancienne && !(d.confirmations && d.confirmations.versionAncienne)) manque.push('versionAncienne');
    if (manque.length) return { status: 409, body: { erreur: 'Confirmation manquante : rien n\'a été enregistré.', manque, resume } };

    // ---- écriture : identifiants, fichiers de la version, attributs des nouveaux objets, pointeur en dernier
    const ids = depose.objets.map((o) => o.id);
    let nouveaux = [];
    if (analyse.sansId.length) {
      nouveaux = prefixe === 'P'
        ? (await compteur(env, { action: 'reserver', prefixe: 'P', n: analyse.sansId.length })).ids
        : analyse.sansId.map((_, i) => idDe('T', prochainT + i));
      analyse.sansId.forEach((pos, i) => { ids[pos] = nouveaux[i]; });
    }
    const valeursNouveaux = {};
    analyse.sansId.forEach((pos, i) => {
      const o = depose.objets[pos]; const v = {};
      if (o.genre) v.genre = o.genre;
      if (o.nom_fr) v.name_fr = o.nom_fr;
      if (o.nom_nl) v.name_nl = o.nom_nl;
      valeursNouveaux[nouveaux[i]] = v;
    });
    const lignes = ids.map((id) => {
      const e = att['ditp-diov'].entites[id] || att['plans-patrimoine'].entites[id] || valeursNouveaux[id] || {};
      return { id, genre: e.genre, nom_fr: e.name_fr, nom_nl: e.name_nl };
    });
    const { shp, shx } = composerShpShx(depose.objets.map((o) => o.contenu));
    const { dbf, coupes } = composerDbf(lignes);
    const version = await nomVersionLibre(env, couche);
    const contenu = { shp, shx, dbf, prj: f.prj, cpg: new TextEncoder().encode('1252') };
    for (const ext of EXTENSIONS) await env.DEPOTS.put(cleFichier(couche, version, ext), contenu[ext], { httpMetadata: { contentType: TYPES[ext] } });
    // Le fichier reçu est relu pour vérification avant que quoi que ce soit devienne visible.
    try { const relu = await lireJeuR2(env, couche, version); if (relu.objets.length !== ids.length || relu.objets.some((o, i) => o.id !== ids[i])) throw new Error('relecture différente'); } catch (err) { await supprimerVersion(env, couche, version); throw new HttpError(500, 'La relecture de vérification a échoué : rien n\'a été enregistré.'); }
    if (d.zip) await env.DEPOTS.put(cleZip(couche, version), deBase64(d.zip, 'zip'), { httpMetadata: { contentType: 'application/zip' } });
    // Les attributs des nouveaux objets viennent du fichier déposé (GENRE, NOM_FR, NOM_NL) ; ceux des objets existants restent ceux de la base.
    if (nouveaux.length && prefixe === 'P') await ajouterEntrees(env, 'ditp-diov', nouveaux, u.matricule, valeursNouveaux);
    const pointeur = { version, origine: (cur && cur.pointeur.origine) || version, fichiers: EXTENSIONS, objets: ids.length, date: new Date().toISOString(), par: u.matricule, deposePar, source: 'depot', prochainT: prefixe === 'T' ? prochainT + nouveaux.length : prochainT };
    const journal = { version, date: pointeur.date, par: u.matricule, deposePar, source: 'depot', nomZip: typeof d.nomZip === 'string' ? d.nomZip.slice(0, 200) : null, versionBase, versionPrecedente: cur ? cur.pointeur.version : null, objets: ids.length, attribues: nouveaux, doublons: resume.doublons, disparus: analyse.disparus, modifies: analyse.modifies.length, inchanges: analyse.inchanges, valeursCoupees: coupes };
    if (!(await basculer(env, couche, cur, pointeur, journal))) {
      await supprimerVersion(env, couche, version);
      throw new HttpError(409, 'Un autre enregistrement a eu lieu en même temps : rien n\'a été remplacé. Rouvrez l\'écran et recommencez.');
    }
    return { status: 200, body: { version, objets: ids.length, attribues: nouveaux, disparus: analyse.disparus.length, modifies: analyse.modifies.length, inchanges: analyse.inchanges, valeursCoupees: coupes, etat: await etat(env) } };
  }

  async function restaurer(env, u, couche, d) {
    const version = String(d.version || '');
    if (!/^v\d{8}_\d{6}(_\d+)?$/.test(version)) throw new HttpError(400, 'Version invalide.');
    const cur = await lirePointeur(env, couche);
    if (!cur) throw new HttpError(404, 'Cette couche n\'est pas encore dans R2.');
    if (version === cur.pointeur.version) throw new HttpError(400, 'Cette version est déjà la version courante.');
    const exts = [];
    for (const ext of EXTENSIONS) if (await env.DEPOTS.head(cleFichier(couche, version, ext))) exts.push(ext);
    if (!OBLIGATOIRES.every((e) => exts.includes(e))) throw new HttpError(404, 'Cette version n\'existe plus (supprimée par la règle de conservation).');
    const jeu = await lireJeuR2(env, couche, version);
    const neuve = await nomVersionLibre(env, couche);
    for (const ext of exts) {
      const o = await env.DEPOTS.get(cleFichier(couche, version, ext));
      await env.DEPOTS.put(cleFichier(couche, neuve, ext), await o.arrayBuffer(), { httpMetadata: { contentType: TYPES[ext] } });
    }
    const pointeur = { ...cur.pointeur, version: neuve, fichiers: exts, objets: jeu.objets.length, date: new Date().toISOString(), par: u.matricule, deposePar: null, source: 'restauration', restaureDepuis: version };
    const journal = { version: neuve, date: pointeur.date, par: u.matricule, deposePar: null, source: 'restauration', restaureDepuis: version, versionPrecedente: cur.pointeur.version, objets: jeu.objets.length };
    if (!(await basculer(env, couche, cur, pointeur, journal))) { await supprimerVersion(env, couche, neuve); throw new HttpError(409, 'Un autre enregistrement a eu lieu en même temps : rien n\'a été remplacé.'); }
    return { status: 200, body: { version: neuve, restaureDepuis: version, objets: jeu.objets.length, etat: await etat(env) } };
  }

  async function historique(env, couche) {
    const cles = []; let curseur;
    do { const page = await env.DEPOTS.list({ prefix: prefixeDepots(couche), cursor: curseur }); for (const o of page.objects) if (o.key.endsWith('.json')) cles.push(o.key); curseur = page.truncated ? page.cursor : undefined; } while (curseur);
    const recents = cles.sort().slice(-50).reverse();
    const out = [];
    for (const k of recents) {
      const o = await env.DEPOTS.get(k);
      if (!o) continue;
      let j; try { j = await o.json(); } catch (err) { continue; }
      const v = j.version;
      j.disponible = !!(await env.DEPOTS.head(cleFichier(couche, v, 'shp')));
      j.zipDisponible = !!(await env.DEPOTS.head(cleZip(couche, v)));
      out.push(j);
    }
    return out;
  }

  /** Zones dessinées : lecture-modification-écriture conditionnelle (archive de l'ancien fichier, purge). `fn(data)` renvoie le nouveau contenu ou null (rien à changer). */
  async function modifierLieux(env, matricule, fn, { etagBase } = {}) {
    for (let tentative = 0; tentative < 4; tentative++) {
      const o = await env.DEPOTS.get(CLE_LIEUX);
      if (!o) throw new HttpError(409, 'Les zones ne sont pas encore dans R2 : chargez-les d\'abord (Réglages > Stockage des données).');
      // Cloudflare rend faible (préfixe W/) l'ETag d'une réponse compressée : on compare sans ce préfixe.
      if (etagBase && o.httpEtag.replace(/^W\//, '') !== String(etagBase).replace(/^W\//, '')) throw new HttpError(409, 'Les zones ont été modifiées par quelqu\'un d\'autre depuis votre lecture : rien n\'a été enregistré. Rouvrez l\'outil.');
      const brut = await o.text();
      let data; try { data = JSON.parse(brut); } catch (err) { throw new HttpError(500, 'Zones illisibles dans R2.'); }
      const nouveau = fn(data);
      if (!nouveau) return false;
      nouveau.date = new Date().toISOString(); nouveau.modifiePar = matricule;
      let version = nomVersion();
      for (let n = 2; await env.DEPOTS.head(`${prefixeArchives('lieux')}${version}.json`); n++) version = `${nomVersion()}_${n}`;
      const cleArchive = `${prefixeArchives('lieux')}${version}.json`;
      await env.DEPOTS.put(cleArchive, brut, { httpMetadata: { contentType: 'application/json' } });
      const ecrit = await env.DEPOTS.put(CLE_LIEUX, JSON.stringify(nouveau), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: o.etag } });
      if (!ecrit) { await env.DEPOTS.delete(cleArchive); if (etagBase) throw new HttpError(409, 'Les zones ont changé pendant l\'écriture : rien n\'a été enregistré. Rouvrez l\'outil.'); continue; }
      await purgerArchives(env, 'lieux');
      return true;
    }
    throw new HttpError(409, 'Les zones sont modifiées en continu par d\'autres écritures ; réessayez dans un instant.');
  }

  /** Contrôle de forme d'un fichier de zones { lieux: { SLUG: { nom, ... } } } ; renvoie la liste des problèmes. */
  function controlerLieux(lieux) {
    if (!lieux || typeof lieux !== 'object' || Array.isArray(lieux)) return ['Les zones doivent former un objet { identifiant: zone }.'];
    const cles = Object.keys(lieux);
    if (cles.length > 1000) return ['Trop de zones (1000 au plus).'];
    const pb = [];
    for (const c of cles) {
      const z = lieux[c];
      if (!/^[A-Z0-9][A-Z0-9-]{0,79}$/.test(c)) pb.push(`Identifiant de zone invalide : ${c.slice(0, 40)}.`);
      else if (!z || typeof z !== 'object' || typeof z.nom !== 'string' || !z.nom.trim() || !Array.isArray(z.objets)) pb.push(`Zone ${c} : nom ou objets manquants.`);
      if (pb.length >= 5) break;
    }
    return pb;
  }

  const slugDe = (nom) => String(nom).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'ZONE';

  /**
   * Lot C, partie 2 : applique des déplacements préparés dans l'écran « Intégrer au shapefile ».
   *  - ajouts : identifiants (SLUG) de zones dessinées, encodées en Lambert 72 et ajoutées au shapefile ;
   *  - retraits : identifiants d'objets du shapefile, retirés du fichier.
   * Couche « polygones » (le vrai réseau) : les zones intégrées quittent les zones, les objets retirés y reviennent (avec leur P…) et les
   * attributs sont écrits dans ditp-diov (les entrées des objets retirés y restent).
   * Ordre : fichiers de la version, relecture, attributs, pointeur (If-Match), puis zones. Si l'écriture des zones échoue après la
   * bascule, la version reste valable et la réponse l'indique (zone « déjà au shapefile », jamais perdue).
   */
  /** Contrôle d'une zone avant son passage dans le shapefile. Renvoie { raison } (texte court, sans point final) ou { contenu, idGarde }. */
  function verifierZone(z, ctx) {
    if (typeof z.nom !== 'string' || !z.nom.trim()) return { raison: 'nom manquant' };
    if (typeof z.genre !== 'string' || !z.genre) return { raison: 'genre manquant' };
    const rec = Array.isArray(z.contour) ? trouverRecoupement(z.contour) : null;
    if (rec && rec.trop) return { raison: 'contour trop détaillé pour être contrôlé' };
    if (rec) return { raison: `le contour se recoupe lui-même, près du point ${rec.point}${z.contour.length > 1 ? ` de l'anneau ${rec.anneau}` : ''}` };
    let contenu;
    try { contenu = encoderContour(z.contour); } catch (err) { return { raison: `contour inutilisable (${err.message})` }; }
    const idGarde = typeof z.id_shapefile === 'string' && z.id_shapefile ? z.id_shapefile : null;
    if (idGarde) {
      if (!REGLES_ID[ctx.couche].test(idGarde) || nombreId(idGarde) >= (idGarde[0] === 'P' ? ctx.prochainP : ctx.prochainT)) return { raison: `l'identifiant ${idGarde} n'a jamais été attribué` };
      if (ctx.present.has(idGarde) && !ctx.retraits.includes(idGarde)) return { raison: `l'identifiant ${idGarde} est déjà dans le fichier` };
    }
    const jumeau = ctx.courant.objets.find((o) => !ctx.retraits.includes(o.id) && memesOctets(o.contenu, contenu));
    if (jumeau) return { raison: `même contour que ${jumeau.id}, déjà dans le fichier` };
    return { contenu, idGarde };
  }

  /** Contrôle zone par zone, sans rien écrire (↓ de l'écran « Intégrer au shapefile »). Corps : { ajouts: [slug], retraits: [id] }. */
  async function controlerZones(env, couche, d) {
    const cur = await lirePointeur(env, couche);
    if (!cur) throw new HttpError(409, 'Cette couche n\'est pas encore dans R2.');
    const ajouts = Array.isArray(d.ajouts) ? d.ajouts.map(String) : [];
    const retraits = Array.isArray(d.retraits) ? d.retraits.map(String) : [];
    if (!ajouts.length) throw new HttpError(400, 'Aucune zone à contrôler.');
    if (ajouts.length > 300 || retraits.length > 300) throw new HttpError(400, 'Trop de zones d\'un coup (300 au plus).');
    const lo = await env.DEPOTS.get(CLE_LIEUX);
    if (!lo) throw new HttpError(409, 'Les zones ne sont pas encore dans R2 : chargez-les d\'abord (Réglages > Stockage des données).');
    const zones = JSON.parse(await lo.text()).lieux || {};
    const courant = await lireJeuR2(env, couche, cur.pointeur.version);
    const present = new Set(courant.objets.map((o) => o.id));
    const prochainP = (await compteur(env, { action: 'etat' })).etat.identifiants.P;
    const prochainT = cur.pointeur.prochainT || 1;
    const vus = [];
    const resultats = ajouts.map((cle) => {
      const z = zones[cle];
      if (!z) return { cle, ok: false, raison: 'introuvable (modifiée ou supprimée depuis l\'ouverture de l\'écran)' };
      const v = verifierZone(z, { couche, courant, present, retraits, prochainP, prochainT });
      if (v.raison) return { cle, nom: z.nom, ok: false, raison: v.raison };
      const jumeau = vus.find((x) => memesOctets(x.contenu, v.contenu));
      if (jumeau) return { cle, nom: z.nom, ok: false, raison: `même contour que la zone « ${jumeau.nom} » cochée en même temps` };
      vus.push({ nom: z.nom, contenu: v.contenu });
      return { cle, nom: z.nom, ok: true };
    });
    return { status: 200, body: { resultats, versionCourante: cur.pointeur.version } };
  }

  async function appliquer(env, u, couche, d) {
    const cur = await lirePointeur(env, couche);
    if (!cur) throw new HttpError(409, 'Cette couche n\'est pas encore dans R2.');
    const ajouts = Array.isArray(d.ajouts) ? d.ajouts.map(String) : [];
    const retraits = Array.isArray(d.retraits) ? d.retraits.map(String) : [];
    if (!ajouts.length && !retraits.length) throw new HttpError(400, 'Rien à appliquer.');
    if (ajouts.length + retraits.length > 300) throw new HttpError(400, 'Trop de déplacements d\'un coup (300 au plus).');
    if (new Set(ajouts).size !== ajouts.length || new Set(retraits).size !== retraits.length) throw new HttpError(400, 'Déplacement en double.');
    const lo = await env.DEPOTS.get(CLE_LIEUX);
    if (!lo) throw new HttpError(409, 'Les zones ne sont pas encore dans R2 : chargez-les d\'abord (Réglages > Stockage des données).');
    const donneesLieux = JSON.parse(await lo.text());
    const zones = donneesLieux.lieux || {};
    const reel = couche === 'polygones';
    const prefixe = reel ? 'P' : 'T';
    const courant = await lireJeuR2(env, couche, cur.pointeur.version);
    const att = await lireAttributsR2(env);
    const prochainP = (await compteur(env, { action: 'etat' })).etat.identifiants.P;
    const prochainT = cur.pointeur.prochainT || 1;
    const present = new Set(courant.objets.map((o) => o.id));
    const erreurs = [];
    for (const id of retraits) if (!present.has(id)) erreurs.push(`${id} : n'est plus dans le fichier (il a changé depuis l'ouverture de l'écran).`);
    const prets = [];
    for (const cle of ajouts) {
      const z = zones[cle];
      if (!z) { erreurs.push(`Zone ${cle} : introuvable (modifiée ou supprimée depuis l'ouverture de l'écran).`); continue; }
      const v = verifierZone(z, { couche, courant, present, retraits, prochainP, prochainT });
      if (v.raison) { erreurs.push(`Zone « ${z.nom} » : ${v.raison}.`); continue; }
      const contenu = v.contenu; const idGarde = v.idGarde;
      const jumeau = prets.find((x) => memesOctets(x.contenu, contenu));
      if (jumeau) { erreurs.push(`Zone « ${z.nom} » : même contour que la zone « ${jumeau.z.nom} » appliquée en même temps.`); continue; }
      prets.push({ cle, z, contenu, id: idGarde });
    }
    const neufs = prets.filter((x) => !x.id);
    const resume = {
      ajouts: prets.map((x) => ({ cle: x.cle, nom: x.z.nom, id: x.id })), retraits, versionCourante: cur.pointeur.version,
      nouveaux: neufs.length, premierId: neufs.length ? idDe(prefixe, reel ? prochainP : prochainT) : null, dernierId: neufs.length ? idDe(prefixe, (reel ? prochainP : prochainT) + neufs.length - 1) : null,
      objetsApres: courant.objets.length - retraits.length + prets.length, touche: reel ? 'zones et attributs' : 'rien d\'autre que cette couche',
    };
    if (erreurs.length) return { status: 400, body: { erreur: 'Rien n\'a été enregistré.', erreurs, resume } };
    if (d.apercu) return { status: 200, body: { apercu: true, resume } };
    if (resume.objetsApres < 1) throw new HttpError(400, 'Le fichier ne peut pas devenir vide.');

    // ---- écriture
    let attribues = [];
    if (neufs.length) {
      attribues = reel ? (await compteur(env, { action: 'reserver', prefixe: 'P', n: neufs.length })).ids : neufs.map((_, i) => idDe('T', prochainT + i));
      neufs.forEach((x, i) => { x.id = attribues[i]; });
    }
    const retire = new Set(retraits);
    const gardes = courant.objets.filter((o) => !retire.has(o.id));
    const objets = [...gardes.map((o) => ({ id: o.id, contenu: o.contenu })), ...prets.map((x) => ({ id: x.id, contenu: x.contenu }))];
    const valeursZone = new Map(prets.map((x) => [x.id, { genre: x.z.genre, name_fr: x.z.nom, name_nl: x.z.name_nl, references: x.z.references, ids_externes: x.z.ids_externes }]));
    const lignes = objets.map((o) => {
      if (valeursZone.has(o.id)) { const v = valeursZone.get(o.id); return { id: o.id, genre: v.genre, nom_fr: v.name_fr, nom_nl: v.name_nl }; }
      const e = att['ditp-diov'].entites[o.id] || att['plans-patrimoine'].entites[o.id] || {};
      return { id: o.id, genre: e.genre, nom_fr: e.name_fr, nom_nl: e.name_nl };
    });
    const { shp, shx } = composerShpShx(objets.map((o) => o.contenu));
    const { dbf, coupes } = composerDbf(lignes);
    const version = await nomVersionLibre(env, couche);
    const anciens = new Map();
    for (const ext of ['prj', 'cpg']) {
      const o = await env.DEPOTS.get(cleFichier(couche, cur.pointeur.version, ext));
      anciens.set(ext, o ? new Uint8Array(await o.arrayBuffer()) : null);
    }
    if (!anciens.get('prj')) throw new HttpError(500, 'Le fichier .prj de la version courante est introuvable.');
    const contenu = { shp, shx, dbf, prj: anciens.get('prj'), cpg: new TextEncoder().encode('1252') };
    for (const ext of EXTENSIONS) await env.DEPOTS.put(cleFichier(couche, version, ext), contenu[ext], { httpMetadata: { contentType: TYPES[ext] } });
    try { const relu = await lireJeuR2(env, couche, version); if (relu.objets.length !== objets.length || relu.objets.some((o, i) => o.id !== objets[i].id)) throw new Error('relecture différente'); } catch (err) { await supprimerVersion(env, couche, version); throw new HttpError(500, 'La relecture de vérification a échoué : rien n\'a été enregistré.'); }
    if (reel && prets.length) {
      const valeurs = {};
      for (const [id, v] of valeursZone) { const o = {}; for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = x; valeurs[id] = o; }
      await ajouterEntrees(env, 'ditp-diov', prets.map((x) => x.id), u.matricule, valeurs);
    }
    const pointeur = { version, origine: cur.pointeur.origine || version, fichiers: EXTENSIONS, objets: objets.length, date: new Date().toISOString(), par: u.matricule, deposePar: null, source: 'application', prochainT: prefixe === 'T' ? prochainT + attribues.length : prochainT };
    const journal = { version, date: pointeur.date, par: u.matricule, deposePar: null, source: 'application', versionPrecedente: cur.pointeur.version, objets: objets.length, attribues, ajoutes: prets.map((x) => ({ cle: x.cle, nom: x.z.nom, id: x.id })), retires: retraits, valeursCoupees: coupes, zonesTouchees: reel };
    if (!(await basculer(env, couche, cur, pointeur, journal))) {
      await supprimerVersion(env, couche, version);
      throw new HttpError(409, 'Un autre enregistrement a eu lieu en même temps : rien n\'a été remplacé. Rouvrez l\'écran et recommencez.');
    }
    // ---- zones (vrai réseau seulement) : les zones intégrées partent, les objets retirés reviennent avec leur identifiant
    let zonesAJour = true; let avertissement = null;
    if (reel) {
      try {
        const rings = new Map(retraits.map((id) => [id, decoderContour(courant.objets.find((o) => o.id === id).contenu)]));
        await modifierLieux(env, u.matricule, (data) => {
          const lieux = { ...(data.lieux || {}) };
          for (const x of prets) delete lieux[x.cle];
          for (const id of retraits) {
            if (Object.values(lieux).some((z) => z.id_shapefile === id)) continue;
            const e = att['ditp-diov'].entites[id] || {};
            const nom = e.name_fr || e.name_nl || id;
            let slug = slugDe(nom); if (lieux[slug]) slug = `${slug}-${id}`.slice(0, 80);
            const lignesZone = rings.get(id);
            const z = { nom, name_nl: e.name_nl, references: e.references, genre: e.genre || 'autre', tolerance_m: 5, id_shapefile: id, ids_externes: e.ids_externes, objets: [{ id, couche: 'Shapefile', code: 'SHAPEFILE', type: 'Surface', lignes: lignesZone }], contour_methode: 'surfaces', contour: lignesZone };
            for (const k of Object.keys(z)) if (z[k] === undefined) delete z[k];
            lieux[slug] = z;
          }
          return { ...data, lieux };
        });
      } catch (err) {
        zonesAJour = false; avertissement = `La version du shapefile est enregistrée, mais les zones n'ont pas pu être mises à jour (${err.message}). Les zones intégrées restent visibles ; ne les intégrez pas une seconde fois.`;
        console.error('zones après application', err);
      }
    }
    return { status: 200, body: { version, objets: objets.length, attribues, ajoutes: prets.length, retires: retraits.length, valeursCoupees: coupes, zonesAJour, avertissement, etat: await etat(env) } };
  }

  return async function routeGeometries(request, env, url) {
    const p = url.pathname;
    if (!p.startsWith('/geometries/') && !p.startsWith('/attributs/')) return null;

    // ---- lecture : tout compte connecté
    if (request.method === 'GET') {
      await intervenantCourant(request, env);
      if (p === '/geometries/stockage') return { status: 200, body: await etat(env) };
      if (p === '/geometries/identifiants') {
        const e = (await compteur(env, { action: 'etat' })).etat;
        return { status: 200, body: { version: 3, prochain_id: e.identifiants.P, note: 'Copie du compteur P du serveur de dépôt.' } };
      }
      if (p === '/geometries/lieux') return servir(request, env, CLE_LIEUX, 'application/json; charset=utf-8');
      let m = /^\/attributs\/([a-z0-9-]+)$/.exec(p);
      if (m) {
        if (!ATTRIBUTS.includes(m[1])) throw new HttpError(404, 'Attributs inconnus.');
        return servir(request, env, cleAttributs(m[1]), 'application/json; charset=utf-8');
      }
      m = /^\/geometries\/shapefile\/([a-z]+)$/.exec(p);
      if (m) {
        if (!COUCHES.includes(m[1])) throw new HttpError(404, 'Couche inconnue.');
        const c = await lirePointeur(env, m[1]);
        if (!c) throw new HttpError(404, 'Cette couche n\'est pas encore dans R2.');
        return { status: 200, body: c.pointeur };
      }
      m = /^\/geometries\/shapefile\/([a-z]+)\/([a-z]{3})$/.exec(p);
      if (m) {
        const [, couche, ext] = m;
        if (!COUCHES.includes(couche) || !EXTENSIONS.includes(ext)) throw new HttpError(404, 'Fichier inconnu.');
        const c = await lirePointeur(env, couche);
        if (!c || !c.pointeur.fichiers.includes(ext)) throw new HttpError(404, 'Fichier absent de la version courante.');
        return servir(request, env, cleFichier(couche, c.pointeur.version, ext), TYPES[ext]);
      }
      m = /^\/geometries\/depots\/([a-z]+)$/.exec(p);
      if (m) {
        if (!COUCHES.includes(m[1])) throw new HttpError(404, 'Couche inconnue.');
        return { status: 200, body: { versions: await historique(env, m[1]) } };
      }
      m = /^\/geometries\/depots\/([a-z]+)\/(v\d{8}_\d{6}(?:_\d+)?)\/zip$/.exec(p);
      if (m) {
        if (!COUCHES.includes(m[1])) throw new HttpError(404, 'Couche inconnue.');
        return servir(request, env, cleZip(m[1], m[2]), 'application/zip');
      }
      return null;
    }

    // ---- zones dessinées (droit « plans »)
    if (request.method === 'POST' && (p === '/geometries/lieux/charger' || p === '/geometries/lieux')) {
      const u = await exigerDroit(request, env, 'plans');
      const d = await lireJson(request);
      const pb = controlerLieux(d.lieux);
      if (pb.length) throw new HttpError(400, pb.join(' '));
      if (p === '/geometries/lieux/charger') {
        if (await env.DEPOTS.head(CLE_LIEUX)) throw new HttpError(409, 'Les zones sont déjà dans R2 : le chargement initial n\'écrase rien.');
        const ok = await env.DEPOTS.put(CLE_LIEUX, JSON.stringify({ version: 1, crs: 'EPSG:31370', lieux: d.lieux, date: new Date().toISOString(), modifiePar: u.matricule }), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } });
        if (!ok) throw new HttpError(409, 'Un autre chargement a eu lieu en même temps. Rien n\'a été écrasé.');
        return { status: 200, body: await etat(env) };
      }
      if (typeof d.etagBase !== 'string' || !d.etagBase) throw new HttpError(400, 'Version de départ des zones manquante.');
      await modifierLieux(env, u.matricule, (data) => ({ ...data, version: 1, crs: 'EPSG:31370', lieux: d.lieux }), { etagBase: d.etagBase });
      return { status: 200, body: await etat(env) };
    }

    // ---- lot C : dépôt d'un shapefile modifié, restauration d'une ancienne version (droit « plans »)
    const mDep = /^\/geometries\/shapefile\/([a-z]+)\/(deposer|restaurer|appliquer|controler)$/.exec(p);
    if (request.method === 'POST' && mDep) {
      const u = await exigerDroit(request, env, 'plans');
      const [, couche, action] = mDep;
      if (!COUCHES.includes(couche)) throw new HttpError(404, 'Couche inconnue.');
      const d = await lireJson(request);
      if (action === 'appliquer') return appliquer(env, u, couche, d);
      if (action === 'controler') return controlerZones(env, couche, d);
      return action === 'deposer' ? deposer(env, u, couche, d) : restaurer(env, u, couche, d);
    }


    // ---- lot C : suppression d'entrées sans contour (droit « attributs »). Refusée pour tout identifiant encore présent dans le vrai shapefile.
    const mSup = /^\/attributs\/([a-z0-9-]+)\/supprimer$/.exec(p);
    if (request.method === 'POST' && mSup) {
      const u = await exigerDroit(request, env, 'attributs');
      const nom = mSup[1];
      if (!ATTRIBUTS.includes(nom)) throw new HttpError(404, 'Attributs inconnus.');
      const { ids } = await lireJson(request);
      if (!Array.isArray(ids) || !ids.length || ids.length > MAX_CHANGEMENTS || ids.some((x) => typeof x !== 'string')) throw new HttpError(400, `Entre 1 et ${MAX_CHANGEMENTS} identifiants attendus.`);
      const voulus = [...new Set(ids)];
      const cur = await lirePointeur(env, 'polygones');
      if (!cur) throw new HttpError(409, 'Le vrai shapefile n\'est pas dans R2 : impossible de savoir quelles entrées n\'ont plus de contour.');
      const dbf = await env.DEPOTS.get(cleFichier('polygones', cur.pointeur.version, 'dbf'));
      if (!dbf) throw new HttpError(500, 'Le .dbf du vrai shapefile est introuvable dans R2.');
      const presents = new Set(lireIdsDbf(new Uint8Array(await dbf.arrayBuffer())));
      const encore = voulus.filter((x) => presents.has(x));
      if (encore.length) return { status: 409, body: { erreur: 'Refusé : ces objets ont encore un contour dans le shapefile. Rien n\'a été supprimé.', conflits: encore.map((id) => ({ id, motif: 'a un contour dans le shapefile' })) } };
      for (let tentative = 0; tentative < 4; tentative++) {
        const o = await env.DEPOTS.get(cleAttributs(nom));
        if (!o) throw new HttpError(404, 'Ces attributs ne sont pas encore dans R2.');
        const brut = await o.text();
        let data;
        try { data = JSON.parse(brut); } catch (err) { throw new HttpError(500, 'Attributs illisibles dans R2.'); }
        const absents = voulus.filter((x) => !(data.entites || {})[x]);
        if (absents.length) return { status: 409, body: { erreur: 'Ces entrées n\'existent plus (déjà supprimées ?). Rien n\'a été supprimé.', conflits: absents.map((id) => ({ id, motif: 'n\'existe plus' })) } };
        for (const x of voulus) delete data.entites[x];
        data.date = new Date().toISOString();
        data.modifiePar = u.matricule;
        let version = nomVersion();
        for (let n = 2; await env.DEPOTS.head(`${prefixeArchives(nom)}${version}.json`); n++) version = `${nomVersion()}_${n}`;
        const cleArchive = `${prefixeArchives(nom)}${version}.json`;
        await env.DEPOTS.put(cleArchive, brut, { httpMetadata: { contentType: 'application/json' } });
        const ecrit = await env.DEPOTS.put(cleAttributs(nom), JSON.stringify(data), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: o.etag } });
        if (!ecrit) { await env.DEPOTS.delete(cleArchive); continue; }
        await purgerArchives(env, nom);
        return { status: 200, body: { supprimees: voulus.length, archive: version } };
      }
      throw new HttpError(409, 'Le fichier est modifié en continu par d\'autres écritures ; réessayez dans un instant.');
    }

    // ---- lot B : modification de lignes d'attributs (droit « attributs »)
    const mMod = /^\/attributs\/([a-z0-9-]+)\/modifier$/.exec(p);
    if (request.method === 'POST' && mMod) {
      const u = await exigerDroit(request, env, 'attributs');
      const nom = mMod[1];
      if (!ATTRIBUTS.includes(nom)) throw new HttpError(404, 'Attributs inconnus.');
      const { changements } = await lireJson(request);
      if (!Array.isArray(changements) || !changements.length || changements.length > MAX_CHANGEMENTS) throw new HttpError(400, `Entre 1 et ${MAX_CHANGEMENTS} lignes attendues.`);
      const demandes = [];
      const vus = new Set();
      for (const ch of changements) {
        if (!ch || typeof ch.id !== 'string' || !ch.avant || !ch.apres || typeof ch.avant !== 'object' || typeof ch.apres !== 'object') throw new HttpError(400, 'Chaque ligne demande { id, avant, apres }.');
        if (vus.has(ch.id)) throw new HttpError(400, `Ligne en double : ${ch.id}.`);
        vus.add(ch.id);
        const avant = {}; const apres = {};
        try {
          for (const [k, v] of Object.entries(ch.apres)) { if (!CHAMPS_MODIFIABLES.includes(k)) throw new Error(`Champ non modifiable : ${k}.`); apres[k] = champValide(k, v); }
          for (const [k, v] of Object.entries(ch.avant)) { if (!CHAMPS_MODIFIABLES.includes(k)) throw new Error(`Champ non modifiable : ${k}.`); avant[k] = v === undefined ? null : v; }
        } catch (err) { throw new HttpError(400, `${ch.id} : ${err.message}`); }
        demandes.push({ id: ch.id, avant, apres });
      }
      for (let tentative = 0; tentative < 4; tentative++) {
        const o = await env.DEPOTS.get(cleAttributs(nom));
        if (!o) throw new HttpError(404, 'Ces attributs ne sont pas encore dans R2.');
        const brut = await o.text();
        let data;
        try { data = JSON.parse(brut); } catch (err) { throw new HttpError(500, 'Attributs illisibles dans R2.'); }
        const conflits = [];
        for (const d of demandes) {
          const e = (data.entites || {})[d.id];
          if (!e) { conflits.push({ id: d.id, motif: 'n\'existe plus' }); continue; }
          for (const [k, v] of Object.entries(d.avant)) {
            if (JSON.stringify(e[k] === undefined ? null : e[k]) !== JSON.stringify(v)) { conflits.push({ id: d.id, motif: 'modifiée par quelqu\'un d\'autre' }); break; }
          }
        }
        if (conflits.length) return { status: 409, body: { erreur: 'Conflit : rien n\'a été enregistré. Rouvrez l\'écran pour voir les valeurs actuelles.', conflits } };
        for (const d of demandes) {
          const e = data.entites[d.id];
          for (const [k, v] of Object.entries(d.apres)) { if (v === null) delete e[k]; else e[k] = v; }
          delete e.noms; // ancien modèle (plusieurs noms), abandonné
        }
        data.date = new Date().toISOString();
        data.modifiePar = u.matricule;
        // Copie de l'ancienne version (nom unique même pour deux écritures dans la même seconde), puis écriture conditionnelle.
        let version = nomVersion();
        for (let n = 2; await env.DEPOTS.head(`${prefixeArchives(nom)}${version}.json`); n++) version = `${nomVersion()}_${n}`;
        const cleArchive = `${prefixeArchives(nom)}${version}.json`;
        await env.DEPOTS.put(cleArchive, brut, { httpMetadata: { contentType: 'application/json' } });
        const ecrit = await env.DEPOTS.put(cleAttributs(nom), JSON.stringify(data), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: o.etag } });
        if (!ecrit) { await env.DEPOTS.delete(cleArchive); continue; } // quelqu'un a écrit entre-temps : on relit et on recommence
        await purgerArchives(env, nom);
        return { status: 200, body: { modifiees: demandes.length, archive: version, etag: ecrit.httpEtag } };
      }
      throw new HttpError(409, 'Le fichier est modifié en continu par d\'autres écritures ; réessayez dans un instant.');
    }

    // ---- interrupteur de source : droit « plans »
    if (request.method === 'POST' && p === '/geometries/source') {
      const u = await exigerDroit(request, env, 'plans');
      const { source } = await lireJson(request);
      if (source !== 'depot' && source !== 'r2') throw new HttpError(400, 'Source attendue : « depot » ou « r2 ».');
      if (source === 'r2') {
        const manque = [];
        if (!(await lirePointeur(env, 'polygones'))) manque.push('le shapefile');
        for (const n of ATTRIBUTS) if (!(await nombreAttributs(env, n))) manque.push(`les attributs ${n}`);
        if (manque.length) throw new HttpError(409, `R2 ne peut pas être la source : il manque ${manque.join(', ')}. Chargez d'abord les données initiales.`);
      }
      await env.DEPOTS.put(SOURCE_KEY, JSON.stringify({ source, date: new Date().toISOString(), par: u.matricule }), { httpMetadata: { contentType: 'application/json' } });
      return { status: 200, body: await etat(env) };
    }

    // ---- chargement initial : droit « plans », refusé si la couche existe déjà
    if (request.method === 'POST' && p === '/geometries/charger') {
      const u = await exigerDroit(request, env, 'plans');
      const d = await lireJson(request);
      const couche = d.couche;
      if (!COUCHES.includes(couche)) throw new HttpError(400, 'Couche inconnue.');
      if (await lirePointeur(env, couche)) throw new HttpError(409, `La couche « ${couche} » est déjà dans R2 : le chargement initial n'écrase rien.`);
      const f = {};
      for (const ext of EXTENSIONS) {
        if (d.fichiers && d.fichiers[ext] !== undefined) f[ext] = deBase64(d.fichiers[ext], ext);
        else if (OBLIGATOIRES.includes(ext)) throw new HttpError(400, `Fichier .${ext} manquant.`);
      }
      let verif;
      try { verif = verifierShapefile(f); } catch (err) { throw new HttpError(400, err.message); }
      // Attributs facultatifs ; chacun doit avoir la forme { version, entites }. Refus si R2 en contient déjà.
      const attributs = {};
      for (const [nom, contenu] of Object.entries(d.attributs || {})) {
        if (!ATTRIBUTS.includes(nom)) throw new HttpError(400, `Attributs inconnus : ${nom}.`);
        if (!contenu || typeof contenu !== 'object' || typeof contenu.entites !== 'object') throw new HttpError(400, `Attributs ${nom} : format attendu { version, entites }.`);
        if (await nombreAttributs(env, nom)) throw new HttpError(409, `Les attributs ${nom} sont déjà dans R2 : le chargement initial n'écrase rien.`);
        attributs[nom] = contenu;
      }
      // Le compteur P du serveur ne doit pas être en retard sur celui du dépôt (sinon un P… déjà utilisé pourrait être réattribué).
      if (d.prochainId !== undefined && couche === 'polygones') {
        const serveur = (await compteur(env, { action: 'etat' })).etat.identifiants.P;
        if (!Number.isInteger(d.prochainId)) throw new HttpError(400, 'prochainId invalide.');
        if (serveur < d.prochainId) throw new HttpError(409, `Le compteur P du serveur (${serveur}) est en retard sur celui du dépôt (${d.prochainId}). Rien n'a été chargé.`);
      }
      const version = nomVersion();
      // 1) fichiers de la version, 2) attributs, 3) pointeur en dernier : sans pointeur, rien n'est visible.
      for (const ext of Object.keys(f)) await env.DEPOTS.put(cleFichier(couche, version, ext), f[ext], { httpMetadata: { contentType: TYPES[ext] } });
      for (const [nom, contenu] of Object.entries(attributs)) {
        await env.DEPOTS.put(cleAttributs(nom), JSON.stringify(contenu), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } });
      }
      const pointeur = { version, origine: version, fichiers: Object.keys(f), objets: verif.objets, date: new Date().toISOString(), par: u.matricule };
      const ok = await env.DEPOTS.put(cleCourant(couche), JSON.stringify(pointeur), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } });
      if (!ok) throw new HttpError(409, 'Un autre chargement a eu lieu en même temps. Rien n\'a été écrasé ; rouvrez l\'écran.');
      return { status: 200, body: await etat(env) };
    }
    return null;
  };
}
