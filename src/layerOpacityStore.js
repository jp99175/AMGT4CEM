/**
 * Opacité individuelle des couches du menu ☰ Carte (Métro, Points métier,
 * UrbIS Topo), réglable via l'icône curseurs de chaque couche — comme dans
 * MobiGIS. Persistée par appareil (localStorage) : un facteur par couche, de
 * 0 (invisible) à 1 (opacité normale de la couche). Le facteur s'applique en
 * multiplicateur sur l'opacité propre à chaque couche (voir mapMenu.js,
 * pointsLayer.js, urbisTopoLayer.js), jamais en remplacement absolu — sinon
 * une couche déjà semi-transparente par nature (ex. les tunnels) deviendrait
 * plus opaque qu'à l'origine dès qu'on la remet à 100%.
 */
const AMGT4CEM_LayerOpacityStore = {
  _key: 'amgt4cem.layer-opacity.v1',

  getFactor(layerKey) {
    const all = this._readAll();
    return layerKey in all ? all[layerKey] : 1;
  },

  setFactor(layerKey, factor) {
    const all = this._readAll();
    all[layerKey] = factor;
    localStorage.setItem(this._key, JSON.stringify(all));
  },

  _readAll() {
    try {
      const raw = localStorage.getItem(this._key);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      console.warn('[AMGT4CEM] Opacité des couches illisible, réinitialisée :', err);
    }
    return {};
  },
};
