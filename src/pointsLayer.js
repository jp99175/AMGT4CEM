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

  init(map) {
    this._layerGroup = L.layerGroup().addTo(map);
    this.refresh();
    return this._layerGroup;
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
    for (const point of points) {
      this._addMarker(point);
    }
  },

  _addMarker(point) {
    const latlng = AMGT4CEM_CRS.lambertToLatLng([point.x, point.y]);
    const marker = L.marker(latlng, {
      draggable: true,
      icon: L.divIcon({
        className: 'amgt-point-marker',
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

    marker.addTo(this._layerGroup);
  },

  _buildPopupContent(point) {
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
};
