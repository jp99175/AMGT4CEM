/**
 * SIG4CEM — annotations d'une photo (crayon, flèche, cercle, texte).
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

/** Dessine les traits (coordonnées relatives) sur un contexte de W×H pixels. */
function render(ctx, W, H, traits) {
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
    } else if (t.t === 'text') {
      ctx.font = `bold ${Math.max(10, t.s * W)}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(2, t.s * W / 8);
      ctx.strokeStyle = '#fff';
      ctx.strokeText(t.txt, t.x * W, t.y * H);
      ctx.fillText(t.txt, t.x * W, t.y * H);
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
      b.addEventListener('click', () => { color = c; refresh(); });
      b.dataset.color = c;
      return b;
    });
    const btnUndo = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--small', text: '↶ Annuler le dernier' });
    const btnClear = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--small', text: 'Tout effacer' });
    const btnCancel = h('button', { type: 'button', class: 'sig4cem-btn', text: 'Annuler' });
    const btnOk = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--primary', text: 'Valider' });
    const root = h('section', { class: 'sig4cem-screen sig4cem-screen--editor' },
      h('div', { class: 'sig4cem-pe__bar' }, ...toolBtns, ...colorBtns),
      h('div', { class: 'sig4cem-pe__body' }, stage),
      h('div', { class: 'sig4cem-pe__bar' }, btnUndo, btnClear),
      h('div', { class: 'sig4cem-map__actions' }, btnCancel, btnOk));
    document.getElementById('sig4cem-root').append(root);

    function fit() {
      const ratio = img.naturalHeight / img.naturalWidth || 0.75;
      canvas.width = W;
      canvas.height = Math.round(W * ratio);
      redraw();
    }
    function redraw() {
      render(canvas.getContext('2d'), canvas.width, canvas.height, draft ? list.concat([draft]) : list);
    }
    function refresh() {
      for (const b of toolBtns) b.classList.toggle('sig4cem-btn--primary', b.dataset.tool === tool);
      for (const b of colorBtns) b.classList.toggle('sig4cem-pe__color--on', b.dataset.color === color);
      btnUndo.disabled = btnClear.disabled = !list.length;
    }
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
    };

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const p = pos(e);
      if (tool === 'text') {
        const txt = (prompt('Texte à inscrire sur la photo :') || '').trim();
        if (txt) { list.push({ t: 'text', c: color, s: 0.045, x: p[0], y: p[1], txt: txt.slice(0, 80) }); refresh(); redraw(); }
        return;
      }
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
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    btnUndo.addEventListener('click', () => { list.pop(); refresh(); redraw(); });
    btnClear.addEventListener('click', () => { list = []; refresh(); redraw(); });

    const close = () => { root.remove(); URL.revokeObjectURL(url); };
    btnCancel.addEventListener('click', close);
    btnOk.addEventListener('click', () => { close(); onDone(list); });
    img.addEventListener('load', fit);
    if (img.complete) fit();
    refresh();
  },

  /** Dessine un calque de traits sur un canvas (utilisé pour les tests et les aperçus). */
  render,
};
})();
