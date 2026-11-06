/**
 * Outil d'administration « Dessiner une zone » (usage exceptionnel, réservé aux administrateurs).
 *
 * Un lieu (auvent, passerelle, ascenseur...) est un ENSEMBLE d'objets UrbIS Topo (lignes). L'outil permet de
 * choisir ces objets : toucher un objet UrbIS Topo affiché sur la carte l'ajoute au lieu (ou le retire) ;
 * le tracé au viseur (chaîne d'arpenteur) dessine une forme à la main.
 * L'enregistrement écrit data/lieux/lieux.json via le relais (route shared/lieux/lieux, code administrateur) :
 *   { version: 1, crs: 'EPSG:31370', lieux: { SLUG: { nom, genre, tolerance_m, objets: [{ id, couche, code, type, lignes }] } } }
 * `lignes` = géométrie en Lambert 72 (mètres, au cm) : le calcul « ce point est-il dans le lieu ? » (zone = objets
 * élargis de `tolerance_m`) se fera sans appeler UrbIS. Les emprises dessinées (dépôt Delta) restent des polygones
 * (data/plans-patrimoine/temp-delta-mod.json), autre type de lieu.
 */
const AMGT4CEM_LieuxTool = {
  FILE: './data/lieux/lieux.json',
  ROUTE: 'shared/lieux/lieux',
  _map: null,
  _btn: null,
  _active: false,
  _panel: null,
  _group: null, // objets candidats (cliquables)
  _cands: new Map(), // clé « couche:id » -> { key, id, couche, code, type, lignes (Lambert), sel, layers[] }
  _lieux: {},
  _viseurOn: true, // tracé au viseur (✋ : déplacer la carte à la place)
  DECALAGE_PX: 60, // décalage du viseur au-dessus du doigt (pas à la souris)

  init(map, btn) {
    this._map = map;
    this._btn = btn;
    map.createPane('amgtLieuxPane').style.zIndex = 655;
    this._group = L.layerGroup();
    btn.addEventListener('click', () => this.toggle());
  },

  async toggle() {
    if (this._active) return this._demanderFermeture();
    if (!AMGT4CEM_PlansPrefs.outilLieuxDisponible()) return; // droit « plans » + case cochée dans les Réglages
    this._active = true;
    this._btn.classList.add('amgt-btn--active');
    this._group.addTo(this._map);
    await this._readLieux();
    this._clickH = (e) => this._surClic(e);
    this._map.on('click', this._clickH);
    this._vueH = () => this._aimantVue();
    this._map.on('moveend', this._vueH);
    this._cur = '';
    this._dirty = false;
    this._hist = [];
    this._buildPanel();
  },

  /** Fermeture demandée par l'utilisateur (✕ ou bouton de la barre) : confirmation s'il y a des modifications non enregistrées. */
  _demanderFermeture() {
    if (this._dirty && !confirm('Fermer l\'outil et abandonner les modifications non enregistrées ?')) return;
    this.close();
  },

  close() {
    this._active = false;
    if (this._clickH) this._map.off('click', this._clickH);
    if (this._vueH) this._map.off('moveend', this._vueH);
    clearTimeout(this._aimantTimer);
    this._aimantPts = [];
    this._traceAbandon();
    this._viseurStop();
    this._modeActif = null;
    this._map.getContainer().classList.remove('amgt-lieux-ptr');
    this._btn.classList.remove('amgt-btn--active');
    this._syncDrag();
    this._group.clearLayers();
    this._cands.clear();
    if (this._apercuLayer) { this._map.removeLayer(this._apercuLayer); this._apercuLayer = null; }
    if (this._opsApercuLayer) { this._map.removeLayer(this._opsApercuLayer); this._opsApercuLayer = null; }
    if (this._refLayer) { this._map.removeLayer(this._refLayer); this._refLayer = null; }
    if (this._docClic) { document.removeEventListener('click', this._docClic); this._docClic = null; }
    this._cur = ''; this._dirty = false; this._hist = [];
    this._map.removeLayer(this._group);
    if (this._panel) this._panel.remove();
    this._panel = null;
  },

  async _readLieux() {
    let lus = {};
    try {
      const r = await fetch(`${this.FILE}?t=${Date.now()}`);
      lus = r.ok ? ((await r.json()).lieux || {}) : {};
    } catch (err) {
      lus = {};
    }
    this._lieux = this._recents(lus);
  },

  // Après un enregistrement, le fichier du site n'est mis à jour qu'après le déploiement (environ une minute) : le relire
  // aussitôt ferait réapparaître un lieu supprimé (et le renvoyer au prochain enregistrement) ou perdre un renommage.
  // Le dernier état envoyé est donc gardé par l'onglet (sessionStorage) et prévaut sur le fichier pendant 10 minutes,
  // ou jusqu'à ce que le fichier le rattrape. Même règle dans patrimoineLayer.js (_lieuxRecents).
  CLE_ENVOYE: 'amgt4cem.lieux.envoye',
  COMBLEMENT_M: 1.5, // Remplir : une ouverture plus étroite (m) entre deux lignes est comblée par un segment droit
  _recents(lus) {
    try {
      const e = JSON.parse(sessionStorage.getItem(this.CLE_ENVOYE) || 'null');
      if (!e || Date.now() - e.at > 10 * 60 * 1000) return lus;
      if (JSON.stringify(e.lieux) === JSON.stringify(lus)) { sessionStorage.removeItem(this.CLE_ENVOYE); return lus; }
      return e.lieux;
    } catch (err) { return lus; }
  },

  // ---------------------------------------------------------------- icônes harmonisées
  // Mêmes icônes que les autres menus : 23 px, trait de 0,8 px, bleu des boutons, sans cadre. Crayon, poubelle, main et
  // sélecteur viennent de src/annotate/icons (masques colorés par currentColor).
  _svg(c) { return `<svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="0.835" stroke-linecap="round" stroke-linejoin="round">${c}</svg>`; },
  _msk(nom) { return `<span class="amgt-lieux-ic" aria-hidden="true" style="--m:url(src/annotate/icons/icone-${nom}.svg)"></span>`; },
  get ICO() {
    return {
      disquette: this._svg('<path d="M5 3h11.5L21 7.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3"/><path d="M7 21v-8h10v8"/>'),
      fermer: this._svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9l6 6M15 9l-6 6"/>'),
      annuler: this._svg('<g transform="matrix(-1 0 0 1 24 0)"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.5v4.5h-4.5"/></g>'),
      replier: this._svg('<path d="M6 9l6 6 6-6"/>'),
      deplier: this._svg('<path d="M6 15l6-6 6 6"/>'),
      polygone: this._svg('<path d="M12 3.5l7.5 4.3v8.4L12 20.5l-7.5-4.3V7.8z"/>'),
      oeil: this._svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
      oeilBarre: this._svg('<path d="M2.5 12S6 5.5 12 5.5c1.6 0 3 .5 4.2 1.2M21.5 12S18 18.5 12 18.5c-1.6 0-3-.5-4.2-1.2"/><path d="M4 4l16 16"/>'),
      crayon: this._msk('crayon'),
      poubelle: this._msk('poubelle'),
      main: this._msk('deplacer'),
      objet: this._msk('selection'),
      remplir: this._svg('<path d="M5 5h14v14H5z"/><path d="M5 10l5-5M5 15l10-10M5 19l14-14M10 19l9-9M15 19l4-4"/>'),
      unir: this._svg('<circle cx="9" cy="13" r="5"/><circle cx="15" cy="13" r="5"/><path d="M19 3v5M16.5 5.5h5"/>'),
      soustraire: this._svg('<circle cx="9" cy="13" r="5"/><circle cx="15" cy="13" r="5" stroke-dasharray="2 2"/><path d="M16.5 5.5h5"/>'),
      modifier: this._svg('<path d="M4 18l5-8 5 5 6-9"/><circle cx="4" cy="18" r="1.7"/><circle cx="9" cy="10" r="1.7"/><circle cx="14" cy="15" r="1.7"/><circle cx="20" cy="6" r="1.7"/>'),
    };
  },

  // ---------------------------------------------------------------- panneau
  _buildPanel() {
    const p = document.createElement('div');
    p.id = 'amgt-lieux-panel';
    p.innerHTML = `
      <div class="amgt-lieux-row amgt-lieux-l1">
        <div class="amgt-lieux-combo">
          <button type="button" data-a="combo" class="amgt-lieux-combo-btn" aria-haspopup="listbox" title="Créer une zone, ou afficher / éditer / supprimer une zone enregistrée"><span data-f="combolab">Créer une nouvelle zone</span><span aria-hidden="true">▾</span></button>
          <ul class="amgt-lieux-combo-liste amgt-hidden" data-f="combolist" role="listbox"></ul>
        </div>
        <button type="button" data-a="retour" class="amgt-lieux-l1-retour" title="Retour : annuler la dernière opération" aria-label="Retour">↶</button>
        <button type="button" data-a="reduire" title="Réduire à cette ligne / redéployer la fenêtre" aria-label="Réduire">▾</button>
      </div>
      <div class="amgt-lieux-sec amgt-lieux-body">
        <div class="amgt-lieux-row"><input data-f="nom" placeholder="Nom de la zone (ex. Ascenseur POELAERT)" /><select data-f="genre" title="Genre de la zone" aria-label="Genre de la zone"></select></div>
        <div class="amgt-lieux-corps">
          <div class="amgt-lieux-liste" data-f="liste"></div>
          <input class="amgt-lieux-haut" data-f="haut" type="range" min="0" max="100" value="35" orient="vertical" title="Hauteur de la liste" aria-label="Hauteur de la liste" />
        </div>
        <div class="amgt-lieux-row amgt-lieux-modes" role="toolbar" aria-label="Outils">
          <button type="button" data-m="trace" title="Dessiner des lignes (chaîne d'arpenteur) ; les surfaces se font avec Remplir"><span data-i="trace"></span><small>Lignes</small></button>
          <button type="button" data-m="remplir" title="Remplir : toucher une zone fermée par des lignes visibles pour en faire une surface"><span data-i="remplir"></span><small>Remplir</small></button>
          <button type="button" data-m="unir" title="Unir des surfaces"><span data-i="unir"></span><small>Unir</small></button>
          <button type="button" data-m="soustraire" title="Soustraire des surfaces à une surface de base"><span data-i="soustraire"></span><small>Soustraire</small></button>
          <button type="button" data-m="modifier" title="Modifier les points d'une ligne ou d'un contour"><span data-i="modifier"></span><small>Modifier</small></button></div>
        <div class="amgt-lieux-compte" data-f="compte"></div>
        <div class="amgt-lieux-row amgt-lieux-trace amgt-hidden" data-f="tracebarre">
          <span data-f="chaine"></span>
          <button type="button" data-a="t-main" title="Déplacer la carte au doigt (désactive le viseur)">✋</button>
          <button type="button" data-a="t-suppr" class="amgt-lieux-edonly amgt-hidden" title="Supprimer le point sélectionné">🗑 Point</button>
          <button type="button" data-a="t-valider" class="amgt-lieux-edonly amgt-hidden" title="Terminer la modification">✓ Terminer</button></div>
        <div class="amgt-lieux-row amgt-lieux-poly amgt-hidden" data-f="opsbarre">
          <span data-f="opsinfo"></span>
          <button type="button" data-a="o-appliquer" title="Confirmer l'opération proposée">Confirmer</button></div>
        <div class="amgt-lieux-row amgt-lieux-l9">
          <label class="amgt-lieux-aimant" data-f="aimantlab" title="Aimant : le viseur s'accroche au point remarquable proche s'il y reste 1 s (0 = sans aimant)"><span class="amgt-lieux-aimant-lab"></span><input data-f="aimant" type="number" min="0" max="50" step="1" value="5" /> m</label>
          <span class="amgt-lieux-sp"></span>
          <button type="button" data-a="retour" title="Retour : annuler la dernière opération" aria-label="Retour">↶</button>
          <button type="button" data-a="enreg" title="Enregistrer la zone" aria-label="Enregistrer">💾</button>
          <button type="button" data-a="fermer" title="Fermer l'outil en abandonnant les modifications non enregistrées" aria-label="Fermer">✕</button></div>
        <div class="amgt-lieux-etat" data-f="etat"></div>
      </div>`;
    document.body.appendChild(p);
    this._panel = p;
    this._genresInit(p.querySelector('[data-f="genre"]'));
    p.querySelector('[data-f="genre"]').addEventListener('change', () => { this._dirty = true; });
    const f = (n) => p.querySelector(`[data-f="${n}"]`);
    const I = this.ICO;
    const mettre = (sel, html, garder, cadre) => { for (const el of p.querySelectorAll(sel)) { const t = garder ? el.textContent.replace(/^\S+\s*/, '') : ''; el.innerHTML = html + (t ? ` <span>${t}</span>` : ''); if (!cadre) el.classList.add('amgt-ic-btn'); } };
    mettre('[data-a="retour"]', I.annuler);
    mettre('[data-a="enreg"]', I.disquette);
    mettre('[data-a="fermer"]', I.fermer);
    mettre('[data-a="t-main"]', I.main);
    mettre('[data-a="t-suppr"]', I.poubelle, true, true);
    mettre('[data-a="reduire"]', I.replier);
    p.querySelector('[data-a="combo"] [aria-hidden]').innerHTML = I.replier;
    for (const el of p.querySelectorAll('[data-i]')) el.innerHTML = I[el.dataset.i === 'trace' ? 'crayon' : el.dataset.i];
    this._comboRender();
    f('nom').addEventListener('input', () => this._touch());
    f('haut').addEventListener('input', () => this._hauteurListe());
    p.querySelector('.amgt-lieux-aimant-lab').innerHTML = this.SVG_AIMANT;
    try { const v = localStorage.getItem('amgt4cem.lieux.aimant'); if (v !== null && v !== '') f('aimant').value = v; } catch (err) { /* stockage indisponible : valeur par défaut */ }
    f('aimant').addEventListener('change', () => { try { localStorage.setItem('amgt4cem.lieux.aimant', f('aimant').value); } catch (err) { /* ignoré */ } });
    this._hauteurListe();
    p.addEventListener('click', (e) => {
      const m = e.target.closest('[data-m]');
      if (m) return this._mode(m.dataset.m === this._modeActif ? null : m.dataset.m); // un 2e clic sur l'outil actif en sort
      // Liste déroulante des lieux : crayon / corbeille d'une ligne, ou la ligne elle-même (charger le lieu).
      const lig = e.target.closest('.amgt-lieux-combo-liste li');
      if (lig) {
        const slug = lig.dataset.slug || '';
        const act = e.target.closest('[data-a]');
        if (act && act.dataset.a === 'l-oeil') return this._oeil(slug); // la liste reste ouverte : on peut en basculer plusieurs
        this._comboFermer();
        if (act && act.dataset.a === 'l-edit') return this._editerLieu(slug);
        if (act && act.dataset.a === 'l-del') return this._supprimerLieu(slug);
        return slug ? this._editerLieu(slug) : this._nouveauLieu(); // le nom charge le lieu : objets cochables dans la liste, nom dans le champ
      }
      const a = e.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'combo') this._comboBasculer(a);
      else if (a.dataset.a === 'fermer') this._demanderFermeture();
      else if (a.dataset.a === 'reduire') this._reduire();
      else if (a.dataset.a === 'retour') this._retour();
      else if (a.dataset.a === 't-main') { this._viseurOn = !this._viseurOn; a.classList.toggle('amgt-lieux-actif', !this._viseurOn); this._syncDrag(); this._etat(this._viseurOn ? 'Viseur actif.' : 'Carte déplaçable au doigt : ✋ à nouveau pour reprendre le tracé.'); }
      else if (a.dataset.a === 't-valider') this._traceTerminer();
      else if (a.dataset.a === 't-suppr') this._traceSupprimer();
      else if (a.dataset.a === 'o-appliquer') this._opsAppliquer();
      else if (a.dataset.a === 'enreg') this._enregistrer();
    });
    // Un clic ailleurs referme la liste déroulante.
    // (une cible retirée de la page par le redessin de la liste, comme l'œil, n'est pas un clic ailleurs)
    this._docClic = (e) => { if (this._panel && e.target.isConnected && !e.target.closest('.amgt-lieux-combo')) this._comboFermer(); };
    document.addEventListener('click', this._docClic);
    L.DomEvent.disableClickPropagation(p);
    L.DomEvent.disableScrollPropagation(p);
    this._renderListe();
    this._mode('remplir');
  },

  /** Réduit la fenêtre à sa première ligne (liste des lieux, retour, redéployer) ; un second appui la redéploie. */
  _reduire() {
    const r = this._panel.classList.toggle('amgt-lieux-reduit');
    this._panel.querySelector('[data-a="reduire"]').innerHTML = r ? this.ICO.deplier : this.ICO.replier;
    this._comboFermer();
  },

  /** Hauteur de la liste : curseur vertical sur le côté (0 = liste repliée). */
  _hauteurListe() {
    const v = Number(this._f('haut').value);
    const l = this._f('liste');
    l.style.maxHeight = `${Math.round(v * 0.5)}vh`;
    l.style.display = v === 0 ? 'none' : '';
  },

  /** Outil actif : 'trace' (lignes) | 'remplir' | 'unir' | 'soustraire' | 'modifier' (un seul à la fois). */
  _mode(m) {
    const tr = (x) => x === 'trace' || x === 'modifier'; // outils qui utilisent le viseur
    if (this._trace && m !== this._modeActif) this._traceTerminer(); // changer d'outil valide le tracé en cours
    if (tr(this._modeActif) && !tr(m)) this._viseurStop();
    this._modeActif = m;
    // Unir : les surfaces cochées dans la liste sont présélectionnées (on peut en toucher d'autres ou en désélectionner).
    this._ops = m === 'unir' ? [...this._cands.values()].filter((c) => c.sel && this._estSurface(c)).map((c) => c.key) : [];
    if (tr(m)) this._viseurStart();
    this._syncDrag();
    // Remplir / Unir / Soustraire : pointeur normal de la souris (pas la main de Leaflet, ni sur les tracés)
    this._map.getContainer().classList.toggle('amgt-lieux-ptr', m === 'remplir' || m === 'unir' || m === 'soustraire');
    for (const b of this._panel.querySelectorAll('[data-m]')) b.classList.toggle('amgt-lieux-actif', b.dataset.m === m);
    this._f('aimantlab').classList.toggle('amgt-hidden', !tr(m)); // l'aimant ne sert qu'aux outils à viseur (Lignes, Modifier)
    this._f('opsbarre').classList.toggle('amgt-hidden', m !== 'unir' && m !== 'soustraire');
    const aide = {
      trace: 'Lignes : glisser, le viseur pose un point au relâcher. Toucher le dernier point (ou changer d\'outil) termine la ligne ; toucher le premier point la ferme. Une ligne reste une ligne : les surfaces se font avec Remplir.',
      remplir: 'Remplir : toucher une zone fermée par des lignes visibles (UrbIS Topo affiché, autres zones non masquées, tes lignes) pour en faire une surface ; les îlots restent vides.',
      unir: 'Unir : les surfaces cochées sont présélectionnées ; toucher d\'autres surfaces pour les ajouter, ou à nouveau pour les désélectionner. L\'union proposée s\'affiche : la confirmer.',
      soustraire: 'Soustraire : toucher la surface de base, puis celles à retrancher (les toucher à nouveau pour désélectionner). Le résultat proposé s\'affiche : le confirmer.',
      modifier: 'Modifier : toucher une ligne ou un contour de la liste, puis déplacer ses points (poignées), ajouter (« + ») ou retirer (🗑 Point). ✓ Terminer ou autre outil pour finir.',
    };
    this._etat(aide[m] || 'Aucun outil actif : choisir un outil, ou cocher / décocher des objets de la liste.');
    this._traceInfo();
    this._opsMaj();
    this._apercu();
    if (m === 'trace' || m === 'modifier') this._chargerAimant(); // (Remplir charge ses propres murs autour du point touché)
  },

  _f(n) { return this._panel.querySelector(`[data-f="${n}"]`); },

  /** Après un enregistrement, un renommage ou une suppression : lieu en cours d'édition = `slug`, liste déroulante reconstruite. */
  _majListe(slug) {
    this._cur = slug && this._lieux[slug] ? slug : '';
    this._comboRender();
  },
  _etat(t, err) { const e = this._f('etat'); e.textContent = t; e.style.color = err ? '#b3261e' : '#0b5c75'; },

  // ------------------------------------------------------ liste déroulante des lieux
  _comboRender() {
    const ul = this._f('combolist');
    ul.textContent = '';
    const ligne = (slug, nom) => {
      const li = document.createElement('li');
      li.dataset.slug = slug;
      li.setAttribute('role', 'option');
      if (slug === (this._cur || '')) li.classList.add('amgt-lieux-combo-cur');
      const t = document.createElement('span');
      t.className = 'amgt-lieux-combo-nom';
      t.textContent = nom;
      li.appendChild(t);
      if (slug) {
        const ed = document.createElement('button');
        ed.type = 'button'; ed.dataset.a = 'l-edit'; ed.innerHTML = this.ICO.crayon; ed.className = 'amgt-ic-btn'; ed.title = 'Éditer cette zone (reprendre l\'édition)'; ed.setAttribute('aria-label', `Éditer ${nom}`);
        const del = document.createElement('button');
        del.type = 'button'; del.dataset.a = 'l-del'; del.innerHTML = this.ICO.poubelle; del.className = 'amgt-ic-btn'; del.title = 'Supprimer cette zone'; del.setAttribute('aria-label', `Supprimer ${nom}`);
        const visible = this._estVisible(slug);
        const oe = document.createElement('button');
        oe.type = 'button'; oe.dataset.a = 'l-oeil'; oe.innerHTML = visible ? this.ICO.oeil : this.ICO.oeilBarre; oe.className = 'amgt-ic-btn';
        oe.title = visible ? 'Masquer cette zone sur la carte' : 'Afficher cette zone sur la carte'; oe.setAttribute('aria-label', `${visible ? 'Masquer' : 'Afficher'} ${nom}`); oe.setAttribute('aria-pressed', visible ? 'true' : 'false');
        li.append(ed, oe, del);
      }
      return li;
    };
    ul.appendChild(ligne('', '＋ Créer une nouvelle zone'));
    for (const [k, l] of Object.entries(this._lieux)) ul.appendChild(ligne(k, l.nom));
    this._f('combolab').textContent = this._cur && this._lieux[this._cur] ? this._lieux[this._cur].nom : 'Créer une nouvelle zone';
    this._refsMaj();
  },
  /** Ouvre / ferme la liste ; elle est en position fixe (au-dessus du bouton) pour ne pas être rognée par le défilement du panneau. */
  _comboBasculer(btn) {
    const ul = this._f('combolist');
    if (!ul.classList.contains('amgt-hidden')) return ul.classList.add('amgt-hidden');
    const r = btn.getBoundingClientRect();
    ul.classList.remove('amgt-hidden');
    ul.style.left = `${r.left}px`;
    ul.style.width = `${r.width}px`;
    ul.style.bottom = `${window.innerHeight - r.top + 2}px`;
    ul.style.maxHeight = `${Math.max(120, r.top - 70)}px`;
  },
  _comboFermer() { if (this._panel) this._f('combolist').classList.add('amgt-hidden'); },

  _confirmerAbandon() { return !this._dirty || confirm('Des modifications ne sont pas enregistrées. Les abandonner ?'); },

  // Œil de la liste : affiche ou masque ce lieu dans la couche des lieux de la carte (réglage propre à cet appareil,
  // géré par patrimoineLayer.js). Œil ouvert = lieu affiché ; œil barré = lieu masqué.
  _estVisible(slug) { return !AMGT4CEM_PatrimoineLayer.lieuMasque(slug); },
  _oeil(slug) {
    if (!this._lieux[slug]) return;
    AMGT4CEM_PatrimoineLayer.masquerLieu(slug, this._estVisible(slug));
    this._comboRender();
  },

  /** Genres proposés : ceux du vocabulaire Métro (config/metro/vocabulaires.json) + « autre » (par défaut). */
  GENRES_DEFAUT: { station: 'Station', tunnel: 'Tunnel (tronçon)', depot: 'Dépôt', ouvrage_atypique: 'Ouvrage atypique' },
  _genresInit(sel) {
    const remplir = (genres) => {
      const garde = sel.value || 'autre';
      sel.textContent = '';
      for (const [g, lib] of [...Object.entries(genres), ['autre', 'Autre']]) { const o = document.createElement('option'); o.value = g; o.textContent = lib; sel.append(o); }
      sel.value = [...sel.options].some((o) => o.value === garde) ? garde : 'autre';
    };
    remplir(this.GENRES_DEFAUT);
    fetch('./config/metro/vocabulaires.json').then((r) => (r.ok ? r.json() : null)).then((v) => {
      if (v && v.genres) remplir(Object.fromEntries(Object.entries(v.genres).map(([g, d]) => [g, d.libelle || g])));
    }).catch(() => { /* liste par défaut conservée */ });
  },
  /** Genre d'une zone enregistrée ; un genre absent des options (ou une zone ancienne sans genre) = « autre ». */
  _genreChoisir(g) {
    const sel = this._f('genre');
    sel.value = g && [...sel.options].some((o) => o.value === g) ? g : 'autre';
  },

  _nouveauLieu() {
    if (!this._confirmerAbandon()) return;
    this._traceAbandon();
    this._clearCands();
    this._cur = '';
    this._f('nom').value = '';
    this._f('genre').value = 'autre';
    this._hist = []; this._dirty = false;
    this._comboRender();
    this._renderListe();
    this._etat('Nouvelle zone : nommer la zone puis toucher des objets, ou tracer une chaîne.');
  },

  _editerLieu(slug) {
    if (slug === this._cur) return; // déjà chargé : recharger perdrait les modifications en cours
    if (!this._confirmerAbandon()) return;
    this._chargerLieu(slug);
  },

  async _supprimerLieu(slug) {
    const l = this._lieux[slug];
    if (!l) return;
    if (!confirm(`Supprimer définitivement la zone « ${l.nom} » ?`)) return;
    const reste = { ...this._lieux };
    delete reste[slug];
    try {
      this._etat('Suppression…');
      await this._envoyer(reste);
      if (slug === this._cur) { this._dirty = false; this._nouveauLieu(); } else this._comboRender();
      this._etat(`Zone « ${l.nom} » supprimée.`);
    } catch (err) {
      this._etat(err.message, true);
    }
  },

  // ------------------------------------------------------------- retour arrière
  _touch() { this._dirty = true; },
  _snap() {
    this._dirty = true;
    const o = [...this._cands.values()].map((c) => ({ id: c.id, couche: c.couche, code: c.code, type: c.type, lignes: c.lignes.map((l) => l.map((q) => [q[0], q[1]])), sel: c.sel }));
    (this._hist = this._hist || []).push(o);
    if (this._hist.length > 60) this._hist.shift();
  },
  /** ↶ : annule la dernière opération (point du tracé en cours, sinon état précédent de la liste des objets). */
  _retour() {
    const t = this._trace;
    if (t && t.hist && t.hist.length) return this._traceAnnuler();
    if (!this._hist || !this._hist.length) return this._etat('Rien à annuler.', true);
    if (t) this._traceAbandon();
    const o = this._hist.pop();
    this._clearCands();
    for (const x of o) this._addCand({ id: x.id, couche: x.couche, code: x.code, type: x.type, lignes: x.lignes }, x.sel);
    this._renderListe();
    this._etat('Opération annulée.');
  },

  _chargerLieu(slug) {
    this._traceAbandon(); // un tracé en cours (ou en édition) resterait sinon dessiné sur la carte
    this._clearCands();
    this._cur = slug && this._lieux[slug] ? slug : '';
    this._hist = []; this._dirty = false;
    this._comboRender();
    if (!this._cur) { this._f('nom').value = ''; this._f('genre').value = 'autre'; this._renderListe(); return; }
    const l = this._lieux[slug];
    this._f('nom').value = l.nom;
    this._genreChoisir(l.genre);
    for (const o of l.objets) this._addCand({ id: o.id, couche: o.couche, code: o.code, type: o.type, lignes: o.lignes }, true);
    this._renderListe();
    const pts = l.objets.flatMap((o) => o.lignes.flat()).map((q) => AMGT4CEM_CRS.lambertToLatLng(q));
    if (pts.length) this._map.fitBounds(L.latLngBounds(pts).pad(0.3));
    this._etat(`Zone « ${l.nom} » en édition.`);
  },

  _clearCands() { this._group.clearLayers(); this._cands.clear(); },

  _renderListe() {
    const liste = this._f('liste');
    liste.innerHTML = '';
    for (const c of this._cands.values()) {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = c.sel;
      cb.addEventListener('change', () => { this._snap(); this._set(c, cb.checked); });
      lab.dataset.key = c.key;
      const tx = document.createElement('span');
      tx.textContent = ` ${c.type || c.code} #${c.id}${c.type === this.TYPE_SURF && c.lignes.length > 1 ? ` (${c.lignes.length - 1} vide${c.lignes.length > 2 ? 's' : ''})` : ''}`;
      // Unir / Soustraire : toucher le nom d'une surface la désigne comme opérande (la case reste la sélection du lieu).
      tx.addEventListener('click', (ev) => { if (this._modeActif === 'unir' || this._modeActif === 'soustraire') { ev.preventDefault(); this._opsToggle(c); } });
      lab.append(cb, tx);
      // ✎ sur toute ligne de la liste : un tracé s'édite tel quel ; un objet UrbIS est d'abord converti en tracé modifiable.
      const ed = document.createElement('button');
      ed.type = 'button';
      ed.innerHTML = this.ICO.crayon;
      ed.title = c.couche === 'Trace' ? 'Éditer ce tracé (poignées)' : 'Éditer cet objet UrbIS : il devient un tracé dont on déplace, ajoute ou retire les points';
      ed.className = 'amgt-lieux-edit amgt-ic-btn';
      ed.addEventListener('click', (ev) => { ev.preventDefault(); this._editerCand(c); });
      lab.appendChild(ed);
      liste.appendChild(lab);
      c.cb = cb;
    }
    const n = [...this._cands.values()].filter((c) => c.sel).length;
    this._f('compte').textContent = `${n} coché(s) / ${this._cands.size}`;
    this._apercu();
    this._opsMaj();
  },

  _set(c, v) {
    c.sel = v;
    if (c.cb) c.cb.checked = v;
    for (const l of c.layers) l.setStyle(this._style(v, c));
    const n = [...this._cands.values()].filter((x) => x.sel).length;
    this._f('compte').textContent = `${n} coché(s) / ${this._cands.size}`;
    this._apercu();
  },

  /** Style d'un objet : trait orange (coché) ou gris ; une surface est remplie, un vide est hachuré (trait pointillé, sans remplissage). */
  _style(sel, c) {
    const st = sel ? { color: '#e65100', weight: 6, opacity: 0.95 } : { color: '#757575', weight: 4, opacity: 0.7 };
    if (c && this._estSurface(c)) return { ...st, weight: 3, fill: true, fillColor: st.color, fillOpacity: sel ? 0.3 : 0.12 };
    if (c && c.type === this.TYPE_VIDE) return { ...st, weight: 3, dashArray: '5 4', fill: false };
    return { ...st, fill: false };
  },

  _addCand(o, sel) {
    const key = `${o.couche}:${o.id}`;
    if (this._cands.has(key)) { if (sel) this._set(this._cands.get(key), true); return; }
    const c = { key, ...o, sel, layers: [] };
    if (c.type === this.TYPE_SURF && this._estSurface(c)) {
      // Surface : un seul polygone ; les anneaux suivants sont ses vides (trous).
      const pl = L.polygon(o.lignes.map((l) => l.map((q) => AMGT4CEM_CRS.lambertToLatLng(q))), { pane: 'amgtLieuxPane', ...this._style(sel, { ...c, layers: [] }) });
      this._group.addLayer(pl);
      c.layers.push(pl);
      this._cands.set(key, c);
      return;
    }
    for (const ligne of o.lignes) {
      const ll = ligne.map((q) => AMGT4CEM_CRS.lambertToLatLng(q));
      const st = { pane: 'amgtLieuxPane', ...this._style(sel, { ...c, layers: [] }) };
      const pl = this._estSurface(c) && o.lignes.length === 1 ? L.polygon(ll, st) : L.polyline(ll, st);
      this._group.addLayer(pl);
      c.layers.push(pl);
    }
    this._cands.set(key, c);
  },

  /** Le glisser de la carte est coupé pendant le tracé au viseur (✋ le rend) : un doigt pose / déplace, deux doigts zooment. */
  _syncDrag() {
    const m = this._map;
    if (!m) return;
    const viseur = this._active && (this._modeActif === 'trace' || (this._modeActif === 'modifier' && !!this._trace)) && this._viseurOn;
    if (viseur) { m.dragging.disable(); m.doubleClickZoom.disable(); } else { m.dragging.enable(); m.doubleClickZoom.enable(); }
    // Sans glisser Leaflet, le navigateur reprendrait le geste (défilement) et l'annulerait au bout de quelques pixels
    // (pointercancel) : le viseur disparaîtrait. touch-action: none le garde ; le zoom à deux doigts reste géré par Leaflet.
    m.getContainer().style.touchAction = viseur ? 'none' : '';
  },

  /**
   * Interroge UrbIS Topo (types actuellement affichés seulement) dans une emprise Lambert.
   * @returns {Promise<{objets: object[]|null, notes: string[]}>} objets null si aucun type linéaire n'est affiché
   */
  /** Objets UrbIS Topo actuellement affichés sur la carte ? (couche activée, types choisis, zoom suffisant, opacité > 0) */
  _urbisAffiche() { return typeof AMGT4CEM_UrbisTopoLayer !== 'undefined' && AMGT4CEM_UrbisTopoLayer.estAffichee(); },

  async _wfs(x0, y0, x1, y1, signal) {
    const { wfsUrl, version, typeAttribute } = AMGT4CEM_CONFIG.urbisTopo;
    if (!this._urbisAffiche()) return { objets: null, notes: [], tronque: false }; // seuls les objets UrbIS Topo visibles comptent
    const selection = AMGT4CEM_UrbisTopoSelectionStore.getSelection();
    const cat = {};
    for (const e of AMGT4CEM_URBISTOPO_CATALOG) cat[e.code] = e;
    const parCouche = { TopoLines: [], TopoShapes: [] };
    for (const code of Object.keys(selection)) {
      const g = cat[code] && cat[code].geometry;
      if (g === 'ligne') parCouche.TopoLines.push(code);
      else if (g === 'polygone') parCouche.TopoShapes.push(code);
    }
    if (!parCouche.TopoLines.length && !parCouche.TopoShapes.length) return { objets: null, notes: [], tronque: false };
    const MAX = 400;
    // Lignes et surfaces demandées en même temps ; une requête qui ne répond pas en 30 s est abandonnée (message clair).
    const lire = async (ft) => {
      const ctl = new AbortController();
      let delai = false;
      const timer = setTimeout(() => { delai = true; ctl.abort(); }, 30000);
      if (signal) signal.addEventListener('abort', () => ctl.abort());
      try {
        const codes = parCouche[ft].map((c) => `'${c}'`).join(',');
        const params = new URLSearchParams({ service: 'WFS', version, request: 'GetFeature', typeNames: `urbistopo:${ft}`, outputFormat: 'application/json', count: String(MAX + 1), CQL_FILTER: `${typeAttribute} IN (${codes}) AND BBOX(geom,${x0},${y0},${x1},${y1})` });
        const r = await fetch(`${wfsUrl}?${params.toString()}`, { signal: ctl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const feats = (await r.json()).features || [];
        return { ft, feats: feats.slice(0, MAX), tronque: feats.length > MAX };
      } catch (err) {
        return { ft, erreur: delai ? 'le service UrbIS ne répond pas (30 s)' : (ctl.signal.aborted ? 'annulé' : err.message) };
      } finally { clearTimeout(timer); }
    };
    const resultats = await Promise.all(['TopoLines', 'TopoShapes'].filter((ft) => parCouche[ft].length).map(lire));
    const notes = [];
    const objets = [];
    let tronque = false;
    for (const res of resultats) {
      if (res.erreur) { notes.push(`${res.ft} : erreur ${res.erreur}`); continue; }
      notes.push(`${res.ft} : ${res.feats.length}`);
      if (res.tronque) tronque = true;
      for (const f of res.feats) {
        const lignes = this._lignes(f.geometry);
        if (!lignes.length) continue;
        const code = (f.properties || {})[typeAttribute];
        objets.push({ id: (f.properties || {}).ID, couche: res.ft, code, type: `${(cat[code] && cat[code].label) || (f.properties || {}).DESCRFRE || code} (${code})`, lignes });
      }
    }
    return { objets, notes, tronque };
  },

  /** Distance (m) d'un point à une ligne brisée, en Lambert. */
  _distLigne(p, l) {
    let dmin = Infinity;
    for (let i = 0; i < l.length - 1; i++) {
      const [ax, ay] = l[i]; const [bx, by] = l[i + 1];
      const dx = bx - ax; const dy = by - ay;
      const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy))) : 0;
      dmin = Math.min(dmin, Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy)));
    }
    return dmin;
  },

  // ------------------------------------------- objets des autres lieux et de la couche patrimoine
  /** Anneaux (Lambert) -> polygones [[ext, trous…], …] selon le remplissage pair-impair (comme l'affichage du contour). */
  _polysDepuisAnneaux(rings) {
    const pc = this._pc();
    if (!pc || rings.length < 2) return rings.map((r) => [r]);
    try { return pc.xor(...rings.map((r) => [r])); } catch (err) { return rings.map((r) => [r]); }
  },

  /** Autres lieux enregistrés, en sources sélectionnables : surface(s) si le lieu a un contour, sinon ses lignes. */
  _refsLieux() {
    return Object.entries(this._lieux || {}).filter(([k]) => k !== this._cur && !(typeof AMGT4CEM_PatrimoineLayer !== 'undefined' && AMGT4CEM_PatrimoineLayer.lieuMasque(k))).map(([k, l]) => ({
      kind: 'lieu', nom: l.nom, slug: k,
      polys: l.contour && l.contour.length ? this._polysDepuisAnneaux(l.contour) : [],
      lignes: l.contour && l.contour.length ? l.contour : l.objets.flatMap((o) => o.lignes),
      objets: l.objets,
    }));
  },
  /** Affichage discret des autres lieux pendant l'édition : on voit ce qu'on peut sélectionner. */
  _refsMaj() {
    if (!this._map) return;
    if (this._refLayer) { this._map.removeLayer(this._refLayer); this._refLayer = null; }
    const g = L.layerGroup();
    for (const r of this._refsLieux()) for (const l of r.lignes) L.polyline(l.map((q) => AMGT4CEM_CRS.lambertToLatLng(q)), { pane: 'amgtLieuxPane', interactive: false, color: '#0b5c75', weight: 2, opacity: 0.6, dashArray: '2 5' }).addTo(g);
    this._refLayer = g.addTo(this._map);
  },
  _refsPatrimoine() {
    if (typeof AMGT4CEM_PatrimoineLayer === 'undefined' || !AMGT4CEM_PatrimoineLayer.geometriesAffichees) return [];
    return AMGT4CEM_PatrimoineLayer.geometriesAffichees().map((g) => ({ kind: 'patri', nom: g.nom, id: g.id, polys: g.polygones, lignes: g.lignes }));
  },

  _surClic(e) {
    if (this._modeActif === 'remplir') this._remplirClic(e.latlng);
    else if (this._modeActif === 'unir' || this._modeActif === 'soustraire') this._opsClic(e.latlng);
    else if (this._modeActif === 'modifier') this._modifierClic(e.latlng);
  },

  // --------------------------------------------- chaîne d'arpenteur (tracé)
  _fmtM(m) { return `${m.toFixed(2).replace('.', ',')} m`; },

  /** Accroche au sommet le plus proche (objets de la liste, sommets du tracé) dans 12 px, sinon le point lui-même. */
  _accroche(latlng, sauf) {
    const pt = this._map.latLngToContainerPoint(latlng);
    let best = null; let dmin = 12;
    const test = (q) => { const d = pt.distanceTo(this._map.latLngToContainerPoint(q)); if (d < dmin) { dmin = d; best = q; } };
    for (const q of this._pointsRemarquables(sauf)) test(AMGT4CEM_CRS.lambertToLatLng(q));
    return best || latlng;
  },

  _traceLam() { return this._trace.pts.map((q) => { const l = AMGT4CEM_CRS.latLngToLambert(q); return [Math.round(l.x * 100) / 100, Math.round(l.y * 100) / 100]; }); },

  _traceDessin() {
    this._traceLignes();
    this._traceSommets();
  },

  /** Lignes (redessinées en direct pendant qu'on glisse un sommet) ; les longueurs se lisent dans la barre. */
  _traceLignes() {
    const t = this._trace;
    t.group.clearLayers();
    if (!t.pts.length) return this._traceInfo();
    const opt = { pane: 'amgtLieuxPane', color: '#0b5c75', weight: 3, interactive: false };
    t.group.addLayer(t.ferme ? L.polygon(t.pts, { ...opt, fillColor: '#0b5c75', fillOpacity: 0.15 }) : L.polyline(t.pts, opt));
    for (const h of t.trous || []) t.group.addLayer(L.polyline(h.map((q) => AMGT4CEM_CRS.lambertToLatLng(q)), { ...opt, weight: 2, dashArray: '5 4' })); // vides de la surface (non modifiables ici)
    this._traceInfo();
  },

  _traceSommets() {
    const t = this._trace;
    t.sommets.clearLayers();
    const edition = t.phase === 'edition';
    const mk = (q, cls, px) => t.sommets.addLayer(L.marker(q, { pane: 'amgtLieuxPane', interactive: false, keyboard: false, icon: L.divIcon({ className: cls, iconSize: [px, px] }) }));
    // Le sommet tenu sous le viseur n'est pas dessiné : le réticule reste transparent, on voit la carte à travers.
    t.pts.forEach((q, k) => {
      if (this._g && this._g.i === k) return;
      if (edition) mk(q, `amgt-lieux-poignee${t.sel === k ? ' amgt-lieux-poignee--sel' : ''}`, 16);
      else mk(q, 'amgt-lieux-pt', 7);
    });
    if (edition) for (const m of this._milieux()) if (!(this._g && this._g.insere === m.k)) mk(m.ll, 'amgt-lieux-mid', 12);
  },

  /** Milieux des segments (poignées « + » de l'édition) : { k: rang du segment, ll } ; le segment k relie le sommet k au suivant. */
  _milieux() {
    const t = this._trace;
    const n = t.pts.length;
    const out = [];
    for (let k = 0; k < (t.ferme ? n : n - 1); k++) {
      const a = t.pts[k]; const b = t.pts[(k + 1) % n];
      out.push({ k, ll: L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2) });
    }
    return out;
  },

  // ------------------------------------------------------------ viseur
  // Au doigt, le sommet est posé sous un VISEUR décalé de DECALAGE_PX au-dessus du point de contact (le doigt ne cache
  // plus ce qu'on fait) ; il suit le doigt, l'aimant s'applique à lui, le relâcher pose (ou dépose) le sommet.
  // Une presse près d'un sommet existant (24 px) le saisit ; un simple toucher du premier sommet ferme le polygone.
  SVG_VISEUR: '<svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke-linecap="round" aria-hidden="true"><g stroke="#fff" stroke-width="4.4"><circle cx="24" cy="24" r="11" /><path d="M24 4v12M24 32v12M4 24h12M32 24h12" /></g><g stroke="#0b5c75" stroke-width="1.6"><circle cx="24" cy="24" r="11" /><path d="M24 4v12M24 32v12M4 24h12M32 24h12" /></g><circle cx="24" cy="24" r="1.6" fill="#e65100" /></svg>',

  _viseurStart() {
    if (this._vh) return;
    const el = this._map.getContainer();
    this._vh = { down: (e) => this._vDown(e), move: (e) => this._vMove(e), up: (e) => this._vUp(e), cancel: (e) => this._vCancel(e) };
    el.addEventListener('pointerdown', this._vh.down);
    el.addEventListener('pointermove', this._vh.move);
    el.addEventListener('pointerup', this._vh.up);
    el.addEventListener('pointercancel', this._vh.cancel);
  },

  _viseurStop() {
    if (!this._vh) return;
    const el = this._map.getContainer();
    el.removeEventListener('pointerdown', this._vh.down);
    el.removeEventListener('pointermove', this._vh.move);
    el.removeEventListener('pointerup', this._vh.up);
    el.removeEventListener('pointercancel', this._vh.cancel);
    this._vh = null;
    this._viseurAnnule();
  },

  _vPos(e, g) {
    const pt = this._map.mouseEventToContainerPoint(e);
    if (g && g.relatif) {
      // Après le premier point : le déplacement du doigt s'applique au viseur à partir du dernier point posé.
      return this._map.containerPointToLatLng(L.point(g.base.x + pt.x - g.depart.x, g.base.y + pt.y - g.depart.y));
    }
    const dec = e.pointerType === 'mouse' ? 0 : this.DECALAGE_PX;
    return this._map.containerPointToLatLng(L.point(pt.x, pt.y - dec));
  },

  _vDown(e) {
    if (!this._viseurOn || (this._modeActif !== 'trace' && this._modeActif !== 'modifier')) return;
    if (this._modeActif === 'modifier' && !this._trace) return; // rien en édition : le toucher choisit l'objet (clic de la carte)
    if (e.button > 0 || (e.target.closest && e.target.closest('button, a, .leaflet-control'))) return;
    this._ptrs = this._ptrs || new Set();
    this._ptrs.add(e.pointerId);
    if (this._ptrs.size > 1) return this._viseurAnnule(); // deux doigts : zoom de la carte, pas de tracé
    const pt = this._map.mouseEventToContainerPoint(e);
    let t = this._trace;
    const edition = !!t && t.phase === 'edition';
    let i = -1;
    let milieu = null;
    if (t) {
      let dmin = 24;
      t.pts.forEach((q, k) => { const d = pt.distanceTo(this._map.latLngToContainerPoint(q)); if (d <= dmin) { dmin = d; i = k; } });
      if (edition && i < 0) {
        dmin = 22;
        for (const m of this._milieux()) { const d = pt.distanceTo(this._map.latLngToContainerPoint(m.ll)); if (d <= dmin) { dmin = d; milieu = m; } }
      }
    }
    if (edition && i < 0 && !milieu) { t.sel = null; this._traceSommets(); return; } // édition : pas de nouveau sommet en touchant le vide
    if (!edition && i < 0 && t && t.ferme) return this._etat('Polygone fermé.');
    if (!t) t = this._trace = { pts: [], ferme: false, hist: [], phase: 'dessin', sel: null, group: L.layerGroup().addTo(this._map), sommets: L.layerGroup().addTo(this._map) };
    this._traceMemo();
    const g = { id: e.pointerId, nouveau: i < 0 && !milieu, i, depart: pt, bouge: false, origine: i >= 0 ? t.pts[i] : null };
    if (milieu) { // poignée « + » : insère un sommet au milieu du segment, saisi aussitôt
      g.origine = milieu.ll;
      t.pts.splice(milieu.k + 1, 0, milieu.ll);
      g.i = milieu.k + 1;
      g.insere = g.i;
    } else if (g.nouveau) {
      // Tactile : le premier point est posé sous le viseur décalé ; les suivants partent du dernier point (mouvement relatif du doigt).
      if (e.pointerType !== 'mouse' && t.pts.length > 0 && !edition) {
        g.relatif = true;
        g.base = this._map.latLngToContainerPoint(t.pts[t.pts.length - 1]);
        t.pts.push(t.pts[t.pts.length - 1]);
      } else t.pts.push(this._vPos(e));
      g.i = t.pts.length - 1;
    }
    g.viseur = L.marker(g.nouveau ? t.pts[g.i] : this._vPos(e, g), { pane: 'amgtLieuxPane', interactive: false, keyboard: false, zIndexOffset: 1000, icon: L.divIcon({ className: 'amgt-lieux-viseur', html: this.SVG_VISEUR, iconSize: [48, 48], iconAnchor: [24, 24] }) }).addTo(this._map);
    this._g = g;
    this._aimantDebut(g.i);
    this._aimantDrag(g.viseur, g.i); // initialise l'aimant (délai d'1 s même sans bouger) et place le sommet sous le viseur
    this._traceSommets();
    try { this._map.getContainer().setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
    e.preventDefault();
  },

  _vMove(e) {
    const g = this._g;
    if (!g || e.pointerId !== g.id || !this._trace) return;
    if (!g.bouge && this._map.mouseEventToContainerPoint(e).distanceTo(g.depart) > 6) g.bouge = true;
    g.viseur.setLatLng(this._vPos(e, g));
    this._aimantDrag(g.viseur, g.i); // met le sommet à la position du viseur (ou de l'aimant) et redessine les lignes
    this._traceSommets();
    e.preventDefault();
  },

  _vUp(e) {
    if (this._ptrs) this._ptrs.delete(e.pointerId);
    const g = this._g;
    if (!g || e.pointerId !== g.id) return;
    const t = this._trace;
    this._g = null;
    this._map.removeLayer(g.viseur);
    if (!t) return;
    if (g.relatif && !g.bouge) {
      // Toucher sans glisser : rien à poser (le viseur part du dernier point, il faut le déplacer).
      this._aimantFin();
      t.pts.pop();
      t.hist.pop();
      this._traceDessin();
      this._etat('Glisser le doigt : le viseur part du dernier point et suit le mouvement du doigt ; relâcher pour poser.');
      return;
    }
    if (!g.nouveau && !g.bouge) {
      // Simple toucher : le sommet revient où il était. Dessin : le premier sommet ferme le polygone ; édition : sélectionne.
      this._aimantFin();
      t.pts[g.i] = g.origine;
      if (!g.insere && g.insere !== 0) t.hist.pop(); // rien n'a changé (sauf insertion d'un sommet au milieu)
      if (t.phase === 'edition') { t.sel = g.i; this._traceDessin(); this._etat('Point sélectionné : le presser pour le déplacer, 🗑 pour le supprimer.'); return; }
      if (g.i === 0 && t.pts.length >= 3 && !t.ferme) this._traceTerminer(true); // premier point : la surface est créée
      else if (g.i === t.pts.length - 1 && t.pts.length >= 2 && !t.ferme) this._traceTerminer(); // dernier point : la ligne est terminée
      else this._traceDessin();
      return;
    }
    const P = this._am && this._am.accroche;
    t.pts[g.i] = L.latLng(P || this._accroche(g.viseur.getLatLng(), g.i));
    if (t.phase === 'edition') t.sel = g.i;
    this._aimantFin();
    this._traceDessin();
    if (t.phase === 'dessin' && g.nouveau) this._fermetureAuto(); // le point qui ferme la forme crée la surface aussitôt
  },

  _vCancel(e) {
    if (this._ptrs) this._ptrs.delete(e.pointerId);
    if (this._g && e.pointerId === this._g.id) this._viseurAnnule();
  },

  /** Abandonne le geste en cours (deux doigts, annulation système, fin du mode) et restaure l'état d'avant. */
  _viseurAnnule() {
    const g = this._g;
    this._g = null;
    this._ptrs = new Set();
    if (!g) return;
    if (g.viseur) this._map.removeLayer(g.viseur);
    const t = this._trace;
    if (t && t.hist && t.hist.length) { const h = t.hist.pop(); t.pts = h.pts; t.ferme = h.ferme; }
    this._aimantFin();
    if (t) this._traceDessin();
  },

  // ------------------------------------------------------------ aimant
  // En glissant un sommet : si le doigt reste 1 s à moins de X m d'un point remarquable (sommet d'un objet UrbIS
  // visible, d'un objet de la liste ou du tracé), le sommet est attiré dessus ; il est libéré dès que le doigt
  // s'en éloigne de plus de 2 X. X est réglable (🧲, 0 = sans aimant), mémorisé sur l'appareil.
  AIMANT_DELAI_MS: 1000,
  // Aimant en fer à cheval (23 px, trait fin, #0b5c75 comme les autres icônes).
  SVG_AIMANT: '<svg viewBox="0 0 48 48" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 6v18a11 11 0 0 0 22 0V6" /><path d="M9 6h8v9H9zM31 6h8v9h-8z" /><line x1="9" y1="11" x2="17" y2="11" /><line x1="31" y1="11" x2="39" y2="11" /></svg>',

  _aimantRayon() {
    const v = Number(this._f('aimant').value);
    return Number.isFinite(v) ? Math.max(0, v) : 0;
  },

  /** Objets UrbIS visibles autour de la vue, chargés une fois par vue : leurs sommets servent à l'aimant. */
  async _chargerAimant() {
    if (!this._active || (this._modeActif !== 'trace' && this._modeActif !== 'modifier')) return;
    const bnds = this._map.getBounds().pad(0.2);
    const sw = AMGT4CEM_CRS.latLngToLambert(bnds.getSouthWest());
    const ne = AMGT4CEM_CRS.latLngToLambert(bnds.getNorthEast());
    if (Math.abs(ne.x - sw.x) > 600) { this._aimantPts = []; this._aimantLignes = []; return; } // trop dézoomé : pas d'aimant sur UrbIS
    const jeton = (this._aimantJeton = (this._aimantJeton || 0) + 1);
    const { objets } = await this._wfs(Math.min(sw.x, ne.x), Math.min(sw.y, ne.y), Math.max(sw.x, ne.x), Math.max(sw.y, ne.y));
    if (jeton !== this._aimantJeton || !objets) return;
    const lignes = objets.flatMap((o) => o.lignes);
    // Bouts de segments (sommets des lignes) + intersections entre segments visibles.
    this._aimantLignes = lignes; // lignes UrbIS visibles ; les points sont calculés à chaque usage avec la liste et le tracé (_pointsRemarquables)
    this._aimantPts = [...lignes.flat(), ...this._intersections(lignes)];
  },

  /** Points d'intersection des segments de `lignes` (Lambert), par grille de 25 m ; au plus ~8 000 segments. */
  _intersections(lignes) {
    const segs = [];
    for (const l of lignes) for (let i = 0; i < l.length - 1; i++) segs.push([l[i], l[i + 1]]);
    if (segs.length > 8000) return [];
    const cell = 25;
    const grille = new Map();
    segs.forEach((sg, k) => {
      const [x0, x1] = [Math.min(sg[0][0], sg[1][0]), Math.max(sg[0][0], sg[1][0])];
      const [y0, y1] = [Math.min(sg[0][1], sg[1][1]), Math.max(sg[0][1], sg[1][1])];
      for (let X = Math.floor(x0 / cell); X <= Math.floor(x1 / cell); X++) for (let Y = Math.floor(y0 / cell); Y <= Math.floor(y1 / cell); Y++) {
        const key = `${X},${Y}`;
        if (!grille.has(key)) grille.set(key, []);
        grille.get(key).push(k);
      }
    });
    const vus = new Set();
    const out = [];
    const eps = 1e-6;
    for (const ids of grille.values()) {
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
        const [i, j] = ids[a] < ids[b] ? [ids[a], ids[b]] : [ids[b], ids[a]];
        const cle = i * 100000 + j;
        if (vus.has(cle)) continue;
        vus.add(cle);
        const [p, p2] = segs[i]; const [q, q2] = segs[j];
        const r = [p2[0] - p[0], p2[1] - p[1]]; const sv = [q2[0] - q[0], q2[1] - q[1]];
        const den = r[0] * sv[1] - r[1] * sv[0];
        if (Math.abs(den) < 1e-9) continue; // parallèles
        const t = ((q[0] - p[0]) * sv[1] - (q[1] - p[1]) * sv[0]) / den;
        const u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
        if (t > eps && t < 1 - eps && u > eps && u < 1 - eps) out.push([Math.round((p[0] + t * r[0]) * 100) / 100, Math.round((p[1] + t * r[1]) * 100) / 100]);
      }
    }
    return out;
  },

  _aimantVue() {
    clearTimeout(this._aimantTimer);
    this._aimantTimer = setTimeout(() => this._chargerAimant(), 400);
  },

  /**
   * Points d'accroche : extrémités (sommets) et intersections de lignes, uniquement entre objets VISIBLES — objets UrbIS affichés,
   * objets de la liste (cochés ou non, ils sont dessinés) et segments du tracé en cours. Le sommet `sauf` (celui qu'on déplace)
   * et les segments qui y touchent sont exclus. Aucune accroche sur le fond de plan.
   */
  _pointsRemarquables(sauf) {
    const lignes = [...(this._aimantLignes || [])];
    for (const c of this._cands.values()) lignes.push(...c.lignes);
    const t = this._trace;
    const pts = [];
    if (t && t.pts.length) {
      const lam = this._traceLam();
      const n = lam.length;
      lam.forEach((q, k) => { if (k !== sauf) pts.push(q); });
      const nb = t.ferme ? n : n - 1;
      for (let k = 0; k < nb; k++) { const k2 = (k + 1) % n; if (k !== sauf && k2 !== sauf) lignes.push([lam[k], lam[k2]]); }
    }
    return [...lignes.flat(), ...pts, ...this._intersections(lignes)];
  },

  _aimantDebut(i) {
    this._am = { i, pts: this._pointsRemarquables(i), cible: null, timer: null, accroche: null, ring: null, doigt: null };
  },

  _aimantDrag(mk, i) {
    const am = this._am;
    const t = this._trace;
    if (!am || !t) return;
    const X = this._aimantRayon();
    const l = AMGT4CEM_CRS.latLngToLambert(mk.getLatLng());
    am.doigt = [l.x, l.y];
    if (am.accroche) {
      // Attiré : on reste sur la cible tant que le doigt ne s'en éloigne pas de plus de 2 X.
      if (Math.hypot(am.doigt[0] - am.cible[0], am.doigt[1] - am.cible[1]) <= 2 * X) {
        mk.setLatLng(am.accroche);
        t.pts[i] = am.accroche;
        this._traceLignes();
        return;
      }
      this._aimantLiberer();
    }
    const c = X > 0 ? this._plusProche(am.doigt, am.pts, X) : null;
    if (!c) { this._aimantReset(); } else if (!am.cible || am.cible[0] !== c[0] || am.cible[1] !== c[1]) {
      this._aimantReset();
      am.cible = c;
      const ll = AMGT4CEM_CRS.lambertToLatLng(c);
      am.ring = L.circleMarker(ll, { pane: 'amgtLieuxPane', radius: 15, color: '#e65100', weight: 2, fill: false, dashArray: '4 3', interactive: false }).addTo(this._map);
      // Petit aimant dessiné sur le point visé : pâle pendant l'attente, plein une fois attiré.
      am.icone = L.marker(ll, { pane: 'amgtLieuxPane', interactive: false, keyboard: false, icon: L.divIcon({ className: 'amgt-lieux-aimant-ic', html: this.SVG_AIMANT, iconSize: [23, 23], iconAnchor: [11.5, 28] }) }).addTo(this._map);
      am.timer = setTimeout(() => this._aimantAttirer(mk, i), this.AIMANT_DELAI_MS);
    }
    t.pts[i] = mk.getLatLng();
    this._traceLignes();
  },

  _plusProche(p, pts, X) {
    let best = null; let dmin = X;
    for (const q of pts) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d <= dmin) { dmin = d; best = q; } }
    return best;
  },

  /** Fin du délai : si le doigt est toujours près de la même cible, le sommet s'y accroche. */
  _aimantAttirer(mk, i) {
    const am = this._am;
    if (!am || !am.cible || am.accroche || !this._trace) return;
    const X = this._aimantRayon();
    if (Math.hypot(am.doigt[0] - am.cible[0], am.doigt[1] - am.cible[1]) > X) return this._aimantReset();
    am.accroche = AMGT4CEM_CRS.lambertToLatLng(am.cible);
    mk.setLatLng(am.accroche);
    this._trace.pts[i] = am.accroche;
    if (am.ring) am.ring.setStyle({ dashArray: null, weight: 3 }); // trait plein, toujours sans remplissage
    if (am.icone && am.icone.getElement()) am.icone.getElement().classList.add('amgt-lieux-aimant-ic--on');
    this._traceLignes();
  },

  _aimantReset() {
    const am = this._am;
    if (!am) return;
    clearTimeout(am.timer);
    am.timer = null;
    am.cible = null;
    if (am.ring) { this._map.removeLayer(am.ring); am.ring = null; }
    if (am.icone) { this._map.removeLayer(am.icone); am.icone = null; }
  },

  _aimantLiberer() {
    if (this._am) this._am.accroche = null;
    this._aimantReset();
  },

  _aimantFin() {
    if (!this._am) return;
    this._aimantReset();
    this._am = null;
  },

  _traceInfo() {
    const el = this._panel && this._f('chaine');
    if (!el) return;
    const t = this._trace;
    this._traceBarre();
    if (!t || !t.pts.length) { el.textContent = ''; return; }
    const lam = this._traceLam();
    let total = 0;
    for (let i = 0; i < lam.length - 1; i++) total += Math.hypot(lam[i + 1][0] - lam[i][0], lam[i + 1][1] - lam[i][1]);
    if (t.ferme) {
      const a = lam.length;
      total += Math.hypot(lam[0][0] - lam[a - 1][0], lam[0][1] - lam[a - 1][1]);
      const aire = Math.abs(lam.reduce((s, q, i) => { const n = lam[(i + 1) % a]; return s + q[0] * n[1] - n[0] * q[1]; }, 0) / 2);
      el.textContent = `${a} sommets · périmètre ${this._fmtM(total)} · ${aire.toFixed(1).replace('.', ',')} m²`;
    } else {
      const dern = lam.length > 1 ? Math.hypot(lam[lam.length - 1][0] - lam[lam.length - 2][0], lam[lam.length - 1][1] - lam[lam.length - 2][1]) : 0;
      el.textContent = `${lam.length} sommet(s) · ${this._fmtM(total)}${lam.length > 1 ? ` (dernier segment ${this._fmtM(dern)})` : ''}`;
    }
  },

  /** En édition seulement : 🗑 Point et ✓ Terminer. */
  _traceBarre() {
    const bar = this._panel && this._f('tracebarre');
    if (!bar) return;
    const ed = !!this._trace && this._trace.phase === 'edition';
    // Barre du tracé : sous Lignes, et sous Modifier tant qu'un contour est ouvert (🗑 Point, ✓ Terminer).
    bar.classList.toggle('amgt-hidden', !(this._modeActif === 'trace' || (this._modeActif === 'modifier' && !!this._trace)));
    for (const b of bar.querySelectorAll('.amgt-lieux-edonly')) b.classList.toggle('amgt-hidden', !ed);
  },

  /** Mémorise l'état du tracé avant une modification (bouton ↶ : revenir d'un pas en arrière). */
  _traceMemo() {
    const t = this._trace;
    if (!t) return;
    (t.hist = t.hist || []).push({ pts: t.pts.map((q) => L.latLng(q.lat, q.lng)), ferme: t.ferme });
  },

  _traceAnnuler() {
    const t = this._trace;
    if (!t || !t.hist || !t.hist.length) return this._etat('Rien à annuler.', true);
    const h = t.hist.pop();
    t.pts = h.pts;
    t.ferme = h.ferme;
    t.sel = null;
    this._traceDessin();
  },

  /** Édition : supprime la poignée sélectionnée (au moins 2 points pour une ligne, 3 pour un polygone). */
  _traceSupprimer() {
    const t = this._trace;
    if (!t || t.phase !== 'edition') return;
    if (t.sel === null || t.sel === undefined) return this._etat('Toucher d\'abord une poignée pour la sélectionner.', true);
    if (t.pts.length <= (t.ferme ? 3 : 2)) return this._etat(t.ferme ? 'Un polygone garde au moins 3 sommets (ou le rouvrir).' : 'Une ligne garde au moins 2 sommets.', true);
    this._traceMemo();
    t.pts.splice(t.sel, 1);
    t.sel = null;
    this._traceDessin();
  },

  _traceAbandon() {
    if (!this._trace) return;
    this._viseurAnnule();
    this._aimantFin();
    this._map.removeLayer(this._trace.group);
    this._map.removeLayer(this._trace.sommets);
    this._trace = null;
    if (this._panel) { this._traceInfo(); this._syncDrag(); }
  },

  /**
   * Termine le tracé : une ligne fermée devient une surface, une ligne ouverte un tracé de la liste. `fermer` ferme d'abord
   * la ligne (toucher le premier point). Moins de 2 points : le tracé est simplement abandonné.
   */
  /** Après la pose d'un point : s'il retombe sur le premier point, la ligne est fermée et terminée (elle reste une ligne). */
  _fermetureAuto() {
    const t = this._trace;
    if (!t || t.pts.length < 4) return;
    const n = t.pts.length;
    const px = (q) => this._map.latLngToContainerPoint(q);
    if (px(t.pts[n - 1]).distanceTo(px(t.pts[0])) <= 12) { t.pts.pop(); this._traceTerminer(true); }
  },

  _traceTerminer(fermer) {
    const t = this._trace;
    if (!t) return;
    if (t.pts.length < 2) return this._traceAbandon();
    if (fermer && t.pts.length >= 3) t.ferme = true;
    const lam = this._traceLam();
    if (t.ferme) lam.push(lam[0]);
    const id = t.editId || `T${Date.now().toString(36)}`;
    const ferme = t.ferme;
    const tTrace = t;
    this._traceAbandon();
    this._snap();
    this._addCand({ id, couche: 'Trace', code: 'TRACE', type: tTrace.type || this.TYPE_LIGNE, lignes: [lam, ...(tTrace.trous || [])] }, true); // les vides de la surface sont conservés
    this._renderListe();
    this._etat(tTrace.type === this.TYPE_SURF ? 'Surface modifiée.' : ferme ? 'Ligne fermée ajoutée. Remplir en fait une surface.' : 'Ligne ajoutée à la liste.');
  },

  /**
   * Édition d'une ligne de la liste (✎). Un tracé s'ouvre directement. Un objet UrbIS (lieu constitué en touchant des
   * objets) est converti en tracé(s) : sa géométrie enregistrée devient modifiable (poignées, « + », 🗑) et il ne
   * dépend plus d'UrbIS. Un objet de plusieurs parties donne un tracé par partie ; le premier s'ouvre, les autres
   * restent dans la liste avec leur propre ✎.
   */
  _editerCand(c) {
    if (this._trace) this._traceTerminer();
    this._snap();
    if (c.couche === 'Trace') return this._traceEditer(c);
    const fermee = (l) => l.length >= 4 && l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1];
    const base = `T${Date.now().toString(36)}`;
    for (const l of c.layers) this._group.removeLayer(l);
    this._cands.delete(c.key);
    const nouveaux = c.lignes.map((ligne, i) => ({
      id: `${base}${c.lignes.length > 1 ? `-${i + 1}` : ''}`,
      couche: 'Trace',
      code: 'TRACE',
      type: this.TYPE_LIGNE,
      lignes: [ligne.map((q) => [q[0], q[1]])],
    }));
    for (const o of nouveaux) this._addCand(o, c.sel);
    this._renderListe();
    this._traceEditer(this._cands.get(`Trace:${nouveaux[0].id}`));
    if (nouveaux.length > 1) this._etat(`Objet converti en ${nouveaux.length} tracés (un par partie) : le premier est en édition, les autres sont dans la liste (✎).`);
  },

  /** Rouvre un tracé de la liste pour l'éditer (bouton ✎ de sa ligne). */
  _traceEditer(c) {
    if (this._trace) this._traceTerminer();
    if (this._modeActif !== 'modifier') this._mode('modifier');
    for (const l of c.layers) this._group.removeLayer(l);
    this._cands.delete(c.key);
    const ring = c.lignes[0];
    const ferme = ring.length >= 4 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
    const pts = (ferme ? ring.slice(0, -1) : ring).map((q) => AMGT4CEM_CRS.lambertToLatLng(q));
    this._trace = { pts, ferme, hist: [], phase: 'edition', sel: null, editId: c.id, type: c.type, trous: c.type === this.TYPE_SURF ? c.lignes.slice(1).map((l) => l.map((q) => [q[0], q[1]])) : [], group: L.layerGroup().addTo(this._map), sommets: L.layerGroup().addTo(this._map) };
    this._renderListe();
    this._traceDessin();
    this._syncDrag();
    this._etat('Édition du tracé : poignées à déplacer, 🗑 pour supprimer, « + » pour ajouter ; ✓ Terminer le remet dans la liste.');
  },

  /** Géométrie GeoJSON -> liste de lignes [[x,y],...] (Lambert), arrondies au cm ; les anneaux des surfaces comptent comme lignes. */
  _lignes(g) {
    if (!g) return [];
    const r = (l) => l.map((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]);
    switch (g.type) {
      case 'LineString': return [r(g.coordinates)];
      case 'MultiLineString': case 'Polygon': return g.coordinates.map(r);
      case 'MultiPolygon': return g.coordinates.flat().map(r);
      default: return [];
    }
  },

  // ------------------------------------------------------------------ contour
  // ---------------------------------------------------------------- surfaces
  TYPE_SURF: 'Surface',
  TYPE_LIGNE: 'Tracé (ligne)', // lignes dessinées : jamais des surfaces (Remplir)
  TYPE_POLY: 'Polygone du lieu', // ancien nom des surfaces générées (lieux déjà enregistrés)
  TYPE_VIDE: 'Vide du lieu', // trou retranché des surfaces

  _fermee(l) { return !!l && l.length >= 4 && l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1]; },
  /** Une surface = un tracé fermé (dessiné, rempli, uni, soustrait). Un vide est une surface retranchée. */
  _estSurface(c) { return c.couche === 'Trace' && c.type !== this.TYPE_LIGNE && c.type !== this.TYPE_VIDE && this._fermee(c.lignes[0]); },
  _err(t) { this._etat(t, true); return null; },
  _pc() { return typeof polygonClipping !== 'undefined' ? polygonClipping : null; },
  _arrondi(rg) { return rg.map((q) => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]); },

  /** Multipolygone (polygon-clipping) -> cands : une surface par polygone ; ses trous sont des vides DE cette surface (même objet). Retourne le nombre de surfaces ajoutées. */
  _ajouterMulti(multi, nomType) {
    const base = `S${Date.now().toString(36)}`;
    let n = 0;
    multi.forEach((poly) => {
      const lignes = poly.map((rg) => { const r = this._arrondi(rg); if (!this._fermee(r)) r.push(r[0]); return r; });
      this._addCand({ id: `${base}-${n}`, couche: 'Trace', code: 'TRACE', type: nomType || this.TYPE_SURF, lignes }, true);
      n++;
    });
    return n;
  },

  /**
   * Chaque vide appartient à la plus petite surface qui le contient. Forme effective d'une surface = elle moins ses vides
   * (`gardeVide(v)` filtre les vides pris en compte). Retourne { geom, vides: [cands des vides utilisés] }.
   */
  _formeEffective(c, gardeVide) {
    const pc = this._pc();
    const aire = (r) => Math.abs(r.reduce((a, q, i) => { const n = r[(i + 1) % r.length]; return a + q[0] * n[1] - n[0] * q[1]; }, 0) / 2);
    const surfaces = [...this._cands.values()].filter((x) => this._estSurface(x));
    const vides = [];
    for (const v of this._cands.values()) {
      if (v.type !== this.TYPE_VIDE || !this._fermee(v.lignes[0]) || (gardeVide && !gardeVide(v))) continue;
      const pt = this._pointInterieur(v.lignes[0]);
      let best = null; let amin = Infinity;
      for (const sf of surfaces) { if (!this._dansAnneau(sf.lignes[0], pt[0], pt[1])) continue; const a = aire(sf.lignes[0]); if (a < amin) { amin = a; best = sf; } }
      if (best === c) vides.push(v);
    }
    const base = c.type === this.TYPE_SURF ? c.lignes : [c.lignes[0]]; // surface 'Surface' : anneaux suivants = ses vides
    return { geom: vides.length ? pc.difference(base, ...vides.map((v) => [v.lignes[0]])) : [base], vides };
  },

  /** Contour enregistré : (union des surfaces cochées) − (union des vides cochés), en anneaux (extérieurs et trous, remplissage pair-impair). [] sans surface. */
  _contour() {
    const cochees = [...this._cands.values()].filter((c) => c.sel);
    const surf = cochees.filter((c) => this._estSurface(c));
    if (!surf.length) return [];
    const pc = this._pc();
    if (!pc) return surf.map((c) => c.lignes[0]);
    try {
      const g = pc.union(...surf.map((c) => this._formeEffective(c, (v) => v.sel).geom));
      return g.flatMap((poly) => poly.map((rg) => this._arrondi(rg)));
    } catch (err) {
      return surf.map((c) => c.lignes[0]);
    }
  },

  /**
   * Arrangement planaire des lignes (Lambert) : segments coupés à leurs croisements et contacts, ouvertures plus étroites que
   * `gap` refermées par un segment droit, puis faces bornées relevées exactement le long des lignes (aucune grille : les
   * limites des surfaces suivent les traits visibles). Retourne [{ ring (fermé, Lambert), aire }].
   */
  _faces(lignes, gap) {
    let ox = Infinity; let oy = Infinity;
    for (const l of lignes) for (const q of l) { ox = Math.min(ox, q[0]); oy = Math.min(oy, q[1]); }
    if (!Number.isFinite(ox)) return [];
    const mm = (v) => Math.round(v * 1000);
    const segs = []; const bouts = [];
    for (const l of lignes) {
      const pts = l.map((q) => [q[0] - ox, q[1] - oy]);
      for (let i = 0; i < pts.length - 1; i++) if (Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) > 1e-4) segs.push([pts[i], pts[i + 1]]);
      const fermee = pts.length >= 4 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-4;
      if (!fermee && pts.length > 1) bouts.push(pts[0], pts[pts.length - 1]);
    }
    if (segs.length > 12000) return [];
    const proj = (p, a, b) => { const dx = b[0] - a[0]; const dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))); return [a[0] + t * dx, a[1] + t * dy]; };
    // Ouvertures : l'extrémité libre d'une ligne est reliée au point le plus proche d'une autre ligne si elle est à moins de `gap`.
    if (gap > 0) {
      const base = segs.length;
      for (const e of bouts) {
        let best = null; let dmin = gap;
        for (let i = 0; i < base; i++) {
          const [a, b] = segs[i];
          if (Math.hypot(a[0] - e[0], a[1] - e[1]) < 1e-3 || Math.hypot(b[0] - e[0], b[1] - e[1]) < 1e-3) continue; // segment de l'extrémité elle-même
          const q = proj(e, a, b); const d = Math.hypot(q[0] - e[0], q[1] - e[1]);
          if (d < dmin && d > 1e-4) { dmin = d; best = q; }
        }
        if (best) segs.push([e, best]);
      }
    }
    // Coupes aux croisements et aux contacts (extrémité posée sur un autre segment).
    const coupes = segs.map(() => [0, 1]);
    const cell = 20; const grille = new Map();
    segs.forEach(([a, b], k) => {
      for (let X = Math.floor(Math.min(a[0], b[0]) / cell); X <= Math.floor(Math.max(a[0], b[0]) / cell); X++) for (let Y = Math.floor(Math.min(a[1], b[1]) / cell); Y <= Math.floor(Math.max(a[1], b[1]) / cell); Y++) {
        const key = `${X},${Y}`; if (!grille.has(key)) grille.set(key, []); grille.get(key).push(k);
      }
    });
    const vus = new Set();
    const surSeg = (p, a, b) => { const q = proj(p, a, b); return Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-3 ? q : null; };
    const param = (a, b, q) => { const dx = b[0] - a[0]; const dy = b[1] - a[1]; return ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy); };
    for (const ids of grille.values()) for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) {
      const i = Math.min(ids[x], ids[y]); const j = Math.max(ids[x], ids[y]);
      const cle = i * 100003 + j; if (vus.has(cle)) continue; vus.add(cle);
      const [a, b] = segs[i]; const [c, d] = segs[j];
      for (const p of [c, d]) if (surSeg(p, a, b)) coupes[i].push(param(a, b, p));
      for (const p of [a, b]) if (surSeg(p, c, d)) coupes[j].push(param(c, d, p));
      const r = [b[0] - a[0], b[1] - a[1]]; const w = [d[0] - c[0], d[1] - c[1]];
      const den = r[0] * w[1] - r[1] * w[0];
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c[0] - a[0]) * w[1] - (c[1] - a[1]) * w[0]) / den;
      const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
      if (t > 0 && t < 1 && u > 0 && u < 1) { coupes[i].push(t); coupes[j].push(u); }
    }
    // Graphe : noeuds au millimètre, arêtes uniques.
    const noeuds = new Map(); const aretes = new Set();
    const nd = (p) => { const k = `${mm(p[0])},${mm(p[1])}`; if (!noeuds.has(k)) noeuds.set(k, { k, x: mm(p[0]) / 1000, y: mm(p[1]) / 1000, nb: [] }); return noeuds.get(k); };
    segs.forEach(([a, b], k) => {
      const ts = [...new Set(coupes[k].map((t) => Math.max(0, Math.min(1, t))))].sort((m, n) => m - n);
      for (let q = 0; q < ts.length - 1; q++) {
        const p1 = nd([a[0] + (b[0] - a[0]) * ts[q], a[1] + (b[1] - a[1]) * ts[q]]);
        const p2 = nd([a[0] + (b[0] - a[0]) * ts[q + 1], a[1] + (b[1] - a[1]) * ts[q + 1]]);
        if (p1 === p2) continue;
        const ek = p1.k < p2.k ? `${p1.k}|${p2.k}` : `${p2.k}|${p1.k}`;
        if (aretes.has(ek)) continue;
        aretes.add(ek); p1.nb.push(p2); p2.nb.push(p1);
      }
    });
    for (const n of noeuds.values()) { n.nb.sort((m, o) => Math.atan2(m.y - n.y, m.x - n.x) - Math.atan2(o.y - n.y, o.x - n.x)); }
    // Faces : demi-arêtes parcourues avec la face à gauche ; aire > 0 = face bornée.
    const faits = new Set(); const faces = []; const bords = []; // bords : contour extérieur de chaque ensemble de lignes connectées (îlots)
    for (const u0 of noeuds.values()) for (const v0 of u0.nb) {
      if (faits.has(`${u0.k}>${v0.k}`)) continue;
      const chemin = []; let u = u0; let v = v0; let garde = 0;
      while (garde++ < 100000) {
        faits.add(`${u.k}>${v.k}`);
        // pas d'antenne : un retour sur le noeud d'avant retire la pointe
        if (chemin.length >= 2 && chemin[chemin.length - 2] === v) chemin.pop(); else chemin.push(u);
        const i = v.nb.indexOf(u);
        const w = v.nb[(i - 1 + v.nb.length) % v.nb.length];
        u = v; v = w;
        if (u === u0 && v === v0) break;
      }
      if (chemin.length < 3) continue;
      const aire = chemin.reduce((acc, p, i) => { const q = chemin[(i + 1) % chemin.length]; return acc + p.x * q.y - q.x * p.y; }, 0) / 2;
      const ring = [...chemin.map((p) => [p.x + ox, p.y + oy]), [chemin[0].x + ox, chemin[0].y + oy]];
      const cles = new Set(chemin.map((p) => p.k));
      if (aire > 1e-3) faces.push({ ring, aire, cles });
      else if (aire < -1e-3) bords.push({ ring, aire: -aire, cles });
    }
    faces.bords = bords;
    return faces;
  },

  _dansAnneau(ring, x, y) {
    let ok = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ok = !ok; }
    return ok;
  },
  /** Point à l'intérieur d'un anneau (milieu du premier intervalle d'une horizontale passant par son centre). */
  _pointInterieur(ring) {
    const cy = ring.reduce((m, q) => m + q[1], 0) / ring.length;
    for (const f of [0, 0.15, -0.15, 0.3, -0.3]) {
      const ys = ring.map((q) => q[1]); const y = cy + f * (Math.max(...ys) - Math.min(...ys));
      const xs = [];
      for (let i = 0; i < ring.length - 1; i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[i + 1]; if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi)); }
      xs.sort((a, b) => a - b);
      if (xs.length >= 2) return [(xs[0] + xs[1]) / 2, y];
    }
    return ring[0];
  },

  /** Lignes qui bornent les zones : objets de la liste (hors surfaces et vides) et objets UrbIS visibles, proches de la fenêtre [x0..x1] × [y0..y1] (+ R m). */
  _murs(x0, y0, x1, y1, sauf, urbis) {
    const R = 120;
    const murs = [...(urbis || this._aimantLignes || []), ...this._refsLieux().flatMap((r) => r.lignes), ...this._refsPatrimoine().flatMap((r) => r.lignes)];
    for (const c of this._cands.values()) if (c.key !== sauf && !this._estSurface(c) && c.type !== this.TYPE_VIDE) murs.push(...c.lignes);
    return murs.filter((l) => l.some((q) => q[0] > x0 - R && q[0] < x1 + R && q[1] > y0 - R && q[1] < y1 + R));
  },

  /** Remplir : la face (zone fermée) qui contient le point touché ; ses limites suivent exactement les lignes visibles. */
  async _zoneFermee(latlng) {
    const p = AMGT4CEM_CRS.latLngToLambert(latlng);
    // Les objets UrbIS sont chargés autour du point touché (±200 m), pas sur toute la vue : sur un grand écran (PC) ou en dézoomant,
    // la vue dépasse la limite du chargement de l'aimant (600 m) et Remplir ne verrait plus aucun mur UrbIS.
    // La zone chargée est gardée : les touchers suivants dans cette zone (à plus de 60 m du bord) n'attendent plus le service.
    const D = 200;
    const sig = `${this._urbisAffiche() ? 'v' : 'x'}${JSON.stringify(AMGT4CEM_UrbisTopoSelectionStore.getSelection())}`; // masquer la couche invalide la zone gardée
    let z = this._zoneUrbis;
    if (!(z && z.sig === sig && p.x > z.x0 + 60 && p.x < z.x1 - 60 && p.y > z.y0 + 60 && p.y < z.y1 - 60)) {
      const res = await this._wfs(p.x - D, p.y - D, p.x + D, p.y + D, this._remplirCtl && this._remplirCtl.signal);
      if (!this._active || this._modeActif !== 'remplir' || (this._remplirCtl && this._remplirCtl.signal.aborted)) return null; // outil changé ou recherche remplacée
      if (res.notes.some((n) => n.includes('erreur'))) { this._zoneUrbis = null; return this._err(`UrbIS Topo indisponible (${res.notes.filter((n) => n.includes('erreur')).join(' ; ')}). Réessayer, ou dessiner des lignes.`); }
      z = this._zoneUrbis = res.objets === null ? null : { sig, x0: p.x - D, y0: p.y - D, x1: p.x + D, y1: p.y + D, objets: res.objets, tronque: res.tronque };
      if (!z) z = { objets: null, tronque: false };
    }
    const objets = z.objets;
    this._noteRemplir = z.tronque ? ' Plafond d\'objets UrbIS atteint autour du point : des murs ont pu manquer, vérifier la surface.' : '';
    const urbis = objets ? objets.flatMap((o) => o.lignes) : null;
    const murs = this._murs(p.x, p.y, p.x, p.y, null, urbis || []);
    if (!murs.length) return this._err(objets === null ? (this._urbisAffiche() ? 'Aucun objet UrbIS affiché' : 'UrbIS Topo n\'est pas affiché (couche masquée, aucun type choisi ou zoom trop faible)') + ' : afficher des objets UrbIS ou dessiner des lignes.' : 'Aucune ligne autour du point touché : afficher des objets UrbIS ou dessiner des lignes.');
    const toutes = this._faces(murs, this.COMBLEMENT_M);
    const faces = toutes.filter((f) => this._dansAnneau(f.ring, p.x, p.y)).sort((a, b) => a.aire - b.aire);
    faces.bords = toutes.bords;
    if (!faces.length) return this._err('Zone non fermée : ajouter une ligne qui ferme la surface.');
    // Îlots (bâtiment, cour... tracés par des lignes séparées de la zone) : ils restent vides. Un îlot = le contour extérieur d'un
    // ensemble de lignes qui ne touche pas la zone et qui est dedans ; les îlots dans un îlot ne comptent pas (le vide les contient).
    const f = faces[0];
    const candidats = (faces.bords || [])
      .filter((b) => ![...b.cles].some((k) => f.cles.has(k)) && b.ring.every((q) => this._dansAnneau(f.ring, q[0], q[1]))) // entièrement dans la zone, sans la toucher
      .sort((a, c) => c.aire - a.aire);
    const gardes = [];
    for (const b of candidats) if (!gardes.some((g) => this._dansAnneau(g.ring, b.ring[0][0], b.ring[0][1]))) gardes.push(b);
    return [[this._arrondi(f.ring), ...gardes.map((b) => this._arrondi(b.ring))]];
  },



  /** Remplir : toucher une zone fermée (lignes de la liste et objets UrbIS visibles) pour en faire une surface. */
  async _remplirClic(latlng) {
    if (this._remplirCtl) this._remplirCtl.abort(); // un nouveau toucher remplace la recherche en cours
    const ctl = (this._remplirCtl = new AbortController());
    const t0 = Date.now();
    const message = () => this._etat(`Recherche de la zone… ${Math.round((Date.now() - t0) / 1000)} s (chargement UrbIS)`);
    message();
    const tic = setInterval(message, 1000);
    let anneaux = null;
    try { anneaux = await this._zoneFermee(latlng); } finally { clearInterval(tic); if (this._remplirCtl === ctl) this._remplirCtl = null; }
    if (ctl.signal.aborted || !anneaux || !this._active) return;
    this._snap();
    this._ajouterMulti(anneaux);
    const vides = anneaux.reduce((n, poly) => n + poly.length - 1, 0);
    this._renderListe();
    this._etat(`Surface ajoutée${vides ? ` (${vides} vide${vides > 1 ? 's' : ''} laissé${vides > 1 ? 's' : ''})` : ''}. ↶ pour l'annuler ; Unir / Soustraire pour la combiner.${this._noteRemplir || ''}`, !!this._noteRemplir);
  },

  // ----- Unir / Soustraire : opérandes touchés sur la carte ou dans la liste
  _opsVider() { this._ops = []; this._opsMaj(); },
  _opsToggle(c) {
    if (!this._estSurface(c)) return this._etat('Seules les surfaces (tracés fermés, remplissages) peuvent être unies ou soustraites.', true);
    this._ops = this._ops || [];
    const i = this._ops.indexOf(c.key);
    if (i >= 0) this._ops.splice(i, 1); else this._ops.push(c.key);
    this._opsMaj();
  },
  _opsMaj() {
    if (!this._panel) return;
    const ops = (this._ops = (this._ops || []).filter((k) => this._cands.has(k)));
    for (const c of this._cands.values()) for (const l of c.layers) l.setStyle(ops.includes(c.key) ? { color: '#7b1fa2', weight: 4, opacity: 1, fill: true, fillColor: '#7b1fa2', fillOpacity: 0.3 } : this._style(c.sel, c));
    const nom = (k) => { const c = this._cands.get(k); return `${c.type} #${c.id}`; };
    const info = this._f('opsinfo');
    const sous = this._modeActif === 'soustraire';
    const btn = this._panel.querySelector('[data-a="o-appliquer"]');
    btn.textContent = sous ? 'Confirmer la soustraction' : 'Confirmer l\'union';
    if (this._opsApercuLayer) { this._map.removeLayer(this._opsApercuLayer); this._opsApercuLayer = null; }
    let pret = false;
    if (ops.length < 2) {
      if (!ops.length) info.textContent = sous ? 'Toucher la surface de base, puis celles à retrancher.' : 'Toucher les surfaces à unir (2 au moins).';
      else info.textContent = sous ? `Base : ${nom(ops[0])}. Toucher les surfaces à retrancher.` : `${nom(ops[0])} : toucher au moins une autre surface.`;
    } else {
      // Résultat proposé, dessiné en pointillés violets : il suffit de le confirmer.
      const r = this._opsResultat();
      if (r.erreur) info.textContent = r.erreur;
      else if (!r.res.length) info.textContent = 'Résultat vide : les surfaces se recouvrent entièrement.';
      else {
        pret = true;
        const aire = (rg) => Math.abs(rg.reduce((a, q, i) => { const n = rg[(i + 1) % rg.length]; return a + q[0] * n[1] - n[0] * q[1]; }, 0) / 2);
        const m2 = r.res.reduce((t, poly) => t + poly.reduce((a, rg, k) => a + (k === 0 ? aire(rg) : -aire(rg)), 0), 0);
        const vides = r.res.reduce((t, poly) => t + poly.length - 1, 0);
        info.textContent = `${sous ? 'Soustraction' : 'Union'} proposée : ${r.res.length} surface${r.res.length > 1 ? 's' : ''}, ${vides} vide${vides > 1 ? 's' : ''}, ${Math.round(m2).toLocaleString('fr-BE')} m². Confirmer pour l'appliquer.`;
        this._opsApercuLayer = L.polygon(r.res.map((poly) => poly.map((rg) => rg.map((q) => AMGT4CEM_CRS.lambertToLatLng(q)))), { pane: 'amgtLieuxPane', interactive: false, color: '#4a148c', weight: 3, dashArray: '6 4', fillColor: '#7b1fa2', fillOpacity: 0.3 }).addTo(this._map);
      }
    }
    btn.disabled = !pret;
    for (const r of this._panel.querySelectorAll('.amgt-lieux-liste label[data-key]')) r.classList.toggle('amgt-lieux-op', ops.includes(r.dataset.key));
  },
  _opsClic(latlng) {
    const a = AMGT4CEM_CRS.latLngToLambert(latlng);
    const pt = [a.x, a.y];
    const dedans = (ring) => { let ok = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i]; const [xj, yj] = ring[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) ok = !ok; } return ok; };
    const aire = (r) => Math.abs(r.reduce((s2, q, i) => { const n = r[(i + 1) % r.length]; return s2 + q[0] * n[1] - n[0] * q[1]; }, 0) / 2);
    let best = null; let amin = Infinity;
    for (const c of this._cands.values()) if (this._estSurface(c) && dedans(c.lignes[0]) && !(c.type === this.TYPE_SURF && c.lignes.slice(1).some(dedans))) { const ar = aire(c.lignes[0]); if (ar < amin) { amin = ar; best = c; } }
    if (!best) return this._etat('Aucune surface à cet endroit.', true);
    this._opsToggle(best);
  },
  // ----- Traits de construction : lignes dessinées (hors surfaces et vides), à supprimer une fois les surfaces faites (après confirmation)
  _traitsConstruction() {
    return [...this._cands.values()].filter((c) => c.couche === 'Trace' && c.type === this.TYPE_LIGNE);
  },
  /** Traits dont tous les segments longent (à 0,1 m) le bord d'une des surfaces `sources` (lignes Lambert). */
  _traitsUtilises(sources) {
    const bords = sources.flatMap((c) => c.lignes);
    const sur = (q) => bords.some((b) => this._distLigne({ x: q[0], y: q[1] }, b) <= 0.1);
    return this._traitsConstruction().filter((c) => c.lignes.every((l) => l.length > 1 && l.every((q, i) => sur(q) && (i === 0 || sur([(q[0] + l[i - 1][0]) / 2, (q[1] + l[i - 1][1]) / 2])))));
  },
  /** Met les traits en évidence (magenta épais), demande confirmation, puis les supprime ou leur rend leur style. */
  async _confirmerTraits(traits, question) {
    if (!traits.length) return false;
    const evidence = { color: '#d81b60', weight: 7, opacity: 1, dashArray: '2 7', fill: false };
    for (const c of traits) for (const l of c.layers) { l.setStyle(evidence); if (l.bringToFront) l.bringToFront(); }
    await new Promise((r) => setTimeout(r, 80)); // laisse la carte se redessiner avant la boîte de dialogue
    const ok = confirm(`${traits.length} trait(s) de construction en rose sur la carte. ${question}`);
    if (ok) for (const c of traits) { for (const l of c.layers) this._group.removeLayer(l); this._cands.delete(c.key); }
    else for (const c of traits) for (const l of c.layers) l.setStyle(this._style(c.sel, c));
    this._renderListe();
    this._opsMaj();
    return ok;
  },

  /** Résultat proposé par les opérandes choisis : { res (multipolygone), videsUtilises, cands } ou { erreur }. */
  _opsResultat() {
    const ops = this._ops || [];
    const sous = this._modeActif === 'soustraire';
    const pc = this._pc();
    if (!pc) return { erreur: 'Bibliothèque de géométrie absente : opération impossible.' };
    const cands = ops.map((k) => this._cands.get(k));
    try {
      // Chaque surface compte avec ses vides : ceux qu'aucune autre surface ne recouvre restent vides dans le résultat.
      const formes = cands.map((c) => this._formeEffective(c));
      const res = sous ? pc.difference(formes[0].geom, ...formes.slice(1).map((f) => f.geom)) : pc.union(...formes.map((f) => f.geom));
      return { res, videsUtilises: formes.flatMap((f) => f.vides), cands };
    } catch (err) { return { erreur: `Opération impossible : ${err.message}` }; }
  },

  async _opsAppliquer() {
    const ops = this._ops || [];
    const sous = this._modeActif === 'soustraire';
    if (ops.length < 2) return this._etat(sous ? 'Choisir une base et au moins une surface à retrancher.' : 'Choisir au moins 2 surfaces à unir.', true);
    const r = this._opsResultat();
    if (r.erreur) return this._etat(r.erreur, true);
    const { res, videsUtilises, cands } = r;
    if (!res.length) return this._etat('Résultat vide : les surfaces se recouvrent entièrement.', true);
    this._snap();
    for (const c of [...cands, ...videsUtilises]) { for (const l of c.layers) this._group.removeLayer(l); this._cands.delete(c.key); }
    this._ops = [];
    const n = this._ajouterMulti(res);
    this._renderListe();
    this._opsMaj();
    this._etat(`${sous ? 'Soustraction' : 'Union'} faite : ${n} surface(s). ↶ pour l'annuler.`);
    const traits = this._traitsUtilises(cands);
    if (await this._confirmerTraits(traits, 'Ils ont servi à délimiter les surfaces d\'origine : les supprimer ? (↶ annule aussi cette suppression)')) this._etat(`${sous ? 'Soustraction' : 'Union'} faite : ${n} surface(s) ; ${traits.length} trait(s) de construction supprimé(s). ↶ pour tout annuler.`);
  },

  /** Modifier : toucher une ligne (ou l'intérieur d'une surface) pour éditer ses points. */
  _modifierClic(latlng) {
    if (this._trace) return; // une modification est en cours : ✓ Terminer ou autre outil pour la finir
    const pt = this._map.latLngToContainerPoint(latlng);
    const a = AMGT4CEM_CRS.latLngToLambert(latlng);
    const b = AMGT4CEM_CRS.latLngToLambert(this._map.containerPointToLatLng(L.point(pt.x + 16, pt.y)));
    const tol = Math.max(0.3, Math.hypot(b.x - a.x, b.y - a.y));
    let best = null; let dmin = tol;
    for (const c of this._cands.values()) for (const l of c.lignes) { const d = this._distLigne(a, l); if (d < dmin) { dmin = d; best = c; } }
    if (!best) return this._etat('Toucher une ligne ou un contour de la liste.', true);
    this._editerCand(best);
  },




  /** Aperçu du contour enregistré : union des surfaces cochées moins les vides cochés. */
  _apercu() {
    if (!this._panel) return;
    if (this._apercuLayer) { this._map.removeLayer(this._apercuLayer); this._apercuLayer = null; }
    const anneaux = this._contour();
    if (!anneaux.length) return;
    this._apercuLayer = L.polygon(anneaux.map((rg) => rg.map((q) => AMGT4CEM_CRS.lambertToLatLng(q))), { pane: 'amgtLieuxPane', interactive: false, color: '#0b5c75', weight: 2, dashArray: '6 4', fillColor: '#0b5c75', fillOpacity: 0.1, fillRule: 'evenodd' }).addTo(this._map);
  },

  // ----------------------------------------------------------- enregistrement
  _slug(nom) { return nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, ''); },

  async _envoyer(lieux) {
    const code = (AMGT4CEM_PeLabelAnchors.getAdminCode() || '').trim(); // vide : putToRelay ouvre la fenêtre de saisie
    await AMGT4CEM_PeLabelAnchors.putToRelay(AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl, this.ROUTE, { version: 1, crs: 'EPSG:31370', lieux }, code);
    this._lieux = lieux;
    try { sessionStorage.setItem(this.CLE_ENVOYE, JSON.stringify({ at: Date.now(), lieux })); } catch (err) { /* stockage indisponible : on se fie au fichier */ }
    // La couche « Plans patrimoine » garde les lieux en mémoire : sans cela, un lieu supprimé ou renommé y resterait jusqu'au rechargement.
    if (typeof AMGT4CEM_PatrimoineLayer !== 'undefined') AMGT4CEM_PatrimoineLayer.reloadLieux();
  },

  async _enregistrer() {
    const nom = this._f('nom').value.trim();
    const slug = this._slug(nom);
    const ancien = this._cur; // lieu en cours d'édition (vide = nouveau lieu)
    // Lieu avec surfaces : proposer d'effacer les traits de construction restants (mis en évidence) avant l'enregistrement.
    const restants = this._traitsConstruction();
    if (restants.length && [...this._cands.values()].some((c) => this._estSurface(c))) {
      this._snap();
      if (!(await this._confirmerTraits(restants, 'Les effacer avant d\'enregistrer la zone ? OK = effacer puis enregistrer ; Annuler = les garder et enregistrer.'))) this._hist.pop();
    }
    const objets = [...this._cands.values()].filter((c) => c.sel).map((c) => ({ id: c.id, couche: c.couche, code: c.code, type: c.type, lignes: c.lignes }));
    if (!slug) return this._etat('Donner un nom à la zone.', true);
    if (!objets.length) return this._etat('Aucun objet coché.', true);
    // Nom modifié sur un lieu existant = renommage : l'ancienne entrée est remplacée (pas de doublon).
    const renomme = !!(ancien && this._lieux[ancien] && slug !== ancien);
    if (renomme) {
      if (this._lieux[slug]) return this._etat(`Une zone « ${this._lieux[slug].nom} » existe déjà sous ce nom.`, true);
      if (!confirm(`Renommer la zone « ${this._lieux[ancien].nom} » en « ${nom} » ?`)) return;
    }
    const tol = (this._cur && this._lieux[this._cur] && this._lieux[this._cur].tolerance_m !== undefined) ? this._lieux[this._cur].tolerance_m : 5; // réservé (non utilisé pour l'instant)
    try {
      this._etat('Enregistrement…');
      const contour = this._contour();
      const lieu = { nom, genre: this._f('genre').value || 'autre', tolerance_m: tol, objets };
      if (contour.length) Object.assign(lieu, { contour_methode: 'surfaces', contour });
      const suite = { ...this._lieux };
      if (renomme) delete suite[ancien];
      suite[slug] = lieu;
      const ancienNom = renomme ? this._lieux[ancien].nom : '';
      await this._envoyer(suite);
      this._dirty = false;
      this._majListe(slug);
      this._etat(renomme
        ? `Zone « ${ancienNom} » renommée en « ${nom} » et enregistrée (${objets.length} objets). La carte le lira après le déploiement (environ une minute).`
        : `Zone « ${nom} » enregistrée (${objets.length} objets). La carte le lira après le déploiement (environ une minute).`);
    } catch (err) {
      this._etat(err.message, true);
    }
  },

};
