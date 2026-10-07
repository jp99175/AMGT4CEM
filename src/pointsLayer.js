/**
 * Affichage sur la carte des objets métier enregistrés dans la micro-base.
 *
 * Chaque marqueur est déplaçable (section 10 du cahier des charges) : un
 * glisser-déposer du marqueur recalcule automatiquement X/Y Lambert et met
 * à jour la micro-base. C'est la méthode normale de repositionnement.
 *
 * Le contenu de la popup est construit en DOM (textContent), pas en chaîne
 * HTML : type/libellé/propriétés viennent du formulaire "Ajouter un point"
 * (saisie utilisateur), les insérer tels quels dans du HTML permettrait une
 * injection stockée (ex : libellé "<img onerror=...>").
 *
 * La micro-base (voir pointsStore.js) est désormais distante (API GitHub) :
 * chaque lecture/écriture est asynchrone et peut échouer (réseau, jeton
 * absent, conflit d'écriture concurrente) — chaque action ci-dessous gère
 * l'erreur en conséquence (message clair, retour à l'état précédent).
 */
const AMGT4CEM_PointsLayer = {
  _layerGroup: null,
  _amianteGroup: null, // flux AMIANTE : couche séparée (case propre dans le menu ☰ Carte)
  _opacityFactor: 1,

  init(map) {
    this._layerGroup = L.layerGroup().addTo(map);
    this._amianteGroup = L.layerGroup().addTo(map);
    this.refresh();
    return { standard: this._layerGroup, amiante: this._amianteGroup };
  },

  /** Réglage d'opacité (icône curseurs du menu ☰ Carte), 0 à 1. */
  setOpacity(factor) {
    this._opacityFactor = factor;
    this._layerGroup.eachLayer((marker) => marker.setOpacity(factor));
    this._amianteGroup.eachLayer((marker) => marker.setOpacity(factor));
  },

  async refresh() {
    let points;
    try {
      points = await AMGT4CEM_PointsStore.getAll();
    } catch (err) {
      console.error('[AMGT4CEM] Chargement des points métier impossible :', err);
      return;
    }
    this._layerGroup.clearLayers();
    this._amianteGroup.clearLayers();
    for (const point of points) {
      this._addMarker(point);
    }
  },

  _addMarker(point) {
    const latlng = AMGT4CEM_CRS.lambertToLatLng([point.x, point.y]);
    const isAmiante = point.properties && point.properties.flux === 'AMIANTE';
    const marker = L.marker(latlng, {
      draggable: true,
      opacity: this._opacityFactor,
      icon: L.divIcon({
        className: isAmiante ? 'amgt-point-marker amgt-point-marker--amiante' : 'amgt-point-marker',
        html: '<div class="amgt-point-marker__dot"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    });

    marker.bindPopup(this._buildPopupContent(point));

    marker.on('dragend', async () => {
      const previousLatLng = latlng;
      const newLatLng = marker.getLatLng();
      const { x, y } = AMGT4CEM_CRS.latLngToLambert(newLatLng);
      try {
        const updated = await AMGT4CEM_PointsStore.update(point.id, { x, y });
        point.x = x;
        point.y = y;
        marker.setPopupContent(this._buildPopupContent(updated));
      } catch (err) {
        console.error('[AMGT4CEM] Repositionnement impossible :', err);
        alert('Impossible d\'enregistrer le déplacement : ' + err.message);
        marker.setLatLng(previousLatLng);
      }
    });

    marker.addTo(isAmiante ? this._amianteGroup : this._layerGroup);
  },

  _buildPopupContent(point) {
    if (point.properties && point.properties.nature) return this._buildSignalementPopup(point);
    const container = document.createElement('div');
    container.className = 'amgt-popup';

    const table = document.createElement('table');
    const addRow = (key, value) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = key;
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(th, td);
      table.appendChild(tr);
    };

    addRow('Identifiant', point.id);
    addRow('Type', point.type);
    addRow('Libellé', point.label);
    addRow('X Lambert', AMGT4CEM_CRS.formatCoord(point.x));
    addRow('Y Lambert', AMGT4CEM_CRS.formatCoord(point.y));
    for (const [key, value] of Object.entries(point.properties || {})) {
      addRow(key, value);
    }
    container.appendChild(table);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'amgt-btn amgt-popup__delete-btn';
    deleteBtn.textContent = '🗑 Supprimer ce point';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Supprimer le point « ${point.label} » ? Cette action est irréversible.`)) return;
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Suppression…';
      try {
        await AMGT4CEM_PointsStore.remove(point.id);
        this.refresh();
      } catch (err) {
        console.error('[AMGT4CEM] Suppression impossible :', err);
        alert('Impossible de supprimer ce point : ' + err.message);
        deleteBtn.disabled = false;
        deleteBtn.textContent = '🗑 Supprimer ce point';
      }
    });
    container.appendChild(deleteBtn);

    return container;
  },

  /**
   * Popup d'un signalement ou d'une demande. Contenu construit en DOM (textContent) :
   * la description et la localisation sont des saisies libres.
   */
  _buildSignalementPopup(point) {
    const sig = AMGT4CEM_Signalements;
    const p = point.properties;
    const container = document.createElement('div');
    container.className = 'amgt-popup';

    if (p.flux === 'AMIANTE') {
      const banner = document.createElement('p');
      banner.className = 'amgt-amiante-banner';
      banner.textContent = '⚠ Flux amiante';
      container.appendChild(banner);
    }

    const table = document.createElement('table');
    const addRow = (key, value) => {
      if (value === null || value === undefined || value === '') return;
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = key;
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(th, td);
      table.appendChild(tr);
    };
    const nature = sig.vocab && sig.nature(p.nature);
    const type = sig.vocab && sig.type(point.type);
    const domaine = sig.vocab && p.domaine ? sig.domaine(p.domaine) : null;
    addRow('Référence', p.reference || 'attribuée à l\'import');
    addRow('Nature', nature ? nature.fr : p.nature);
    addRow('Type', type ? type.fr : point.type);
    addRow('Domaine technique', domaine ? domaine.fr : p.domaine);
    addRow('Date d\'observation', p.dateObservation);
    addRow('Localisation', p.lieu);
    addRow('Description', p.description);
    addRow('X Lambert', AMGT4CEM_CRS.formatCoord(point.x));
    addRow('Y Lambert', AMGT4CEM_CRS.formatCoord(point.y));
    addRow('Exporté le', p.exporteLe ? p.exporteLe.slice(0, 16).replace('T', ' ') : 'pas encore exporté');
    container.appendChild(table);

    if ((p.pieces || []).length) {
      const strip = document.createElement('div');
      strip.className = 'amgt-photo-list';
      container.appendChild(strip);
      p.pieces.forEach(async (meta, i) => {
        try {
          const record = await AMGT4CEM_PiecesStore.get(meta.id);
          if (!record) return;
          const img = document.createElement('img');
          img.src = URL.createObjectURL(record.blob);
          img.alt = `Photo ${i + 1}`;
          img.className = 'amgt-photo-thumb';
          strip.appendChild(img);
        } catch (err) {
          console.warn('[AMGT4CEM] Photo illisible :', err);
        }
      });
    }

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'amgt-btn amgt-btn--primary';
    exportBtn.textContent = '⬇ Exporter le dépôt (.zip)';
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      try {
        await sig.exportPoint(point);
        const updated = await AMGT4CEM_PointsStore.update(point.id, {
          properties: { ...point.properties, exporteLe: new Date().toISOString() },
        });
        if (updated) point.properties = updated.properties;
        this.refresh();
      } catch (err) {
        console.error('[AMGT4CEM] Export impossible :', err);
        alert('Impossible d\'exporter ce signalement : ' + err.message);
      } finally {
        exportBtn.disabled = false;
      }
    });
    container.appendChild(exportBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'amgt-btn amgt-popup__delete-btn';
    deleteBtn.textContent = '🗑 Supprimer';
    deleteBtn.addEventListener('click', async () => {
      const warn = p.exporteLe ? '' : '\n\nCe signalement n\'a pas encore été exporté : sa suppression est définitive.';
      if (!confirm(`Supprimer « ${point.label} » ?${warn}`)) return;
      deleteBtn.disabled = true;
      try {
        await AMGT4CEM_PointsStore.remove(point.id);
        this.refresh();
      } catch (err) {
        console.error('[AMGT4CEM] Suppression impossible :', err);
        alert('Impossible de supprimer ce point : ' + err.message);
        deleteBtn.disabled = false;
      }
    });
    container.appendChild(deleteBtn);

    return container;
  },
};
