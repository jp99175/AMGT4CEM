/**
 * Serveur de dépôt des signalements (Cloudflare Worker + R2 + Durable Object).
 *
 * Reçoit l'archive ZIP d'un signalement envoyée par SIG4CEM (src/signal/), lui attribue sa référence
 * officielle AAAA-NNNN et la range dans R2. Gère aussi les intervenants : référentiel (R2, jamais dans le dépôt
 * public), connexion, première connexion (code d'activation), administration. DISTINCT de workers/relay/ : le relais
 * écrit dans le dépôt GitHub (public), ce serveur-ci ne touche jamais au dépôt.
 *
 * Routes (JSON ; sauf /depot : corps ZIP) :
 *   POST /auth/login          { matricule, motdepasse }                    -> { jeton, expire, utilisateur }
 *   POST /auth/activer        { matricule, code, motdepasse }              -> idem (première connexion)
 *   GET  /auth/moi            (jeton)                                      -> { utilisateur }
 *   POST /auth/motdepasse     (jeton) { ancien, nouveau }                  -> { ok: true }
 *   GET  /signalements       (jeton)  -> { date, signalements:[…] } index lu par la carte
 *   GET  /signalements/AAAA-NNNN/couverture (jeton) photo de couverture (JPEG) pour le pop-up de la carte
 *   POST /signalements/AAAA-NNNN/supprimer (jeton ; rédacteur ou droit utilisateurs) retire l'entrée de l'index (archive conservée)
 *   GET  /sante               (jeton)                                      -> { ok: true, utilisateur }
 *   POST /depot               (jeton) corps ZIP ; X-Signalement-Id, X-Flux, X-Fichier
 *                                                                          -> { reference, deja, recuLe }
 *   GET  /admin/intervenants  (jeton ; droit utilisateurs)                                -> { intervenants: [...] }
 *   POST /admin/intervenants  (jeton ; droit utilisateurs) { fiche }                      -> { intervenant, codeActivation? }
 *   POST /admin/activation    (jeton ; droit utilisateurs) { matricule }                  -> { intervenant, codeActivation }
 *   POST /admin/amorcer       { code, intervenant }  premier compte admin, une seule fois (secret ADMIN_BOOTSTRAP_CODE)
 *
 *   GET|PUT /admin/securite   (jeton ; droit utilisateurs)  nombre de tours PBKDF2, délai croissant après échec
 *   GET  /admin/connexions-interrompues (jeton ; droit utilisateurs)  opérations coupées (erreur 1102) sur 24 h et 7 jours
 *   GET  /admin/compteurs     (jeton ; droit utilisateurs ou plans)          -> état des compteurs (copie de compteurs.json)
 *   GET|POST /admin/effacer-essai (jeton ; droit utilisateurs)  aperçu / effacement par lots (confirmation « ESSAI ») de tout ce qui reste de la couche d'essai ; ne touche pas à polygones
 *   GET|POST /admin/remise-a-zero (jeton ; droit utilisateurs)  aperçu / effacement par lots (confirmation « EFFACER ») des fiches et de l'ancien rangement ; `finale` : références à zéro et numéro de remise à zéro + 1
 *   GET|POST /admin/sauvegardes (jeton ; droit utilisateurs)  aperçu / application (confirmation « APPLIQUER ») de la politique de sauvegarde sur les archives et versions existantes
 *   GET  /admin/arborescence?suite=…  (jeton ; droit utilisateurs)  -> { objets: [{ cle, taille, date }], suite } : liste du bucket, 1000 objets par page, lecture seule
 *
 * Jeton : « Authorization: Bearer … », signé (HMAC, secret SESSION_SECRET), valable 30 jours ; l'existence, l'état
 * actif et les DROITS de l'intervenant sont revérifiés dans le référentiel à chaque appel (désactiver un agent ou lui
 * retirer un droit prend effet tout de suite).
 *
 * Droits (liste `droits` de chaque fiche ; remplace l'ancien booléen `admin`, converti à la première écriture) :
 *   utilisateurs  comptes, codes d'activation, sécurité, suppression des entrées des autres, purge ;
 *   attributs     attributs des polygones et lignes, étiquettes, repères ;
 *   plans         shapefile, plans, scans, données publiques (vérifier / forcer) ;
 *   vocabulaire   listes de choix.
 * Garde-fous : on ne retire pas son propre droit `utilisateurs` (ni ne se désactive) ; il reste toujours un compte
 * actif qui le détient.
 *
 * Référentiel : R2 `referentiel/intervenants.json`. Le mot de passe n'y est jamais en clair : PBKDF2-SHA-256 avec un
 * sel propre à chaque intervenant. L'administrateur ne le connaît jamais : il génère un code d'activation (valable
 * 7 jours, stocké haché), l'agent choisit son mot de passe en l'utilisant.
 *
 * Compteurs : Durable Object `Compteur` (une seule instance, « references ») : les demandes y passent une par une,
 * deux envois simultanés ne reçoivent jamais le même numéro.
 *   - références AAAA-NNNN par flux et par année (année de Bruxelles). Idempotent : renvoyer la même entrée (même
 *     X-Signalement-Id) redonne la même référence, sans doublon ni numéro perdu. Tant que les entrées des deux flux
 *     sont rangées dans le même dossier R2, elles partagent la série « commun » (séparation à l'étape des fiches) ;
 *   - identifiants des géométries P (polygones.shp), L (lignes.shp), G (objets de l'application) : réservation d'un
 *     bloc, jamais de réutilisation ; prochains numéros au départ : P 193, L 1, G 193.
 * Après chaque attribution, une copie lisible est écrite dans R2 : prive/referentiels/compteurs.json (consultation et
 * sauvegarde ; la référence reste le Durable Object).
 * Rangement R2 : <flux>/<année>/<référence>/depot.zip et recu.json (le rédacteur authentifié y est inscrit).
 *
 * Transition : tant qu'aucun intervenant n'a activé son compte, l'ancien code partagé (secret DEPOT_CODE, en-tête
 * X-Depot-Code) reste accepté pour /depot et /sante. Dès le premier compte activé, il ne sert plus.
 */

import { creerRoutesGeometries, cleCourant, prefixeVersions, prefixeDepots, planSauvegardes, CONSERVATION } from './geometries.js';

const MAX_BYTES = 30 * 1024 * 1024;
const REF_KEY = 'referentiel/intervenants.json';
const TOKEN_TTL_S = 30 * 24 * 3600;
const ACTIVATION_TTL_MS = 7 * 24 * 3600 * 1000;
const SECURITE_KEY = 'prive/referentiels/securite.json';
const JOURNAL_CONNEXIONS = 'journal/connexions/';
// Paramètres de sécurité par défaut (modifiables dans la page Sécurité, droit utilisateurs).
const SECURITE_DEFAUT = { tours: 100000, delaiBaseS: 5, delaiPlafondS: 900, fenetreMin: 30 };
const TOURS_MIN = 10000;
const TOURS_MAX = 100000; // plafond de PBKDF2 dans Workers
const MDP_MIN = 8;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1 : lisible au téléphone

const DROITS = ['utilisateurs', 'attributs', 'plans', 'vocabulaire'];
const PREFIXES = { P: 193, L: 1, G: 193 }; // prochain numéro au départ (P et G : après la migration G→P du 16/10)
const COMPTEURS_KEY = 'prive/referentiels/compteurs.json';

export class Compteur {
  constructor(state) {
    this.state = state;
  }

  /** État lisible : { version, identifiants: {P, L, G} (prochains), references: {flux: {annee: prochain}} }. */
  async etat() {
    const e = (await this.state.storage.get('etat')) || { version: 1, identifiants: {}, references: {} };
    if (!Number.isInteger(e.epoque)) e.epoque = 0; // numéro de remise à zéro : chaque remise à zéro l'augmente de 1
    for (const [p, depart] of Object.entries(PREFIXES)) if (!e.identifiants[p]) e.identifiants[p] = depart;
    return e;
  }

