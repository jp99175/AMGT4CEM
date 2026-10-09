/**
 * Listes « Mes entrées » de SIG4CEM : brouillons, envois en cours, dernières entrées.
 *
 *  - Draft : entrées enregistrées en local, envoi pas demandé. Cases à cocher ; « Envoyer la sélection »,
 *    « Supprimer la sélection » ; un toucher sur l'entrée la rouvre dans le formulaire.
 *  - Téléversement en cours : envoi demandé mais pas reçu (en attente ou en erreur, avec le message d'erreur).
 *    Cases à cocher ; « Relancer l'envoi », « Repasser en brouillon », « Supprimer ».
 *  - Mes dernières entrées : entrées reçues par le serveur (avec leur référence), filtrées par date d'envoi :
 *    7 jours, 1 mois ou entre deux dates. Lecture seule : modifier une entrée envoyée (révision) reste à faire.
 *
 * SIG4CEM.List.open({ kind: 'draft'|'file'|'envoye', back(), edit(entry), send(id) -> message })
 */
(function () {
const SIG = (window.SIG4CEM = window.SIG4CEM || {});
const NS = (window.AMGT4CEM_Signalements = window.AMGT4CEM_Signalements || {});
const h = SIG.h;
const S = SIG.STATUT;

const TITRES = { draft: 'Draft', file: 'Téléversement en cours', envoye: 'Mes dernières entrées' };
const VIDES = {
  draft: 'Aucun brouillon en local.',
  file: "Aucun envoi en cours : tout ce qui a été demandé est arrivé sur le serveur.",
  envoye: 'Aucune entrée envoyée sur cette période.',
};

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso).slice(0, 16).replace('T', ' ') : d.toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' });
}

