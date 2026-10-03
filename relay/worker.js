/**
 * Relais d'enregistrement (Cloudflare Worker) des données modifiées dans
 * l'application. Reçoit un PUT de l'application, vérifie le code
 * administrateur, valide le contenu, puis l'enregistre dans le dépôt GitHub
 * (API Contents, appelée de serveur à serveur : pas de mur CORS comme depuis
 * un navigateur — voir README section 6).
 *
 * UNE SEULE AUTORISATION pour tout : le code administrateur (ADMIN_TOKEN) ouvre
 * toutes les routes. Les routes ne sont pas des droits distincts : ce sont des
 * chemins de fichiers. Deux familles :
 *   PUT /shared/<dossier>/<fichier>   donnée écrite par l'application -> data/<dossier>/<fichier>.json
 *       ex. /shared/fond-de-plan/etiquettes-planches   -> data/fond-de-plan/etiquettes-planches.json
 *           /shared/fond-de-plan/etiquettes-troncons   -> data/fond-de-plan/etiquettes-troncons.json
 *       (<dossier>, <fichier> : minuscules, chiffres, tirets). Corps JSON { "version": 1, ... }, au
 *       format libre ; contrôle commun : Lambert 72 pour toute coordonnée x/y/a1/a2 d'un jeu
 *       `labels`, crs « EPSG:31370 » si présent. Un nouveau dossier (amiante, chantiers...) ou un
 *       nouveau fichier ne demande NI modification NI redéploiement de ce relais.
 *   PUT /settings                     paramètres généraux -> data/app-settings.json
 *       (contrôle strict : adresses de services en https).
 *   GET (toute route) contrôle de connexion et du code, n'écrit rien.
 *
 * Variables (wrangler.toml ou tableau de bord Cloudflare) :
 *   GITHUB_REPO      "jp99175/AMGT4CEM"
 *   GITHUB_BRANCH    branche déployée par GitHub Pages
 *   SETTINGS_PATH    (optionnel) fichier des paramètres, défaut "data/app-settings.json"
 *   ALLOWED_ORIGINS  origines autorisées, séparées par des virgules
 *                    (ex. "https://jp99175.github.io,http://localhost:8765")
 * Secrets (`wrangler secret put ...`) :
 *   GITHUB_TOKEN     jeton GitHub à portée minimale : « Contents : lecture et écriture » sur ce seul dépôt
 *   ADMIN_TOKEN      code administrateur demandé par le plugin d'édition
 */
const NAME_RE = /^[a-z0-9-]{1,40}$/;
const LABEL_KEY_RE = /^[0-9A-Za-z.-]{1,40}#\d{1,3}$/;
const MAX_BODY_BYTES = 200 * 1024;
const SETTING_URL_KEYS = ['urbisUrl', 'brucielHistoriqueUrl', 'brucielRecentUrl', 'geocoderUrl', 'relayUrl'];
const SETTING_KEYS = [...SETTING_URL_KEYS, 'urbisLayers'];
// Adresses de services : https obligatoire (http seulement vers localhost, pour tester en local).
const isServiceUrl = (v) => typeof v === 'string' && v.length <= 400 && /^(https:\/\/[^\s]+|http:\/\/localhost(:\d+)?(\/[^\s]*)?)$/.test(v);
// Emprise large du Lambert 72 belge (X et Y : 1 000 à 300 000 m) : rejette lat/lng collés par erreur.
const inLambert = (v) => typeof v === 'number' && Number.isFinite(v) && v > 1000 && v < 300000;
const isLambertPoint = (p) => Array.isArray(p) && p.length === 2 && inLambert(p[0]) && inLambert(p[1]);

/**
 * Données partagées (PUT /shared/<dossier>/<fichier>) : { "version": 1, ... } au format libre. Contrôles
 * communs : `crs`, s'il est donné, vaut EPSG:31370 ; dans un jeu `labels` { "clé#rang": { ... } }, la clé a la
 * forme « numéro#rang » et toute coordonnée (x, y, a1, a2) est en Lambert 72 belge (mètres).
 */
export function validateShared(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.version !== 1) return 'Format attendu : { "version": 1, ... }';
  if (body.crs !== undefined && body.crs !== 'EPSG:31370') return 'crs : seul « EPSG:31370 » (Lambert 72) est accepté';
  if (body.labels !== undefined) {
    if (!body.labels || typeof body.labels !== 'object' || Array.isArray(body.labels)) return '« labels » doit être un objet';
    for (const [key, d] of Object.entries(body.labels)) {
      if (!LABEL_KEY_RE.test(key)) return `Clé invalide : ${key}`;
      if (!d || typeof d !== 'object') return `Définition invalide pour ${key}`;
      for (const f of ['x', 'y']) if (d[f] !== undefined && !inLambert(d[f])) return `${key} : ${f} hors du Lambert 72 belge (mètres)`;
      for (const f of ['a1', 'a2']) if (d[f] !== undefined && !isLambertPoint(d[f])) return `${key} : ${f} doit être [x, y] en Lambert 72 belge (mètres)`;
    }
  }
  return null;
}

