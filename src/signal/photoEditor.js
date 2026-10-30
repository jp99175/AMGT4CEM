/**
 * SIG4CEM — annotations d'une photo : pinceau, ligne (flèche), formes (ellipse), texte. Ligne 1 : historique et outils ; ligne 2 : palette
 * (couleur + opacité) puis options de l'outil actif.
 * Le texte est une zone à fond transparent : on la pose d'un toucher, on la modifie, on la déplace (✥), on la supprime (✕),
 * on change sa taille (A− / A+) et sa couleur tant que l'éditeur est ouvert.
 *
 * La photo d'origine n'est jamais modifiée : les annotations sont dessinées sur un calque TRANSPARENT (PNG)
 * enregistré à part (AMGT4CEM_Signalements.Pieces.setAnnotations) et superposé à l'affichage. Les traits sont
 * aussi conservés (coordonnées relatives à l'image, 0..1) pour pouvoir les reprendre et en annuler un.
 */
(function () {
const NS = window.SIG4CEM;
const h = NS.h;
const COULEURS = ['#e53935', '#fdd835', '#1e88e5', '#212121'];
const svgIc = (contenu) => `<svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="0.835" stroke-linecap="round" stroke-linejoin="round">${contenu}</svg>`;
const FLECHE = '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.5v4.5h-4.5"/>';
const maskIc = (n) => `<span class="sig4cem-ic sig4cem-ic--${n}" aria-hidden="true"></span>`;
// [outil, libellé, icône] : pinceau (trait libre), ligne (segment fléché), formes (ellipse), texte.
const OUTILS = [
  ['pen', 'Pinceau', maskIc('pinceau')],
  ['arrow', 'Ligne', maskIc('fleche')],
  ['ellipse', 'Formes', svgIc('<rect x="3.5" y="8" width="10.5" height="9" rx="1"/><circle cx="15" cy="9.5" r="5.5"/>')],
  ['text', 'Texte', maskIc('texte')],
];
const OVERLAY_SIDE = 1000; // grand côté du calque PNG (la photo, elle, garde sa définition)

/** Dessine les traits (coordonnées relatives) sur un contexte de W×H pixels (`sansTexte` : l'éditeur affiche les textes en zones modifiables). */
function render(ctx, W, H, traits, sansTexte) {
  ctx.clearRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const t of traits) {
    ctx.strokeStyle = ctx.fillStyle = t.c;
    ctx.globalAlpha = t.o == null ? 1 : t.o;
    ctx.lineWidth = Math.max(2, t.w * W);
    if (t.t === 'pen') {
      ctx.beginPath();
      t.p.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
      if (t.p.length === 1) ctx.lineTo(t.p[0][0] * W + 0.1, t.p[0][1] * H);
      ctx.stroke();
    } else if (t.t === 'arrow') {
      const [ax, ay, bx, by] = [t.a[0] * W, t.a[1] * H, t.b[0] * W, t.b[1] * H];
      const ang = Math.atan2(by - ay, bx - ax);
      const head = Math.max(12, t.w * W * 5);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - head * Math.cos(ang - 0.45), by - head * Math.sin(ang - 0.45));
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - head * Math.cos(ang + 0.45), by - head * Math.sin(ang + 0.45));
      ctx.stroke();
    } else if (t.t === 'ellipse') {
      const cx = ((t.a[0] + t.b[0]) / 2) * W, cy = ((t.a[1] + t.b[1]) / 2) * H;
      const rx = Math.abs(t.b[0] - t.a[0]) * W / 2, ry = Math.abs(t.b[1] - t.a[1]) * H / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (t.t === 'text' && !sansTexte) {
      const size = Math.max(10, t.s * W);
      ctx.font = `bold ${size}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(2, t.s * W / 8);
      String(t.txt || '').split('\n').forEach((ligne, i) => {
        ctx.strokeStyle = '#fff';
        ctx.strokeText(ligne, t.x * W, t.y * H + i * size * 1.2);
        ctx.fillText(ligne, t.x * W, t.y * H + i * size * 1.2);
      });
    }
  }
}

NS.PhotoEditor = {
  /** Calque PNG transparent pour des traits donnés (null s'il n'y en a pas). */
  async overlayPng(traits, largeur, hauteur) {
    if (!traits || !traits.length) return null;
    const scale = Math.min(1, OVERLAY_SIDE / Math.max(largeur, hauteur));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(largeur * scale));
    c.height = Math.max(1, Math.round(hauteur * scale));
    render(c.getContext('2d'), c.width, c.height, traits);
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Encodage PNG impossible'))), 'image/png'));
  },

  /**
   * Ouvre l'éditeur sur une photo. `onDone(traits)` à la validation ; rien n'est modifié si on annule.
   * @param {Blob} blob - la photo (JPEG réduit)
   * @param {Array} traits - traits existants
   */
  open(blob, traits, onDone) {
    const url = URL.createObjectURL(blob);
    let list = (traits || []).map((t) => JSON.parse(JSON.stringify(t)));
    let tool = 'pen';
    let color = COULEURS[0];
    let opacity = 1;
    let draft = null;
    const W = 800; // résolution du dessin à l'écran : relative, les traits sont stockés en 0..1

    const img = h('img', { class: 'sig4cem-pe__img', src: url, alt: 'Photo à annoter', draggable: 'false' });
    const canvas = h('canvas', { class: 'sig4cem-pe__canvas' });
    const stage = h('div', { class: 'sig4cem-pe__stage' }, img, canvas);
    const btnIc = (titre, svg, extra) => { const b = h('button', { type: 'button', class: 'sig4cem-pe__ic' + (extra ? ' ' + extra : ''), title: titre, 'aria-label': titre }); b.innerHTML = svg; return b; };
    const toolBtns = OUTILS.map(([k, label, ic]) => {
      const b = btnIc(label, ic);
      b.addEventListener('click', () => { tool = k; nuancier.hidden = true; refresh(); });
      b.dataset.tool = k;
      return b;
    });
    const colorBtns = COULEURS.map((c) => {
      const b = h('button', { type: 'button', class: 'sig4cem-pe__color', title: 'Couleur', 'aria-label': 'Couleur' });
      b.style.background = c;
      b.addEventListener('click', () => { color = c; if (selected) { selected.item.c = c; layoutText(selected); } refresh(); });
      b.dataset.color = c;
      return b;
    });
    // Palette : couleurs + opacité, dans une fenêtre sous la ligne 2.
    const opaVal = h('span', { class: 'sig4cem-pe__opaval' });
    const opaRange = h('input', { type: 'range', min: '10', max: '100', step: '5', value: '100', 'aria-label': 'Opacité' });
    opaRange.addEventListener('input', () => { opacity = Number(opaRange.value) / 100; if (selected) { selected.item.o = opacity === 1 ? undefined : opacity; layoutText(selected); } refresh(); });
    const nuancier = h('div', { class: 'sig4cem-pe__nuancier', hidden: '' },
      h('div', { class: 'sig4cem-pe__nuancier-c' }, ...colorBtns),
      h('label', { class: 'sig4cem-pe__opa' }, h('span', { text: 'Opacité' }), opaRange, opaVal));
    const btnPalette = btnIc('Couleur et opacité', maskIc('palette'));
    btnPalette.addEventListener('click', (e) => { e.stopPropagation(); nuancier.hidden = !nuancier.hidden; });
    const btnSmaller = btnIc('Texte plus petit', '<span class="sig4cem-pe__t">A<small>−</small></span>');
    const btnBigger = btnIc('Texte plus grand', '<span class="sig4cem-pe__t">A<small>+</small></span>');
    const hint = h('div', { class: 'sig4cem-pe__hint', hidden: '' });
    // Ligne 1 : icônes en trait fin (mêmes dessins que le menu Couches).
    const btnUndo = btnIc('Annuler', svgIc(`<g transform="matrix(-1 0 0 1 24 0)">${FLECHE}</g>`));
    const btnRedo = btnIc('Refaire', svgIc(FLECHE));
    const btnClear = btnIc('Feuille blanche : effacer tout le dessin', svgIc('<path d="M6.5 3h7.5l4.5 4.5V20a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4.5h4.5"/>'));
    const btnOk = btnIc('Enregistrer les annotations', svgIc('<path d="M5 3h11.5L21 7.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3"/><path d="M7 21v-8h10v8"/>'), 'sig4cem-pe__ic--droite');
    const btnCancel = btnIc('Fermer sans enregistrer', svgIc('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9l6 6M15 9l-6 6"/>'));
    const sep = () => h('span', { class: 'sig4cem-pe__sep' });
    const redoStack = []; // éléments annulés, que « Refaire » remet dans l'ordre inverse
    const ligne2 = h('div', { class: 'sig4cem-pe__bar sig4cem-pe__bar--2' }, btnPalette, sep(), btnSmaller, btnBigger, nuancier);
    const root = h('section', { class: 'sig4cem-screen sig4cem-screen--editor' },
      h('div', { class: 'sig4cem-pe__bar' }, btnUndo, btnRedo, btnClear, sep(), ...toolBtns, btnOk, btnCancel),
      ligne2,
      hint,
      h('div', { class: 'sig4cem-pe__body' }, stage));
    document.getElementById('sig4cem-root').append(root);
    root.addEventListener('pointerdown', (e) => { if (!nuancier.hidden && !nuancier.contains(e.target) && !btnPalette.contains(e.target)) nuancier.hidden = true; });
    const propre = () => JSON.stringify(list.filter((t) => t.t !== 'text' || (t.txt || '').trim()));
    const etatInitial = propre();

    function fit() {
      const ratio = img.naturalHeight / img.naturalWidth || 0.75;
      canvas.width = W;
      canvas.height = Math.round(W * ratio);
      redraw();
    }
    function redraw() {
      render(canvas.getContext('2d'), canvas.width, canvas.height, draft ? list.concat([draft]) : list, true);
    }
    function refresh() {
      for (const b of toolBtns) b.classList.toggle('sig4cem-pe__ic--on', b.dataset.tool === tool);
      for (const b of colorBtns) b.classList.toggle('sig4cem-pe__color--on', b.dataset.color === color);
      opaVal.textContent = `${Math.round(opacity * 100)} %`;
      btnUndo.disabled = !list.length;
      btnClear.disabled = !list.length;
      btnRedo.disabled = !redoStack.length;
      btnOk.disabled = propre() === etatInitial;
      const texte = tool === 'text';
      btnSmaller.hidden = btnBigger.hidden = !texte;
      btnSmaller.disabled = btnBigger.disabled = !selected;
      hint.hidden = !texte;
      hint.textContent = texte ? 'Touchez la photo pour poser un texte. ✥ le déplace, ✕ le supprime.' : '';
    }
    // ---- Textes : zones à fond transparent, modifiables et déplaçables tant que l'éditeur est ouvert.
    let selected = null; // { item, el }
    const boxes = [];
    const MIN_S = 0.02, MAX_S = 0.12;
    function layoutText(b) {
      b.el.style.left = `${b.item.x * 100}%`;
      b.el.style.top = `${b.item.y * 100}%`;
      b.el.style.fontSize = `${Math.max(10, b.item.s * stage.clientWidth)}px`;
      b.el.style.color = b.item.c;
      b.body.style.opacity = b.item.o == null ? 1 : b.item.o;
      b.el.classList.toggle('sig4cem-pe__text--low', b.item.y < 0.07);
    }
    function select(b) {
      selected = b;
      for (const o of boxes) o.el.classList.toggle('sig4cem-pe__text--on', o === b);
      refresh();
    }
    function removeBox(b) {
      const i = boxes.indexOf(b);
      if (i >= 0) boxes.splice(i, 1);
      const j = list.indexOf(b.item);
      if (j >= 0) list.splice(j, 1);
      b.el.remove();
      if (selected === b) selected = null;
      refresh();
    }
    function addBox(item, focus) {
      const body = h('span', { class: 'sig4cem-pe__text-body', contenteditable: 'true', spellcheck: 'false', role: 'textbox', 'aria-label': 'Texte sur la photo' });
      body.textContent = item.txt || '';
      const move = h('span', { class: 'sig4cem-pe__text-move', title: 'Déplacer', 'aria-label': 'Déplacer le texte', text: '✥' });
      const del = h('span', { class: 'sig4cem-pe__text-del', title: 'Supprimer', 'aria-label': 'Supprimer le texte', text: '✕' });
      const el = h('div', { class: 'sig4cem-pe__text' }, move, body, del);
      const b = { item, el, body };
      boxes.push(b);
      stage.append(el);
      layoutText(b);
      body.addEventListener('focus', () => select(b));
      body.addEventListener('input', () => { item.txt = body.innerText.replace(/\u00a0/g, ' ').replace(/\n+$/, '').slice(0, 200); refresh(); });
      body.addEventListener('blur', () => { if (!body.innerText.trim()) removeBox(b); });
      del.addEventListener('click', () => removeBox(b));
      let drag = null;
      move.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        move.setPointerCapture(e.pointerId);
        const r = stage.getBoundingClientRect();
        drag = { dx: (e.clientX - r.left) / r.width - item.x, dy: (e.clientY - r.top) / r.height - item.y };
        select(b);
      });
      move.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const r = stage.getBoundingClientRect();
        item.x = Math.min(0.95, Math.max(0, (e.clientX - r.left) / r.width - drag.dx));
        item.y = Math.min(0.95, Math.max(0, (e.clientY - r.top) / r.height - drag.dy));
        layoutText(b);
      });
      const endDrag = () => { drag = null; refresh(); };
      move.addEventListener('pointerup', endDrag);
      move.addEventListener('pointercancel', endDrag);
      select(b);
      if (focus) body.focus();
      return b;
    }
    for (const t of list) if (t.t === 'text') addBox(t, false);
    select(null);
    window.addEventListener('resize', () => boxes.forEach(layoutText));
    btnBigger.addEventListener('click', () => { if (selected) { selected.item.s = Math.min(MAX_S, selected.item.s * 1.2); layoutText(selected); refresh(); } });
    btnSmaller.addEventListener('click', () => { if (selected) { selected.item.s = Math.max(MIN_S, selected.item.s / 1.2); layoutText(selected); refresh(); } });

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
    };

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const p = pos(e);
      select(null);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      if (tool === 'text') return; // la zone de texte se pose au clic (pour que le clavier s'ouvre sur mobile)
      canvas.setPointerCapture(e.pointerId);
      const w = 0.008;
      draft = tool === 'pen' ? { t: 'pen', c: color, w, p: [p] } : { t: tool, c: color, w, a: p, b: p };
      if (opacity < 1) draft.o = opacity;
      redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!draft) return;
      e.preventDefault();
      const p = pos(e);
      if (draft.t === 'pen') draft.p.push(p); else draft.b = p;
      redraw();
    });
    const end = () => {
      if (!draft) return;
      const t = draft;
      draft = null;
      const vide = t.t !== 'pen' && Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]) < 0.01;
      if (!vide) { list.push(t); redoStack.length = 0; }
      refresh();
      redraw();
    };
    canvas.addEventListener('click', (e) => {
      if (tool !== 'text') return;
      const p = pos(e);
      const item = { t: 'text', c: color, s: 0.045, x: Math.min(0.9, p[0]), y: Math.min(0.9, p[1]), txt: '' };
      if (opacity < 1) item.o = opacity;
      list.push(item);
      redoStack.length = 0;
      addBox(item, true);
    });
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    btnUndo.addEventListener('click', () => {
      const last = list[list.length - 1];
      if (!last) return;
      const b = boxes.find((o) => o.item === last);
      if (b) removeBox(b); else list.pop();
      redoStack.push(last);
      refresh(); redraw();
    });
    btnRedo.addEventListener('click', () => {
      const item = redoStack.pop();
      if (!item) return;
      list.push(item);
      if (item.t === 'text') addBox(item, false);
      refresh(); redraw();
    });
    btnClear.addEventListener('click', () => { for (const b of boxes.slice()) b.el.remove(); boxes.length = 0; selected = null; list = []; redoStack.length = 0; refresh(); redraw(); });

    const close = () => { root.remove(); URL.revokeObjectURL(url); };
    btnCancel.addEventListener('click', () => {
      if (propre() !== etatInitial && !window.confirm('Fermer sans enregistrer ? Les modifications seront perdues.')) return;
      close();
    });
    btnOk.addEventListener('click', () => { list = list.filter((t) => t.t !== 'text' || (t.txt || '').trim()); close(); onDone(list); });
    img.addEventListener('load', () => { fit(); boxes.forEach(layoutText); });
    if (img.complete) fit();
    refresh();
  },

  /** Dessine un calque de traits sur un canvas (utilisé pour les tests et les aperçus). */
  render,
};
})();
