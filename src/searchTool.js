/**
 * Recherche (haut droite, à la place du contrôle de zoom Leaflet) : trouve
 * une station, un tunnel (Metro.json) ou un point métier par nom/libellé, et
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

    const open = () => {
      panel.classList.remove('amgt-hidden');
      input.value = '';
      resultsEl.innerHTML = '';
      input.focus();
    };
    const close = () => {
      panel.classList.add('amgt-hidden');
      clearTimeout(this._geocodeTimer);
    };

    toggleBtn.addEventListener('click', () => {
      if (panel.classList.contains('amgt-hidden')) open();
      else close();
    });

    document.addEventListener('click', (e) => {
      if (panel.classList.contains('amgt-hidden')) return;
      if (panel.contains(e.target) || e.target === toggleBtn) return;
      close();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });

    input.addEventListener('input', async () => {
      const query = input.value.trim();
      clearTimeout(this._geocodeTimer);
      const token = ++this._searchToken;

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
   * Appelé une fois Metro.json chargé et ses couches construites.
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
    const needle = this._normalize(query);
    const results = [];
    const points = await AMGT4CEM_PointsStore.getAll();
    for (const point of points) {
      if (this._normalize(point.label).includes(needle)) {
        results.push({
          kind: 'point',
          label: point.label,
          latlng: AMGT4CEM_CRS.lambertToLatLng([point.x, point.y]),
        });
        if (results.length >= 8) break;
      }
    }
    return results;
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
          latlng: bounds ? null : AMGT4CEM_CRS.lambertToLatLng([entry.point.x, entry.point.y]),
          bounds,
        };
      });
    } catch (err) {
      console.warn('[AMGT4CEM] Recherche d\'adresse (UrbIS) indisponible :', err);
      return [];
    }
  },

  _kindLabel(kind) {
    return { station: 'Station', tunnel: 'Tunnel', point: 'Point métier', address: 'Adresse' }[kind] || kind;
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

    for (const result of results) {
      const li = document.createElement('li');
      li.className = 'amgt-search-result';

      const kindTag = document.createElement('span');
      kindTag.className = `amgt-search-kind amgt-search-kind--${result.kind}`;
      kindTag.textContent = this._kindLabel(result.kind);

      const labelSpan = document.createElement('span');
      labelSpan.className = 'amgt-search-label';
      labelSpan.textContent = result.label;

      li.append(kindTag, labelSpan);
      li.addEventListener('click', () => {
        if (result.bounds) {
          this._map.fitBounds(result.bounds, { maxZoom: 19, padding: [40, 40] });
        } else if (result.latlng) {
          this._map.setView(result.latlng, 19);
        }
        close();
      });
      resultsEl.appendChild(li);
    }
  },
};
