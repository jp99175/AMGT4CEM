/**
 * Copie des données « nappe phréatique » de Bruxelles Environnement dans R2 (partie publique) — AMGT4CEM.
 *
 * Pourquoi : le WFS régional répond parfois en HTTP 502, et ces données (isopièzes du modèle, état de mai 2013) ne
 * changent pas. Ce Worker les récupère PAR SON PROPRE RÉSEAU (donc sans CORS), les range dans R2 sous `public/nappe/` et
 * les REVÉRIFIE périodiquement ; la carte lit cette copie en priorité, puis son cache navigateur, puis le service.
 *
 *   GET /nappe/etat.json              état de chaque jeu de données (empreinte, dates, dernière erreur)
 *   GET /nappe/<jeu>.json             GeoJSON complet du jeu (isopieses, stations), Lambert 72
 *   GET /nappe/sync                   déclenche une synchronisation immédiate (secret SYNC_CODE : en-tête X-Sync-Code ou ?code=…) ;
 *                                     à lancer une fois après le déploiement, sans attendre le prochain passage
 *
 * Réglages lus à chaque passage dans le site publié (SITE_URL) : data/fonds-de-plan/services.json (adresses des
 * services) et data/nappe/parametres.json (couches, `synchro.intervalleJours` de chaque jeu). Une modification de ces
 * fichiers est donc prise en compte sans redéployer ce Worker.
 *
 * Choix pour rester sous la limite de temps processeur (erreur 1102) : le GeoJSON n'est jamais décodé ici. Il est contrôlé
 * par de simples recherches de texte, empreinte SHA-256 calculée par le système, et rangé tel quel.
 *
 * Un jeu n'est remplacé que si son contenu a CHANGÉ (empreinte différente) ; sinon seule la date de vérification avance.
 * Si la récupération échoue (502...), l'ancienne copie est conservée et l'erreur est notée dans etat.json.
 */

