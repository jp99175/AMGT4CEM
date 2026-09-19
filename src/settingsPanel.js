/**
 * Panneau "⚙ Paramètres" (barre d'outils) : permet de corriger les URLs des
 * services externes (UrbIS, orthophotos, géocodeur d'adresses) si l'un
 * d'eux venait à changer d'adresse, sans devoir modifier config.js.
 *
 * Exclusif avec le menu "☰ Carte" (un seul panneau ouvert à la fois, même
 * position à l'écran) — voir mapMenu.js pour la réciproque.
 */
const AMGT4CEM_SettingsPanel = {
  init() {
    const btn = document.getElementById('amgt-settings-btn');
    const panel = document.getElementById('amgt-settings-panel');
    const menuPanel = document.getElementById('amgt-map-menu');

    const fields = {
      urbisUrl: document.getElementById('amgt-settings-urbis-url'),
      urbisLayers: document.getElementById('amgt-settings-urbis-layers'),
      brucielHistoriqueUrl: document.getElementById('amgt-settings-bruciel-hist-url'),
      brucielRecentUrl: document.getElementById('amgt-settings-bruciel-recent-url'),
      geocoderUrl: document.getElementById('amgt-settings-geocoder-url'),
    };

    const fillFromCurrentConfig = () => {
      const histEntry = AMGT4CEM_CONFIG.basemaps.bruciel.entries.find((e) => e.year <= 1996);
      const recentEntry = AMGT4CEM_CONFIG.basemaps.bruciel.entries.find((e) => e.year >= 2004);
      fields.urbisUrl.value = AMGT4CEM_CONFIG.basemaps.urbis.url;
      fields.urbisLayers.value = AMGT4CEM_CONFIG.basemaps.urbis.layers;
      fields.brucielHistoriqueUrl.value = histEntry ? histEntry.url : '';
      fields.brucielRecentUrl.value = recentEntry ? recentEntry.url : '';
      fields.geocoderUrl.value = AMGT4CEM_CONFIG.geocoder.url;
    };

    btn.addEventListener('click', () => {
      const opening = panel.classList.contains('amgt-hidden');
      menuPanel.classList.add('amgt-hidden');
      panel.classList.toggle('amgt-hidden');
      if (opening) fillFromCurrentConfig();
    });

    document.addEventListener('click', (e) => {
      if (panel.classList.contains('amgt-hidden')) return;
      if (panel.contains(e.target) || e.target === btn) return;
      panel.classList.add('amgt-hidden');
    });

    document.getElementById('amgt-settings-save').addEventListener('click', () => {
      AMGT4CEM_SettingsStore.save({
        urbisUrl: fields.urbisUrl.value.trim(),
        urbisLayers: fields.urbisLayers.value.trim(),
        brucielHistoriqueUrl: fields.brucielHistoriqueUrl.value.trim(),
        brucielRecentUrl: fields.brucielRecentUrl.value.trim(),
        geocoderUrl: fields.geocoderUrl.value.trim(),
      });
      // Un rechargement garantit que toutes les couches déjà construites
      // (basemap.js les prépare une fois à l'init) repartent bien des
      // nouvelles URLs, plutôt que de tenter une mise à jour à chaud partielle.
      alert('Paramètres enregistrés. La page va se recharger pour les appliquer.');
      window.location.reload();
    });

    document.getElementById('amgt-settings-reset').addEventListener('click', () => {
      if (!confirm('Revenir aux adresses de service par défaut de l\'application ?')) return;
      AMGT4CEM_SettingsStore.reset();
      window.location.reload();
    });
  },

  /** Appelé par mapMenu.js pour fermer ce panneau quand l'autre s'ouvre. */
  close() {
    document.getElementById('amgt-settings-panel').classList.add('amgt-hidden');
  },
};
