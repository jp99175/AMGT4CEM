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

const EPAISSEURS = [0.004, 0.008, 0.014];
const TYPES = ['plein', 'tirets', 'points'];
const TERMINAISONS = ['aucune', 'fleche', 'barre', 'rond'];

/** Terminaison au point (x, y) ; `ang` = direction du trait, orientée vers l'extérieur. */
function terminaison(ctx, x, y, ang, kind, lw) {
  if (!kind || kind === 'aucune') return;
  const head = Math.max(12, lw * 5);
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  if (kind === 'fleche') {
    ctx.moveTo(x - head * Math.cos(ang - 0.45), y - head * Math.sin(ang - 0.45));
    ctx.lineTo(x, y);
    ctx.lineTo(x - head * Math.cos(ang + 0.45), y - head * Math.sin(ang + 0.45));
    ctx.stroke();
  } else if (kind === 'barre') {
    const d = head * 0.55;
    ctx.moveTo(x - d * Math.sin(ang), y + d * Math.cos(ang));
    ctx.lineTo(x + d * Math.sin(ang), y - d * Math.cos(ang));
    ctx.stroke();
  } else if (kind === 'rond') {
    ctx.arc(x, y, Math.max(3, lw * 1.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
/** Pointillé selon le type de trait. */
function tirets(ctx, type, lw) {
  if (type === 'tirets') ctx.setLineDash([lw * 3.5, lw * 2.5]);
  else if (type === 'points') ctx.setLineDash([0.1, lw * 2.2]);
  else ctx.setLineDash([]);
}

/** Dessine les traits (coordonnées relatives) sur un contexte de W×H pixels (`sansTexte` : l'éditeur affiche les textes en zones modifiables). */
function render(ctx, W, H, traits, sansTexte) {
  ctx.clearRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const t of traits) {
    ctx.strokeStyle = ctx.fillStyle = t.c;
    ctx.globalAlpha = t.o == null ? 1 : t.o;
    const lw = Math.max(2, t.w * W);
    ctx.lineWidth = lw;
    tirets(ctx, t.ty, lw);
    if (t.t === 'pen') {
      ctx.beginPath();
      t.p.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
      if (t.p.length === 1) ctx.lineTo(t.p[0][0] * W + 0.1, t.p[0][1] * H);
      ctx.stroke();
      const n = t.p.length;
      if (n > 1) {
        const P = t.p.map(([x, y]) => [x * W, y * H]);
        const loin = (i0, sens) => { for (let i = i0 + sens; i >= 0 && i < n; i += sens) if (Math.hypot(P[i][0] - P[i0][0], P[i][1] - P[i0][1]) > lw * 2) return P[i]; return P[n - 1 - i0 === 0 ? 0 : n - 1]; };
        const q0 = loin(0, 1), q1 = loin(n - 1, -1);
        terminaison(ctx, P[0][0], P[0][1], Math.atan2(P[0][1] - q0[1], P[0][0] - q0[0]), t.ed, lw);
        terminaison(ctx, P[n - 1][0], P[n - 1][1], Math.atan2(P[n - 1][1] - q1[1], P[n - 1][0] - q1[0]), t.ef, lw);
      }
    } else if (t.t === 'arrow') {
      const [ax, ay, bx, by] = [t.a[0] * W, t.a[1] * H, t.b[0] * W, t.b[1] * H];
      const ang = Math.atan2(by - ay, bx - ax);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      terminaison(ctx, ax, ay, ang + Math.PI, t.ed, lw);
      terminaison(ctx, bx, by, ang, t.ef == null ? 'fleche' : t.ef, lw);
    } else if (t.t === 'ellipse') {
      const cx = ((t.a[0] + t.b[0]) / 2) * W, cy = ((t.a[1] + t.b[1]) / 2) * H;
      const rx = Math.abs(t.b[0] - t.a[0]) * W / 2, ry = Math.abs(t.b[1] - t.a[1]) * H / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (t.t === 'text' && !sansTexte) {
      ctx.setLineDash([]);
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
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
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
    // Réglages propres à chaque outil (épaisseur, type de trait, terminaisons).
    const reg = { pen: { ep: 1, ty: 'plein', d: 'aucune', f: 'aucune' }, arrow: { ep: 1, ty: 'plein', d: 'aucune', f: 'fleche' }, ellipse: { ep: 1, ty: 'plein' } };
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
    // Options de ligne 2 : chaque bouton fait défiler ses choix, son icône montre le choix en cours.
    const ligneIc = (y, w, dash) => `<path d="M3 ${y}h18" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
    const finIc = (k, fin) => {
      const x = fin ? 20 : 4, dx = fin ? -1 : 1;
      const corps = `<path d="M${fin ? 4 : 8} 12h${fin ? 12 : 12}"/>`;
      if (k === 'fleche') return `<path d="M4 12h16"/><path d="${fin ? 'M14.5 7.5L20 12l-5.5 4.5' : 'M9.5 7.5L4 12l5.5 4.5'}"/>`;
      if (k === 'barre') return `<path d="M4 12h16"/><path d="M${x} 7v10"/>`;
      if (k === 'rond') return `<path d="M4 12h16"/><circle cx="${x + dx * 1.5}" cy="12" r="2.4" fill="currentColor"/>`;
      return '<path d="M4 12h16"/>';
    };
    const TITRES_T = { aucune: 'aucune', fleche: 'flèche', barre: 'barre', rond: 'rond' };
    const btnEp = btnIc('Épaisseur du trait', '');
    const btnDeb = btnIc('Terminaison du début', '');
    const btnTy = btnIc('Type de trait', '');
    const btnFin = btnIc('Terminaison de la fin', '');
    const suivant = (liste, v) => liste[(liste.indexOf(v) + 1) % liste.length];
    btnEp.addEventListener('click', () => { const r = reg[tool]; if (r) { r.ep = (r.ep + 1) % EPAISSEURS.length; refresh(); } });
    btnTy.addEventListener('click', () => { const r = reg[tool]; if (r) { r.ty = suivant(TYPES, r.ty); refresh(); } });
    btnDeb.addEventListener('click', () => { const r = reg[tool]; if (r && r.d) { r.d = suivant(TERMINAISONS, r.d); refresh(); } });
    btnFin.addEventListener('click', () => { const r = reg[tool]; if (r && r.f) { r.f = suivant(TERMINAISONS, r.f); refresh(); } });
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
    const ligne2 = h('div', { class: 'sig4cem-pe__bar sig4cem-pe__bar--2' }, btnPalette, sep(), btnEp, btnDeb, btnTy, btnFin, btnSmaller, btnBigger, nuancier);
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
      const r = reg[tool];
      btnEp.hidden = btnTy.hidden = !r;
      btnDeb.hidden = btnFin.hidden = !(r && r.d);
      if (r) {
        const epw = [0.9, 2.2, 3.8][r.ep];
        btnEp.innerHTML = svgIc(ligneIc(12, epw));
        btnEp.title = `Épaisseur du trait (${['fine', 'moyenne', 'épaisse'][r.ep]})`;
        btnTy.innerHTML = svgIc(r.ty === 'tirets' ? ligneIc(12, 1.6, '4 3') : r.ty === 'points' ? ligneIc(12, 1.8, '0.1 3.2') : ligneIc(12, 1.6)).replace('<svg ', '<svg stroke-linecap="round" ');
        btnTy.title = `Type de trait (${r.ty})`;
        if (r.d) {
          btnDeb.innerHTML = svgIc(finIc(r.d, false));
          btnFin.innerHTML = svgIc(finIc(r.f, true));
          btnDeb.title = `Terminaison du début (${TITRES_T[r.d]})`;
          btnFin.title = `Terminaison de la fin (${TITRES_T[r.f]})`;
        }
      }
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
      const r = reg[tool];
      const w = EPAISSEURS[r.ep];
      draft = tool === 'pen' ? { t: 'pen', c: color, w, p: [p] } : { t: tool, c: color, w, a: p, b: p };
      if (opacity < 1) draft.o = opacity;
      if (r.ty !== 'plein') draft.ty = r.ty;
      if (r.d) { draft.ed = r.d; draft.ef = r.f; }
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
