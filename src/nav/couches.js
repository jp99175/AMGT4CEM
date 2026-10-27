/**
 * Menu « Couches » de la page Carte de la nouvelle interface (home.html?page=carto).
 *
 * Le gabarit et les scripts de la carte sont ceux de l'interface actuelle (?app=carto), qui ne change pas : ce
 * module, chargé seulement par `pages.carto` (config.js), adapte le menu une fois la page construite :
 *   - « ☰ Carte » devient « ☰ Couches » ;
 *   - l'engrenage, l'icône de compte et la disquette disparaissent du menu (voir couches.css) : le compte est dans
 *     la barre de navigation, les réglages dans la page Réglages ;
 *   - un VISITEUR (non connecté) ne voit pas « Géotechnique » ni, par conséquent, le sondage virtuel (qui n'apparaît
 *     que couche cochée). Les données restent dans R2 public : seule l'interface les masque ;
 *   - « Mon affichage » : les couches cochées et opacités sont gardées toutes seules sur l'appareil (menuPrefs.js) ;
 *     « Revenir au défaut » reprend l'affichage par défaut qui s'applique à cet utilisateur ;
 *   - « Défaut pour tous » (droit `utilisateurs`) : enregistre l'affichage actuel comme défaut des utilisateurs
 *     connectés ou des visiteurs, par le relais (code administrateur, gardé le temps de l'onglet).
 */