  async fetch(request) {
    const demande = await request.json();
    const action = demande.action || 'reference'; // ancien appel { id, annee } : une référence
    const e = await this.etat();

    if (action === 'etat') return Response.json({ etat: e });

    // Remise à zéro des références de fiches (AAAA-NNNN) et des mémoires d'envoi ; les identifiants P, L, G ne bougent pas.
    if (action === 'raz-references') {
      const aEffacer = [];
      for (const prefix of ['refid:', 'id:', 'n:']) for (const k of (await this.state.storage.list({ prefix })).keys()) aEffacer.push(k);
      for (let i = 0; i < aEffacer.length; i += 128) await this.state.storage.delete(aEffacer.slice(i, i + 128));
      e.references = {};
      e.epoque += 1;
      e.date = new Date().toISOString();
      e.derniereRemiseAZero = { le: e.date, par: String(demande.par || '') };
      await this.state.storage.put({ etat: e });
      return Response.json({ etat: e, effaces: aEffacer.length });
    }

    if (action === 'reference') {
      const { id, annee } = demande;
      const flux = demande.flux || 'commun';
      const connue = (await this.state.storage.get(`refid:${flux}:${id}`)) || (flux === 'commun' ? await this.state.storage.get(`id:${id}`) : null);
      if (connue) return Response.json({ reference: connue, deja: true, etat: e });
      const serie = (e.references[flux] = e.references[flux] || {});
      // Série « commun » : reprend l'ancien compteur (n:AAAA = dernier numéro attribué) s'il existe.
      const prochain = serie[annee] || (flux === 'commun' ? ((await this.state.storage.get(`n:${annee}`)) || 0) + 1 : 1);
      const reference = `${annee}-${String(prochain).padStart(4, '0')}`;
      serie[annee] = prochain + 1;
      e.date = new Date().toISOString();
      await this.state.storage.put({ etat: e, [`refid:${flux}:${id}`]: reference });
      return Response.json({ reference, deja: false, etat: e });
    }

    if (action === 'reserver') {
      const { prefixe } = demande;
      const n = Number(demande.n);
      if (!PREFIXES[prefixe]) return Response.json({ erreur: 'Préfixe inconnu.' }, { status: 400 });
      if (!Number.isInteger(n) || n < 1 || n > 10000) return Response.json({ erreur: 'Nombre invalide (1 à 10 000).' }, { status: 400 });
      const debut = e.identifiants[prefixe];
      e.identifiants[prefixe] = debut + n;
      e.date = new Date().toISOString();
      await this.state.storage.put({ etat: e });
      const id = (k) => `${prefixe}${String(k).padStart(6, '0')}`;
      return Response.json({ premier: id(debut), dernier: id(debut + n - 1), ids: Array.from({ length: n }, (_, i) => id(debut + i)), etat: e });
    }
    return Response.json({ erreur: 'Action inconnue.' }, { status: 400 });
  }
}

/** Appel du Durable Object des compteurs ; écrit ensuite la copie lisible dans R2 (un échec de copie ne bloque rien). */
async function compteur(env, demande) {
  const stub = env.COMPTEUR.get(env.COMPTEUR.idFromName('references'));
  const r = await stub.fetch('https://compteur/', { method: 'POST', body: JSON.stringify(demande) });
  const out = await r.json();
  if (!r.ok) throw new HttpError(r.status, out.erreur || 'Compteur indisponible.');
  if (demande.action !== 'etat' && !out.deja && out.etat) {
    try {
      await env.DEPOTS.put(COMPTEURS_KEY, JSON.stringify({ ...out.etat, note: 'Copie lisible : la référence est le Durable Object Compteur du serveur de dépôt.' }, null, 2), { httpMetadata: { contentType: 'application/json' } });
    } catch (err) { console.error('copie compteurs', err); }
  }
  return out;
}

// ------------------------------------------------------------------ réponses et CORS
function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, X-Depot-Code, X-Signalement-Id, X-Flux, X-Fichier, X-Epoque, Content-Type, If-Match, If-None-Match',
    'Access-Control-Expose-Headers': 'ETag',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function reply(request, env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(request, env) },
  });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ------------------------------------------------------------------ cryptographie
const enc = new TextEncoder();

function b64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64u(text) {
  const s = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sameSecret(a, b) {
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return sameBytes(new Uint8Array(ha), new Uint8Array(hb));
}

// ------------------------------------------------------------------ paramètres de sécurité (R2, mémorisés 1 min)
let securiteMemo = null; // { valeur, lu }

async function securite(env) {
  if (securiteMemo && Date.now() - securiteMemo.lu < 60000) return securiteMemo.valeur;
  let lu = {};
  try { const o = await env.DEPOTS.get(SECURITE_KEY); if (o) lu = await o.json(); } catch (err) { console.error('securite.json', err); }
  const valeur = { ...SECURITE_DEFAUT, ...lu };
  securiteMemo = { valeur, lu: Date.now() };
  return valeur;
}

/** Nombre de tours pour une NOUVELLE empreinte (chaque empreinte garde le sien) : réglage, sinon PBKDF2_ITER, sinon 100 000. */
async function iterations(env) {
  const test = Number(env.PBKDF2_ITER); // essais locaux uniquement
  if (Number.isFinite(test) && test >= 1000 && test <= TOURS_MAX) return Math.floor(test);
  const n = Number((await securite(env)).tours);
  return Number.isFinite(n) && n >= TOURS_MIN && n <= TOURS_MAX ? Math.floor(n) : SECURITE_DEFAUT.tours;
}

async function pbkdf2(secret, saltBytes, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: iter }, key, 256));
}

/** { s: sel, i: itérations, h: empreinte } */
async function hacher(secret, env) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iter = await iterations(env);
  return { s: b64u(salt), i: iter, h: b64u(await pbkdf2(secret, salt, iter)) };
}

async function verifierHash(secret, rec) {
  if (!rec || !rec.h) return false;
  return sameBytes(await pbkdf2(secret, unb64u(rec.s), rec.i), unb64u(rec.h));
}

function codeActivation() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

function normCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function hmac(env, data) {
  if (!env.SESSION_SECRET) throw new HttpError(500, "SESSION_SECRET n'est pas défini sur le serveur (Worker > Settings > Variables and Secrets).");
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

async function creerJeton(env, matricule) {
  const e = Math.floor(Date.now() / 1000) + TOKEN_TTL_S;
  const payload = b64u(enc.encode(JSON.stringify({ m: matricule, e })));
  return { jeton: `${payload}.${b64u(await hmac(env, payload))}`, expire: new Date(e * 1000).toISOString() };
}

async function lireJeton(env, header) {
  const m = /^Bearer\s+(\S+)$/.exec(header || '');
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  if (!sameBytes(await hmac(env, payload), unb64u(sig))) return null;
  let data;
  try { data = JSON.parse(new TextDecoder().decode(unb64u(payload))); } catch (err) { return null; }
  if (!data || !data.m || !(data.e > Date.now() / 1000)) return null;
  return data.m;
}

// ------------------------------------------------------------------ référentiel des intervenants (R2)
function referentielVide() {
  return { version: 1, date: new Date().toISOString(), intervenants: [] };
}

async function chargerRef(env) {
  const obj = await env.DEPOTS.get(REF_KEY);
  if (!obj) return { ref: referentielVide(), etag: null };
  return { ref: await obj.json(), etag: obj.etag };
}

/** Droits d'une fiche : liste `droits` ; ancienne fiche (booléen `admin`) : les quatre droits si admin. */
function droitsDe(u) {
  if (Array.isArray(u.droits)) return DROITS.filter((d) => u.droits.includes(d));
  return u.admin ? [...DROITS] : [];
}

function aDroit(u, droit) {
  return droitsDe(u).includes(droit);
}

/** Lecture, modification, écriture conditionnelle (ETag) : deux écritures simultanées ne s'écrasent pas. */
async function modifierRef(env, mutation) {
  for (let essai = 0; essai < 5; essai++) {
    const { ref, etag } = await chargerRef(env);
    const resultat = await mutation(ref);
    // Conversion des anciennes fiches (admin -> droits), faite à la première écriture du référentiel.
    for (const u of ref.intervenants) { u.droits = droitsDe(u); delete u.admin; }
    ref.version = Math.max(2, ref.version || 1);
    ref.date = new Date().toISOString();
    const onlyIf = etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' };
    const ecrit = await env.DEPOTS.put(REF_KEY, JSON.stringify(ref, null, 2), { onlyIf, httpMetadata: { contentType: 'application/json' } });
    if (ecrit) return resultat;
  }
  throw new HttpError(503, 'Référentiel occupé, réessayez.');
}

function normMatricule(m) {
  const v = String(m || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,20}$/.test(v)) throw new HttpError(400, 'Matricule invalide (2 à 20 caractères : lettres, chiffres, - ou _).');
  return v;
}

function normGsm(g) {
  const brut = String(g || '').replace(/[\s.\-/()]/g, '');
  if (!brut) return '';
  let n = brut;
  if (n.startsWith('00')) n = `+${n.slice(2)}`;
  else if (n.startsWith('0')) n = `+32${n.slice(1)}`;
  if (!/^\+32\d{8,9}$/.test(n)) throw new HttpError(400, 'GSM invalide : format attendu +32xxxxxxxxx.');
  return n;
}

function texte(v, max, nom, obligatoire) {
  const s = String(v == null ? '' : v).trim();
  if (obligatoire && !s) throw new HttpError(400, `Champ obligatoire : ${nom}.`);
  if (s.length > max) throw new HttpError(400, `Champ trop long : ${nom}.`);
  return s;
}

