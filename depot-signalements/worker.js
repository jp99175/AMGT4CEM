/**
 * Serveur de dépôt des signalements (Cloudflare Worker + R2 + Durable Object).
 *
 * Reçoit l'archive ZIP d'un signalement envoyée par le plugin src/signalements/, lui attribue
 * sa référence officielle AAAA-NNNN et la range dans R2. DISTINCT de relay/ : le relais écrit dans
 * le dépôt GitHub (public), ce serveur-ci ne touche jamais au dépôt — le suivi n'y entre pas.
 *
 *   POST /depot   corps = archive ZIP ; en-têtes X-Depot-Code, X-Signalement-Id, X-Flux (STANDARD|AMIANTE)
 *                 -> 200 { reference, deja, recuLe }
 *   GET  /sante   vérifie l'adresse et le code (bouton de test) -> 200 { ok: true }
 *
 * Référence : année de Bruxelles + compteur incrémenté, un seul pour les deux flux (la référence est la
 * clé primaire de la fiche : elle doit être unique partout). Idempotent : renvoyer le même signalement
 * (même X-Signalement-Id) redonne la même référence, sans doublon ni numéro perdu.
 *
 * Rangement R2 : <flux>/<année>/<référence>/depot.zip et recu.json (flux = standard | amiante).
 * Le code d'accès (secret DEPOT_CODE) est commun : il identifie l'appartenance au service, pas la personne
 * (l'identification des rédacteurs viendra avec le référentiel des intervenants).
 */

const MAX_BYTES = 30 * 1024 * 1024;

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

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'X-Depot-Code, X-Signalement-Id, X-Flux, X-Fichier, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function reply(request, env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request, env) },
  });
}

async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

function anneeBruxelles() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric' }).format(new Date());
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });

    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (origin && !allowed.includes(origin)) return reply(request, env, 403, { erreur: 'Origine non autorisée.' });

    const code = request.headers.get('X-Depot-Code') || '';
    if (!env.DEPOT_CODE || !code || !(await sameSecret(code, env.DEPOT_CODE))) {
      return reply(request, env, 401, { erreur: "Code d'accès refusé." });
    }

    if (request.method === 'GET' && url.pathname === '/sante') return reply(request, env, 200, { ok: true });
    if (request.method !== 'POST' || url.pathname !== '/depot') return reply(request, env, 404, { erreur: 'Route inconnue.' });

    const id = request.headers.get('X-Signalement-Id') || '';
    const flux = request.headers.get('X-Flux') || '';
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return reply(request, env, 400, { erreur: 'Identifiant de signalement invalide.' });
    if (flux !== 'STANDARD' && flux !== 'AMIANTE') return reply(request, env, 400, { erreur: 'Flux invalide.' });
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BYTES) return reply(request, env, 413, { erreur: 'Archive trop volumineuse (30 Mo au plus).' });

    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return reply(request, env, 413, { erreur: 'Archive trop volumineuse (30 Mo au plus).' });
    const magic = new Uint8Array(body.slice(0, 4));
    if (!(magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 && magic[3] === 0x04)) {
      return reply(request, env, 400, { erreur: "Ce n'est pas une archive ZIP." });
    }

    const stub = env.COMPTEUR.get(env.COMPTEUR.idFromName('references'));
    const attribution = await (await stub.fetch('https://compteur/', { method: 'POST', body: JSON.stringify({ id, annee: anneeBruxelles() }) })).json();
    const { reference, deja } = attribution;

    const dossier = `${flux === 'AMIANTE' ? 'amiante' : 'standard'}/${reference.slice(0, 4)}/${reference}`;
    const recuLe = new Date().toISOString();
    const fichier = (request.headers.get('X-Fichier') || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
    // Écriture à chaque envoi (même si deja) : une écriture ratée au premier essai se rattrape au suivant.
    await env.DEPOTS.put(`${dossier}/depot.zip`, body, { httpMetadata: { contentType: 'application/zip' } });
    await env.DEPOTS.put(
      `${dossier}/recu.json`,
      JSON.stringify({ reference, id, flux, fichier, taille: body.byteLength, recuLe }, null, 2),
      { httpMetadata: { contentType: 'application/json' } },
    );
    return reply(request, env, 200, { reference, deja, recuLe });
  },
};
