/**
 * SIG4CEM — annotations d'une photo (crayon, flèche, cercle, texte).
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
const OUTILS = [['pen', '✏️ Crayon'], ['arrow', '↗ Flèche'], ['ellipse', '◯ Cercle'], ['text', 'T Texte']];
const OVERLAY_SIDE = 1000; // grand côté du calque PNG (la photo, elle, garde sa définition)

/** Dessine les traits (coordonnées relatives) sur un contexte de W×H pixels (`sansTexte` : l'éditeur affiche les textes en zones modifiables). */
function render(ctx, W, H, traits, sansTexte) {
  ctx.clearRect(0, 0, W, H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const t of traits) {
    ctx.strokeStyle = ctx.fillStyle = t.c;
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
    let draft = null;
    const W = 800; // résolution du dessin à l'écran : relative, les traits sont stockés en 0..1

    const img = h('img', { class: 'sig4cem-pe__img', src: url, alt: 'Photo à annoter', draggable: 'false' });
    const canvas = h('canvas', { class: 'sig4cem-pe__canvas' });
    const stage = h('div', { class: 'sig4cem-pe__stage' }, img, canvas);
    const toolBtns = OUTILS.map(([k, label]) => {
      const b = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--small', text: label });
      b.addEventListener('click', () => { tool = k; refresh(); });
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
    const btnSmaller = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--small', title: 'Texte plus petit', 'aria-label': 'Texte plus petit', text: 'A−' });
    const btnBigger = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--small', title: 'Texte plus grand', 'aria-label': 'Texte plus grand', text: 'A+' });
    const hint = h('span', { class: 'sig4cem-pe__hint' });
    const btnUndo = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--small', text: '↶ Annuler le dernier' });
    const btnClear = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--small', text: 'Tout effacer' });
    const btnCancel = h('button', { type: 'button', class: 'sig4cem-btn', text: 'Annuler' });
    const btnOk = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--primary', text: 'Valider' });
    const root = h('section', { class: 'sig4cem-screen sig4cem-screen--editor' },
      h('div', { class: 'sig4cem-pe__bar' }, ...toolBtns, ...colorBtns),
      h('div', { class: 'sig4cem-pe__body' }, stage),
      h('div', { class: 'sig4cem-pe__bar' }, btnUndo, btnClear, btnSmaller, btnBigger, hint),
      h('div', { class: 'sig4cem-map__actions' }, btnCancel, btnOk));
    document.getElementById('sig4cem-root').append(root);

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
      for (const b of toolBtns) b.classList.toggle('sig4cem-btn--primary', b.dataset.tool === tool);
      for (const b of colorBtns) b.classList.toggle('sig4cem-pe__color--on', b.dataset.color === color);
      btnUndo.disabled = btnClear.disabled = !list.length;
      btnSmaller.disabled = btnBigger.disabled = !selected;
      hint.textContent = tool === 'text'
        ? 'Touchez la photo pour poser un texte. ✥ le déplace, ✕ le supprime.'
        : selected ? 'Texte sélectionné : A− / A+ et couleurs s\'appliquent à lui.' : '';
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
      body.addEventListener('input', () => { item.txt = body.innerText.replace(/\u00a0/g, ' ').replace(/\n+$/, '').slice(0, 200); });
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
      const endDrag = () => { drag = null; };
      move.addEventListener('pointerup', endDrag);
      move.addEventListener('pointercancel', endDrag);
      select(b);
      if (focus) body.focus();
      return b;
    }
    for (const t of list) if (t.t === 'text') addBox(t, false);
    select(null);
    window.addEventListener('resize', () => boxes.forEach(layoutText));
    btnBigger.addEventListener('click', () => { if (selected) { selected.item.s = Math.min(MAX_S, selected.item.s * 1.2); layoutText(selected); } });
    btnSmaller.addEventListener('click', () => { if (selected) { selected.item.s = Math.max(MIN_S, selected.item.s / 1.2); layoutText(selected); } });

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
      if (!vide) list.push(t);
      refresh();
      redraw();
    };
    canvas.addEventListener('click', (e) => {
      if (tool !== 'text') return;
      const p = pos(e);
      const item = { t: 'text', c: color, s: 0.045, x: Math.min(0.9, p[0]), y: Math.min(0.9, p[1]), txt: '' };
      list.push(item);
      addBox(item, true);
    });
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    btnUndo.addEventListener('click', () => {
      const last = list[list.length - 1];
      const b = boxes.find((o) => o.item === last);
      if (b) removeBox(b); else list.pop();
      refresh(); redraw();
    });
    btnClear.addEventListener('click', () => { for (const b of boxes.slice()) b.el.remove(); boxes.length = 0; selected = null; list = []; refresh(); redraw(); });

    const close = () => { root.remove(); URL.revokeObjectURL(url); };
    btnCancel.addEventListener('click', close);
    btnOk.addEventListener('click', () => { list = list.filter((t) => t.t !== 'text' || (t.txt || '').trim()); close(); onDone(list); });
    img.addEventListener('load', () => { fit(); boxes.forEach(layoutText); });
    if (img.complete) fit();
    refresh();
  },

  /** Dessine un calque de traits sur un canvas (utilisé pour les tests et les aperçus). */
  render,
};
})();
