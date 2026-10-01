/**
 * Relais d'enregistrement des définitions d'ancrage des références de planche
 * (Cloudflare Worker). Reçoit un PUT de l'application, vérifie le code
 * administrateur, valide le contenu, puis enregistre data/pe-label-anchors.json
 * dans le dépôt GitHub (API Contents, appelée de serveur à serveur : pas de
 * mur CORS comme depuis un navigateur — voir README section 6).
 *
 * Variables (wrangler.toml ou tableau de bord Cloudflare) :
 *   GITHUB_REPO      "jp99175/AMGT4CEM"
 *   GITHUB_BRANCH    branche déployée par GitHub Pages
 *   FILE_PATH        (optionnel) défaut "data/pe-label-anchors.json"
 *   ALLOWED_ORIGINS  origines autorisées, séparées par des virgules
 *                    (ex. "https://jp99175.github.io,http://localhost:8765")
 * Secrets (`wrangler secret put ...`) :
 *   GITHUB_TOKEN     jeton GitHub à portée minimale : « Contents : lecture et écriture » sur ce seul dépôt
 *   ADMIN_TOKEN      code administrateur demandé par le plugin d'édition
 */
const REFS = ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'];
const KEY_RE = /^[0-9A-Za-z.-]{1,20}#\d{1,3}$/;
const MAX_BODY_BYTES = 200 * 1024;
// Emprise large de la Belgique : rejette les coordonnées absurdes (lat/lng inversés, Lambert collé par erreur...).
const inBelgium = (p) => Array.isArray(p) && p.length === 2 && p[0] > 49.4 && p[0] < 51.6 && p[1] > 2.5 && p[1] < 6.5;

export function validate(body) {
  if (!body || typeof body !== 'object' || body.version !== 1 || typeof body.labels !== 'object' || body.labels === null || Array.isArray(body.labels)) {
    return 'Format attendu : { "version": 1, "labels": { ... } }';
  }
  for (const [key, d] of Object.entries(body.labels)) {
    if (!KEY_RE.test(key)) return `Clé invalide : ${key}`;
    if (!d || !REFS.includes(d.r1) || !inBelgium(d.a1)) return `Définition invalide pour ${key} (r1/a1)`;
    const has2 = d.r2 !== undefined || d.a2 !== undefined;
    if (has2 && (!REFS.includes(d.r2) || !inBelgium(d.a2) || d.r2 === d.r1)) return `Définition invalide pour ${key} (r2/a2)`;
    const extra = Object.keys(d).filter((k) => !['r1', 'a1', 'r2', 'a2'].includes(k));
    if (extra.length) return `Champ inattendu pour ${key} : ${extra[0]}`;
  }
  return null;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const headers = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'PUT, OPTIONS';
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
    if (request.method !== 'PUT') return json(405, { error: 'Méthode non autorisée' }, cors);

    const auth = request.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), env.ADMIN_TOKEN || '')) {
      return json(401, { error: 'Code administrateur refusé' }, cors);
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'Contenu trop volumineux' }, cors);
    let body;
    try {
      body = JSON.parse(raw);
    } catch (err) {
      return json(400, { error: 'JSON invalide' }, cors);
    }
    const problem = validate(body);
    if (problem) return json(400, { error: problem }, cors);

    const path = env.FILE_PATH || 'data/pe-label-anchors.json';
    // Contenu canonique (clés triées) : un enregistrement sans changement réel ne crée pas de commit parasite.
    const labels = Object.fromEntries(Object.keys(body.labels).sort().map((k) => [k, body.labels[k]]));
    const content = JSON.stringify({ version: 1, labels }, null, 2) + '\n';
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
      message: 'Étiquettes de planche : mise à jour des ancrages (via l\'application)',
      content: encoded,
      branch: env.GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    });
    if (!put.ok) return json(502, { error: `Écriture GitHub refusée (HTTP ${put.status})` }, cors);
    const result = await put.json();
    return json(200, { ok: true, commit: result.commit && result.commit.sha }, cors);
  },
};