/** Paramètres généraux : { version: 1, settings: { urbisUrl?, urbisLayers?, ... } } — que des clés connues, des adresses valides. */
export function validateSettings(body) {
  if (!body || typeof body !== 'object' || body.version !== 1 || typeof body.settings !== 'object' || body.settings === null || Array.isArray(body.settings)) {
    return 'Format attendu : { "version": 1, "settings": { ... } }';
  }
  for (const [key, value] of Object.entries(body.settings)) {
    if (!SETTING_KEYS.includes(key)) return `Paramètre inconnu : ${key}`;
    if (SETTING_URL_KEYS.includes(key) ? !isServiceUrl(value) : typeof value !== 'string' || !/^[\w:.,-]{1,100}$/.test(value)) return `Valeur invalide pour ${key}`;
  }
  return null;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const headers = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, PUT, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

const json = (status, data, extra) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...extra } });

/** Comparaison en temps constant (évite de révéler le code par le temps de réponse). */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function github(env, method, path, body) {
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}${method === 'GET' ? `?ref=${encodeURIComponent(env.GITHUB_BRANCH)}` : ''}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'amgt4cem-pe-label-relay',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'PUT' && request.method !== 'GET') return json(405, { error: 'Méthode non autorisée' }, cors);

    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), env.ADMIN_TOKEN || '')) {
      return json(401, { error: 'Code administrateur refusé' }, cors);
    }
    // GET : contrôle de connexion (« Tester » dans ⚙ Paramètres > Serveur) — vérifie le code, n'écrit rien.
    if (request.method === 'GET') return json(200, { ok: true }, cors);
    const parts = new URL(request.url).pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    const route = parts[parts.length - 1];
    // /shared/<dossier>/<fichier> : donnée de l'application, écrite sous data/<dossier>/<fichier>.json.
    const shared = parts.length >= 3 && parts[parts.length - 3] === 'shared' && NAME_RE.test(parts[parts.length - 2]) && NAME_RE.test(route);
    let target = null;
    if (shared) {
      const dossier = parts[parts.length - 2];
      target = { path: `data/${dossier}/${route}.json`, validate: validateShared, key: null, message: `Données « ${dossier}/${route} » : mise à jour (via l'application)` };
    } else if (route === 'settings') {
      target = { path: env.SETTINGS_PATH || 'data/app-settings.json', validate: validateSettings, key: 'settings', message: "Paramètres généraux : mise à jour (via l'application)" };
    }
    if (!target) return json(404, { error: 'Route inconnue (attendu : /shared/<dossier>/<fichier> ou /settings)' }, cors);

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'Contenu trop volumineux' }, cors);
    let body;
    try {
      body = JSON.parse(raw);
    } catch (err) {
      return json(400, { error: 'JSON invalide' }, cors);
    }
    const problem = target.validate(body);
    if (problem) return json(400, { error: problem }, cors);

    const path = target.path;
    // Contenu canonique (clés triées) : un enregistrement sans changement réel ne crée pas de commit parasite.
    let content;
    if (target.key) {
      const entries = body[target.key];
      const sorted = Object.fromEntries(Object.keys(entries).sort().map((k) => [k, entries[k]]));
      content = JSON.stringify({ version: 1, [target.key]: sorted }, null, 2) + '\n';
    } else {
      content = JSON.stringify(body, null, 2) + '\n'; // données partagées : format libre, enregistré tel quel
    }
    let binary = '';
    for (const byte of new TextEncoder().encode(content)) binary += String.fromCharCode(byte);
    const encoded = btoa(binary);

    // Version actuelle du fichier (sha requis par GitHub pour le remplacer) ; absent = création.
    let sha;
    const current = await github(env, 'GET', path);
    if (current.ok) {
      const file = await current.json();
      sha = file.sha;
      if (file.content && file.content.replace(/\s/g, '') === encoded) return json(200, { ok: true, unchanged: true }, cors);
    } else if (current.status !== 404) {
      return json(502, { error: `Lecture GitHub impossible (HTTP ${current.status})` }, cors);
    }
    const put = await github(env, 'PUT', path, {
      message: target.message,
      content: encoded,
      branch: env.GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    });
    if (!put.ok) return json(502, { error: `Écriture GitHub refusée (HTTP ${put.status})` }, cors);
    const result = await put.json();
    return json(200, { ok: true, commit: result.commit && result.commit.sha }, cors);
  },
};
