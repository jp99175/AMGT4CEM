/**
 * Menu déroulant du bouton « ✚ Ajouter un point ».
 *
 * Sans entrée de plugin, le bouton garde son comportement d'origine (il lance directement « Point métier »).
 * Dès qu'un plugin ajoute une entrée (AMGT4CEM_Plugins : ctx.addPointMenu.add), le bouton ouvre ce menu :
 * les entrées sont classées par `order` (défaut 50 ; « Point métier » vaut 20).
 *
 * Entrée de plugin : { label: texte ou fonction, title?: texte ou fonction, order?, onSelect(),
 *                      isActive?(), deactivate?() }
 * Si l'outil d'un plugin est en cours (isActive), un clic sur le bouton l'arrête au lieu d'ouvrir le menu.
 * setHighlight(true/false) allume le bouton pendant que l'outil d'un plugin est actif.
 */
const AMGT4CEM_AddPointMenu = {
  _btn: null,
  _menu: null,
  _entries: [],
  _corePoint: null,
  _baseLabel: '',

  /** @param {HTMLElement} btn - le bouton ; @param {{corePoint: Function}} options - lance l'outil « Point métier » */
  init(btn, { corePoint }) {
    this._btn = btn;
    this._corePoint = corePoint;
    this._baseLabel = btn.textContent.trim();
    this._menu = document.createElement('div');
    this._menu.id = 'amgt-add-point-menu';
    this._menu.className = 'amgt-add-point-menu amgt-hidden';
    document.body.appendChild(this._menu);

    btn.addEventListener('click', (e) => { e.stopPropagation(); this._onButton(); });
    document.addEventListener('click', (e) => { if (!this._menu.contains(e.target)) this.close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
  },

  add(entry) {
    this._entries.push({ order: 50, ...entry });
    this._btn.textContent = `${this._baseLabel} ▾`;
  },

  setHighlight(on) {
    this._btn.classList.toggle('amgt-btn--active', !!on);
  },

  close() {
    this._menu.classList.add('amgt-hidden');
  },

  _onButton() {
    if (AMGT4CEM_AddPointTool.isActive()) { AMGT4CEM_AddPointTool.deactivate(); this.close(); return; }
    const running = this._entries.find((en) => en.isActive && en.isActive());
    if (running) { running.deactivate(); this.close(); return; }
    if (!this._entries.length) { this._corePoint(); return; }
    if (this._menu.classList.contains('amgt-hidden')) this._open(); else this.close();
  },

  _open() {
    const items = [{ order: 20, label: '✚ Point métier', title: 'Poser un point métier sur la carte', onSelect: () => this._corePoint() }, ...this._entries]
      .sort((a, b) => a.order - b.order);
    this._menu.textContent = '';
    for (const item of items) {
      const value = (v) => (typeof v === 'function' ? v() : v);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'amgt-add-point-menu__item';
      b.textContent = value(item.label);
      if (item.title) b.title = value(item.title);
      b.addEventListener('click', (e) => { e.stopPropagation(); this.close(); item.onSelect(); });
      this._menu.appendChild(b);
    }
    const r = this._btn.getBoundingClientRect();
    this._menu.style.left = `${Math.max(8, r.left)}px`;
    this._menu.style.top = `${r.bottom + 4}px`;
    this._menu.classList.remove('amgt-hidden');
  },
};
