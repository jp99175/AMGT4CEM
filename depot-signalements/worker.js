/**
 * Serveur de dépôt des signalements (Cloudflare Worker + R2 + Durable Object).
 *
 * Reçoit l'archive ZIP d'un signalement envoyée par SIG4CEM (src/signal/), lui attribue sa référence
 * officielle AAAA-NNNN et la range dans R2. Gère aussi les intervenants : référentiel (R2, jamais dans le dépôt
 * public), connexion, première connexion (code d'activation), administration. DISTINCT de relay/ : le relais
 * écrit dans le dépôt GitHub (public), ce serveur-ci ne touche jamais au dépôt.
 *
 * Routes (JSON ; sauf /depot : corps ZIP) :
 *   POST /auth/login          { matricule, motdepasse }                    -> { jeton, expire, utilisateur }
 *   POST /auth/activer        { matricule, code, motdepasse }              -> idem (première connexion)
 *   GET  /auth/moi            (jeton)                                      -> { utilisateur }
 *   POST /auth/motdepasse     (jeton) { ancien, nouveau }                  -> { ok: true }
 *   GET  /signalements       (jeton)  -> { date, signalements:[…] } index lu par la carte
 *   POST /signalements/AAAA-NNNN/supprimer (jeton ; rédacteur ou admin) retire l'entrée de l'index (archive conservée)
 *   GET  /sante               (jeton)                                      -> { ok: true, utilisateur }
 *   POST /depot               (jeton) corps ZIP ; X-Signalement-Id, X-Flux, X-Fichier
 *                                                                          -> { reference, deja, recuLe }
 *   GET  /admin/intervenants  (jeton admin)                                -> { intervenants: [...] }
 *   POST /admin/intervenants  (jeton admin) { fiche }                      -> { intervenant, codeActivation? }
 *   POST /admin/activation    (jeton admin) { matricule }                  -> { intervenant, codeActivation }
 *   POST /admin/amorcer       { code, intervenant }  premier compte admin, une seule fois (secret ADMIN_BOOTSTRAP_CODE)
 *
 * Jeton : « Authorization: Bearer … », signé (HMAC, secret SESSION_SECRET), valable 30 jours ; l'existence, l'état
 * actif et le droit admin de l'intervenant sont revérifiés dans le référentiel à chaque appel (désactiver un agent
 * coupe son accès tout de suite).
 *
 * Référentiel : R2 `referentiel/intervenants.json`. Le mot de passe n'y est jamais en clair : PBKDF2-SHA-256 avec un
 * sel propre à chaque intervenant. L'administrateur ne le connaît jamais : il génère un code d'activation (valable
 * 7 jours, stocké haché), l'agent choisit son mot de passe en l'utilisant.
 *
 * Référence : année de Bruxelles + compteur incrémenté. Idempotent : renvoyer le même signalement (même
 * X-Signalement-Id) redonne la même référence, sans doublon ni numéro perdu.
 * Rangement R2 : <flux>/<année>/<référence>/depot.zip et recu.json (le rédacteur authentifié y est inscrit).
 *
 * Transition : tant qu'aucun intervenant n'a activé son compte, l'ancien code partagé (secret DEPOT_CODE, en-tête
 * X-Depot-Code) reste accepté pour /depot et /sante. Dès le premier compte activé, il ne sert plus.
 */

const MAX_BYTES = 30 * 1024 * 1024;
const REF_KEY = 'referentiel/intervenants.json';
const TOKEN_TTL_S = 30 * 24 * 3600;
const ACTIVATION_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_ECHECS = 5;
const BLOCAGE_MS = 15 * 60 * 1000;
const MDP_MIN = 8;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1 : lisible au téléphone

