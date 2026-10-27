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
 * Étape 1 (27/10/2026) : « Mon appareil » (compte, version) et un lien temporaire vers l'administration actuelle
 * (?app=admin) pour le droit « utilisateurs ». La reprise des réglages communs est l'étape 2.
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

// ------------------------------------------------------------------ blocs de l'étape 1
Reglages.register({
  id: 'appareil',
  ordre: 10,
  titre: 'Mon appareil',
  droit: null,
  lignes: (s) => [
    { texte: `Connecté : ${AMGT4CEM_Auth.label(s)}`, aide: 'Pour vous déconnecter, touchez l\'icône du compte en haut à droite.' },
    { texte: `Version de l'application : ${typeof AMGT4CEM_BUILD_TIMESTAMP !== 'undefined' ? AMGT4CEM_BUILD_TIMESTAMP : 'inconnue'}` },
  ],
});

Reglages.register({
  id: 'utilisateurs',
  ordre: 20,
  titre: 'Utilisateurs',
  droit: 'utilisateurs',
  lignes: () => [
    { texte: 'Intervenants, droits et sécurité', aide: 'Page d\'administration actuelle, intégrée ici à l\'étape suivante.', href: AMGT4CEM_Router.url('admin') },
  ],
});

// ------------------------------------------------------------------ rendu
function ligne(l) {
  const corps = h('span', { class: 'rgl-row__body' }, h('span', { class: 'rgl-row__text', text: l.texte }), l.aide ? h('span', { class: 'rgl-row__aide', text: l.aide }) : null);
  if (l.href || l.onClick) {
    const el = h(l.href ? 'a' : 'button', l.href ? { class: 'rgl-row rgl-row--action', href: l.href } : { class: 'rgl-row rgl-row--action', type: 'button' },
      corps, h('span', { class: 'rgl-row__chevron', 'aria-hidden': 'true', text: '›' }));
    if (l.onClick) el.addEventListener('click', l.onClick);
    return el;
  }
  return h('div', { class: 'rgl-row' }, corps);
}

function bloc(b, s) {
  const lignes = b.lignes(s) || [];
  if (!lignes.length) return null;
  return h('section', { class: 'rgl-bloc', 'aria-label': b.titre }, h('h2', { class: 'rgl-bloc__titre', text: b.titre }), ...lignes.map(ligne));
}

let compte = null; // icône de compte, créée une seule fois (elle se met à jour seule)

function render() {
  if (!compte) compte = AMGT4CEM_Nav.compte();
  root.textContent = '';
  const s = AMGT4CEM_Auth.session();
  const droits = s ? AMGT4CEM_Auth.DROITS.filter((d) => AMGT4CEM_Auth.aDroit(d, s)).map((d) => LIBELLES_DROITS[d]) : [];
  const sousTitre = !s ? 'Connexion requise' : (droits.length ? `Droits : ${droits.join(', ')}` : 'Aucun droit particulier');
  root.append(h('header', { class: 'rgl-head' },
    h('div', { class: 'rgl-head__titres' }, h('h1', { text: 'Réglages' }), h('p', { text: sousTitre })),
    compte));

  if (!s) {
    const b = h('button', { type: 'button', class: 'rgl-btn rgl-btn--primary', text: 'Se connecter' });
    b.addEventListener('click', demander);
    root.append(h('p', { class: 'rgl-note', text: 'Les réglages sont réservés aux agents identifiés.' }), b);
    return;
  }
  for (const b of Reglages.visibles(s)) {
    const el = bloc(b, s);
    if (el) root.append(el);
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
