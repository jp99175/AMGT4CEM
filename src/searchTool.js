/**
 * Recherche (haut droite, à la place du contrôle de zoom Leaflet) : trouve
 * une station, un tunnel (référentiel) ou un point métier par nom/libellé, et
 * recentre la carte dessus. Le zoom reste possible à la molette, au
 * pincement et au double-clic — seuls les boutons +/- dédiés disparaissent.
 */
const AMGT4CEM_SearchTool = {
  _map: null,
  _metroIndex: [],

  init(map) {
    this._map = map;
    this._searchToken = 0;
    this._geocodeTimer = null;

    const toggleBtn = document.getElementById('amgt-search-toggle');
    const panel = document.getElementById('amgt-search-panel');
    const input = document.getElementById('amgt-search-input');
    const resultsEl = document.getElementById('amgt-search-results');
    this._input = input;

    // Liste de résultats pilotable au clavier : le focus reste dans le champ (on peut continuer à taper),
    // la ligne active est désignée par aria-activedescendant.
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'amgt-search-results');
    input.setAttribute('aria-autocomplete', 'list');
    resultsEl.setAttribute('role', 'listbox');

    const open = () => {
      panel.classList.remove('amgt-hidden');
      toggleBtn.parentElement.classList.add('amgt-search--open');
      toggleBtn.classList.add('amgt-btn--active');
      input.value = '';
      resultsEl.innerHTML = '';
      this._setActive(resultsEl, null);
      input.focus();
    };
    const close = () => {
      panel.classList.add('amgt-hidden');
      toggleBtn.parentElement.classList.remove('amgt-search--open');
      toggleBtn.classList.remove('amgt-btn--active');
      clearTimeout(this._geocodeTimer);
    };

    toggleBtn.addEventListener('click', () => {
      if (panel.classList.contains('amgt-hidden')) open();
      else close();
    });

    document.addEventListener('click', (e) => {
      if (panel.classList.contains('amgt-hidden')) return;
      if (panel.contains(e.target) || toggleBtn.contains(e.target)) return;
      close();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); return; }
      const items = [...resultsEl.querySelectorAll('.amgt-search-result')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (items.length === 0) return;
        e.preventDefault();
        const i = items.findIndex((li) => li.dataset.key === this._activeKey);
        if (e.key === 'ArrowDown') this._setActive(resultsEl, items[Math.min(i + 1, items.length - 1)]);
        else this._setActive(resultsEl, i <= 0 ? null : items[i - 1]); // ↑ sur la première ligne : retour au champ
      } else if (e.key === 'Enter') {
        const actif = items.find((li) => li.dataset.key === this._activeKey);
        if (actif) { e.preventDefault(); actif.click(); }
      }
    });

    input.addEventListener('input', async () => {
      const query = input.value.trim();
      clearTimeout(this._geocodeTimer);
      const token = ++this._searchToken;
      this._setActive(resultsEl, null); // nouvelle frappe : la sélection au clavier repart du champ

      if (!query) {
        resultsEl.innerHTML = '';
        return;
      }

      // Résultats locaux (stations/tunnels/points) : quasi instantanés, pas
      // de vrai réseau (localStorage), affichés sans attendre le géocodeur.
      const localResults = [...this._searchLocal(query), ...(await this._searchPoints(query))];
      if (token !== this._searchToken) return; // une saisie plus récente a eu lieu
      this._renderResults(resultsEl, localResults, close);

      // Recherche d'adresse (UrbIS) : débattue (300 ms) pour éviter une
      // requête réseau à chaque frappe, ajoutée aux résultats locaux déjà
      // affichés une fois reçue — sans jamais bloquer/casser l'affichage des
      // résultats locaux si le géocodage échoue (réseau, CORS...).
      this._geocodeTimer = setTimeout(async () => {
        const addressResults = await this._searchAddresses(query);
        if (token !== this._searchToken) return;
        this._renderResults(resultsEl, [...localResults, ...addressResults], close);
      }, 300);
    });
  },

  /**
   * Appelé une fois le référentiel chargé et ses couches construites.
   * @param {object[]} searchIndex - voir AMGT4CEM_MetroLayer.build()
   */
  setMetroIndex(searchIndex) {
    this._metroIndex = searchIndex;
  },

  _normalize(str) {
    return (str || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  },

  _searchLocal(query) {
    const needle = this._normalize(query);
    const results = [];

    for (const entry of this._metroIndex) {
      if (this._normalize(entry.searchText).includes(needle)) {
        results.push({ kind: entry.kind, label: entry.label, bounds: entry.bounds });
        if (results.length >= 8) break;
      }
    }

    return results;
  },

  async _searchPoints(query) {
    if (!AMGT4CEM_Auth.session()) return []; // les points métier sont réservés aux comptes connectés
    if (typeof AMGT4CEM_SignalementsLayer === 'undefined') return []; // SIG4CEM : pas de couche des points métier
    return AMGT4CEM_SignalementsLayer.search(this._normalize(query), (t) => this._normalize(t));
  },

  /**
   * Recherche d'adresse via le géocodeur officiel UrbIS. Renvoie [] (jamais
   * d'exception) en cas d'échec réseau/CORS/format inattendu — une adresse
   * introuvable ne doit jamais casser l'affichage des résultats locaux déjà
   * montrés à l'utilisateur.
   */
  async _searchAddresses(query) {
    const { url, spatialReference, language } = AMGT4CEM_CONFIG.geocoder;
    const requestUrl = `${url}?spatialReference=${spatialReference}&language=${language}&address=${encodeURIComponent(query)}`;

    try {
      const response = await fetch(requestUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const entries = body.result || [];

      return entries.slice(0, 5).map((entry) => {
        const street = entry.address?.street || {};
        const parts = [
          [street.name, entry.address?.number].filter(Boolean).join(' '),
          [street.postCode, street.municipality].filter(Boolean).join(' '),
        ].filter(Boolean);

        const extent = entry.extent;
        const bounds = extent
          ? L.latLngBounds(
              AMGT4CEM_CRS.lambertToLatLng([extent.xmin, extent.ymin]),
              AMGT4CEM_CRS.lambertToLatLng([extent.xmax, extent.ymax])
            )
          : null;

        return {
          kind: 'address',
          label: parts.join(', ') || query,
          // Le point sert au pointeur posé sur l'adresse ; l'emprise, au recentrage quand elle existe.
          latlng: entry.point ? AMGT4CEM_CRS.lambertToLatLng([entry.point.x, entry.point.y]) : bounds ? bounds.getCenter() : null,
          bounds,
        };
      });
    } catch (err) {
      console.warn('[AMGT4CEM] Recherche d\'adresse (UrbIS) indisponible :', err);
      return [];
    }
  },

  _kindLabel(kind) {
    return { station: 'Station', tunnel: 'Tunnel', planche: 'Planche', point: 'Point métier', address: 'Adresse' }[kind] || kind;
  },

  _renderResults(resultsEl, results, close) {
    resultsEl.innerHTML = '';
    if (results.length === 0) {
      const li = document.createElement('li');
      li.className = 'amgt-search-empty';
      li.textContent = 'Aucun résultat';
      resultsEl.appendChild(li);
      return;
    }

    // Résultats regroupés par type : la pastille sert de titre au groupe, puis un résultat par ligne.
    const ordre = ['station', 'tunnel', 'planche', 'point', 'address'];
    const rang = (k) => (ordre.indexOf(k) < 0 ? 99 : ordre.indexOf(k));
    const types = [...new Set(results.map((r) => r.kind))].sort((x, y) => rang(x) - rang(y));
    for (const k of types) {
      const titre = document.createElement('li');
      titre.className = 'amgt-search-groupe';
      const kindTag = document.createElement('span');
      kindTag.className = `amgt-search-kind amgt-search-kind--${k}`;
      kindTag.textContent = this._kindLabel(k);
      titre.append(kindTag);
      resultsEl.appendChild(titre);

      for (const result of results.filter((r) => r.kind === k)) {
        const li = document.createElement('li');
        li.className = 'amgt-search-result';
        li.setAttribute('role', 'option');
        li.id = `amgt-search-opt-${resultsEl.querySelectorAll('.amgt-search-result').length}`;
        li.dataset.key = `${result.kind}|${result.label}`;
        const labelSpan = document.createElement('span');
        labelSpan.className = 'amgt-search-label';
        labelSpan.textContent = result.label;
        li.append(labelSpan);
        li.addEventListener('click', () => {
          if (result.bounds) {
            this._map.fitBounds(result.bounds, { maxZoom: 19, padding: [40, 40] });
          } else if (result.latlng) {
            this._map.setView(result.latlng, 19);
          }
          if (result.kind === 'address' && result.latlng) this._placePin(result.latlng, result.label);
          close();
        });
        resultsEl.appendChild(li);
      }
    }

    // Les adresses arrivent après les résultats locaux et la liste est reconstruite : la ligne active est retrouvée
    // par son type et son libellé, pour ne pas sauter pendant la navigation au clavier.
    const gardee = this._activeKey && [...resultsEl.querySelectorAll('.amgt-search-result')].find((li) => li.dataset.key === this._activeKey);
    this._setActive(resultsEl, gardee || null);
  },

  /** Ligne active de la liste (null = aucune, le champ garde la main). */
  _setActive(resultsEl, li) {
    resultsEl.querySelectorAll('.amgt-search-result--active').forEach((el) => {
      el.classList.remove('amgt-search-result--active');
      el.removeAttribute('aria-selected');
    });
    this._activeKey = li ? li.dataset.key : null;
    if (li) {
      li.classList.add('amgt-search-result--active');
      li.setAttribute('aria-selected', 'true');
      li.scrollIntoView({ block: 'nearest' });
      if (this._input) this._input.setAttribute('aria-activedescendant', li.id);
    } else if (this._input) {
      this._input.removeAttribute('aria-activedescendant');
    }
  },

  // Pointeur : 23 px de haut, trait 0,8 px (bleu des icônes de l'app), partie pleine blanche, cercle transparent.
  // La pointe est l'ancre (8, 23) : elle tombe sur l'adresse.
  SVG_POINTEUR: '<svg viewBox="0 0 16 23" width="16" height="23" aria-hidden="true" focusable="false"><path d="M8 22 L1.94 11.5 A7 7 0 1 1 14.06 11.5 Z M12 8 A4 4 0 1 0 4 8 A4 4 0 1 0 12 8 Z" fill="#ffffff" fill-rule="evenodd" stroke="#0b5c75" stroke-width="0.8" stroke-linejoin="round" /></svg>',

  /** Pose (ou déplace) l'unique pointeur sur l'adresse choisie ; un clic dessus l'efface. */
  _placePin(latlng, label) {
    if (this._pin) this._pin.remove();
    this._pin = L.marker(latlng, {
      keyboard: false,
      zIndexOffset: 1000,
      icon: L.divIcon({ className: 'amgt-address-pin', html: this.SVG_POINTEUR, iconSize: [16, 23], iconAnchor: [8, 23] }),
    }).addTo(this._map);
    this._pin.bindTooltip(label, { direction: 'top', offset: [0, -23] });
    this._pin.on('click', () => { this._pin.remove(); this._pin = null; });
  },
};