export class Compteur {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const { id, annee } = await request.json();
    const known = await this.state.storage.get(`id:${id}`);
    if (known) return Response.json({ reference: known, deja: true });
    const n = ((await this.state.storage.get(`n:${annee}`)) || 0) + 1;
    const reference = `${annee}-${String(n).padStart(4, '0')}`;
    await this.state.storage.put({ [`n:${annee}`]: n, [`id:${id}`]: reference });
    return Response.json({ reference, deja: false });
  }
}

// ------------------------------------------------------------------ réponses et CORS
function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, X-Depot-Code, X-Signalement-Id, X-Flux, X-Fichier, Content-Type',
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

function iterations(env) {
  const n = Number(env.PBKDF2_ITER);
  return Number.isFinite(n) && n >= 1000 && n <= 100000 ? Math.floor(n) : 100000; // 100 000 : maximum accepté par Workers
}

async function pbkdf2(secret, saltBytes, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: iter }, key, 256));
}

/** { s: sel, i: itérations, h: empreinte } */
async function hacher(secret, env) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iter = iterations(env);
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

/** Lecture, modification, écriture conditionnelle (ETag) : deux écritures simultanées ne s'écrasent pas. */
async function modifierRef(env, mutation) {
  for (let essai = 0; essai < 5; essai++) {
    const { ref, etag } = await chargerRef(env);
    const resultat = await mutation(ref);
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
    admin: f.admin === true,
    actif: f.actif !== false,
  };
}

