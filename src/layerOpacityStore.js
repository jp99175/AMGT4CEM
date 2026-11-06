/**
 * Opacité individuelle des couches du menu ☰ Carte (DITP-DIOV, Points métier,
 * UrbIS Topo), réglable via l'icône curseurs de chaque couche — comme dans
 * MobiGIS. Persistée par appareil (localStorage) : un facteur par couche, de
 * 0 (invisible) à 1 (opacité normale de la couche). Le facteur s'applique en
 * multiplicateur sur l'opacité propre à chaque couche (voir mapMenu.js,
 * signalementsLayer.js, urbisTopoLayer.js), jamais en remplacement absolu — sinon
 * une couche déjà semi-transparente par nature (ex. les tunnels) deviendrait
 * plus opaque qu'à l'origine dès qu'on la remet à 100%.
 */
// Migration unique (renommage de la couche « metro » en « ditp-diov », 06/11/2026) : reprend les réglages locaux de
// l'appareil enregistrés sous l'ancien nom (opacité, dernières cases cochées, sélection des genres) puis les efface.
(function migrerMetroVersDitpDiov() {
  try {
    const bascule = (cle) => {
      const brut = localStorage.getItem(cle);
      if (!brut) return;
      const o = JSON.parse(brut);
      for (const groupe of [o, o.layers, o.opacity]) {
        if (groupe && typeof groupe === 'object' && 'metro' in groupe) {
          if (!('ditp-diov' in groupe)) groupe['ditp-diov'] = groupe.metro;
          delete groupe.metro;
        }
      }
      localStorage.setItem(cle, JSON.stringify(o));
    };
    bascule('amgt4cem.layer-opacity.v1');
    bascule('amgt4cem.menu-prefs.v1');
    for (const [ancienne, nouvelle] of [['amgt4cem.metro-selection.v1', 'amgt4cem.ditp-diov-selection.v1'], ['amgt4cem.metro-default.v1', 'amgt4cem.ditp-diov-default.v1']]) {
      const v = localStorage.getItem(ancienne);
      if (v !== null && localStorage.getItem(nouvelle) === null) localStorage.setItem(nouvelle, v);
      localStorage.removeItem(ancienne);
    }
  } catch (err) { /* stockage indisponible ou illisible : les réglages repartent du défaut */ }
})();

const AMGT4CEM_LayerOpacityStore = {
  _key: 'amgt4cem.layer-opacity.v1',

  getFactor(layerKey) {
    const all = this._readAll();
    return layerKey in all ? all[layerKey] : 1;
  },

  has(layerKey) {
    return layerKey in this._readAll();
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
