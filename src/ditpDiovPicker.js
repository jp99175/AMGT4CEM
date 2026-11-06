/**
 * Sélecteur plein écran des genres de la couche « DITP-DIOV » (Couches > DITP-DIOV > « (modifier la sélection) ») :
 * station, tunnel, dépôt, ouvrage atypique. Chaque genre a sa case et sa couleur.
 *
 *  - La sélection (cases) est celle de l'appareil, avec « ↺ défaut » et « défaut pour tous » comme les autres
 *    sélecteurs (voir src/nav/couches.js, src/ditpDiovGenres.js).
 *  - La COULEUR est la même pour tout le monde : elle vient de config/ditp-diov/vocabulaires.json. Les comptes qui ont le
 *    droit « attributs » la modifient ici (palette de couleur) et l'enregistrent pour tous par le relais
 *    (route shared/ditp-diov/vocabulaires, code administrateur du relais gardé le temps de l'onglet).
 *    L'essai de couleur est visible tout de suite sur la carte ; fermé sans enregistrer, il est annulé.
 *  - Dépôts et ouvrages atypiques n'existent que dans la couche privée : un visiteur ne voit que stations et tunnels.
 */
const AMGT4CEM_DitpDiovPicker = {
  _overlay: null,
  _content: null,
  _barre: null,
  _essais: {}, // genre -> couleur essayée, pas encore enregistrée

  init() {
    this._overlay = document.getElementById('amgt-ditp-diov-picker');
    this._content = document.getElementById('amgt-ditp-diov-picker-content');
    this._barre = document.getElementById('amgt-ditp-diov-picker-couleurs');
    document.getElementById('amgt-ditp-diov-picker-close').addEventListener('click', () => this.close());
  },

  _peutColorier() {
    const s = AMGT4CEM_Auth.session();
    return !!s && AMGT4CEM_Auth.aDroit('attributs', s);
  },

  _genres() {
    const connecte = !!AMGT4CEM_Auth.session();
    return AMGT4CEM_DitpDiovGenres.LISTE.filter((g) => connecte || g.genre === 'station' || g.genre === 'tunnel');
  },

  open() {
    this._essais = {};
    this._render();
    this._overlay.classList.remove('amgt-hidden');
  },

  close() {
    if (Object.keys(this._essais).length) this._annulerEssais();
    this._overlay.classList.add('amgt-hidden');
  },

  _annulerEssais() {
    this._essais = {};
    AMGT4CEM_DitpDiovGenres.recolorer();
    this._render();
  },

  _render() {
    if (!this._content) return;
    const store = AMGT4CEM_DitpDiovSelectionStore;
    const genres = this._genres();
    const ids = genres.map((g) => g.genre);
    this._content.innerHTML = '';

    const global = document.createElement('label');
    global.className = 'amgt-checkbox-row amgt-topo-global-toggle';
    const n = ids.filter((id) => store.isSelected(id)).length;
    const tout = document.createElement('input');
    tout.type = 'checkbox';
    tout.checked = n === ids.length;
    tout.indeterminate = n > 0 && n < ids.length;
    tout.addEventListener('change', () => {
      if (tout.checked) store.selectMany(ids); else store.deselectMany(ids);
      this._render();
    });
    global.append(tout, document.createTextNode(' Tout (dé)sélectionner'));
    this._content.appendChild(global);

    const colorier = this._peutColorier();
    for (const { genre } of genres) {
      const ligne = document.createElement('div');
      ligne.className = 'amgt-ditp-diov-genre-row';
      ligne.style.cssText = 'display:flex;align-items:center;gap:8px';

      const label = document.createElement('label');
      label.className = 'amgt-checkbox-row';
      label.style.flex = '1';
      const case_ = document.createElement('input');
      case_.type = 'checkbox';
      case_.checked = store.isSelected(genre);
      case_.addEventListener('change', () => { store.toggle(genre); this._render(); });
      label.append(case_, document.createTextNode(' ' + AMGT4CEM_DitpDiovGenres.libelle(genre)));

      const couleur = this._essais[genre] || AMGT4CEM_DitpDiovGenres.couleur(genre);
      let pastille;
      if (colorier) {
        pastille = document.createElement('input');
        pastille.type = 'color';
        pastille.value = couleur;
        pastille.title = 'Couleur du genre, la même pour tout le monde (droit « attributs »)';
        pastille.addEventListener('input', () => {
          this._essais[genre] = pastille.value;
          AMGT4CEM_DitpDiovGenres.recolorer({ ...this._essais });
          this._barreCouleurs();
        });
      } else {
        pastille = document.createElement('span');
        pastille.className = 'amgt-topo-color-dot';
        pastille.style.background = couleur;
      }
      ligne.append(label, pastille);
      this._content.appendChild(ligne);
    }
    this._barreCouleurs();
  },

  // ---------------------------------------------------------------- couleurs : enregistrement pour tous
  _dire(texte, erreur) {
    let p = this._barre.querySelector('.amgt-ditp-diov-msg');
    if (!p) { p = document.createElement('p'); p.className = 'amgt-settings-hint amgt-ditp-diov-msg'; this._barre.prepend(p); }
    p.textContent = texte || '';
    p.classList.toggle('amgt-default-bar-error', !!erreur);
  },

  _barreCouleurs() {
    const msg = this._barre.querySelector('.amgt-ditp-diov-msg');
    const texte = msg ? msg.textContent : '';
    this._barre.innerHTML = '';
    if (!this._peutColorier()) return;
    const essais = Object.keys(this._essais);
    this._dire(essais.length ? '' : texte);
    if (!essais.length) return;
    const rangee = document.createElement('div');
    rangee.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:8px 0';
    const bouton = (texte, f, cls = 'amgt-btn') => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = cls; b.textContent = texte;
      b.addEventListener('click', f);
      return b;
    };
    rangee.append(
      bouton('Enregistrer les couleurs pour tous', () => this._enregistrer(), 'amgt-btn amgt-btn--primary'),
      bouton('Annuler', () => this._annulerEssais()));
    this._barre.appendChild(rangee);
    this._dire('Couleurs essayées sur la carte, pas encore enregistrées : elles seront les mêmes pour tous les utilisateurs.');
  },

  _enregistrer() {
    if (!AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl) return this._dire('Adresse du relais non renseignée (Réglages > Avancé > Services et relais).', true);
    const code = AMGT4CEM_PeLabelAnchors.getAdminCode();
    if (code) return this._envoyer(code);
    this._barre.innerHTML = '';
    this._dire('Code administrateur du relais, pour enregistrer les couleurs :');
    const champ = document.createElement('input');
    champ.type = 'password'; champ.autocomplete = 'off'; champ.placeholder = 'Code administrateur'; champ.className = 'amgt-default-bar-input';
    const ok = document.createElement('button');
    ok.type = 'button'; ok.className = 'amgt-btn amgt-btn--primary'; ok.textContent = 'Valider';
    const non = document.createElement('button');
    non.type = 'button'; non.className = 'amgt-btn'; non.textContent = 'Annuler';
    const valider = () => (champ.value.trim() ? this._envoyer(champ.value.trim()) : this._dire('Saisir le code administrateur.', true));
    ok.addEventListener('click', valider);
    champ.addEventListener('keydown', (e) => { if (e.key === 'Enter') valider(); });
    non.addEventListener('click', () => { this._dire(''); this._barreCouleurs(); });
    this._barre.append(champ, ok, non);
    champ.focus();
  },

  async _envoyer(code) {
    this._dire('Enregistrement…');
    try {
      const url = AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl;
      await AMGT4CEM_PeLabelAnchors.checkConnection(url, code);
      AMGT4CEM_PeLabelAnchors.setAdminCode(code);
      // Fichier relu à neuf : on ne change que la couleur des genres modifiés.
      const r = await fetch(`./config/ditp-diov/vocabulaires.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`Vocabulaire DITP-DIOV illisible (HTTP ${r.status}).`);
      const voc = await r.json();
      for (const [genre, c] of Object.entries(this._essais)) {
        if (voc.genres && voc.genres[genre]) voc.genres[genre].couleur = c;
      }
      voc.date = new Date().toISOString().slice(0, 10);
      await AMGT4CEM_PeLabelAnchors.putToRelay(url, 'shared/ditp-diov/vocabulaires', voc, code);
      // Mémoire de l'appareil à jour tout de suite (les autres appareils l'ont après le redéploiement).
      const genres = (AMGT4CEM_Referentiel.vocabulaires || {}).genres || {};
      for (const [genre, c] of Object.entries(this._essais)) if (genres[genre]) genres[genre].couleur = c;
      this._essais = {};
      AMGT4CEM_DitpDiovGenres.recolorer();
      this._render();
      this._dire('✓ Couleurs enregistrées pour tous (visibles par les autres après le redéploiement du site, environ 1 minute).');
    } catch (err) {
      AMGT4CEM_PeLabelAnchors.setAdminCode('');
      this._barreCouleurs();
      this._dire(err.message, true);
    }
  },
};