const DELAIS_ENTRE_ESSAIS_MS = [2000, 6000, 15000]; // 4 essais au total

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const autorises = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'X-Sync-Code, Content-Type',
    Vary: 'Origin',
  };
  if (autorises.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function lireJson(url) {
  const reponse = await fetch(url, { cf: { cacheTtl: 0 } });
  if (!reponse.ok) throw new Error(`${url} : HTTP ${reponse.status}`);
  return reponse.json();
}

/** Nom publié d'une couche : égal au nom configuré, ou terminé par « :nom » / « _nom » (la plus courte l'emporte). */
async function nomPublie(urlService, couche, version) {
  const reponse = await fetch(`${urlService}?service=WFS&version=${version}&request=GetCapabilities`);
  if (!reponse.ok) throw new Error(`GetCapabilities HTTP ${reponse.status}`);
  const xml = await reponse.text();
  const noms = [...xml.matchAll(/<(?:\w+:)?FeatureType[^>]*>\s*<(?:\w+:)?Name>([^<]+)</g)].map((m) => m[1].trim());
  const trouves = noms.filter((n) => n === couche || n.endsWith(`:${couche}`) || n.endsWith(`_${couche}`)).sort((a, b) => a.length - b.length);
  if (!trouves.length) throw new Error(`couche « ${couche} » absente du GetCapabilities (${noms.length} couches publiées)`);
  return trouves[0];
}

async function hexSha256(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Une récupération complète du jeu (toute la couche, Lambert 72) ; lève une Error si la réponse est inutilisable. */
async function telecharger(urlService, typeName, version, crs) {
  const params = new URLSearchParams({ service: 'WFS', version, request: 'GetFeature', typeName, outputFormat: 'application/json', srsName: crs });
  const reponse = await fetch(`${urlService}?${params.toString()}`);
  if (!reponse.ok) throw new Error(`GetFeature HTTP ${reponse.status}`);
  const buffer = await reponse.arrayBuffer();
  const texte = new TextDecoder().decode(buffer);
  if (!/"type"\s*:\s*"FeatureCollection"/.test(texte)) throw new Error('réponse sans FeatureCollection (exception du service ?)');
  const nb = (texte.match(/"type"\s*:\s*"Feature"/g) || []).length;
  if (nb === 0) throw new Error('aucun objet dans la réponse');
  return { buffer, nb };
}

async function synchroniser(env, { force = false } = {}) {
  const site = env.SITE_URL.replace(/\/$/, '');
  const [services, parametres] = await Promise.all([lireJson(`${site}/data/fonds-de-plan/services.json`), lireJson(`${site}/data/nappe/parametres.json`)]);
  const etatBrut = await env.DEPOTS.get('public/nappe/etat.json');
  const etat = etatBrut ? await etatBrut.json() : { version: 1, parties: {} };
  const crs = 'EPSG:31370';
  const maintenant = new Date();

  for (const [cle, partie] of Object.entries(parametres)) {
    if (!partie || typeof partie !== 'object' || !partie.synchro || !partie.couche) continue;
    const suivi = etat.parties[cle] || { disponible: false };
    const echu = !suivi.verifieLe || (maintenant - new Date(suivi.verifieLe)) / 86400000 >= (partie.synchro.intervalleJours || 1);
    if (!force && !echu && !suivi.derniereErreur) continue;

    suivi.tentativeLe = maintenant.toISOString();
    let derniereErreur = null;
    for (let essai = 0; essai <= DELAIS_ENTRE_ESSAIS_MS.length; essai++) {
      try {
        const urlService = services.services[partie.service].url;
        const typeName = await nomPublie(urlService, partie.couche, parametres.wfsVersion);
        const { buffer, nb } = await telecharger(urlService, typeName, parametres.wfsVersion, crs);
        const sha256 = await hexSha256(buffer);
        if (sha256 !== suivi.sha256 || !suivi.disponible) {
          await env.DEPOTS.put(`public/nappe/${cle}.json`, buffer, { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
          suivi.modifieLe = maintenant.toISOString();
        }
        Object.assign(suivi, { disponible: true, sha256, nbObjets: nb, octets: buffer.byteLength, couche: typeName, verifieLe: maintenant.toISOString() });
        derniereErreur = null;
        break;
      } catch (err) {
        derniereErreur = String(err && err.message ? err.message : err);
        if (essai < DELAIS_ENTRE_ESSAIS_MS.length) await attendre(DELAIS_ENTRE_ESSAIS_MS[essai]);
      }
    }
    suivi.derniereErreur = derniereErreur; // null si réussi ; l'ancienne copie reste servie en cas d'échec
    etat.parties[cle] = suivi;
    // Etat écrit après chaque jeu : un échec sur le suivant ne fait pas perdre ce qui vient d'être acquis.
    etat.genereLe = maintenant.toISOString();
    await env.DEPOTS.put('public/nappe/etat.json', JSON.stringify(etat, null, 1), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  }
  return etat;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(synchroniser(env));
  },

  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Méthode non permise', { status: 405, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === '/nappe/sync') {
      const code = request.headers.get('X-Sync-Code') || url.searchParams.get('code'); // en-tête, ou ?code=… depuis un navigateur
      if (!env.SYNC_CODE || code !== env.SYNC_CODE) return new Response('Code de synchronisation refusé', { status: 403, headers: cors });
      try {
        const etat = await synchroniser(env, { force: true });
        return new Response(JSON.stringify(etat, null, 1), { headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
      } catch (err) {
        return new Response(String(err && err.message ? err.message : err), { status: 502, headers: cors });
      }
    }

    const m = /^\/nappe\/([a-z0-9_-]+)\.json$/.exec(url.pathname);
    if (!m) return new Response('Introuvable', { status: 404, headers: cors });
    const objet = await env.DEPOTS.get(`public/nappe/${m[1]}.json`);
    if (!objet) return new Response('Pas encore disponible', { status: 404, headers: cors });
    return new Response(request.method === 'HEAD' ? null : objet.body, {
      headers: {
        ...cors,
        'Content-Type': 'application/json; charset=utf-8',
        ETag: objet.httpEtag,
        // etat.json doit rester frais (c'est lui qui dit si les données ont changé) ; les jeux eux-mêmes se revalident.
        'Cache-Control': m[1] === 'etat' ? 'no-cache' : 'public, max-age=3600',
      },
    });
  },
};
