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
      if (!query) {
        resultsEl.innerHTML = '';
        return;
      }
      const results = await this._search(query);
      this._renderResults(resultsEl, results, close);
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

  async _search(query) {
    const needle = this._normalize(query);
    const results = [];

    for (const entry of this._metroIndex) {
      if (this._normalize(entry.searchText).includes(needle)) {
        results.push({ kind: entry.kind, label: entry.label, bounds: entry.bounds });
        if (results.length >= 8) break;
      }
    }

    if (results.length < 8) {
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
    }

    return results;
  },

  _kindLabel(kind) {
    return { station: 'Station', tunnel: 'Tunnel', point: 'Point métier' }[kind] || kind;
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