/** Trigramme (initiales servant aux noms de fichiers) : 2 ou 3 lettres A-Z, sans accent ; vide = pas encore attribué. */
function normTrigramme(v) {
  const t = String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  if (t && !/^[A-Z]{2,3}$/.test(t)) throw new HttpError(400, 'Trigramme invalide : 2 ou 3 lettres, sans chiffre ni accent.');
  return t;
}

/** Fiche reçue de la page admin -> champs validés (jamais le hash, ni l'activation). */
function validerFiche(f) {
  if (!f || typeof f !== 'object') throw new HttpError(400, 'Fiche manquante.');
  const email = texte(f.email, 120, 'email', true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Email invalide.');
  return {
    matricule: normMatricule(f.matricule),
    prenom: texte(f.prenom, 60, 'prénom', true),
    nom: texte(f.nom, 60, 'nom', true),
    gsm: normGsm(f.gsm),
    email,
    organisation: texte(f.organisation, 60, 'organisation', false),
    division: texte(f.division, 60, 'division', false),
    departement: texte(f.departement, 60, 'département', false),
    service: texte(f.service, 60, 'service', false),
    // Trigramme : absent de la fiche (ancienne page) = on garde celui qui existe.
    ...(f.trigramme === undefined ? {} : { trigramme: normTrigramme(f.trigramme) }),
    // Droits cochés ; ancienne page d'administration (case « admin ») : les quatre droits.
    droits: Array.isArray(f.droits) ? DROITS.filter((d) => f.droits.includes(d)) : (f.admin === true ? [...DROITS] : []),
    actif: f.actif !== false,
  };
}

/** Ce qui sort du serveur : jamais le hash ni le code d'activation. */
function vue(u) {
  return {
    matricule: u.matricule, prenom: u.prenom, nom: u.nom, gsm: u.gsm, email: u.email,
    organisation: u.organisation, division: u.division, departement: u.departement, service: u.service,
    trigramme: u.trigramme || '',
    droits: droitsDe(u), admin: aDroit(u, 'utilisateurs'), actif: u.actif !== false, // admin : compatibilité des anciennes pages
    motDePasseDefini: !!u.hash,
    activationExpire: u.activation ? u.activation.expire : null,
    creeLe: u.creeLe, modifieLe: u.modifieLe,
  };
}

async function nouvelleActivation(env) {
  const code = codeActivation();
  const h = await hacher(normCode(code), env);
  return { code, activation: { ...h, expire: new Date(Date.now() + ACTIVATION_TTL_MS).toISOString() } };
}

function mdpValide(mdp, matricule) {
  if (typeof mdp !== 'string' || mdp.length < MDP_MIN) throw new HttpError(400, `Mot de passe trop court (${MDP_MIN} caractères au moins).`);
  if (mdp.length > 200) throw new HttpError(400, 'Mot de passe trop long.');
  if (mdp.toUpperCase() === matricule) throw new HttpError(400, 'Le mot de passe ne peut pas être le matricule.');
}

const ECHEC = 'Matricule ou mot de passe incorrect.';

/**
 * Décompte des échecs avec délai croissant : après chaque échec, nouvel essai possible seulement après un délai qui
 * double (base, 2×, 4×… jusqu'au plafond). Le compte repart de zéro quand aucun échec n'a eu lieu pendant la fenêtre
 * (mesurée depuis le DERNIER échec : une suite d'essais espacés ne remet jamais le délai à sa base). À appeler dans modifierRef.
 */
function noterEchec(u, sec) {
  const now = Date.now();
  if (!u.dernierEchecLe || now - new Date(u.dernierEchecLe).getTime() > sec.fenetreMin * 60000) u.echecs = 0;
  u.dernierEchecLe = new Date(now).toISOString();
  delete u.premierEchecLe;
  u.echecs = (u.echecs || 0) + 1;
  const delaiS = Math.min(sec.delaiPlafondS, sec.delaiBaseS * 2 ** (u.echecs - 1));
  u.bloqueJusqua = new Date(now + delaiS * 1000).toISOString();
}

function effacerEchecs(u) {
  u.echecs = 0;
  u.dernierEchecLe = null;
  u.bloqueJusqua = null;
}

function attente(ms) {
  const s = Math.ceil(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.ceil(s / 60)} min`;
}

function verifierBlocage(u) {
  const reste = u.bloqueJusqua ? new Date(u.bloqueJusqua).getTime() - Date.now() : 0;
  if (reste > 0) throw new HttpError(429, `Trop d’essais : réessayez dans ${attente(reste)}.`);
}

// ------------------------------------------------------------------ authentification des appels
/** @returns {Promise<object>} l'intervenant (fiche complète) ; lève 401 sinon. */
async function intervenantCourant(request, env) {
  const matricule = await lireJeton(env, request.headers.get('Authorization'));
  if (!matricule) throw new HttpError(401, 'Connexion requise.');
  const { ref } = await chargerRef(env);
  const u = ref.intervenants.find((x) => x.matricule === matricule);
  if (!u || u.actif === false || !u.hash) throw new HttpError(401, 'Compte inactif ou inconnu.');
  return u;
}

const LIBELLE_DROIT = { utilisateurs: 'gestion des utilisateurs', attributs: 'attributs', plans: 'plans', vocabulaire: 'vocabulaire' };

/** Intervenant courant, s'il détient l'un des droits demandés ; 403 sinon. */
async function exigerDroit(request, env, ...droits) {
  const u = await intervenantCourant(request, env);
  if (!droits.some((d) => aDroit(u, d))) throw new HttpError(403, `Droit requis : ${droits.map((d) => LIBELLE_DROIT[d]).join(' ou ')}.`);
  return u;
}

/** Repli transitoire : ancien code partagé, accepté tant qu'aucun compte n'est activé. */
async function repliCodePartage(request, env) {
  const code = request.headers.get('X-Depot-Code') || '';
  if (!env.DEPOT_CODE || !code) return false;
  const { ref } = await chargerRef(env);
  if (ref.intervenants.some((u) => u.hash)) return false;
  return sameSecret(code, env.DEPOT_CODE);
}

/** Au moins un compte actif doit garder le droit `utilisateurs` (compte activé, ou activation en attente). */
function verifierAdminRestant(ref) {
  if (!ref.intervenants.some((u) => aDroit(u, 'utilisateurs') && u.actif !== false && (u.hash || u.activation))) {
    throw new HttpError(409, 'Il doit rester au moins un compte actif avec le droit « gestion des utilisateurs ».');
  }
}

// ------------------------------------------------------------------ suivi des opérations interrompues (erreur 1102)
// Une connexion, une activation ou un changement de mot de passe calcule une empreinte coûteuse (PBKDF2). Si Cloudflare
// coupe la demande pour dépassement du temps de calcul (erreur 1102), rien ne s'exécute après : la note de début déposée
// ici n'est donc jamais effacée. Une note de plus d'une minute signale une opération interrompue.
const OPERATIONS_SUIVIES = { '/auth/login': 'connexion', '/auth/activer': 'activation', '/auth/motdepasse': 'mot de passe' };

function jourBruxelles(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, '');
}

async function noterDebut(request, env, operation) {
  let matricule = null;
  try { matricule = String((await request.clone().json()).matricule || '').trim().toUpperCase().slice(0, 20) || null; } catch (err) { /* corps illisible : la route le refusera */ }
  if (!matricule) { try { matricule = await lireJeton(env, request.headers.get('Authorization')); } catch (err) { matricule = null; } }
  const cle = `${JOURNAL_CONNEXIONS}${jourBruxelles(new Date())}/${crypto.randomUUID()}.debut`;
  try {
    await env.DEPOTS.put(cle, JSON.stringify({ operation, matricule, debut: new Date().toISOString(), tours: await iterations(env) }), { httpMetadata: { contentType: 'application/json' } });
    return cle;
  } catch (err) { console.error('journal', err); return null; }
}

/** Nombre de tours des empreintes existantes (chaque compte garde le sien jusqu'au prochain changement de mot de passe). */
async function toursDesComptes(env) {
  const { ref } = await chargerRef(env);
  const parTours = {};
  for (const u of ref.intervenants) if (u.hash && u.hash.i) parTours[u.hash.i] = (parTours[u.hash.i] || 0) + 1;
  return parTours;
}

async function connexionsInterrompues(env) {
  const now = Date.now();
  const notes = [];
  let curseur;
  do {
    const page = await env.DEPOTS.list({ prefix: JOURNAL_CONNEXIONS, cursor: curseur });
    for (const o of page.objects) notes.push(o.key);
    curseur = page.truncated ? page.cursor : undefined;
  } while (curseur);
  const interrompues = [];
  for (const cle of notes) {
    const o = await env.DEPOTS.get(cle);
    if (!o) continue;
    let n = {};
    try { n = await o.json(); } catch (err) { n = {}; }
    const t = new Date(n.debut || 0).getTime();
    if (now - t > 7 * 86400000) { await env.DEPOTS.delete(cle); continue; } // purge à 7 jours
    if (now - t > 60000) interrompues.push(n);
  }
  interrompues.sort((a, b) => String(b.debut).localeCompare(String(a.debut)));
  const depuis = (ms) => interrompues.filter((n) => now - new Date(n.debut).getTime() <= ms).length;
  return { h24: depuis(86400000), j7: interrompues.length, derniere: interrompues[0] || null, liste: interrompues.slice(0, 20) };
}

// ------------------------------------------------------------------ routes
async function lireJson(request) {
  try { return await request.json(); } catch (err) { throw new HttpError(400, 'Corps JSON invalide.'); }
}

// Géométries et attributs dans R2 (workers/depot/geometries.js) : mêmes outils d'authentification que le reste du serveur.
const routeGeometries = creerRoutesGeometries({ HttpError, intervenantCourant, exigerDroit, compteur, lireJson });

async function routeAuth(request, env, url) {
  const p = url.pathname;
  if (request.method === 'POST' && p === '/auth/login') {
    const { matricule: mRaw, motdepasse } = await lireJson(request);
    const matricule = normMatricule(mRaw);
    const mdp = String(motdepasse || '');
    const { ref } = await chargerRef(env);
    const u = ref.intervenants.find((x) => x.matricule === matricule);
    if (!u || u.actif === false || !u.hash) {
      await pbkdf2(mdp, new Uint8Array(16), await iterations(env)); // même durée qu'un vrai essai : ne révèle pas si le matricule existe
      throw new HttpError(401, ECHEC);
    }
    verifierBlocage(u);
    if (!(await verifierHash(mdp, u.hash))) {
      const sec = await securite(env);
      await modifierRef(env, async (r) => { const c = r.intervenants.find((x) => x.matricule === matricule); if (c) noterEchec(c, sec); });
      throw new HttpError(401, ECHEC);
    }
    if (u.echecs || u.bloqueJusqua) {
      await modifierRef(env, async (r) => { const c = r.intervenants.find((x) => x.matricule === matricule); if (c) effacerEchecs(c); });
    }
    return { status: 200, body: { ...(await creerJeton(env, u.matricule)), utilisateur: vue(u), epoque: await epoqueActuelle(env) } };
  }

  if (request.method === 'POST' && p === '/auth/activer') {
    const { matricule: mRaw, code, motdepasse } = await lireJson(request);
    const matricule = normMatricule(mRaw);
    mdpValide(motdepasse, matricule);
    const MAUVAIS = "Matricule ou code d'activation incorrect.";
    const { ref } = await chargerRef(env);
    // Tout premier compte : référentiel vide + secret d'amorçage utilisé comme code d'activation -> administrateur.
    if (!ref.intervenants.length && env.ADMIN_BOOTSTRAP_CODE && code && (await sameSecret(String(code), env.ADMIN_BOOTSTRAP_CODE))) {
      const hash0 = await hacher(motdepasse, env);
      const u = await modifierRef(env, async (r) => {
        if (r.intervenants.length) throw new HttpError(409, 'Le référentiel existe déjà : amorçage impossible.');
        const now = new Date().toISOString();
        const c = { matricule, prenom: '', nom: '', gsm: '', email: '', organisation: 'BM', division: 'DITP', departement: 'AMGT', service: 'CEM', droits: [...DROITS], actif: true, hash: hash0, activation: null, creeLe: now, modifieLe: now };
        r.intervenants.push(c);
        return c;
      });
      return { status: 200, body: { ...(await creerJeton(env, u.matricule)), utilisateur: vue(u), epoque: await epoqueActuelle(env) } };
    }
    const u0 = ref.intervenants.find((x) => x.matricule === matricule);
    if (!u0 || u0.actif === false || !u0.activation) {
      await pbkdf2(String(code || ''), new Uint8Array(16), await iterations(env));
      throw new HttpError(401, MAUVAIS);
    }
    verifierBlocage(u0);
    if (new Date(u0.activation.expire).getTime() < Date.now()) throw new HttpError(401, "Code d'activation expiré : demandez-en un nouveau à l'administrateur.");
    if (!(await verifierHash(normCode(code), u0.activation))) {
      const sec = await securite(env);
      await modifierRef(env, async (r) => { const c = r.intervenants.find((x) => x.matricule === matricule); if (c) noterEchec(c, sec); });
      throw new HttpError(401, MAUVAIS);
    }
    const hash = await hacher(motdepasse, env);
    const u = await modifierRef(env, async (r) => {
      const c = r.intervenants.find((x) => x.matricule === matricule);
      if (!c || !c.activation) throw new HttpError(409, "Ce code d'activation vient d'être utilisé ou remplacé.");
      c.hash = hash;
      c.activation = null;
      effacerEchecs(c);
      c.modifieLe = new Date().toISOString();
      return c;
    });
    return { status: 200, body: { ...(await creerJeton(env, u.matricule)), utilisateur: vue(u), epoque: await epoqueActuelle(env) } };
  }

  if (request.method === 'GET' && p === '/auth/moi') {
    return { status: 200, body: { utilisateur: vue(await intervenantCourant(request, env)), epoque: await epoqueActuelle(env) } };
  }

  if (request.method === 'POST' && p === '/auth/motdepasse') {
    const courant = await intervenantCourant(request, env);
    const { ancien, nouveau } = await lireJson(request);
    mdpValide(nouveau, courant.matricule);
    if (!(await verifierHash(String(ancien || ''), courant.hash))) throw new HttpError(401, 'Mot de passe actuel incorrect.');
    const hash = await hacher(nouveau, env);
    await modifierRef(env, async (ref) => {
      const u = ref.intervenants.find((x) => x.matricule === courant.matricule);
      if (u) { u.hash = hash; u.modifieLe = new Date().toISOString(); }
    });
    return { status: 200, body: { ok: true } };
  }
  return null;
}

/** Numéro de remise à zéro courant ; null si le compteur est injoignable (le client ne fait alors rien). */
async function epoqueActuelle(env) {
  try { return (await compteur(env, { action: 'etat' })).etat.epoque; } catch (err) { console.error('epoque', err); return null; }
}

// ------------------------------------------------------------------ remise à zéro des fiches et des essais
// Ce qui peut partir, et rien d'autre : ancien rangement (index/, standard/) et fiches (signalements/).
const RAZ_PREFIXES = [
  { id: 'anciens', titre: 'Ancien rangement des fiches (index/, standard/)', prefixes: ['index/', 'standard/'] },
  { id: 'fiches', titre: 'Fiches de signalement (signalements/)', prefixes: ['signalements/'] },
];
const RAZ_LOT = 500; // objets effacés par appel (plafond du forfait gratuit)

async function listerPrefixe(env, prefix, max) {
  const out = []; let curseur;
  do {
    const page = await env.DEPOTS.list({ prefix, cursor: curseur, limit: 1000 });
    for (const o of page.objects) { out.push({ cle: o.key, taille: o.size }); if (out.length >= max) return { objets: out, complet: false }; }
    curseur = page.truncated ? page.cursor : undefined;
  } while (curseur);
  return { objets: out, complet: true };
}

/** Candidats à l'effacement, par groupe. `max` borne le nombre d'objets lus par préfixe. */
async function candidatsRaz(env, max) {
  const groupes = [];
  for (const g of RAZ_PREFIXES) {
    const objets = []; let complet = true;
    for (const p of g.prefixes) { const l = await listerPrefixe(env, p, max); objets.push(...l.objets); complet = complet && l.complet; }
    groupes.push({ id: g.id, titre: g.titre, objets, complet });
  }
  return groupes;
}

async function routeRemiseAZero(request, env, url) {
  if (url.pathname !== '/admin/remise-a-zero') return null;
  const moi = await exigerDroit(request, env, 'utilisateurs');
  if (request.method === 'GET') {
    const groupes = await candidatsRaz(env, 20000);
    const etat = (await compteur(env, { action: 'etat' })).etat;
    return { status: 200, body: {
      epoque: etat.epoque,
      references: etat.references,
      groupes: groupes.map((g) => ({ id: g.id, titre: g.titre, fichiers: g.objets.length, octets: g.objets.reduce((s, o) => s + o.taille, 0), partiel: !g.complet })),
    } };
  }
  if (request.method === 'POST') {
    const b = await lireJson(request);
    if (b.confirmation !== 'EFFACER') throw new HttpError(400, 'Confirmation absente : écrivez EFFACER.');
    if (b.finale) {
      // Dernière étape, demandée par l'écran quand plus rien ne reste à effacer : références à zéro, numéro de remise à zéro + 1.
      const reste = (await candidatsRaz(env, 1)).reduce((s, g) => s + g.objets.length, 0);
      if (reste) throw new HttpError(409, 'Des fichiers restent à effacer : relancez l\'effacement.');
      const out = await compteur(env, { action: 'raz-references', par: moi.matricule });
      return { status: 200, body: { termine: true, epoque: out.etat.epoque } };
    }
    // Étape d'effacement : un lot à la fois ; l'écran rappelle tant que `restant` n'est pas 0.
    const groupes = await candidatsRaz(env, RAZ_LOT);
    const cles = groupes.flatMap((g) => g.objets.map((o) => o.cle)).slice(0, RAZ_LOT);
    if (cles.length) await env.DEPOTS.delete(cles);
    const lus = groupes.reduce((s, g) => s + g.objets.length, 0);
    const restant = lus - cles.length + (groupes.some((g) => !g.complet) ? 1 : 0);
    return { status: 200, body: { effaces: cles.length, restant } };
  }
  return null;
}

/** Couche d'essai du shapefile : tout ce qui lui reste dans R2 (versions, journaux, zips, pointeur). Ne touche jamais à `polygones`. */
async function candidatsEssai(env, max) {
  const groupes = [];
  for (const [id, titre, prefix] of [['versions', 'Versions du shapefile d\'essai', prefixeVersions('essai')], ['depots', 'Journaux et ZIP des dépôts d\'essai', prefixeDepots('essai')]]) {
    const l = await listerPrefixe(env, prefix, max);
    groupes.push({ id, titre, objets: l.objets, complet: l.complet });
  }
  const p = await env.DEPOTS.head(cleCourant('essai'));
  groupes.push({ id: 'pointeur', titre: 'Pointeur de version (courant.json)', objets: p ? [{ cle: cleCourant('essai'), taille: p.size }] : [], complet: true });
  return groupes;
}

async function routeEffacerEssai(request, env, url) {
  if (url.pathname !== '/admin/effacer-essai') return null;
  await exigerDroit(request, env, 'utilisateurs');
  if (request.method === 'GET') {
    const groupes = await candidatsEssai(env, 20000);
    return { status: 200, body: { groupes: groupes.map((g) => ({ id: g.id, titre: g.titre, fichiers: g.objets.length, octets: g.objets.reduce((t, o) => t + o.taille, 0), partiel: !g.complet })) } };
  }
  if (request.method === 'POST') {
    const b = await lireJson(request);
    if (b.confirmation !== 'ESSAI') throw new HttpError(400, 'Confirmation absente : écrivez ESSAI.');
    const groupes = await candidatsEssai(env, RAZ_LOT);
    const tous = groupes.flatMap((g) => g.objets.map((o) => o.cle));
    // Le pointeur part en dernier : tant qu'il reste des versions, la couche reste décrite par lui.
    const cle = tous.filter((c) => c !== cleCourant('essai')).slice(0, RAZ_LOT);
    const reste = tous.length - cle.length - (tous.includes(cleCourant('essai')) ? 1 : 0) + (groupes.some((g) => !g.complet) ? 1 : 0);
    if (cle.length) await env.DEPOTS.delete(cle);
    if (reste <= 0 && tous.includes(cleCourant('essai'))) { await env.DEPOTS.delete(cleCourant('essai')); return { status: 200, body: { effaces: cle.length + 1, restant: 0 } }; }
    return { status: 200, body: { effaces: cle.length, restant: reste } };
  }
  return null;
}

/** Politique de sauvegarde : aperçu (GET) et application (POST, confirmation requise) de ce qui est hors règle. */
async function routeSauvegardes(request, env, url) {
  if (url.pathname !== '/admin/sauvegardes') return null;
  await exigerDroit(request, env, 'utilisateurs');
  const resume = (groupes) => groupes.map((g) => ({ id: g.id, titre: g.titre, fichiers: g.objets.length, octets: g.objets.reduce((s, o) => s + o.taille, 0) }));
  if (request.method === 'GET') return { status: 200, body: { regle: CONSERVATION, groupes: resume(await planSauvegardes(env)) } };
  if (request.method === 'POST') {
    const b = await lireJson(request);
    if (b.confirmation !== 'APPLIQUER') throw new HttpError(400, 'Confirmation absente : écrivez APPLIQUER.');
    const groupes = await planSauvegardes(env);
    const cles = groupes.flatMap((g) => g.objets.map((o) => o.cle));
    for (let i = 0; i < cles.length; i += 100) await env.DEPOTS.delete(cles.slice(i, i + 100));
    return { status: 200, body: { effaces: cles.length, groupes: resume(groupes) } };
  }
  return null;
}

async function routeAdmin(request, env, url) {
  const p = url.pathname;

  if (request.method === 'POST' && p === '/admin/amorcer') {
    const { code, intervenant } = await lireJson(request);
    if (!env.ADMIN_BOOTSTRAP_CODE || !code || !(await sameSecret(String(code), env.ADMIN_BOOTSTRAP_CODE))) throw new HttpError(401, "Code d'amorçage refusé.");
    const fiche = validerFiche({ ...intervenant, droits: [...DROITS], actif: true });
    const act = await nouvelleActivation(env);
    await modifierRef(env, async (ref) => {
      if (ref.intervenants.length) throw new HttpError(409, 'Le référentiel existe déjà : amorçage impossible.');
      const now = new Date().toISOString();
      ref.intervenants.push({ ...fiche, hash: null, activation: act.activation, creeLe: now, modifieLe: now });
    });
    return { status: 200, body: { codeActivation: act.code, expire: act.activation.expire } };
  }

  if (request.method === 'GET' && p === '/admin/securite') {
    await exigerDroit(request, env, 'utilisateurs');
    securiteMemo = null;
    const sec = await securite(env);
    return { status: 200, body: { ...sec, toursMin: TOURS_MIN, toursMax: TOURS_MAX, comptes: await toursDesComptes(env) } };
  }

  if (request.method === 'PUT' && p === '/admin/securite') {
    const moi = await exigerDroit(request, env, 'utilisateurs');
    const b = await lireJson(request);
    const entier = (v, min, max, nom) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${nom} : nombre entier entre ${min} et ${max} attendu.`);
      return n;
    };
    const valeur = {
      version: 1,
      tours: entier(b.tours, TOURS_MIN, TOURS_MAX, 'Nombre de tours'),
      delaiBaseS: entier(b.delaiBaseS, 1, 60, 'Délai après le premier échec (s)'),
      delaiPlafondS: entier(b.delaiPlafondS, 60, 86400, 'Délai maximal (s)'),
      fenetreMin: entier(b.fenetreMin, 5, 1440, 'Fenêtre (min)'),
      modifieLe: new Date().toISOString(),
      modifiePar: moi.matricule,
    };
    await env.DEPOTS.put(SECURITE_KEY, JSON.stringify(valeur, null, 2), { httpMetadata: { contentType: 'application/json' } });
    securiteMemo = null;
    return { status: 200, body: { ...valeur, toursMin: TOURS_MIN, toursMax: TOURS_MAX, comptes: await toursDesComptes(env) } };
  }

  if (request.method === 'GET' && p === '/admin/connexions-interrompues') {
    await exigerDroit(request, env, 'utilisateurs');
    return { status: 200, body: await connexionsInterrompues(env) };
  }

  if (request.method === 'GET' && p === '/admin/compteurs') {
    await exigerDroit(request, env, 'utilisateurs', 'plans');
    return { status: 200, body: (await compteur(env, { action: 'etat' })).etat };
  }

  // Arborescence du bucket : une page à la fois (1000 objets au plus), l'écran enchaîne les pages. Lecture seule.
  if (request.method === 'GET' && p === '/admin/arborescence') {
    await exigerDroit(request, env, 'utilisateurs');
    const page = await env.DEPOTS.list({ limit: 1000, cursor: url.searchParams.get('suite') || undefined });
    return { status: 200, body: { objets: page.objects.map((o) => ({ cle: o.key, taille: o.size, date: o.uploaded })), suite: page.truncated ? page.cursor : null } };
  }

  if (request.method === 'GET' && p === '/admin/intervenants') {
    await exigerDroit(request, env, 'utilisateurs');
    const { ref } = await chargerRef(env);
    return { status: 200, body: { date: ref.date, intervenants: ref.intervenants.map(vue) } };
  }

  if (request.method === 'POST' && p === '/admin/intervenants') {
    const moi = await exigerDroit(request, env, 'utilisateurs');
    const { fiche: brute } = await lireJson(request);
    const fiche = validerFiche(brute);
    if (fiche.matricule === moi.matricule && (!fiche.droits.includes('utilisateurs') || !fiche.actif)) throw new HttpError(409, 'Vous ne pouvez pas retirer votre propre droit « gestion des utilisateurs » ni vous désactiver.');
    const resultat = await modifierRef(env, async (ref) => {
      const now = new Date().toISOString();
      const existant = ref.intervenants.find((x) => x.matricule === fiche.matricule);
      // Un trigramme est unique parmi tous les intervenants (même inactifs).
      if (fiche.trigramme) {
        const pris = ref.intervenants.find((x) => x.matricule !== fiche.matricule && String(x.trigramme || '').toUpperCase() === fiche.trigramme);
        if (pris) throw new HttpError(409, 'Ce trigramme existe déjà. Choisissez-en un autre.');
      }
      if (existant) {
        Object.assign(existant, fiche, { modifieLe: now });
        delete existant.admin;
        verifierAdminRestant(ref);
        return { u: existant };
      }
      const act = await nouvelleActivation(env);
      const u = { ...fiche, hash: null, activation: act.activation, creeLe: now, modifieLe: now };
      ref.intervenants.push(u);
      return { u, code: act.code };
    });
    return { status: 200, body: { intervenant: vue(resultat.u), ...(resultat.code ? { codeActivation: resultat.code } : {}) } };
  }

  if (request.method === 'POST' && p === '/admin/activation') {
    await exigerDroit(request, env, 'utilisateurs');
    const matricule = normMatricule((await lireJson(request)).matricule);
    const act = await nouvelleActivation(env);
    const u = await modifierRef(env, async (ref) => {
      const cible = ref.intervenants.find((x) => x.matricule === matricule);
      if (!cible) throw new HttpError(404, 'Intervenant inconnu.');
      cible.activation = act.activation; // le mot de passe actuel, s'il existe, reste valable jusqu'à l'activation
      effacerEchecs(cible);
      cible.modifieLe = new Date().toISOString();
      return cible;
    });
    return { status: 200, body: { intervenant: vue(u), codeActivation: act.code } };
  }
  return null;
}


