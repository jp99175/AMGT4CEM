/**
 * Page « Réglages » de la nouvelle interface (home.html?page=reglages).
 *
 * Réservée aux comptes connectés : sans session, l'écran de connexion s'ouvre à l'arrivée. Les réglages sont
 * rangés en BLOCS, chacun réservé à un droit (ou à tout compte connecté) :
 *
 *   AMGT4CEM_Reglages.register({
 *     id: 'attributs',            // identifiant unique
 *     ordre: 30,                  // place dans la page (croissant)
 *     titre: 'Attributs',
 *     droit: 'attributs',         // null : tout compte connecté ; sinon utilisateurs | attributs | plans | vocabulaire
 *     lignes: (session) => [      // une ligne par réglage ou par écran
 *       { texte: '…', aide?: '…', href?: '…', onClick?: () => {} },
 *     ],
 *   });
 *
 * Un bloc sans ligne n'est pas affiché : une étape de la refonte R2 n'ajoute qu'une entrée ici, quand son écran
 * existe. Le serveur de dépôt reste seul juge des droits ; la page ne fait que masquer ce qui ne sert à rien.
 *
 * Une ligne peut aussi ouvrir un SOUS-ÉCRAN (bouton « ‹ Réglages » pour revenir) :
 *   { texte, aide?, ecran: { id, titre, persistant?, monter: (conteneur) => void | Promise } }
 * `persistant` : le conteneur est gardé d'une ouverture à l'autre (utile pour une page qui s'attache à un élément une fois).
 * Une ligne peut enfin porter un champ de réglage de l'appareil : { texte, aide?, champ: { unite, min, max, valeur(), enregistrer(n) } }.
 *
 * Étape 1 (27/10/2026) : « Mon appareil » (compte, version).
 * Étape 2 (27/10/2026) : délai d'affichage des mesures (appareil) ; « Utilisateurs » (page d'administration actuelle,
 * chargée à la demande dans un sous-écran) ; « Services et relais » (src/reglages/serveur.js).
 */