SIG.List = {
  el: null,
  kind: null,
  ctx: null,
  selected: new Set(),
  filter: { mode: '7j', from: '', to: '' },
  notice: '',
  busy: false,

  open(ctx) {
    this.ctx = ctx;
    this.kind = ctx.kind;
    this.selected = new Set();
    this.notice = ctx.notice || '';
    if (!this.el) {
      this.el = h('section', { class: 'sig4cem-screen sig4cem-screen--list sig4cem-hidden' });
      document.getElementById('sig4cem-root').append(this.el);
    }
    this.el.classList.remove('sig4cem-hidden');
    return this.render();
  },

  close() {
    if (this.el) this.el.classList.add('sig4cem-hidden');
  },

  /** Entrées de la liste courante, les plus récentes d'abord. */
  async _entries() {
    const all = await SIG.Entries.all();
    let rows;
    if (this.kind === 'draft') rows = all.filter((e) => e.statut === S.DRAFT);
    else if (this.kind === 'file') rows = all.filter((e) => e.statut === S.FILE || e.statut === S.ERREUR);
    else rows = all.filter((e) => e.statut === S.ENVOYE);
    if (this.kind === 'envoye') {
      const f = this.filter;
      const now = Date.now();
      let from = null;
      let to = null;
      if (f.mode === '7j') from = now - 7 * 864e5;
      else if (f.mode === '1m') from = now - 31 * 864e5;
      else {
        if (f.from) from = new Date(`${f.from}T00:00:00`).getTime();
        if (f.to) to = new Date(`${f.to}T23:59:59`).getTime();
      }
      rows = rows.filter((e) => {
        const t = new Date(e.envoyeLe || e.creeLe).getTime();
        return (from === null || t >= from) && (to === null || t <= to);
      });
    }
    const stamp = (e) => (e.envoyeLe || e.creeLe || '');
    return rows.sort((a, b) => stamp(b).localeCompare(stamp(a)));
  },

  async render() {
    const rows = await this._entries();
    const ids = new Set(rows.map((r) => r.id));
    for (const id of Array.from(this.selected)) if (!ids.has(id)) this.selected.delete(id);
    const selectable = this.kind !== 'envoye';
    const el = this.el;
    el.textContent = '';

    const back = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--small', text: '← Menu' });
    back.addEventListener('click', () => this.ctx.back());
    el.append(h('div', { class: 'sig4cem-list__top' }, back, h('h2', { text: `${TITRES[this.kind]} (${rows.length})` })));
    if (this.notice) el.append(h('p', { class: 'sig4cem-notice', text: this.notice }));

    if (this.kind === 'envoye') el.append(this._filterBar());

    if (selectable && rows.length) el.append(this._toolbar(rows));
    if (!rows.length) el.append(h('p', { class: 'sig4cem-note', text: VIDES[this.kind] }));
    const list = h('ul', { class: 'sig4cem-list' });
    for (const entry of rows) list.append(this._row(entry, selectable));
    el.append(list);
    if (this.kind === 'envoye') {
      el.append(h('p', { class: 'sig4cem-note', text: "Une entrée déjà envoyée ne se modifie pas ici : les révisions d'une entrée envoyée restent à faire." }));
    }
  },

  _filterBar() {
    const f = this.filter;
    const mode = h('select', { 'aria-label': 'Période' },
      new Option('7 derniers jours', '7j'), new Option('1 mois', '1m'), new Option('Entre deux dates', 'periode'));
    mode.value = f.mode;
    const from = h('input', { type: 'date', 'aria-label': 'Du', value: f.from });
    const to = h('input', { type: 'date', 'aria-label': 'Au', value: f.to });
    const dates = h('span', { class: `sig4cem-filter__dates${f.mode === 'periode' ? '' : ' sig4cem-hidden'}` }, 'du ', from, ' au ', to);
    mode.addEventListener('change', () => { f.mode = mode.value; this.render(); });
    from.addEventListener('change', () => { f.from = from.value; this.render(); });
    to.addEventListener('change', () => { f.to = to.value; this.render(); });
    return h('div', { class: 'sig4cem-filter' }, mode, dates);
  },

  _toolbar(rows) {
    const all = h('input', { type: 'checkbox', id: 'sig4cem-list-all', 'aria-label': 'Tout sélectionner' });
    all.checked = rows.length > 0 && rows.every((r) => this.selected.has(r.id));
    all.addEventListener('change', () => {
      if (all.checked) rows.forEach((r) => this.selected.add(r.id)); else this.selected.clear();
      this.render();
    });
    const n = this.selected.size;
    const btn = (text, onClick, primary) => {
      const b = h('button', { type: 'button', class: `sig4cem-btn sig4cem-btn--small${primary ? ' sig4cem-btn--primary' : ''}`, text });
      b.disabled = n === 0 || this.busy;
      b.addEventListener('click', onClick);
      return b;
    };
    const actions = this.kind === 'draft'
      ? [btn('⬆ Envoyer la sélection', () => this._send(), true), btn('🗑 Supprimer', () => this._delete())]
      : [btn("↻ Relancer l'envoi", () => this._send(), true), btn('↩ Repasser en brouillon', () => this._toDraft()), btn('🗑 Supprimer', () => this._delete())];
    return h('div', { class: 'sig4cem-list__toolbar' },
      h('label', { class: 'sig4cem-check' }, all, ` Tout (${n} sélectionnée${n > 1 ? 's' : ''})`),
      h('div', { class: 'sig4cem-list__actions' }, ...actions));
  },

  _row(entry, selectable) {
    const photos = (entry.pieces || []).length;
    const meta = [entry.dateObservation, entry.lieu, photos ? `${photos} photo${photos > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
    const status = entry.statut === S.ERREUR
      ? h('span', { class: 'sig4cem-row__status sig4cem-row__status--erreur', text: `Envoi en erreur : ${entry.erreur || 'cause inconnue'}` })
      : entry.statut === S.FILE
        ? h('span', { class: 'sig4cem-row__status', text: "Envoi demandé, en attente" })
        : entry.statut === S.ENVOYE
          ? h('span', { class: 'sig4cem-row__status sig4cem-row__status--ok', text: `Référence ${entry.reference} · envoyée le ${fmtDate(entry.envoyeLe)}` })
          : null;
    const title = `${entry.flux === 'AMIANTE' ? '⚠ ' : ''}${entry.label || 'Entrée'}`;
    const body = h('div', { class: 'sig4cem-row__body' },
      h('strong', { text: title }), h('span', { class: 'sig4cem-row__meta', text: meta }), status);
    const li = h('li', { class: 'sig4cem-listrow' });
    if (selectable) {
      const cb = h('input', { type: 'checkbox', 'aria-label': `Sélectionner ${title}` });
      cb.checked = this.selected.has(entry.id);
      cb.addEventListener('change', () => {
        if (cb.checked) this.selected.add(entry.id); else this.selected.delete(entry.id);
        this.render();
      });
      const open = h('button', { type: 'button', class: 'sig4cem-listrow__open', title: 'Ouvrir pour modifier' }, body);
      open.addEventListener('click', () => this.ctx.edit(entry));
      li.append(cb, open);
    } else {
      const details = h('details', { class: 'sig4cem-listrow__details' }, h('summary', {}, body));
      const dl = h('dl', { class: 'sig4cem-dl' });
      const add = (k, v) => { if (v) dl.append(h('dt', { text: k }), h('dd', { text: v })); };
      const D = NS.Depot;
      add('Nature', (D.nature(entry.nature) || {}).fr);
      add('Type', (D.type(entry.type) || {}).fr);
      add('Domaine technique', entry.domaine ? (D.domaine(entry.domaine) || {}).fr : '');
      add('Demandeur', entry.demandeur);
      add('Référence du demandeur', entry.referenceDemandeur);
      add('Description', entry.description);
      details.append(dl);
      li.append(details);
    }
    return li;
  },

  async _toDraft() {
    for (const id of this.selected) await SIG.Entries.update(id, { statut: S.DRAFT, erreur: null, lotOuvert: false });
    this.notice = `${this.selected.size} entrée(s) repassée(s) en brouillon.`;
    this.selected.clear();
    await this.render();
  },

  async _delete() {
    const n = this.selected.size;
    if (!confirm(`Supprimer ${n} entrée(s) et leurs photos de cet appareil ? Cette suppression est définitive.`)) return;
    for (const id of this.selected) await SIG.Entries.remove(id);
    this.notice = `${n} entrée(s) supprimée(s).`;
    this.selected.clear();
    await this.render();
  },

  /** Envoie la sélection, une entrée à la fois, et affiche le résultat. */
  async _send() {
    const ids = Array.from(this.selected);
    this.busy = true;
    let ok = 0;
    const errors = [];
    for (const [i, id] of ids.entries()) {
      this.notice = `Envoi ${i + 1}/${ids.length}…`;
      await this.render();
      await SIG.Entries.update(id, { statut: S.FILE, lotOuvert: true });
      const message = await this.ctx.send(id);
      const after = await SIG.Entries.get(id);
      if (after && after.statut === S.ENVOYE) ok += 1; else errors.push(message);
    }
    this.busy = false;
    this.selected.clear();
    this.notice = `${ok} entrée(s) envoyée(s) sur ${ids.length}.${errors.length ? ` ${errors[0]}` : ''}`;
    await this.render();
  },
};
})();