// ------------------------------------------------------------------ index des signalements (lecture par la carte)

// Arborescence R2 des entrées : un dossier par formulaire (« signalement-demande »), avec son index JSON, puis un
// sous-dossier par entrée : fiche.json (dernière version), depot.zip (archive de la dernière version), pieces/ (photos et
// calques), revisions/ (un PDF par révision), historique/ (archives des versions précédentes), recu.json (réception).
const FORMULAIRE = 'signalement-demande';
const BASE = `signalements/${FORMULAIRE}`;
const INDEX_KEY = `${BASE}/index.json`;

/** Entrée sortie du système (statut « supprime » ; `supprimeLe` pour les entrées supprimées avant l'ajout du statut). */
function estSupprime(e) {
  return !!e && (e.statut === 'supprime' || !!e.supprimeLe);
}

/** Lit un fichier d'une archive ZIP (méthodes « stored » et « deflate ») ; null si absent. */
async function lireZip(buffer, nom) {
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) return null;
    const methode = dv.getUint16(p + 10, true);
    const taille = dv.getUint32(p + 20, true);
    const lN = dv.getUint16(p + 28, true);
    const lE = dv.getUint16(p + 30, true);
    const lC = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + lN));
    if (name === nom) {
      const debut = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const brut = u8.subarray(debut, debut + taille);
      if (methode === 0) return brut;
      if (methode === 8) return new Uint8Array(await new Response(new Blob([brut]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      return null;
    }
    p += 46 + lN + lE + lC;
  }
  return null;
}

/** Tous les fichiers d'une archive ZIP : Map nom -> octets. */
async function lireToutZip(buffer) {
  const dv = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const out = new Map();
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return out;
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const methode = dv.getUint16(p + 10, true);
    const taille = dv.getUint32(p + 20, true);
    const lN = dv.getUint16(p + 28, true);
    const lE = dv.getUint16(p + 30, true);
    const lC = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + lN));
    const debut = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const brut = u8.subarray(debut, debut + taille);
    if (methode === 0) out.set(name, brut);
    else if (methode === 8) out.set(name, new Uint8Array(await new Response(new Blob([brut]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
    p += 46 + lN + lE + lC;
  }
  return out;
}

// ---------------------------------------------------------------- nommage des photos (convention du 4/11/2026, décisions du 27/11/2026)
// Nom définitif : IMG_AAAA-0nnn-TTT_AAAAMMJJ_HHMMSS.jpg (ou IMG_AAAA-0nnn-import-TTT_… si l'heure n'est pas certaine) = référence, trigramme de l'AUTEUR, heure de prise de vue
// (heure de Bruxelles). Le suffixe -2, -3… n'existe que si plusieurs photos d'une même fiche ont le même auteur et la même seconde.
// Le renommage est déterministe (mêmes photos dans le même ordre = mêmes noms) : une révision renvoyée donne les mêmes noms.

let tableCrc = null;
function crc32(octets) {
  if (!tableCrc) {
    tableCrc = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tableCrc[n] = c >>> 0; }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < octets.length; i++) crc = tableCrc[(crc ^ octets[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Archive ZIP « stored » (sans compression, comme celle de l'appareil). @param {{name:string,data:Uint8Array}[]} entrees */
function construireZip(entrees) {
  const enc = new TextEncoder();
  const d = new Date();
  const dosTime = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const dosDate = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  const locaux = [];
  const centraux = [];
  let decalage = 0;
  for (const { name, data } of entrees) {
    const nom = enc.encode(name);
    const crc = crc32(data);
    const l = new DataView(new ArrayBuffer(30));
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true); l.setUint16(10, dosTime, true); l.setUint16(12, dosDate, true);
    l.setUint32(14, crc, true); l.setUint32(18, data.length, true); l.setUint32(22, data.length, true); l.setUint16(26, nom.length, true);
    locaux.push(new Uint8Array(l.buffer), nom, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nom.length, true); c.setUint32(42, decalage, true);
    centraux.push(new Uint8Array(c.buffer), nom);
    decalage += 30 + nom.length + data.length;
  }
  const tailleCentral = centraux.reduce((n, x) => n + x.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, entrees.length, true); fin.setUint16(10, entrees.length, true); fin.setUint32(12, tailleCentral, true); fin.setUint32(16, decalage, true);
  const morceaux = [...locaux, ...centraux, new Uint8Array(fin.buffer)];
  const out = new Uint8Array(morceaux.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of morceaux) { out.set(x, o); o += x.length; }
  return out;
}

/** « AAAA-MM-JJTHH:MM:SS » (heure du mur) à partir d'un instant, en heure de Bruxelles. */
function heureBruxelles(iso) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const g = (t) => parts.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}`;
}

/** Matricule de l'auteur de chaque photo : celui noté sur la photo, à défaut celui qui envoie. */
function auteurDe(piece, deposePar) {
  return (piece && typeof piece.auteur === 'string' && piece.auteur) || deposePar || null;
}

/** Refuse l'envoi si l'auteur d'une photo est inconnu ou n'a pas de trigramme. @throws HttpError 409 */
function verifierAuteurs(sig, ref, deposePar) {
  const vus = new Set();
  for (const p of (sig && Array.isArray(sig.pieces) ? sig.pieces : [])) {
    const m = auteurDe(p, deposePar);
    if (vus.has(m)) continue;
    vus.add(m);
    const u = m ? ref.intervenants.find((x) => x.matricule === m) : null;
    if (!u) throw new HttpError(409, 'Envoi refusé : l\'auteur d\'une photo n\'est pas identifié. Reconnectez-vous puis renvoyez.');
    if (!u.trigramme) throw new HttpError(409, `Envoi refusé : ${`${u.prenom} ${u.nom}`.trim()} n'a pas encore de trigramme. Un gestionnaire des utilisateurs doit lui en attribuer un (Réglages > Utilisateurs) ; la fiche reste sur l'appareil, renvoyez ensuite.`);
  }
}

/**
 * Donne leur nom définitif aux photos (et aux calques) d'une archive, réécrit signalement.json et renvoie la nouvelle archive.
 * @returns {{ zip: Uint8Array, fichiers: Map, sig: object }}
 */
function renommerPhotos(fichiers, sig, reference, ref, deposePar, recuLe) {
  const noms = new Map();   // ancien nom -> nouveau
  const vus = new Map();
  const pieces = Array.isArray(sig.pieces) ? sig.pieces : [];
  for (const p of pieces) {
    const u = ref.intervenants.find((x) => x.matricule === auteurDe(p, deposePar));
    const valide = typeof p.prisLe === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(p.prisLe);
    const t = valide ? p.prisLe : heureBruxelles(recuLe);
    const importee = p.importee === true || !valide; // heure non certaine : « import » devant le trigramme
    const base = `IMG_${reference}-${importee ? 'import-' : ''}${String(u.trigramme).toUpperCase()}_${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}_${t.slice(11, 13)}${t.slice(14, 16)}${t.slice(17, 19)}`;
    const n = (vus.get(base) || 0) + 1;
    vus.set(base, n);
    const nouveau = `${base}${n > 1 ? `-${n}` : ''}`;
    if (!fichiers.has(p.nom)) throw new HttpError(400, `Photo « ${p.nom} » absente de l'archive.`);
    noms.set(p.nom, `${nouveau}.jpg`);
    if (p.annotations && p.annotations.nom) {
      if (!fichiers.has(p.annotations.nom)) throw new HttpError(400, `Calque « ${p.annotations.nom} » absent de l'archive.`);
      noms.set(p.annotations.nom, `${nouveau}_ANNOT.png`);
    }
  }
  const sortie = new Map();
  for (const [nom, octets] of fichiers) sortie.set(noms.get(nom) || nom, octets);
  const neuf = JSON.parse(JSON.stringify(sig));
  for (const p of neuf.pieces || []) {
    p.nom = noms.get(p.nom);
    if (p.annotations && p.annotations.nom) p.annotations.nom = noms.get(p.annotations.nom);
  }
  if (neuf.couverture) neuf.couverture = noms.get(neuf.couverture) || null;
  sortie.set('signalement.json', new TextEncoder().encode(JSON.stringify(neuf, null, 2)));
  return { zip: construireZip([...sortie].map(([name, data]) => ({ name, data }))), fichiers: sortie, sig: neuf };
}

/** Ce que la carte a besoin de savoir d'un signalement (jamais les pièces ni le détail). */
function entreeIndex(sig, reference, recuLe, deposePar) {
  const loc = sig.localisation && Number.isFinite(sig.localisation.x) && Number.isFinite(sig.localisation.y) ? sig.localisation : null;
  return {
    reference,
    id: sig.id,
    nature: sig.nature || null,
    type: sig.type || null,
    domaine: sig.domaine || null,
    titre: String(sig.titre || '').slice(0, 120),
    description: String(sig.description || '').slice(0, 300),
    lieu: String(sig.lieu || '').slice(0, 200),
    dateObservation: sig.dateObservation || null,
    x: loc ? loc.x : null,
    y: loc ? loc.y : null,
    version: sig.version || 1,
    creeLe: sig.creeLe || null,
    modifieLe: sig.modifieLe || null,
    recuLe,
    redacteur: sig.redacteur || null,
    contributeurs: Array.isArray(sig.contributeurs) ? sig.contributeurs.slice(0, 20) : [],
    nbPieces: Array.isArray(sig.pieces) ? sig.pieces.length : 0,
    deposePar: deposePar || null,
    statut: 'actif', // actif | supprime ; les statuts de traitement viendront s'ajouter
  };
}

async function entreeDepuisArchive(buffer, reference, recuLe, deposePar) {
  const octets = await lireZip(buffer, 'signalement.json');
  if (!octets) return null;
  try { return entreeIndex(JSON.parse(new TextDecoder().decode(octets)), reference, recuLe, deposePar); } catch (err) { return null; }
}

/** Ajoute ou remplace une entrée de l'index (écriture conditionnelle, comme le référentiel). */
async function majIndex(env, entrees) {
  for (let essai = 0; essai < 5; essai++) {
    const obj = await env.DEPOTS.get(INDEX_KEY);
    const idx = obj ? await obj.json() : { signalements: [] };
    for (const e of entrees) {
      const i = idx.signalements.findIndex((x) => x.reference === e.reference);
      if (i >= 0) idx.signalements[i] = e; else idx.signalements.push(e);
    }
    idx.date = new Date().toISOString();
    const onlyIf = obj ? { etagMatches: obj.etag } : { etagDoesNotMatch: '*' };
    if (await env.DEPOTS.put(INDEX_KEY, JSON.stringify(idx), { onlyIf, httpMetadata: { contentType: 'application/json' } })) return;
  }
  throw new HttpError(503, 'Index occupé, réessayez.');
}

/** Liste pour la carte : l'index, avec les noms des intervenants à la place des seuls matricules. */
async function listerSignalements(env) {
  const obj = await env.DEPOTS.get(INDEX_KEY);
  const idx = obj ? await obj.json() : { signalements: [] };
  const { ref } = await chargerRef(env);
  const nom = (m) => {
    const u = ref.intervenants.find((x) => x.matricule === m);
    return u && (u.prenom || u.nom) ? `${u.prenom} ${u.nom}`.trim() : m;
  };
  return {
    date: idx.date || null,
    signalements: idx.signalements.filter((e) => !estSupprime(e)).map((e) => ({ ...e, redacteurNom: e.redacteur ? nom(e.redacteur) : null, contributeursNoms: (e.contributeurs || []).map(nom) })),
  };
}

function anneeBruxelles() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric' }).format(new Date());
}

async function routeDepot(request, env, url) {
  if (request.method === 'GET' && url.pathname === '/sante') {
    if (await repliCodePartage(request, env)) return { status: 200, body: { ok: true, transitoire: true } };
    return { status: 200, body: { ok: true, utilisateur: vue(await intervenantCourant(request, env)), epoque: await epoqueActuelle(env) } };
  }
  const mArchive = /^\/signalements\/(\d{4}-\d{4})\/archive$/.exec(url.pathname);
  if (request.method === 'GET' && mArchive) {
    await intervenantCourant(request, env);
    const ix = await env.DEPOTS.get(INDEX_KEY);
    if (ix && (await ix.json()).signalements.some((x) => x.reference === mArchive[1] && estSupprime(x))) throw new HttpError(410, 'Entrée supprimée.');
    const o = await env.DEPOTS.get(`${BASE}/${mArchive[1]}/depot.zip`);
    if (o) return { status: 200, raw: o.body, type: 'application/zip' };
    throw new HttpError(404, 'Entrée inconnue.');
  }
  // Photo de couverture d'une entrée (pop-up de la carte) : la photo non annotée choisie comme couverture, sinon la première.
  const mCouv = /^\/signalements\/(\d{4}-\d{4})\/couverture$/.exec(url.pathname);
  if (request.method === 'GET' && mCouv) {
    await intervenantCourant(request, env);
    const ix = await env.DEPOTS.get(INDEX_KEY);
    if (ix && (await ix.json()).signalements.some((x) => x.reference === mCouv[1] && estSupprime(x))) throw new HttpError(410, 'Entrée supprimée.');
    const f = await env.DEPOTS.get(`${BASE}/${mCouv[1]}/fiche.json`);
    if (!f) throw new HttpError(404, 'Entrée inconnue.');
    let fiche;
    try { fiche = await f.json(); } catch (err) { throw new HttpError(404, 'Fiche illisible.'); }
    const noms = (Array.isArray(fiche.pieces) ? fiche.pieces : []).map((m) => m && m.nom).filter((n) => typeof n === 'string' && /^[A-Za-z0-9._-]{1,150}$/.test(n));
    const nom = noms.includes(fiche.couverture) ? fiche.couverture : noms[0];
    if (!nom) throw new HttpError(404, 'Aucune photo.');
    const o = await env.DEPOTS.get(`${BASE}/${mCouv[1]}/pieces/${nom}`);
    if (!o) throw new HttpError(404, 'Photo introuvable.');
    return { status: 200, raw: o.body, type: 'image/jpeg', headers: { 'Cache-Control': 'private, max-age=300' } };
  }
  const mSup = /^\/signalements\/(\d{4}-\d{4})\/supprimer$/.exec(url.pathname);
  if (request.method === 'POST' && mSup) {
    // Suppression « douce » : l'entrée sort de l'index (carte, listes, comptes) ; l'archive et son historique restent dans R2.
    // Réservée au rédacteur de l'entrée et aux administrateurs. Une entrée supprimée ne peut plus être renvoyée (410).
    const moi = await intervenantCourant(request, env);
    for (let essai = 0; essai < 5; essai++) {
      const obj = await env.DEPOTS.get(INDEX_KEY);
      if (!obj) throw new HttpError(404, 'Entrée inconnue.');
      const idx = await obj.json();
      const e = idx.signalements.find((x) => x.reference === mSup[1] && !estSupprime(x));
      if (!e) throw new HttpError(404, 'Entrée inconnue ou déjà supprimée.');
      if (!aDroit(moi, 'utilisateurs') && e.redacteur !== moi.matricule) throw new HttpError(403, "Seuls le rédacteur de l'entrée et les gestionnaires des utilisateurs peuvent la supprimer.");
      e.statut = 'supprime';
      e.supprimeLe = new Date().toISOString();
      e.supprimePar = moi.matricule;
      idx.date = new Date().toISOString();
      if (await env.DEPOTS.put(INDEX_KEY, JSON.stringify(idx), { onlyIf: { etagMatches: obj.etag }, httpMetadata: { contentType: 'application/json' } })) {
        return { status: 200, body: { ok: true, reference: e.reference } };
      }
    }
    throw new HttpError(503, 'Index occupé, réessayez.');
  }
  if (request.method === 'GET' && url.pathname === '/signalements') {
    await intervenantCourant(request, env); // tout compte actif peut lire ; pas de lecture anonyme
    return { status: 200, body: await listerSignalements(env) };
  }
  if (request.method !== 'POST' || url.pathname !== '/depot') return null;

  let deposePar;
  if (await repliCodePartage(request, env)) deposePar = null;
  else deposePar = (await intervenantCourant(request, env)).matricule;

  // Remise à zéro : une fiche préparée avant la dernière remise à zéro ne doit pas recevoir une nouvelle référence.
  const epoqueServeur = await epoqueActuelle(env);
  if (epoqueServeur && Number(request.headers.get('X-Epoque') || 0) < epoqueServeur) {
    throw new HttpError(409, 'Les fiches ont été remises à zéro : ouvrez l\'application connecté pour effacer les fiches locales, puis recommencez la saisie.');
  }

  const id = request.headers.get('X-Signalement-Id') || '';
  const flux = request.headers.get('X-Flux') || '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new HttpError(400, 'Identifiant de signalement invalide.');
  if (flux !== 'STANDARD' && flux !== 'AMIANTE') throw new HttpError(400, 'Flux invalide.');
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BYTES) throw new HttpError(413, 'Archive trop volumineuse (30 Mo au plus).');

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) throw new HttpError(413, 'Archive trop volumineuse (30 Mo au plus).');
  const magic = new Uint8Array(body.slice(0, 4));
  if (!(magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 && magic[3] === 0x04)) throw new HttpError(400, "Ce n'est pas une archive ZIP.");

  // Photos : l'auteur de chacune doit être identifié et avoir un trigramme AVANT qu'une référence soit attribuée.
  let fichiersEnvoyes;
  try { fichiersEnvoyes = await lireToutZip(body); } catch (err) { throw new HttpError(400, 'Archive ZIP illisible.'); }
  let sigEnvoye = null;
  try { const brut = fichiersEnvoyes.get('signalement.json'); sigEnvoye = brut ? JSON.parse(new TextDecoder().decode(brut)) : null; } catch (err) { sigEnvoye = null; }
  const { ref: refIntervenants } = await chargerRef(env);
  if (sigEnvoye) verifierAuteurs(sigEnvoye, refIntervenants, deposePar);

  // Série « commun » tant que les deux flux partagent le même dossier R2 (séparation à l'étape des fiches).
  const { reference, deja } = await compteur(env, { action: 'reference', flux: 'commun', id, annee: anneeBruxelles() });

  const dossier = `${BASE}/${reference}`;
  const recuLe = new Date().toISOString();
  const fichier = (request.headers.get('X-Fichier') || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  // Noms définitifs des photos : l'archive rangée (depot.zip) et le déballage portent les mêmes noms que fiche.json.
  const renomme = sigEnvoye ? renommerPhotos(fichiersEnvoyes, sigEnvoye, reference, refIntervenants, deposePar, recuLe) : null;
  const corps = renomme ? renomme.zip : new Uint8Array(body);
  const entree = await entreeDepuisArchive(corps.buffer.slice(corps.byteOffset, corps.byteOffset + corps.byteLength), reference, recuLe, deposePar);

  // Révision d'une entrée déjà reçue : même identifiant, version plus récente. Une version plus ancienne que celle du
  // serveur est refusée (quelqu'un d'autre a révisé entre-temps) ; l'ancienne version est gardée dans historique/.
  let precedent = null;
  if (deja) {
    const idx = await env.DEPOTS.get(INDEX_KEY);
    precedent = idx ? (await idx.json()).signalements.find((x) => x.reference === reference) || null : null;
    if (precedent && estSupprime(precedent)) throw new HttpError(410, 'Cette entrée a été supprimée du système : elle ne peut plus être envoyée.');
    if (precedent && entree && entree.version < precedent.version) {
      throw new HttpError(409, `Une version plus récente (v0.${String(precedent.version).padStart(2, '0')}) existe déjà sur le serveur : rouvrez l'entrée pour partir de celle-ci.`);
    }
    if (precedent && entree && entree.version > precedent.version) {
      const ancien = await env.DEPOTS.get(`${dossier}/depot.zip`);
      if (ancien) {
        const tag = String(precedent.recuLe || 'sans-date').replace(/[^0-9TZ]/g, '');
        await env.DEPOTS.put(`${dossier}/historique/v${String(precedent.version).padStart(3, '0')}_${tag}.zip`, ancien.body, { httpMetadata: { contentType: 'application/zip' } });
      }
    }
  }
  let revisions = [];
  if (deja) {
    const r0 = await env.DEPOTS.get(`${dossier}/recu.json`);
    if (r0) { try { revisions = (await r0.json()).revisions || []; } catch (err) { revisions = []; } }
  }
  if (entree && !revisions.some((r) => r.version === entree.version)) revisions.push({ version: entree.version, recuLe, deposePar });
  // Écriture à chaque envoi (même si deja) : une écriture ratée au premier essai se rattrape au suivant.
  await env.DEPOTS.put(`${dossier}/depot.zip`, corps, { httpMetadata: { contentType: 'application/zip' } });
  await env.DEPOTS.put(
    `${dossier}/recu.json`,
    JSON.stringify({ reference, id, flux, fichier, taille: body.byteLength, recuLe, deposePar, revisions }, null, 2),
    { httpMetadata: { contentType: 'application/json' } },
  );
  // Déballage pour la consultation : fiche.json, pieces/ (photos et calques, mêmes noms que dans l'archive) et revisions/ (PDF de cette
  // version). Un échec ici ne perd pas le dépôt : l'archive complète est déjà rangée.
  try {
    const fichiers = renomme ? renomme.fichiers : fichiersEnvoyes;
    const types = { json: 'application/json', pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' };
    for (const [nom, octets] of fichiers) {
      if (!/^[A-Za-z0-9._-]{1,150}$/.test(nom)) continue;
      const ext = (nom.split('.').pop() || '').toLowerCase();
      let cle = null;
      if (nom === 'signalement.json') cle = `${dossier}/fiche.json`;
      else if (nom === 'revision.pdf') cle = entree ? `${dossier}/revisions/v0.${String(entree.version).padStart(2, '0')}.pdf` : null;
      else if (ext === 'jpg' || ext === 'png') cle = `${dossier}/pieces/${nom}`;
      if (cle) await env.DEPOTS.put(cle, octets, { httpMetadata: { contentType: types[ext] || 'application/octet-stream' } });
    }
  } catch (err) { console.error('déballage', err); }
  // Index lu par la carte. Un échec ici ne doit pas perdre le dépôt.
  try { if (entree) await majIndex(env, [entree]); } catch (err) { console.error('index', err); }
  return { status: 200, body: { reference, deja, recuLe } };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });

    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (origin && !allowed.includes(origin)) return reply(request, env, 403, { erreur: 'Origine non autorisée.' });

    const operation = request.method === 'POST' ? OPERATIONS_SUIVIES[url.pathname] : null;
    const note = operation ? await noterDebut(request, env, operation) : null;
    try {
      const out = (url.pathname.startsWith('/auth/') && (await routeAuth(request, env, url)))
        || (url.pathname.startsWith('/admin/') && ((await routeRemiseAZero(request, env, url)) || (await routeSauvegardes(request, env, url)) || (await routeEffacerEssai(request, env, url)) || (await routeAdmin(request, env, url))))
        || (await routeGeometries(request, env, url))
        || (await routeDepot(request, env, url));
      if (!out) return reply(request, env, 404, { erreur: 'Route inconnue.' });
      if (out.raw !== undefined) return new Response(out.raw, { status: out.status, headers: { 'Content-Type': out.type, 'Cache-Control': 'no-store', ...(out.headers || {}), ...corsHeaders(request, env) } });
      return reply(request, env, out.status, out.body);
    } catch (err) {
      if (err instanceof HttpError) return reply(request, env, err.status, { erreur: err.message });
      console.error(err);
      return reply(request, env, 500, { erreur: 'Erreur interne du serveur.' });
    } finally {
      // Fin normale (réussie ou refusée) : la note de début est effacée. Une coupure 1102 la laisse en place.
      if (note) { try { await env.DEPOTS.delete(note); } catch (err) { console.error('journal', err); } }
    }
  },
};
