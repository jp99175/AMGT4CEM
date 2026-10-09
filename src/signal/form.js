/**
 * Formulaire de saisie d'une entrée (signalement ou demande), dans SIG4CEM.
 *
 * Mêmes champs et même vocabulaire que le plugin `signalements` (data/signalements/vocabulaire.json via
 * src/signalements/depot.js) : nature > type > domaine technique, date d'observation, localisation précisée,
 * demandeur et sa référence, description, photos. La position vient du choix sur la carte (mapPicker.js).
 * Les photos sont réduites et rangées dans IndexedDB dès leur ajout (src/signalements/pieces-store.js),
 * sous l'identifiant de l'entrée : annuler les supprime.
 *
 * Deux boutons d'enregistrement : « Enregistrer en local » (brouillon) et « Enregistrer et envoyer »
 * (envoi demandé). Le formulaire ne fait que rendre les données ; l'enregistrement est celui de signal.js.
 *
 * SIG4CEM.Form.open({ entryId, position, onSave(data, { send }), onChangePosition(), onCancel() })
 */
(function () {
const SIG = (window.SIG4CEM = window.SIG4CEM || {});
const NS = (window.AMGT4CEM_Signalements = window.AMGT4CEM_Signalements || {});
const h = SIG.h;

SIG.Form = {
  el: null,
  f: {},
  entryId: null,
  position: null,
  photos: [],
  editing: null, // entrée rouverte depuis une liste (null : nouvelle entrée)
  removed: [], // photos retirées pendant la modification d'une entrée : supprimées seulement à l'enregistrement

  _row(label, control, id) {
    return h('div', { class: 'sig4cem-row' }, h('label', { for: id, text: label }), control);
  },

  _build() {
    if (this.el) return;
    const f = this.f;
    const D = NS.Depot;
    f.pos = h('span', { class: 'sig4cem-form__pos' });
    f.changePos = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--small', text: 'Modifier la position' });
    f.nature = h('select', { id: 'sig4cem-f-nature' }, new Option('— choisir —', ''));
    for (const n of D.natures()) f.nature.add(new Option(n.fr, n.code));
    f.type = h('select', { id: 'sig4cem-f-type' });
    f.amiante = h('p', { class: 'sig4cem-amiante sig4cem-hidden', text: '⚠ Flux amiante : enregistré et envoyé séparément des autres entrées.' });
    f.domaineLabel = h('label', { for: 'sig4cem-f-domaine', text: 'Domaine technique' });
    f.domaine = h('select', { id: 'sig4cem-f-domaine' });
    f.date = h('input', { type: 'date', id: 'sig4cem-f-date' });
    f.lieu = h('input', { type: 'text', id: 'sig4cem-f-lieu', maxlength: '200', placeholder: 'station, niveau, local, PK…' });
    f.demandeur = h('input', { type: 'text', id: 'sig4cem-f-demandeur', maxlength: '200', placeholder: 'qui a demandé ou signalé (service, entreprise, agent…)' });
    f.refDemandeur = h('input', { type: 'text', id: 'sig4cem-f-refdem', maxlength: '100', placeholder: "son numéro de ticket ou de dossier, s'il en a un" });
    f.description = h('textarea', { id: 'sig4cem-f-description', rows: '4', maxlength: '2000' });
    f.camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'sig4cem-hidden', id: 'sig4cem-f-camera' });
    f.files = h('input', { type: 'file', accept: 'image/*', multiple: '', class: 'sig4cem-hidden', id: 'sig4cem-f-files' });
    f.btnCamera = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--icon', title: 'Prendre une photo', 'aria-label': 'Prendre une photo', text: '\u{1F4F7}' });
    f.btnFiles = h('button', { type: 'button', class: 'sig4cem-link', text: 'Joindre des fichiers' });
    f.photoList = h('div', { class: 'sig4cem-photos' });
    f.fields = h('div', { class: 'sig4cem-hidden' },
      this._row('Type', f.type, 'sig4cem-f-type'),
      f.amiante,
      h('div', { class: 'sig4cem-row' }, f.domaineLabel, f.domaine),
      this._row("Date d'observation", f.date, 'sig4cem-f-date'),
      this._row('Localisation précisée', f.lieu, 'sig4cem-f-lieu'),
      this._row('Demandeur', f.demandeur, 'sig4cem-f-demandeur'),
      this._row('Référence chez le demandeur', f.refDemandeur, 'sig4cem-f-refdem'),
      this._row('Description', f.description, 'sig4cem-f-description'),
      h('div', { class: 'sig4cem-row' }, h('label', { text: 'Photos' }),
        h('div', { class: 'sig4cem-photo-buttons' }, f.btnCamera, f.btnFiles), f.camera, f.files, f.photoList));
    f.btnCancel = h('button', { type: 'button', class: 'sig4cem-btn', text: 'Annuler' });
    f.btnLocal = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--primary', text: 'Enregistrer en local' });
    f.btnSend = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--primary', text: 'Enregistrer et envoyer' });
    f.title = h('h2', { text: 'Nouvelle entrée' });
    this.el = h('section', { class: 'sig4cem-screen sig4cem-screen--form sig4cem-hidden' },
      f.title,
      h('div', { class: 'sig4cem-row sig4cem-row--pos' }, f.pos, f.changePos),
      this._row('Nature', f.nature, 'sig4cem-f-nature'),
      f.fields,
      h('div', { class: 'sig4cem-actions' }, f.btnLocal, f.btnSend, f.btnCancel));
    document.getElementById('sig4cem-root').append(this.el);

    f.nature.addEventListener('change', () => this._onNature());
    f.type.addEventListener('change', () => this._onType());
    f.btnCamera.addEventListener('click', () => f.camera.click());
    f.btnFiles.addEventListener('click', () => f.files.click());
    for (const input of [f.camera, f.files]) {
      input.addEventListener('change', async (e) => {
        const chosen = Array.from(e.target.files);
        e.target.value = '';
        for (const file of chosen) await this._addPhoto(file);
      });
    }
  },

  _onNature() {
    const f = this.f;
    const nature = f.nature.value;
    f.fields.classList.toggle('sig4cem-hidden', !nature);
    f.type.textContent = '';
    if (nature) {
      f.type.add(new Option('— choisir —', ''));
      for (const t of NS.Depot.typesFor(nature)) f.type.add(new Option(t.flux === 'AMIANTE' ? `${t.fr} (amiante)` : t.fr, t.code));
    }
    this._onType();
  },

  _onType() {
    const f = this.f;
    const type = NS.Depot.type(f.type.value);
    f.domaine.textContent = '';
    f.domaine.add(new Option(type && !type.domaineObligatoire ? 'Non précisé' : '— choisir —', ''));
    for (const d of NS.Depot.vocab.domaines) f.domaine.add(new Option(d.fr, d.code));
    f.domaineLabel.textContent = type && !type.domaineObligatoire ? 'Domaine technique (facultatif)' : 'Domaine technique';
    f.amiante.classList.toggle('sig4cem-hidden', !(type && type.flux === 'AMIANTE'));
  },

  async _addPhoto(file) {
    try {
      this.photos.push(await NS.Pieces.add(this.entryId, file));
      await this._renderPhotos();
    } catch (err) {
      console.error('[SIG4CEM] Photo non ajoutée :', err);
      alert(`Impossible d'ajouter cette photo : ${err.message}`);
    }
  },

  async _renderPhotos() {
    const list = this.f.photoList;
    for (const img of list.querySelectorAll('img')) URL.revokeObjectURL(img.src);
    list.textContent = '';
    for (const [i, meta] of this.photos.entries()) {
      const record = await NS.Pieces.get(meta.id);
      if (!record) continue;
      const rm = h('button', { type: 'button', class: 'sig4cem-photo__rm', title: 'Retirer cette photo', 'aria-label': 'Retirer cette photo', text: '✕' });
      rm.addEventListener('click', async () => {
        this.photos.splice(i, 1);
        if (this.editing) this.removed.push(meta.id); else await NS.Pieces.remove(meta.id);
        await this._renderPhotos();
      });
      // La photo d'origine ; les annotations sont un calque transparent superposé, jamais fondu dans la photo.
      const thumb = h('span', { class: 'sig4cem-photo' }, h('img', { src: URL.createObjectURL(record.blob), alt: `Photo ${i + 1}` }));
      if (record.annot) thumb.append(h('img', { class: 'sig4cem-photo__overlay', src: URL.createObjectURL(record.annot), alt: '' }));
      thumb.append(rm);
      const edit = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--small', text: record.annot ? '✏️ Modifier les annotations' : '✏️ Annoter' });
      edit.addEventListener('click', () => {
        SIG.PhotoEditor.open(record.blob, record.traits || [], async (traits) => {
          const png = await SIG.PhotoEditor.overlayPng(traits, meta.largeur, meta.hauteur);
          meta.annotation = await NS.Pieces.setAnnotations(meta.id, traits, png);
          await this._renderPhotos();
        });
      });
      const comment = h('textarea', { class: 'sig4cem-photo__comment', rows: '2', maxlength: '500', placeholder: 'Commentaire sur cette photo (facultatif)' });
      comment.value = meta.commentaire || '';
      comment.addEventListener('input', () => { meta.commentaire = comment.value; });
      list.append(h('div', { class: 'sig4cem-photo-card' }, thumb, h('div', { class: 'sig4cem-photo-card__side' }, comment, edit)));
    }
  },

  _showPosition() {
    this.f.pos.textContent = `Position : X ${AMGT4CEM_CRS.formatCoord(this.position.x)} · Y ${AMGT4CEM_CRS.formatCoord(this.position.y)}`;
  },

  /** Données du formulaire, ou null (message à l'écran) si un champ obligatoire manque. */
  _collect() {
    const f = this.f;
    const D = NS.Depot;
    const type = D.type(f.type.value);
    if (!f.nature.value) { alert('Merci de choisir la nature.'); return null; }
    if (!type) { alert('Merci de choisir le type.'); return null; }
    if (type.domaineObligatoire && !f.domaine.value) { alert('Merci de choisir le domaine technique.'); return null; }
    if (!f.date.value) { alert("Merci de renseigner la date d'observation."); return null; }
    return {
      id: this.entryId,
      flux: type.flux,
      nature: f.nature.value,
      type: type.code,
      domaine: f.domaine.value || null,
      label: D.buildLabel(type.code, f.domaine.value),
      x: this.position.x,
      y: this.position.y,
      dateObservation: f.date.value,
      lieu: f.lieu.value.trim(),
      demandeur: f.demandeur.value.trim(),
      referenceDemandeur: f.refDemandeur.value.trim(),
      description: f.description.value.trim(),
      pieces: this.photos.map((m) => ({ ...m, commentaire: (m.commentaire || '').trim() })),
      ...(this.editing ? { creeLe: this.editing.creeLe } : {}),
    };
  },

  /**
   * Ouvre le formulaire pour une nouvelle entrée (`reuse` : revenir du choix de position sans tout effacer),
   * ou pour une entrée déjà enregistrée (`entry` : brouillon ou envoi en attente rouvert depuis une liste).
   */
  open({ entryId, position, reuse, entry, onSave, onChangePosition, onCancel }) {
    this._build();
    const f = this.f;
    if (!reuse) {
      this.editing = entry || null;
      this.removed = [];
      this.entryId = entry ? entry.id : entryId;
      this.photos = entry ? (entry.pieces || []).map((m) => ({ ...m })) : [];
      f.title.textContent = entry ? "Modifier l'entrée" : 'Nouvelle entrée';
      f.nature.value = entry ? entry.nature : '';
      this._onNature();
      if (entry) { f.type.value = entry.type; this._onType(); f.domaine.value = entry.domaine || ''; }
      f.date.value = entry ? entry.dateObservation : NS.Depot.today();
      for (const k of ['lieu', 'demandeur', 'refDemandeur', 'description']) {
        const keys = { lieu: 'lieu', demandeur: 'demandeur', refDemandeur: 'referenceDemandeur', description: 'description' };
        f[k].value = entry ? (entry[keys[k]] || '') : '';
      }
      this._renderPhotos();
    }
    this.position = position;
    this._showPosition();
    this.el.classList.remove('sig4cem-hidden');
    f.changePos.onclick = () => onChangePosition();
    f.btnCancel.onclick = async () => {
      if (this.editing) {
        // Entrée déjà enregistrée : annuler ne supprime rien de ce qui existait ; seules les photos ajoutées pendant cette modification partent.
        const kept = new Set((this.editing.pieces || []).map((m) => m.id));
        for (const m of this.photos) if (!kept.has(m.id)) { try { await NS.Pieces.remove(m.id); } catch (err) { console.warn('[SIG4CEM] Photo non supprimée :', err); } }
        onCancel();
        return;
      }
      if (this.photos.length && !confirm('Abandonner cette entrée et ses photos ?')) return;
      try { await NS.Pieces.removeForPoint(this.entryId); } catch (err) { console.warn('[SIG4CEM] Photos non supprimées :', err); }
      onCancel();
    };
    const save = (send) => async () => {
      const data = this._collect();
      if (!data) return;
      f.btnLocal.disabled = f.btnSend.disabled = true;
      try {
        const saved = await onSave(data, { send });
        if (saved === false) return; // enregistrement refusé : rien n'est supprimé
        for (const id of this.removed) { try { await NS.Pieces.remove(id); } catch (err) { console.warn('[SIG4CEM] Photo non supprimée :', err); } }
        this.removed = [];
      } finally { f.btnLocal.disabled = f.btnSend.disabled = false; }
    };
    f.btnLocal.onclick = save(false);
    f.btnSend.onclick = save(true);
  },

  close() {
    if (this.el) this.el.classList.add('sig4cem-hidden');
  },
};
})();
