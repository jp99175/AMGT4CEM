/**
 * Plugin « Signalements » : saisie des signalements et demandes sur la carte.
 *
 * Application séparée, branchée sur l'application cartographique par src/plugins.js :
 * elle ajoute un bouton « ⚠ Signalement » à la barre d'outils, deux cases de couche au menu
 * ☰ Carte (signalements, flux amiante) et son propre formulaire. Elle ne modifie aucun
 * module du cœur et ne partage pas le stockage des points métier.
 *
 * Contenu de chaque module : voir README.md de ce dossier.
 */
(function () {
const NS = (window.AMGT4CEM_Signalements = window.AMGT4CEM_Signalements || {});

/** Petit constructeur DOM : tout texte passe par textContent (jamais de HTML saisi par l'utilisateur). */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const UI = {
  ctx: null,
  groups: { STANDARD: null, AMIANTE: null },
  active: false,
  pendingLatLng: null,
  tempMarker: null,
  photos: [],
  f: {}, // champs du formulaire

  // ---------------------------------------------------------------- initialisation
  async init(ctx) {
    this.ctx = ctx;
    NS.Envoi.init(ctx.options);
    await NS.Depot.load();
    this.groups.STANDARD = L.layerGroup().addTo(ctx.map);
    this.groups.AMIANTE = L.layerGroup().addTo(ctx.map);

    this._registerMenuEntries();
    this._buildMenuRows();
    this._buildForm();

    ctx.map.on('click', (e) => this.handleMapClick(e));
    ctx.captureClicks({ isActive: () => this.active, handleMapClick: (e) => this.handleMapClick(e) });
    ctx.onCoreToolActivated(() => this.deactivate());
    await this.refresh();
  },

  /** Entrées du menu du bouton « ✚ Ajouter un point » : saisie d'un signalement, téléversement des envois en attente. */
  _registerMenuEntries() {
    this.pending = 0;
    this.ctx.addPointMenu.add({
      order: 10,
      label: '⚠ Signalement',
      title: 'Saisir un signalement ou une demande',
      onSelect: () => { this.ctx.deactivateCoreTools(); this.activate(); },
      isActive: () => this.active,
      deactivate: () => this.deactivate(),
    });
    this.ctx.addPointMenu.add({
      order: 30,
      label: () => `⬆ Téléverser les fichiers sur le serveur (${this.pending})`,
      title: () => (NS.Envoi.configured() ? 'Envoie au serveur les signalements pas encore référencés' : "Aucun serveur de dépôt configuré (options.serverUrl dans config.js)"),
      onSelect: () => this.uploadPending(),
    });
  },

  _buildMenuRows() {
    const row = (id, label) => {
      const input = h('input', { type: 'checkbox', id, checked: '' });
      input.checked = true;
      return { input, el: h('div', { class: 'amgt-layer-row' }, h('label', { class: 'amgt-checkbox-row' }, input, ` ${label}`)) };
    };
    const std = row('amgt-sig-layer-standard', 'Signalements et demandes');
    const am = row('amgt-sig-layer-amiante', 'Amiante');
    std.input.addEventListener('change', (e) => this._toggleGroup('STANDARD', e.target.checked));
    am.input.addEventListener('change', (e) => this._toggleGroup('AMIANTE', e.target.checked));
    const anchor = document.getElementById('amgt-reset-view-btn');
    // Dans la section « Points métier » du menu (après la couche des points, avant « Réinitialiser la vue »).
    for (const n of [std.el, am.el]) anchor.parentNode.insertBefore(n, anchor);
  },

  _toggleGroup(flux, visible) {
    if (visible) this.groups[flux].addTo(this.ctx.map);
    else this.ctx.map.removeLayer(this.groups[flux]);
  },

  // ---------------------------------------------------------------- formulaire
  _buildForm() {
    const f = this.f;
    const row = (label, control, id) => h('div', { class: 'amgt-form-row' }, h('label', { for: id, text: label }), control);

    f.nature = h('select', { id: 'amgt-sig-nature' }, new Option('— choisir —', ''));
    for (const n of NS.Depot.natures()) f.nature.add(new Option(n.fr, n.code));
    f.type = h('select', { id: 'amgt-sig-type' });
    f.amiante = h('p', { class: 'amgt-sig-amiante-banner amgt-hidden', text: '⚠ Flux amiante : enregistré et exporté séparément des autres signalements.' });
    f.domaine = h('select', { id: 'amgt-sig-domaine' });
    f.domaineLabel = h('label', { for: 'amgt-sig-domaine', text: 'Domaine technique' });
    f.date = h('input', { type: 'date', id: 'amgt-sig-date' });
    f.lieu = h('input', { type: 'text', id: 'amgt-sig-lieu', maxlength: '200', placeholder: 'station, niveau, local, PK…' });
    f.demandeur = h('input', { type: 'text', id: 'amgt-sig-demandeur', maxlength: '200', placeholder: 'qui a demandé ou signalé (service, entreprise, agent…)' });
    f.refDemandeur = h('input', { type: 'text', id: 'amgt-sig-ref-demandeur', maxlength: '100', placeholder: "son numéro de ticket ou de dossier, s'il en a un" });
    f.description = h('textarea', { id: 'amgt-sig-description', rows: '3', maxlength: '2000' });
    f.photoInput = h('input', { type: 'file', id: 'amgt-sig-photos', accept: 'image/*', multiple: '' });
    f.photoList = h('div', { class: 'amgt-photo-list' });
    f.x = h('span', { text: '-' });
    f.y = h('span', { text: '-' });
    f.fields = h('div', { class: 'amgt-hidden' },
      row('Type', f.type, 'amgt-sig-type'),
      f.amiante,
      h('div', { class: 'amgt-form-row' }, f.domaineLabel, f.domaine),
      row("Date d'observation", f.date, 'amgt-sig-date'),
      row('Localisation précisée', f.lieu, 'amgt-sig-lieu'),
      row('Demandeur', f.demandeur, 'amgt-sig-demandeur'),
      row('Référence chez le demandeur', f.refDemandeur, 'amgt-sig-ref-demandeur'),
      row('Description', f.description, 'amgt-sig-description'),
      h('div', { class: 'amgt-form-row' }, h('label', { for: 'amgt-sig-photos', text: 'Photos' }), f.photoInput, f.photoList));

    f.confirm = h('button', { class: 'amgt-btn amgt-btn--primary', text: 'Enregistrer' });
    f.cancel = h('button', { class: 'amgt-btn', text: 'Annuler' });
    this.form = h('div', { id: 'amgt-sig-form', class: 'amgt-sig-form amgt-hidden' },
      h('h3', { text: 'Nouveau signalement' }),
      h('div', { class: 'amgt-form-row' }, h('span', {}, 'X Lambert : ', f.x)),
      h('div', { class: 'amgt-form-row' }, h('span', {}, 'Y Lambert : ', f.y)),
      row('Nature', f.nature, 'amgt-sig-nature'),
      f.fields,
      h('div', { class: 'amgt-form-actions' }, f.cancel, f.confirm));
    document.body.appendChild(this.form);

    f.nature.addEventListener('change', () => this._onNatureChange());
    f.type.addEventListener('change', () => this._onTypeChange());
    f.photoInput.addEventListener('change', (e) => {
      for (const file of e.target.files) this.photos.push(file);
      e.target.value = '';
      this._renderPhotos();
    });
    f.confirm.addEventListener('click', () => this.confirm());
    f.cancel.addEventListener('click', () => this.deactivate());
    this._resetForm();
  },

  _onNatureChange() {
    const nature = this.f.nature.value;
    this.f.fields.classList.toggle('amgt-hidden', !nature);
    this.f.type.innerHTML = '';
    if (nature) {
      this.f.type.add(new Option('— choisir —', ''));
      for (const t of NS.Depot.typesFor(nature)) this.f.type.add(new Option(t.flux === 'AMIANTE' ? `${t.fr} (amiante)` : t.fr, t.code));
    }
    this._onTypeChange();
  },

  _onTypeChange() {
    const type = NS.Depot.type(this.f.type.value);
    this.f.domaine.innerHTML = '';
    this.f.domaine.add(new Option(type && !type.domaineObligatoire ? 'Non précisé' : '— choisir —', ''));
    for (const d of NS.Depot.vocab.domaines) this.f.domaine.add(new Option(d.fr, d.code));
    this.f.domaineLabel.textContent = type && !type.domaineObligatoire ? 'Domaine technique (facultatif)' : 'Domaine technique';
    this.f.amiante.classList.toggle('amgt-hidden', !(type && type.flux === 'AMIANTE'));
  },

  _renderPhotos() {
    for (const img of this.f.photoList.querySelectorAll('img')) URL.revokeObjectURL(img.src);
    this.f.photoList.textContent = '';
    this.photos.forEach((file, i) => {
      const rm = h('button', { type: 'button', title: 'Retirer cette photo', text: '✕' });
      rm.addEventListener('click', () => { this.photos.splice(i, 1); this._renderPhotos(); });
      this.f.photoList.appendChild(h('span', { class: 'amgt-photo-item' },
        h('img', { src: URL.createObjectURL(file), alt: `Photo ${i + 1}` }), rm));
    });
  },

  _resetForm() {
    const f = this.f;
    f.nature.value = '';
    this._onNatureChange();
    f.date.value = NS.Depot.today();
    for (const k of ['lieu', 'demandeur', 'refDemandeur', 'description']) f[k].value = '';
    this.photos = [];
    this._renderPhotos();
  },

  // ---------------------------------------------------------------- placement
  toggle() { if (this.active) this.deactivate(); else this.activate(); },

  activate() {
    this.active = true;
    this.ctx.map.getContainer().classList.add('amgt-placing-mode');
    this.ctx.addPointMenu.setHighlight(true);
  },

  deactivate() {
    this.active = false;
    this.ctx.map.getContainer().classList.remove('amgt-placing-mode');
    this.ctx.addPointMenu.setHighlight(false);
    if (this.tempMarker) { this.ctx.map.removeLayer(this.tempMarker); this.tempMarker = null; }
    this.form.classList.add('amgt-hidden');
    this.pendingLatLng = null;
    this._resetForm();
  },

  handleMapClick(e) {
    if (!this.active) return;
    this.pendingLatLng = e.latlng;
    if (this.tempMarker) this.ctx.map.removeLayer(this.tempMarker);
    this.tempMarker = L.marker(e.latlng, {
      draggable: true,
      icon: L.divIcon({ className: 'amgt-temp-marker', html: '<div class="amgt-temp-marker__dot"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
    }).addTo(this.ctx.map);
    this.tempMarker.on('dragend', () => { this.pendingLatLng = this.tempMarker.getLatLng(); this._showCoords(); this._keepMarkerVisible(); });
    this._showCoords();
    this.form.classList.remove('amgt-hidden');
    this._keepMarkerVisible();
  },

  _showCoords() {
    const { x, y } = this.ctx.crs.latLngToLambert(this.pendingLatLng);
    this.f.x.textContent = this.ctx.crs.formatCoord(x);
    this.f.y.textContent = this.ctx.crs.formatCoord(y);
    this.pendingLambert = { x, y };
  },

  /** Le formulaire est ancré en bas de l'écran : décale la vue pour que le marqueur reste visible au-dessus. */
  _keepMarkerVisible() {
    const formRect = this.form.getBoundingClientRect();
    const mapRect = this.ctx.map.getContainer().getBoundingClientRect();
    const safeBottom = formRect.top - mapRect.top - 16;
    const p = this.ctx.map.latLngToContainerPoint(this.pendingLatLng);
    if (p.y > safeBottom) this.ctx.map.panBy([0, p.y - safeBottom], { animate: true });
  },

  // ---------------------------------------------------------------- enregistrement
  async confirm() {
    const f = this.f;
    const D = NS.Depot;
    const nature = f.nature.value;
    const type = D.type(f.type.value);
    if (!nature) return alert('Merci de choisir la nature.');
    if (!type) return alert('Merci de choisir le type.');
    if (type.domaineObligatoire && !f.domaine.value) return alert('Merci de choisir le domaine technique.');
    if (!f.date.value) return alert("Merci de renseigner la date d'observation.");
    if (!this.pendingLambert) return;

    f.confirm.disabled = true;
    f.confirm.textContent = 'Enregistrement…';
    let item = null;
    try {
      item = await NS.Store.add({
        flux: type.flux,
        nature,
        type: type.code,
        domaine: f.domaine.value || null,
        label: D.buildLabel(type.code, f.domaine.value),
        x: this.pendingLambert.x,
        y: this.pendingLambert.y,
        dateObservation: f.date.value,
        lieu: f.lieu.value.trim(),
        demandeur: f.demandeur.value.trim(),
        referenceDemandeur: f.refDemandeur.value.trim(),
        description: f.description.value.trim(),
      });
      const pieces = [];
      for (const file of this.photos) pieces.push(await NS.Pieces.add(item.id, file));
      if (pieces.length) await NS.Store.update(item.id, { pieces });
      this.deactivate();
      await this.refresh();
    } catch (err) {
      console.error('[AMGT4CEM] Enregistrement du signalement impossible :', err);
      if (item) await NS.Store.remove(item.id); // tout ou rien : pas de signalement sans ses photos
      alert("Impossible d'enregistrer ce signalement : " + err.message);
    } finally {
      f.confirm.disabled = false;
      f.confirm.textContent = 'Enregistrer';
    }
  },

  // ---------------------------------------------------------------- affichage
  async refresh() {
    this.groups.STANDARD.clearLayers();
    this.groups.AMIANTE.clearLayers();
    const all = await NS.Store.getAll();
    for (const s of all) this._addMarker(s);
    this.pending = all.filter((s) => !s.reference).length;
  },

  /** Envoie un signalement et inscrit la référence reçue sur la copie locale. */
  async _send(s) {
    const result = await NS.Envoi.send(s);
    const updated = await NS.Store.update(s.id, { reference: result.reference, envoyeLe: result.recuLe });
    if (updated) Object.assign(s, updated);
    return result;
  },

  /** « Téléverser les fichiers sur le serveur » : envoie un par un les signalements pas encore référencés. */
  async uploadPending() {
    if (!NS.Envoi.configured()) {
      alert("Aucun serveur de dépôt n'est configuré : les signalements restent sur cet appareil (export ZIP possible depuis leur fenêtre).");
      return;
    }
    const pending = (await NS.Store.getAll()).filter((s) => !s.reference);
    if (!pending.length) { alert('Aucun signalement en attente : tous sont déjà référencés.'); return; }
    const refs = [];
    let failure = null;
    for (const s of pending) {
      try { refs.push((await this._send(s)).reference); } catch (err) { failure = err; break; }
    }
    await this.refresh();
    let message = `${refs.length} signalement(s) téléversé(s) sur ${pending.length}.`;
    if (refs.length) message += `\nRéférences : ${refs.join(', ')}`;
    if (failure) message += `\n\nArrêt : ${failure.message}`;
    alert(message);
  },

  _addMarker(s) {
    const crs = this.ctx.crs;
    const amiante = s.flux === 'AMIANTE';
    const marker = L.marker(crs.lambertToLatLng([s.x, s.y]), {
      draggable: !s.reference, // une fois référencé, la position envoyée ne bouge plus
      icon: L.divIcon({
        className: `${amiante ? 'amgt-sig-marker amgt-sig-marker--amiante' : 'amgt-sig-marker'}${s.reference ? ' amgt-sig-marker--refere' : ''}`,
        html: '<div class="amgt-sig-marker__dot"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    });
    marker.bindPopup(() => this._popup(s));
    marker.on('dragend', async () => {
      const { x, y } = crs.latLngToLambert(marker.getLatLng());
      try {
        const updated = await NS.Store.update(s.id, { x, y });
        if (updated) { s.x = x; s.y = y; }
      } catch (err) {
        alert("Impossible d'enregistrer le déplacement : " + err.message);
        marker.setLatLng(crs.lambertToLatLng([s.x, s.y]));
      }
    });
    marker.addTo(this.groups[amiante ? 'AMIANTE' : 'STANDARD']);
  },

  _popup(s) {
    const D = NS.Depot;
    const box = h('div', { class: 'amgt-popup' });
    if (s.flux === 'AMIANTE') box.append(h('p', { class: 'amgt-sig-amiante-banner', text: '⚠ Flux amiante' }));
    const table = h('table');
    const add = (k, v) => { if (v !== null && v !== undefined && v !== '') table.append(h('tr', {}, h('th', { text: k }), h('td', { text: v }))); };
    add('Référence', s.reference || 'pas encore envoyé au serveur');
    add('Nature', (D.nature(s.nature) || {}).fr || s.nature);
    add('Type', (D.type(s.type) || {}).fr || s.type);
    add('Domaine technique', s.domaine ? (D.domaine(s.domaine) || {}).fr || s.domaine : '');
    add("Date d'observation", s.dateObservation);
    add('Localisation', s.lieu);
    add('Demandeur', s.demandeur);
    add('Réf. chez le demandeur', s.referenceDemandeur);
    add('Description', s.description);
    add('X Lambert', this.ctx.crs.formatCoord(s.x));
    add('Y Lambert', this.ctx.crs.formatCoord(s.y));
    add('Envoyé le', s.envoyeLe ? s.envoyeLe.slice(0, 16).replace('T', ' ') : '');
    add('Exporté le', s.exporteLe ? s.exporteLe.slice(0, 16).replace('T', ' ') : 'pas encore exporté');
    box.append(table);

    if ((s.pieces || []).length) {
      const strip = h('div', { class: 'amgt-photo-list' });
      box.append(strip);
      s.pieces.forEach(async (meta, i) => {
        try {
          const record = await NS.Pieces.get(meta.id);
          if (record) strip.append(h('img', { class: 'amgt-photo-thumb', src: URL.createObjectURL(record.blob), alt: `Photo ${i + 1}` }));
        } catch (err) { console.warn('[AMGT4CEM] Photo illisible :', err); }
      });
    }

    const sendBtn = h('button', { type: 'button', class: 'amgt-btn amgt-btn--primary', text: '⬆ Envoyer au serveur' });
    sendBtn.addEventListener('click', async () => {
      sendBtn.disabled = true;
      sendBtn.textContent = 'Envoi…';
      try {
        const result = await this._send(s);
        await this.refresh();
        alert(`Signalement référencé : ${result.reference}`);
      } catch (err) {
        console.error('[AMGT4CEM] Envoi impossible :', err);
        alert(err.message);
        sendBtn.disabled = false;
        sendBtn.textContent = '⬆ Envoyer au serveur';
      }
    });
    const exportBtn = h('button', { type: 'button', class: 'amgt-btn', text: '⬇ Exporter le dépôt (.zip)' });
    exportBtn.addEventListener('click', async () => {
      exportBtn.disabled = true;
      try {
        await D.exportOne(s);
        const updated = await NS.Store.update(s.id, { exporteLe: new Date().toISOString() });
        if (updated) s.exporteLe = updated.exporteLe;
        await this.refresh();
      } catch (err) {
        console.error('[AMGT4CEM] Export impossible :', err);
        alert("Impossible d'exporter ce signalement : " + err.message);
      } finally {
        exportBtn.disabled = false;
      }
    });
    const delBtn = h('button', { type: 'button', class: 'amgt-btn amgt-popup__delete-btn', text: '🗑 Supprimer' });
    delBtn.addEventListener('click', async () => {
      const warn = s.reference
        ? `\n\nIl est référencé (${s.reference}) : la copie du serveur est conservée, seule la copie de cet appareil disparaît.`
        : s.exporteLe ? '' : "\n\nCe signalement n'a ni été envoyé ni exporté : sa suppression est définitive.";
      if (!confirm(`Supprimer « ${s.label} » ?${warn}`)) return;
      delBtn.disabled = true;
      try { await NS.Store.remove(s.id); await this.refresh(); }
      catch (err) { alert('Impossible de supprimer ce signalement : ' + err.message); delBtn.disabled = false; }
    });
    if (!s.reference && NS.Envoi.configured()) box.append(sendBtn);
    box.append(exportBtn, delBtn);
    return box;
  },
};

NS.UI = UI;
AMGT4CEM_Plugins.register({ id: 'signalements', init: (ctx) => UI.init(ctx) });
})();