(function () {
if (typeof AMGT4CEM_Router === 'undefined' || AMGT4CEM_Router.mode !== 'page' || AMGT4CEM_Router.app !== 'carto') return;

const h = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  for (const c of kids) if (c) n.append(c);
  return n;
};

const Couches = {
  _initial: null, // affichage du gabarit, avant tout réglage : sert de base à « Revenir au défaut »

  connecte() { return !!AMGT4CEM_Auth.session(); },
  admin() { const s = AMGT4CEM_Auth.session(); return !!s && AMGT4CEM_Auth.aDroit('utilisateurs', s); },

  init() {
    const bouton = document.getElementById('amgt-menu-btn');
    if (!bouton) return;
    bouton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="26" height="26" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"> <path d="M24 6 42 16 24 26 6 16Z"/> <path d="M6 24 24 34 42 24"/> <path d="M6 32 24 42 42 32"/> </svg>';
    bouton.title = 'Couches';
    bouton.setAttribute('aria-label', 'Couches');
    this._bandeau(bouton);

    this._initial = AMGT4CEM_MenuPrefs.capture();
    this._construireAffichage();

    // L'affichage de départ (menuPrefs.js) est posé par app.js une fois les couches prêtes : on repasse ensuite
    // sur les règles d'accès, qui l'emportent sur un affichage enregistré (ex. Géotechnique coché avant une déconnexion).
    const demarrage = AMGT4CEM_MenuPrefs.applyStartup.bind(AMGT4CEM_MenuPrefs);
    AMGT4CEM_MenuPrefs.applyStartup = () => { demarrage(); this.appliquerAcces(); };

    this.appliquerAcces();
    AMGT4CEM_Auth.onChange(() => { this.appliquerAcces(); this._majAdmin(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { this.appliquerAcces(); this._majAdmin(); } });
  },

  // ---------------------------------------------------------------- bandeau latéral
  /** Titre du bandeau et voile : le voile suit l'ouverture du bandeau (la classe amgt-hidden est posée par mapMenu.js). */
  _bandeau(bouton) {
    const panneau = document.getElementById('amgt-map-menu');
    panneau.prepend(h('h2', { class: 'amgt-couches-titre', text: 'Couches' }));
    const voile = h('div', { class: 'amgt-couches-voile' });
    // Fermeture du bandeau, en haut à droite de celui-ci : même effet qu'un clic à côté.
    const fermer = h('button', { type: 'button', class: 'amgt-couches-fermer', title: 'Fermer', 'aria-label': 'Fermer le menu' });
    fermer.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="26" height="26" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"> <rect x="6" y="6" width="36" height="36" rx="9"/> <path d="M15 15v18"/> <path d="M29 16 21 24l8 8"/> </svg>';
    fermer.addEventListener('click', (e) => { e.stopPropagation(); panneau.classList.add('amgt-hidden'); });
    document.body.append(voile, fermer);
    const maj = () => {
      const ouvert = !panneau.classList.contains('amgt-hidden');
      voile.classList.toggle('amgt-couches-voile--on', ouvert);
      fermer.classList.toggle('amgt-couches-fermer--on', ouvert);
      document.documentElement.classList.toggle('amgt-couches-ouvert', ouvert);
      bouton.setAttribute('aria-expanded', String(ouvert));
    };
    new MutationObserver(maj).observe(panneau, { attributes: true, attributeFilter: ['class'] });
    maj();
  },

  // ---------------------------------------------------------------- accès visiteur
  /** Géotechnique : absente de l'interface d'un visiteur (case, curseur, lien) et décochée. */
  appliquerAcces() {
    const visible = this.connecte();
    const case_ = document.getElementById('amgt-layer-nappe');
    if (!case_) return;
    const ligne = case_.closest('.amgt-layer-row');
    const reglages = document.querySelector('.amgt-opacity-slider-row[data-layer="nappe"]');
    for (const el of [ligne, reglages]) if (el) el.style.display = visible ? '' : 'none';
    if (!visible) {
      if (case_.checked) { case_.checked = false; case_.dispatchEvent(new Event('change', { bubbles: true })); } // non fiable : pas enregistré comme choix de l'utilisateur
      if (typeof AMGT4CEM_NappeLayer !== 'undefined') AMGT4CEM_NappeLayer.closePicker();
    }
  },

  // ---------------------------------------------------------------- Mon affichage
  _construireAffichage() {
    const revenir = h('button', { type: 'button', class: 'amgt-link-btn amgt-couches__revenir', text: '↺ Revenir au défaut' });
    revenir.addEventListener('click', () => this.revenirAuDefaut());
    this._dit = h('p', { class: 'amgt-couches__msg', role: 'status', hidden: '' });

    this._admin = h('div', { class: 'amgt-couches__admin' });
    const bloc = h('div', { class: 'amgt-couches' },
      h('h3', { text: 'Mon affichage' }),
      h('p', { class: 'amgt-couches__aide', text: 'Vos couches et opacités sont gardées automatiquement sur cet appareil.' }),
      revenir, this._dit, this._admin);

    const pied = document.querySelector('.amgt-map-menu__footer');
    pied.parentNode.insertBefore(bloc, pied);
    this._majAdmin();
  },

  _msg(texte, erreur) {
    this._dit.textContent = texte || '';
    this._dit.hidden = !texte;
    this._dit.className = `amgt-couches__msg${erreur ? ' amgt-couches__msg--erreur' : ''}`;
  },

  /** Affichage par défaut qui s'applique à cet utilisateur, sinon celui du gabarit. */
  _defaut() {
    const partage = AMGT4CEM_MenuPrefs._defaultState() || { layers: {}, opacity: {} };
    return {
      layers: { ...this._initial.layers, ...(partage.layers || {}) },
      opacity: { ...this._initial.opacity, ...(partage.opacity || {}) },
    };
  },

  revenirAuDefaut() {
    const d = this._defaut();
    for (const [nom, actif] of Object.entries(d.layers)) {
      const c = document.getElementById(`amgt-layer-${nom}`);
      if (c && c.checked !== Boolean(actif)) { c.checked = Boolean(actif); c.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    for (const [nom, facteur] of Object.entries(d.opacity)) {
      const curseur = document.querySelector(`.amgt-opacity-slider-row[data-layer="${nom}"] .amgt-opacity-slider`);
      if (!curseur) continue;
      curseur.value = String(Math.round(Number(facteur) * 100));
      curseur.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Plus de réglage propre à l'appareil : l'affichage par défaut s'applique de nouveau (et suit ses changements).
    try { localStorage.removeItem(AMGT4CEM_MenuPrefs._lastKey); localStorage.removeItem('amgt4cem.layer-opacity.v1'); } catch (err) { /* stockage indisponible */ }
    this.appliquerAcces();
    this._msg('✓ Affichage par défaut rétabli.');
  },

  // ---------------------------------------------------------------- Défaut pour tous
  _majAdmin() {
    if (!this._admin) return;
    this._admin.textContent = '';
    if (!this.admin()) return;
    const ouvrir = h('button', { type: 'button', class: 'amgt-link-btn', text: 'Définir comme défaut pour tous…' });
    // stopPropagation : le bouton est retiré de la page pendant le clic, le menu le prendrait pour un clic extérieur et se fermerait.
    ouvrir.addEventListener('click', (e) => { e.stopPropagation(); this._ouvrirDefautPourTous(); });
    this._admin.append(ouvrir);
  },

  _ouvrirDefautPourTous() {
    this._admin.textContent = '';
    const cible = (valeur, texte, coche) => {
      const r = h('input', { type: 'radio', name: 'amgt-couches-cible', value: valeur });
      r.checked = coche;
      return { r, ligne: h('label', { class: 'amgt-radio-row' }, r, ` ${texte}`) };
    };
    const connectes = cible('connectes', 'Utilisateurs connectés', true);
    const publics = cible('public', 'Visiteurs non connectés', false);
    const code = h('input', { type: 'password', placeholder: 'Code administrateur du relais', autocomplete: 'off', class: 'amgt-couches__code' });
    const codeConnu = !!AMGT4CEM_PeLabelAnchors.getAdminCode();
    const enregistrer = h('button', { type: 'button', class: 'amgt-btn amgt-btn--primary', text: 'Enregistrer' });
    const annuler = h('button', { type: 'button', class: 'amgt-btn', text: 'Annuler' });
    annuler.addEventListener('click', (e) => { e.stopPropagation(); this._msg(''); this._majAdmin(); });

    enregistrer.addEventListener('click', async (e) => {
      e.stopPropagation();
      const kind = connectes.r.checked ? 'connectes' : 'public';
      const relais = AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl;
      if (!relais) { this._msg('Adresse du relais non renseignée (Réglages > Avancé > Services et relais).', true); return; }
      const c = code.value.trim() || AMGT4CEM_PeLabelAnchors.getAdminCode();
      if (!c) { this._msg('Saisir le code administrateur du relais.', true); return; }
      this._msg('Vérification…');
      enregistrer.disabled = true;
      try {
        await AMGT4CEM_PeLabelAnchors.checkConnection(relais, c);
        AMGT4CEM_PeLabelAnchors.setAdminCode(c);
        await AMGT4CEM_MenuPrefs._saveShared(kind, c);
        this._msg(`✓ Affichage enregistré pour ${kind === 'connectes' ? 'les utilisateurs connectés' : 'les visiteurs non connectés'} (visible après le redéploiement du site, environ 1 minute).`);
        this._majAdmin();
      } catch (err) {
        AMGT4CEM_PeLabelAnchors.setAdminCode('');
        this._msg(err.message, true);
        enregistrer.disabled = false;
      }
    });

    this._admin.append(
      h('p', { class: 'amgt-couches__aide', text: 'Enregistrer l\'affichage actuel (couches cochées et opacités) comme défaut de :' }),
      connectes.ligne, publics.ligne,
      codeConnu ? null : code,
      h('div', { class: 'amgt-couches__actions' }, annuler, enregistrer));
  },
};

Couches.init();
window.AMGT4CEM_Couches = Couches;
})();
