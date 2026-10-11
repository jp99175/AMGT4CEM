/**
 * « Toutes les entrées » de SIG4CEM : les entrées actives du système (index du serveur de dépôt), lecture seule,
 * visibles par tous les agents connectés. Une rubrique par formulaire (pour l'instant : Signalement/demande).
 *
 * SIG4CEM.All.count() -> nombre d'entrées (null si hors connexion) ; SIG4CEM.All.open({ back() })
 */
(function () {
const SIG = (window.SIG4CEM = window.SIG4CEM || {});
const NS = (window.AMGT4CEM_Signalements = window.AMGT4CEM_Signalements || {});
const h = SIG.h;

function fmtDay(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

SIG.All = {
  el: null,
  rows: [],

  /** Récupère l'index auprès du serveur ; null sans connexion ou en cas d'échec. */
  async fetch() {
    if (!AMGT4CEM_Auth.configured() || !AMGT4CEM_Auth.session()) return null;
    try {
      this.rows = (await AMGT4CEM_Auth.call('/signalements')).signalements || [];
      return this.rows;
    } catch (err) {
      console.warn('[SIG4CEM] Toutes les entrées : lecture impossible :', err);
      return null;
    }
  },

  async count() {
    const rows = await this.fetch();
    return rows ? rows.length : null;
  },

  async open(ctx) {
    if (!this.el) {
      this.el = h('section', { class: 'sig4cem-screen sig4cem-screen--list sig4cem-hidden' });
      document.getElementById('sig4cem-root').append(this.el);
    }
    this.el.classList.remove('sig4cem-hidden');
    this.el.textContent = '';
    this.el.append(h('p', { class: 'sig4cem-note', text: 'Chargement…' }));
    const rows = await this.fetch();
    const back = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--small', text: '← Menu' });
    back.addEventListener('click', () => ctx.back());
    this.el.textContent = '';
    this.el.append(h('div', { class: 'sig4cem-list__top' }, back, h('h2', { text: `Signalement/demande${rows ? ` (${rows.length})` : ''}` })));
    if (!rows) {
      this.el.append(h('p', { class: 'sig4cem-note', text: 'Lecture impossible : connexion requise ou serveur injoignable.' }));
      return;
    }
    if (!rows.length) this.el.append(h('p', { class: 'sig4cem-note', text: 'Aucune entrée dans le système.' }));
    const list = h('ul', { class: 'sig4cem-list' });
    const stamp = (e) => e.modifieLe || e.recuLe || '';
    for (const e of [...rows].sort((a, b) => stamp(b).localeCompare(stamp(a)))) list.append(this._row(e, ctx));
    this.el.append(list);
  },

  close() {
    if (this.el) this.el.classList.add('sig4cem-hidden');
  },

  _row(e, ctx) {
    const D = NS.Depot;
    const typeDef = D.type(e.type);
    const natureFr = (D.nature(e.nature || (typeDef && typeDef.nature)) || {}).fr;
    const domaineFr = e.domaine ? (D.domaine(e.domaine) || {}).fr : '';
    const nd = [natureFr, domaineFr].filter(Boolean).join(' – ').toLocaleUpperCase('fr-BE');
    const day = fmtDay(e.modifieLe || e.recuLe);
    const ident = [e.reference, `v0.${String(e.version || 1).padStart(2, '0')}`, day ? `du ${day}` : ''].filter(Boolean).join(' ');
    const title = e.titre || (typeDef && typeDef.fr) || 'Entrée';
    const meta = [e.dateObservation, e.lieu, e.nbPieces ? `${e.nbPieces} photo${e.nbPieces > 1 ? 's' : ''}` : '', e.x == null ? 'sans position' : ''].filter(Boolean).join(' · ');
    const dl = h('dl', { class: 'sig4cem-dl' });
    const add = (k, v) => { if (v) dl.append(h('dt', { text: k }), h('dd', { text: v })); };
    add('Description', e.description);
    add('Rédacteur', e.redacteurNom || e.redacteur);
    add('Contributeurs', (e.contributeursNoms || []).filter((n) => n !== (e.redacteurNom || e.redacteur)).join(', '));
    const rest = h('div', { class: 'sig4cem-row__rest' },
      nd ? h('span', { class: 'sig4cem-row__nd', text: nd }) : null,
      h('span', { class: 'sig4cem-row__meta', text: meta }),
      h('span', { class: 'sig4cem-row__status sig4cem-row__status--ok', text: ident }));
    const edit = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--small', text: '✎ Modifier (nouvelle version)' });
    edit.addEventListener('click', () => ctx.revise(e.reference));
    const details = h('details', { class: 'sig4cem-listrow__details' }, h('summary', {}, h('strong', { class: 'sig4cem-row__title', text: title }), rest), dl, edit);
    return h('li', { class: 'sig4cem-listrow' }, details);
  },
};
})();