/** Ce qui sort du serveur : jamais le hash ni le code d'activation. */
function vue(u) {
  return {
    matricule: u.matricule, prenom: u.prenom, nom: u.nom, gsm: u.gsm, email: u.email,
    organisation: u.organisation, division: u.division, departement: u.departement, service: u.service,
    admin: !!u.admin, actif: u.actif !== false,
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

/** Décompte des échecs ; blocage temporaire après MAX_ECHECS. À appeler dans modifierRef. */
function noterEchec(u) {
  u.echecs = (u.echecs || 0) + 1;
  if (u.echecs >= MAX_ECHECS) { u.bloqueJusqua = new Date(Date.now() + BLOCAGE_MS).toISOString(); u.echecs = 0; }
}

function verifierBlocage(u) {
  if (u.bloqueJusqua && new Date(u.bloqueJusqua).getTime() > Date.now()) {
    throw new HttpError(429, 'Trop d’essais. Réessayez dans quelques minutes.');
  }
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

async function exigerAdmin(request, env) {
  const u = await intervenantCourant(request, env);
  if (!u.admin) throw new HttpError(403, 'Droit administrateur requis.');
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

/** Au moins un administrateur actif doit rester (compte activé, ou activation en attente). */
function verifierAdminRestant(ref) {
  if (!ref.intervenants.some((u) => u.admin && u.actif !== false && (u.hash || u.activation))) {
    throw new HttpError(409, 'Il doit rester au moins un administrateur actif.');
  }
}

// ------------------------------------------------------------------ routes
async function lireJson(request) {
  try { return await request.json(); } catch (err) { throw new HttpError(400, 'Corps JSON invalide.'); }
}

async function routeAuth(request, env, url) {
  const p = url.pathname;
  if (request.method === 'POST' && p === '/auth/login') {
    const { matricule: mRaw, motdepasse } = await lireJson(request);
    const matricule = normMatricule(mRaw);
    const mdp = String(motdepasse || '');
    const { ref } = await chargerRef(env);
    const u = ref.intervenants.find((x) => x.matricule === matricule);
    if (!u || u.actif === false || !u.hash) {
      await pbkdf2(mdp, new Uint8Array(16), iterations(env)); // même durée qu'un vrai essai : ne révèle pas si le matricule existe
      throw new HttpError(401, ECHEC);
    }
    verifierBlocage(u);
    if (!(await verifierHash(mdp, u.hash))) {
      await modifierRef(env, async (r) => { const c = r.intervenants.find((x) => x.matricule === matricule); if (c) noterEchec(c); });
      throw new HttpError(401, ECHEC);
    }
    if (u.echecs || u.bloqueJusqua) {
      await modifierRef(env, async (r) => { const c = r.intervenants.find((x) => x.matricule === matricule); if (c) { c.echecs = 0; c.bloqueJusqua = null; } });
    }
    return { status: 200, body: { ...(await creerJeton(env, u.matricule)), utilisateur: vue(u) } };
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
        const c = { matricule, prenom: '', nom: '', gsm: '', email: '', organisation: 'BM', division: 'DITP', departement: 'AMGT', service: 'CEM', admin: true, actif: true, hash: hash0, activation: null, creeLe: now, modifieLe: now };
        r.intervenants.push(c);
        return c;
      });
      return { status: 200, body: { ...(await creerJeton(env, u.matricule)), utilisateur: vue(u) } };
    }
    const u0 = ref.intervenants.find((x) => x.matricule === matricule);
    if (!u0 || u0.actif === false || !u0.activation) {
      await pbkdf2(String(code || ''), new Uint8Array(16), iterations(env));
      throw new HttpError(401, MAUVAIS);
    }
    verifierBlocage(u0);
    if (new Date(u0.activation.expire).getTime() < Date.now()) throw new HttpError(401, "Code d'activation expiré : demandez-en un nouveau à l'administrateur.");
    if (!(await verifierHash(normCode(code), u0.activation))) {
      await modifierRef(env, async (r) => { const c = r.intervenants.find((x) => x.matricule === matricule); if (c) noterEchec(c); });
      throw new HttpError(401, MAUVAIS);
    }
    const hash = await hacher(motdepasse, env);
    const u = await modifierRef(env, async (r) => {
      const c = r.intervenants.find((x) => x.matricule === matricule);
      if (!c || !c.activation) throw new HttpError(409, "Ce code d'activation vient d'être utilisé ou remplacé.");
      c.hash = hash;
      c.activation = null;
      c.echecs = 0;
      c.bloqueJusqua = null;
      c.modifieLe = new Date().toISOString();
      return c;
    });
    return { status: 200, body: { ...(await creerJeton(env, u.matricule)), utilisateur: vue(u) } };
  }

  if (request.method === 'GET' && p === '/auth/moi') {
    return { status: 200, body: { utilisateur: vue(await intervenantCourant(request, env)) } };
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

async function routeAdmin(request, env, url) {
  const p = url.pathname;

  if (request.method === 'POST' && p === '/admin/amorcer') {
    const { code, intervenant } = await lireJson(request);
    if (!env.ADMIN_BOOTSTRAP_CODE || !code || !(await sameSecret(String(code), env.ADMIN_BOOTSTRAP_CODE))) throw new HttpError(401, "Code d'amorçage refusé.");
    const fiche = validerFiche({ ...intervenant, admin: true, actif: true });
    const act = await nouvelleActivation(env);
    await modifierRef(env, async (ref) => {
      if (ref.intervenants.length) throw new HttpError(409, 'Le référentiel existe déjà : amorçage impossible.');
      const now = new Date().toISOString();
      ref.intervenants.push({ ...fiche, hash: null, activation: act.activation, creeLe: now, modifieLe: now });
    });
    return { status: 200, body: { codeActivation: act.code, expire: act.activation.expire } };
  }

  if (request.method === 'GET' && p === '/admin/intervenants') {
    await exigerAdmin(request, env);
    const { ref } = await chargerRef(env);
    return { status: 200, body: { date: ref.date, intervenants: ref.intervenants.map(vue) } };
  }

  if (request.method === 'POST' && p === '/admin/intervenants') {
    const moi = await exigerAdmin(request, env);
    const { fiche: brute } = await lireJson(request);
    const fiche = validerFiche(brute);
    if (fiche.matricule === moi.matricule && (!fiche.admin || !fiche.actif)) throw new HttpError(409, 'Vous ne pouvez pas retirer votre propre droit administrateur ni vous désactiver.');
    const resultat = await modifierRef(env, async (ref) => {
      const now = new Date().toISOString();
      const existant = ref.intervenants.find((x) => x.matricule === fiche.matricule);
      if (existant) {
        Object.assign(existant, fiche, { modifieLe: now });
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
    await exigerAdmin(request, env);
    const matricule = normMatricule((await lireJson(request)).matricule);
    const act = await nouvelleActivation(env);
    const u = await modifierRef(env, async (ref) => {
      const cible = ref.intervenants.find((x) => x.matricule === matricule);
      if (!cible) throw new HttpError(404, 'Intervenant inconnu.');
      cible.activation = act.activation; // le mot de passe actuel, s'il existe, reste valable jusqu'à l'activation
      cible.echecs = 0;
      cible.bloqueJusqua = null;
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
    return { status: 200, body: { ok: true, utilisateur: vue(await intervenantCourant(request, env)) } };
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
      if (!moi.admin && e.redacteur !== moi.matricule) throw new HttpError(403, "Seuls le rédacteur de l'entrée et les administrateurs peuvent la supprimer.");
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

  const id = request.headers.get('X-Signalement-Id') || '';
  const flux = request.headers.get('X-Flux') || '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new HttpError(400, 'Identifiant de signalement invalide.');
  if (flux !== 'STANDARD' && flux !== 'AMIANTE') throw new HttpError(400, 'Flux invalide.');
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BYTES) throw new HttpError(413, 'Archive trop volumineuse (30 Mo au plus).');

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BYTES) throw new HttpError(413, 'Archive trop volumineuse (30 Mo au plus).');
  const magic = new Uint8Array(body.slice(0, 4));
  if (!(magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 && magic[3] === 0x04)) throw new HttpError(400, "Ce n'est pas une archive ZIP.");

  const stub = env.COMPTEUR.get(env.COMPTEUR.idFromName('references'));
  const attribution = await (await stub.fetch('https://compteur/', { method: 'POST', body: JSON.stringify({ id, annee: anneeBruxelles() }) })).json();
  const { reference, deja } = attribution;

  const dossier = `${BASE}/${reference}`;
  const recuLe = new Date().toISOString();
  const fichier = (request.headers.get('X-Fichier') || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  const entree = await entreeDepuisArchive(body, reference, recuLe, deposePar);

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
  await env.DEPOTS.put(`${dossier}/depot.zip`, body, { httpMetadata: { contentType: 'application/zip' } });
  await env.DEPOTS.put(
    `${dossier}/recu.json`,
    JSON.stringify({ reference, id, flux, fichier, taille: body.byteLength, recuLe, deposePar, revisions }, null, 2),
    { httpMetadata: { contentType: 'application/json' } },
  );
  // Déballage pour la consultation : fiche.json, pieces/ (photos et calques, mêmes noms que dans l'archive) et revisions/ (PDF de cette
  // version). Un échec ici ne perd pas le dépôt : l'archive complète est déjà rangée.
  try {
    const fichiers = await lireToutZip(body);
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

    try {
      const out = (url.pathname.startsWith('/auth/') && (await routeAuth(request, env, url)))
        || (url.pathname.startsWith('/admin/') && (await routeAdmin(request, env, url)))
        || (await routeDepot(request, env, url));
      if (!out) return reply(request, env, 404, { erreur: 'Route inconnue.' });
      if (out.raw) return new Response(out.raw, { status: out.status, headers: { 'Content-Type': out.type, 'Cache-Control': 'no-store', ...corsHeaders(request, env) } });
      return reply(request, env, out.status, out.body);
    } catch (err) {
      if (err instanceof HttpError) return reply(request, env, err.status, { erreur: err.message });
      console.error(err);
      return reply(request, env, 500, { erreur: 'Erreur interne du serveur.' });
    }
  },
};