(function () {
const root = document.getElementById('reglages-root');
AMGT4CEM_Auth.init(AMGT4CEM_CONFIG.depot || {});

const h = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  for (const c of kids) if (c) n.append(c);
  return n;
};

const LIBELLES_DROITS = { utilisateurs: 'utilisateurs', attributs: 'attributs', plans: 'plans', vocabulaire: 'vocabulaire' };

const Reglages = {
  _blocs: [],

  register(bloc) {
    this._blocs = this._blocs.filter((b) => b.id !== bloc.id);
    this._blocs.push({ ordre: 50, droit: null, ...bloc });
    if (this._demarre) render();
  },

  /** Blocs visibles pour cette session, dans l'ordre. */
  visibles(s) {
    return this._blocs
      .filter((b) => !b.droit || AMGT4CEM_Auth.aDroit(b.droit, s))
      .sort((a, b) => a.ordre - b.ordre);
  },
};
window.AMGT4CEM_Reglages = Reglages;

// ------------------------------------------------------------------ préférences de l'appareil
/** Délai d'affichage du résultat d'une mesure (outils de mesure, étape 5). 0 = jusqu'à « Fermer ». */
const CLE_DELAI_MESURE = 'amgt4cem.mesure.delaiMs.v1';
const DELAI_MESURE_DEFAUT = 5000;
Reglages.delaiMesureMs = function () {
  try {
    const v = Number(localStorage.getItem(CLE_DELAI_MESURE));
    if (localStorage.getItem(CLE_DELAI_MESURE) !== null && Number.isFinite(v) && v >= 0) return v;
  } catch (err) { /* réglage local indisponible : valeur par défaut */ }
  return DELAI_MESURE_DEFAUT;
};
Reglages.fixerDelaiMesureMs = function (ms) {
  try { localStorage.setItem(CLE_DELAI_MESURE, String(Math.max(0, Math.round(ms)))); } catch (err) { /* valable pour la session seulement */ }
};

// ------------------------------------------------------------------ chargement à la demande
const dejaCharge = new Map();
function charger(type, url) {
  if (!dejaCharge.has(url)) {
    dejaCharge.set(url, new Promise((ok, ko) => {
      const el = document.createElement(type === 'css' ? 'link' : 'script');
      if (type === 'css') { el.rel = 'stylesheet'; el.href = url; } else el.src = url;
      el.onload = ok;
      el.onerror = () => { dejaCharge.delete(url); ko(new Error(`Chargement impossible : ${url}`)); };
      (type === 'css' ? document.head : document.body).append(el);
    }));
  }
  return dejaCharge.get(url);
}
Reglages.charger = charger;

// ------------------------------------------------------------------ blocs
Reglages.register({
  id: 'appareil',
  ordre: 10,
  titre: 'Mon appareil',
  droit: null,
  lignes: (s) => [
    { texte: `Connecté : ${AMGT4CEM_Auth.label(s)}`, aide: 'Pour vous déconnecter, touchez l\'icône du compte en haut à droite.' },
    {
      texte: 'Durée d\'affichage d\'une mesure',
      aide: 'Le résultat d\'une mesure reste affiché ce nombre de secondes (0 : jusqu\'à ce que vous touchiez « Fermer »). Réglage propre à cet appareil.',
      champ: { unite: 's', min: 0, max: 600, valeur: () => Reglages.delaiMesureMs() / 1000, enregistrer: (n) => Reglages.fixerDelaiMesureMs(n * 1000) },
    },
    { texte: `Version de l'application : ${typeof AMGT4CEM_BUILD_TIMESTAMP !== 'undefined' ? AMGT4CEM_BUILD_TIMESTAMP : 'inconnue'}` },
  ],
});

Reglages.register({
  id: 'utilisateurs',
  ordre: 20,
  titre: 'Utilisateurs',
  droit: 'utilisateurs',
  lignes: () => [
    {
      texte: 'Intervenants, droits et sécurité',
      aide: 'Créer un compte, donner des droits, envoyer un code d\'activation, régler la sécurité des mots de passe.',
      ecran: {
        id: 'utilisateurs',
        titre: 'Utilisateurs',
        persistant: true,
        async monter(conteneur) {
          // La page d'administration actuelle s'attache à un élément #admin-root : on la charge une seule fois.
          if (!conteneur.firstChild) {
            const zone = h('div', { id: 'admin-root' });
            conteneur.append(zone);
            await charger('css', './src/admin/admin.css');
            await charger('script', './src/admin/admin.js');
          }
        },
      },
    },
  ],
});

// ------------------------------------------------------------------ rendu
function ligneChamp(l) {
  const c = l.champ;
  const input = h('input', { type: 'number', inputmode: 'decimal', min: String(c.min), max: String(c.max), step: '1', class: 'rgl-input', 'aria-label': l.texte });
  input.value = String(c.valeur());
  input.addEventListener('change', () => {
    const n = Number(input.value);
    if (!Number.isFinite(n) || n < c.min || n > c.max) { input.value = String(c.valeur()); return; }
    c.enregistrer(n);
  });
  return h('label', { class: 'rgl-row' }, corpsLigne(l), h('span', { class: 'rgl-row__champ' }, input, h('span', { class: 'rgl-row__unite', text: c.unite || '' })));
}

function corpsLigne(l) {
  return h('span', { class: 'rgl-row__body' }, h('span', { class: 'rgl-row__text', text: l.texte }), l.aide ? h('span', { class: 'rgl-row__aide', text: l.aide }) : null);
}

function ligne(l) {
  if (l.champ) return ligneChamp(l);
  const corps = corpsLigne(l);
  if (l.href || l.onClick || l.ecran) {
    const el = h(l.href ? 'a' : 'button', l.href ? { class: 'rgl-row rgl-row--action', href: l.href } : { class: 'rgl-row rgl-row--action', type: 'button' },
      corps, h('span', { class: 'rgl-row__chevron', 'aria-hidden': 'true', text: '›' }));
    if (l.onClick) el.addEventListener('click', l.onClick);
    if (l.ecran) el.addEventListener('click', () => ouvrir(l.ecran));
    return el;
  }
  return h('div', { class: 'rgl-row' }, corps);
}

function bloc(b, s) {
  const lignes = b.lignes(s) || [];
  if (!lignes.length) return null;
  return h('section', { class: 'rgl-bloc', 'aria-label': b.titre }, h('h2', { class: 'rgl-bloc__titre', text: b.titre }), ...lignes.map(ligne));
}

// La page a deux vues : la liste des blocs (`principal`) et un sous-écran (`sous`) à la fois.
const principal = h('div', { class: 'rgl-principal' });
const sous = h('div', { class: 'rgl-sous', hidden: '' });
root.append(principal, sous);
const conteneurs = new Map(); // sous-écrans persistants
let ecranOuvert = null;

async function ouvrir(ecran) {
  ecranOuvert = ecran;
  const retour = h('button', { type: 'button', class: 'rgl-retour', text: '‹ Réglages' });
  retour.addEventListener('click', fermer);
  let conteneur = ecran.persistant ? conteneurs.get(ecran.id) : null;
  if (!conteneur) {
    conteneur = h('div', { class: `rgl-ecran rgl-ecran--${ecran.id}` });
    if (ecran.persistant) conteneurs.set(ecran.id, conteneur);
  }
  sous.replaceChildren(retour, h('h1', { class: 'rgl-ecran__titre', text: ecran.titre }), conteneur);
  principal.hidden = true;
  sous.hidden = false;
  window.scrollTo(0, 0);
  try { await ecran.monter(conteneur); } catch (err) { conteneur.append(h('p', { class: 'rgl-note', text: err.message })); }
}

function fermer() {
  ecranOuvert = null;
  sous.hidden = true;
  sous.replaceChildren();
  principal.hidden = false;
  window.scrollTo(0, 0);
}
Reglages.ouvrir = ouvrir;
Reglages.fermer = fermer;

let compte = null; // icône de compte, créée une seule fois (elle se met à jour seule)

function render() {
  if (!compte) compte = AMGT4CEM_Nav.compte();
  const s = AMGT4CEM_Auth.session();
  if (!s && ecranOuvert) fermer(); // déconnexion : retour à la page principale
  if (ecranOuvert) return; // ne pas défaire un sous-écran en cours de saisie
  principal.textContent = '';
  const droits = s ? AMGT4CEM_Auth.DROITS.filter((d) => AMGT4CEM_Auth.aDroit(d, s)).map((d) => LIBELLES_DROITS[d]) : [];
  const sousTitre = !s ? 'Connexion requise' : (droits.length ? `Droits : ${droits.join(', ')}` : 'Aucun droit particulier');
  principal.append(h('header', { class: 'rgl-head' },
    h('div', { class: 'rgl-head__titres' }, h('h1', { text: 'Réglages' }), h('p', { text: sousTitre })),
    compte));

  if (!s) {
    const b = h('button', { type: 'button', class: 'rgl-btn rgl-btn--primary', text: 'Se connecter' });
    b.addEventListener('click', demander);
    principal.append(h('p', { class: 'rgl-note', text: 'Les réglages sont réservés aux agents identifiés.' }), b);
    return;
  }
  for (const b of Reglages.visibles(s)) {
    const el = bloc(b, s);
    if (el) principal.append(el);
  }
}

async function demander() {
  await AMGT4CEM_Auth.ensure({ message: 'Connectez-vous pour accéder aux réglages.' });
  render();
}

AMGT4CEM_Auth.onChange(render);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
Reglages._demarre = true;
render();
if (!AMGT4CEM_Auth.session()) demander();
AMGT4CEM_Auth.surveillerExpiration();
})();
