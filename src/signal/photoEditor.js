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
const TYPES_FORMES = ['plein', 'tirets', 'points', 'nuage'];
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

/** Géométrie d'un rectangle / d'une ellipse en pixels d'un canvas W×H : centre, demi-côtés, rotation. */
function geom(t, W, H) {
  return { cx: ((t.a[0] + t.b[0]) / 2) * W, cy: ((t.a[1] + t.b[1]) / 2) * H, hw: Math.abs(t.b[0] - t.a[0]) * W / 2, hh: Math.abs(t.b[1] - t.a[1]) * H / 2, r: t.r || 0 };
}
const tourne = (x, y, r) => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
/** Contour d'une forme (points en pixels) : rectangle, ellipse (polygone fin) ou ligne brisée. */
function contour(t, W, H) {
  if (t.t === 'poly') return t.p.map(([x, y]) => [x * W, y * H]);
  const g = geom(t, W, H);
  const loc = t.t === 'rect'
    ? [[-g.hw, -g.hh], [g.hw, -g.hh], [g.hw, g.hh], [-g.hw, g.hh]]
    : Array.from({ length: 96 }, (_, i) => [g.hw * Math.cos(i / 96 * Math.PI * 2), g.hh * Math.sin(i / 96 * Math.PI * 2)]);
  return loc.map(([x, y]) => { const q = tourne(x, y, g.r); return [g.cx + q[0], g.cy + q[1]]; });
}
/** Nuage de révision : arcs qui bombent vers l'extérieur le long du contour. */
function nuage(ctx, pts, ferme, lw) {
  const P = ferme ? pts.concat([pts[0]]) : pts;
  const step = Math.max(16, lw * 6);
  const out = [P[0]];
  let reste = step;
  for (let i = 1; i < P.length; i++) {
    let [x0, y0] = P[i - 1];
    const [x1, y1] = P[i];
    let L = Math.hypot(x1 - x0, y1 - y0);
    while (L >= reste && L > 0) {
      const f = reste / L;
      x0 += (x1 - x0) * f; y0 += (y1 - y0) * f;
      out.push([x0, y0]);
      L = Math.hypot(x1 - x0, y1 - y0);
      reste = step;
    }
    reste -= L;
  }
  if (!ferme || Math.hypot(out[out.length - 1][0] - P[0][0], out[out.length - 1][1] - P[0][1]) > step * 0.3) out.push(P[P.length - 1]);
  let aire = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; aire += a[0] * b[1] - b[0] * a[1]; }
  const sens = ferme && aire < 0 ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(out[0][0], out[0][1]);
  for (let i = 1; i < out.length; i++) {
    const [ax, ay] = out[i - 1], [bx, by] = out[i];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const nx = sens * (by - ay) / L, ny = sens * -(bx - ax) / L;
    ctx.quadraticCurveTo((ax + bx) / 2 + nx * L * 0.75, (ay + by) / 2 + ny * L * 0.75, bx, by);
  }
  ctx.stroke();
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
    } else if (t.t === 'ellipse' || t.t === 'rect' || t.t === 'poly') {
      const pts = contour(t, W, H);
      const ferme = t.t !== 'poly' || !!t.cl;
      if (pts.length > 1) {
        if (t.fc && ferme) {
          ctx.save();
          ctx.setLineDash([]);
          ctx.fillStyle = t.fc;
          ctx.beginPath();
          pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        if (t.ty === 'nuage') nuage(ctx, pts, ferme, lw);
        else {
          ctx.beginPath();
          pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          if (ferme) ctx.closePath();
          ctx.stroke();
        }
        if (t.t === 'poly' && !ferme && pts.length > 1) {
          const n = pts.length;
          terminaison(ctx, pts[0][0], pts[0][1], Math.atan2(pts[0][1] - pts[1][1], pts[0][0] - pts[1][0]), t.ed, lw);
          terminaison(ctx, pts[n - 1][0], pts[n - 1][1], Math.atan2(pts[n - 1][1] - pts[n - 2][1], pts[n - 1][0] - pts[n - 2][0]), t.ef, lw);
        }
      }
    } else if (t.t === 'text' && !sansTexte) {
      ctx.setLineDash([]);
      const size = Math.max(10, t.s * W);
      ctx.font = `${t.i ? 'italic ' : ''}${t.b === false ? '' : 'bold '}${size}px sans-serif`;
      ctx.textBaseline = 'top';
      const lignes = String(t.txt || '').split('\n');
      const largeurs = lignes.map((l) => ctx.measureText(l).width);
      const maxL = Math.max(0, ...largeurs);
      const k = t.al === 'c' ? 0.5 : t.al === 'd' ? 1 : 0;
      lignes.forEach((ligne, i) => {
        const x = t.x * W + (maxL - largeurs[i]) * k, y = t.y * H + i * size * 1.2;
        ctx.lineWidth = Math.max(2, t.s * W / 8);
        ctx.strokeStyle = '#fff';
        ctx.strokeText(ligne, x, y);
        ctx.fillText(ligne, x, y);
        if (t.u && ligne) {
          ctx.lineWidth = Math.max(1.5, size / 14);
          ctx.strokeStyle = t.c;
          ctx.beginPath();
          ctx.moveTo(x, y + size * 1.02);
          ctx.lineTo(x + largeurs[i], y + size * 1.02);
          ctx.stroke();
        }
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
    let fillColor = null; // remplissage des formes fermées (null = aucun)
    let cible = 'trait'; // ce que modifie la palette : 'trait' ou 'fond'
    let edit = null; // forme en cours d'édition (poignées) tant qu'elle n'est pas confirmée
    let polyDraft = null; // sommets d'une ligne brisée en cours de pose
    let guide = null; // repère en pointillés : { type: 'med' | 'diag', sx, sy }
    // Réglages propres à chaque outil (épaisseur, type de trait, terminaisons).
    const reg = { pen: { ep: 1, ty: 'plein', d: 'aucune', f: 'aucune' }, arrow: { ep: 1, ty: 'plein', d: 'aucune', f: 'fleche' }, ellipse: { ep: 1, ty: 'plein', d: 'aucune', f: 'aucune', kind: 'ellipse' } };
    let draft = null;
    const W = 800; // résolution du dessin à l'écran : relative, les traits sont stockés en 0..1

    const img = h('img', { class: 'sig4cem-pe__img', src: url, alt: 'Photo à annoter', draggable: 'false' });
    const canvas = h('canvas', { class: 'sig4cem-pe__canvas' });
    const stage = h('div', { class: 'sig4cem-pe__stage' }, img, canvas);
    const btnIc = (titre, svg, extra) => { const b = h('button', { type: 'button', class: 'sig4cem-pe__ic' + (extra ? ' ' + extra : ''), title: titre, 'aria-label': titre }); b.innerHTML = svg; return b; };
    const toolBtns = OUTILS.map(([k, label, ic]) => {
      const b = btnIc(label, ic);
      b.addEventListener('click', () => { if (edit || polyDraft) return; tool = k; nuancier.hidden = true; fermerMenu(); refresh(); });
      b.dataset.tool = k;
      return b;
    });
    const colorBtns = COULEURS.map((c) => {
      const b = h('button', { type: 'button', class: 'sig4cem-pe__color', title: 'Couleur', 'aria-label': 'Couleur' });
      b.style.background = c;
      b.addEventListener('click', () => {
        if (cible === 'fond') { fillColor = c; if (edit) edit.fc = c; } else { color = c; if (edit) edit.c = c; if (selected) { selected.item.c = c; layoutText(selected); } }
        redraw(); refresh();
      });
      b.dataset.color = c;
      return b;
    });
    const btnAucun = h('button', { type: 'button', class: 'sig4cem-pe__color sig4cem-pe__color--aucun', title: 'Aucun remplissage', 'aria-label': 'Aucun remplissage' });
    btnAucun.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#e53935" stroke-width="1.6"><path d="M5 19L19 5"/></svg>';
    btnAucun.addEventListener('click', () => { fillColor = null; if (edit) delete edit.fc; redraw(); refresh(); });
    // Palette : couleurs + opacité, dans une fenêtre sous la ligne 2.
    const opaVal = h('span', { class: 'sig4cem-pe__opaval' });
    const opaRange = h('input', { type: 'range', min: '10', max: '100', step: '5', value: '100', 'aria-label': 'Opacité' });
    opaRange.addEventListener('input', () => { opacity = Number(opaRange.value) / 100; if (selected) { selected.item.o = opacity === 1 ? undefined : opacity; layoutText(selected); } if (edit) { if (opacity === 1) delete edit.o; else edit.o = opacity; redraw(); } refresh(); });
    const nuancier = h('div', { class: 'sig4cem-pe__nuancier', hidden: '' },
      h('div', { class: 'sig4cem-pe__nuancier-c' }, ...colorBtns, btnAucun),
      h('label', { class: 'sig4cem-pe__opa' }, h('span', { text: 'Opacité' }), opaRange, opaVal));
    const btnTF = btnIc('Couleur du trait / du remplissage', '');
    btnTF.addEventListener('click', (e) => {
      e.stopPropagation();
      fermerMenu();
      // Pour les formes, un 2e toucher passe du trait au remplissage ; ailleurs seul le trait se règle.
      if (tool === 'ellipse' && !nuancier.hidden) cible = cible === 'trait' ? 'fond' : 'trait';
      else { cible = 'trait'; nuancier.hidden = !nuancier.hidden; }
      refresh();
    });
    const tfSvg = () => `<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke-linejoin="round">${tool === 'ellipse' ? `<rect x="9.5" y="9.5" width="11.5" height="11.5" rx="1" fill="${fillColor || 'none'}" stroke="#0b5c75" stroke-width=".835"/>` : ''}<rect x="3" y="3" width="12" height="12" rx="1" stroke="${color}" stroke-width="2.4"/><rect x="3" y="3" width="12" height="12" rx="1" stroke="#0b5c75" stroke-width=".835"/></svg>`;
    const KINDS = [['ellipse', 'Ellipse', '<ellipse cx="12" cy="12" rx="9" ry="6"/>'], ['rect', 'Rectangle', '<rect x="4" y="6.5" width="16" height="11" rx="1.2"/>'], ['poly', 'Ligne brisée', '<path d="M4 17.5l5-9.5 5.5 6.5L20 6"/>']];
    const btnForme = btnIc('Forme', '');
    const sepTexte = [];
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
    const NUAGE = '<path d="M7.5 18.5a3.6 3.6 0 0 1-.6-7.1 4.2 4.2 0 0 1 7.6-2.2 3.9 3.9 0 0 1 5.3 3.7 2.8 2.8 0 0 1-1.7 5.6z"/>';
    const icEp = (i) => svgIc(ligneIc(12, [0.9, 2.2, 3.8][i]));
    const icTy = (t) => svgIc(t === 'nuage' ? NUAGE : t === 'tirets' ? ligneIc(12, 1.6, '4 3') : t === 'points' ? ligneIc(12, 1.8, '0.1 3.2') : ligneIc(12, 1.6)).replace('<svg ', '<svg stroke-linecap="round" ');
    const NOM_EP = ['fine', 'moyenne', 'épaisse'];
    // Menus déroulants (vers le bas) : l'icône montre le choix en cours, un toucher déploie tous les choix.
    const menuEl = h('div', { class: 'sig4cem-pe__menu', hidden: '' });
    let menuBtn = null;
    function fermerMenu() { menuEl.hidden = true; menuBtn = null; }
    function ouvrirMenu(btn, choix, courant, choisir) {
      if (menuBtn === btn) { fermerMenu(); return; }
      nuancier.hidden = true;
      menuEl.textContent = '';
      for (const c of choix) {
        const b = btnIc(c.titre, c.ic, c.val === courant ? 'sig4cem-pe__ic--on' : '');
        b.addEventListener('click', (e) => { e.stopPropagation(); choisir(c.val); fermerMenu(); });
        menuEl.append(b);
      }
      menuEl.style.left = `${btn.offsetLeft}px`;
      menuEl.hidden = false;
      menuBtn = btn;
    }
    for (const b of [btnForme, btnEp, btnDeb, btnTy, btnFin]) b.classList.add('sig4cem-pe__ic--menu');
    btnForme.addEventListener('click', (e) => { e.stopPropagation(); if (edit || polyDraft) return; ouvrirMenu(btnForme, KINDS.map(([k, titre, d]) => ({ val: k, titre, ic: svgIc(d) })), reg.ellipse.kind, (k) => { reg.ellipse.kind = k; refresh(); }); });
    btnEp.addEventListener('click', (e) => { e.stopPropagation(); const r = reg[tool]; if (r) ouvrirMenu(btnEp, [0, 1, 2].map((i) => ({ val: i, titre: `Épaisseur ${NOM_EP[i]}`, ic: icEp(i) })), r.ep, (v) => { r.ep = v; if (edit) edit.w = EPAISSEURS[v]; redraw(); refresh(); }); });
    btnTy.addEventListener('click', (e) => { e.stopPropagation(); const r = reg[tool]; if (r) ouvrirMenu(btnTy, (tool === 'ellipse' ? TYPES_FORMES : TYPES).map((t) => ({ val: t, titre: `Trait ${t}`, ic: icTy(t) })), r.ty, (v) => { r.ty = v; if (edit) { if (v === 'plein') delete edit.ty; else edit.ty = v; } redraw(); refresh(); }); });
    btnDeb.addEventListener('click', (e) => { e.stopPropagation(); const r = reg[tool]; if (r && r.d) ouvrirMenu(btnDeb, TERMINAISONS.map((k) => ({ val: k, titre: `Début : ${TITRES_T[k]}`, ic: svgIc(finIc(k, false)) })), r.d, (v) => { r.d = v; if (edit && edit.t === 'poly') edit.ed = v; redraw(); refresh(); }); });
    btnFin.addEventListener('click', (e) => { e.stopPropagation(); const r = reg[tool]; if (r && r.f) ouvrirMenu(btnFin, TERMINAISONS.map((k) => ({ val: k, titre: `Fin : ${TITRES_T[k]}`, ic: svgIc(finIc(k, true)) })), r.f, (v) => { r.f = v; if (edit && edit.t === 'poly') edit.ef = v; redraw(); refresh(); }); });
    const btnG = btnIc('Gras', '<span class="sig4cem-pe__t"><b>G</b></span>');
    const btnI = btnIc('Italique', '<span class="sig4cem-pe__t"><i style="font-family:serif">I</i></span>');
    const btnU = btnIc('Souligné', svgIc('<path d="M7 4v7.5a5 5 0 0 0 10 0V4"/><path d="M5 20h14"/>'));
    const btnAl = btnIc('Alignement du texte', '');
    const ALIGN = { g: '<path d="M4 6h16M4 10.5h10M4 15h16M4 19.5h10"/>', c: '<path d="M4 6h16M7 10.5h10M4 15h16M7 19.5h10"/>', d: '<path d="M4 6h16M10 10.5h10M4 15h16M10 19.5h10"/>' };
    const NOM_AL = { g: 'gauche', c: 'centré', d: 'droite' };
    const stT = { b: true, i: false, u: false, al: 'g' }; // style des prochains textes
    const styleTexte = (cle, val) => { stT[cle] = val; if (selected) { if (cle === 'b') selected.item.b = val; else selected.item[cle] = val; layoutText(selected); } refresh(); };
    btnG.addEventListener('click', () => styleTexte('b', !(selected ? selected.item.b !== false : stT.b)));
    btnI.addEventListener('click', () => styleTexte('i', !(selected ? !!selected.item.i : stT.i)));
    btnU.addEventListener('click', () => styleTexte('u', !(selected ? !!selected.item.u : stT.u)));
    btnAl.addEventListener('click', () => styleTexte('al', suivant(['g', 'c', 'd'], selected ? selected.item.al || 'g' : stT.al)));
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
    const sep2 = () => { const e = sep(); sepTexte.push(e); return e; };
    const redoStack = []; // éléments annulés, que « Refaire » remet dans l'ordre inverse
    const ligne2 = h('div', { class: 'sig4cem-pe__bar sig4cem-pe__bar--2' }, btnTF, sep(), btnForme, btnEp, btnDeb, btnTy, btnFin, btnG, btnI, btnU, btnAl, sep2(), btnSmaller, btnBigger, menuEl, nuancier);
    const root = h('section', { class: 'sig4cem-screen sig4cem-screen--editor' },
      h('div', { class: 'sig4cem-pe__bar' }, btnUndo, btnRedo, btnClear, sep(), ...toolBtns, btnOk, btnCancel),
      ligne2,
      hint,
      h('div', { class: 'sig4cem-pe__body' }, stage));
    document.getElementById('sig4cem-root').append(root);
    root.addEventListener('pointerdown', (e) => {
      if (!nuancier.hidden && !nuancier.contains(e.target) && !btnTF.contains(e.target)) nuancier.hidden = true;
      if (!menuEl.hidden && !menuEl.contains(e.target) && !(menuBtn && menuBtn.contains(e.target))) fermerMenu();
    });
    const propre = () => JSON.stringify(list.filter((t) => t.t !== 'text' || (t.txt || '').trim()));
    const etatInitial = propre();

    function fit() {
      const ratio = img.naturalHeight / img.naturalWidth || 0.75;
      canvas.width = W;
      canvas.height = Math.round(W * ratio);
      redraw();
    }
    function redraw() {
      const ctx = canvas.getContext('2d');
      const poly = polyDraft && polyDraft.length > 1 ? [{ t: 'poly', c: color, w: EPAISSEURS[reg.ellipse.ep], p: polyDraft, cl: false, ed: reg.ellipse.d, ef: reg.ellipse.f }] : [];
      render(ctx, canvas.width, canvas.height, (draft ? list.concat([draft]) : list).concat(poly), true);
      const cw = canvas.width, ch = canvas.height, k = cw / (canvas.clientWidth || cw);
      ctx.save();
      ctx.strokeStyle = '#1e88e5';
      ctx.fillStyle = '#1e88e5';
      ctx.lineWidth = 1.4 * k;
      ctx.setLineDash([5 * k, 4 * k]);
      const cible_ = draft && (draft.t === 'rect' || draft.t === 'ellipse') ? draft : edit;
      let rep_ = guide;
      if (!rep_ && cible_ && cible_.a) { const g0 = geom(cible_, cw, ch); if (g0.hw > 4 && Math.abs(g0.hw - g0.hh) < 1.5) rep_ = { type: 'med' }; } // carré / cercle : médianes, quelle que soit l'orientation
      if (rep_ && cible_ && cible_.a) {
        const g = geom(cible_, cw, ch);
        const ligne = (x0, y0, x1, y1) => { const A = tourne(x0, y0, g.r), B = tourne(x1, y1, g.r); ctx.beginPath(); ctx.moveTo(g.cx + A[0], g.cy + A[1]); ctx.lineTo(g.cx + B[0], g.cy + B[1]); ctx.stroke(); };
        if (rep_.type === 'med') { ligne(0, -g.hh, 0, g.hh); ligne(-g.hw, 0, g.hw, 0); } else ligne(-rep_.sx * g.hw, -rep_.sy * g.hh, rep_.sx * g.hw, rep_.sy * g.hh);
      }
      if (polyDraft && polyDraft.length) {
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(polyDraft[0][0] * cw, polyDraft[0][1] * ch, 6 * k, 0, Math.PI * 2);
        ctx.fill();
        if (polyDraft.length === 1) { ctx.beginPath(); ctx.arc(polyDraft[0][0] * cw, polyDraft[0][1] * ch, 2 * k, 0, 7); ctx.fill(); }
      }
      ctx.restore();
      placePoignees();
    }
    function refresh() {
      const verrou = !!(edit || polyDraft);
      for (const b of toolBtns) { b.classList.toggle('sig4cem-pe__ic--on', b.dataset.tool === tool); b.disabled = verrou && b.dataset.tool !== tool; }
      opaVal.textContent = `${Math.round(opacity * 100)} %`;
      btnUndo.disabled = !list.length;
      btnRedo.disabled = !redoStack.length || verrou;
      const texte = tool === 'text';
      const r = reg[tool];
      btnEp.hidden = btnTy.hidden = !r;
      const formes = tool === 'ellipse';
      btnDeb.hidden = btnFin.hidden = !(r && r.d && (!formes || r.kind === 'poly'));
      btnTF.innerHTML = tfSvg();
      btnTF.title = `Couleur du trait / du remplissage (on modifie : ${cible === 'fond' ? 'le remplissage' : 'le trait'})`;
      btnAucun.hidden = cible !== 'fond';
      for (const b of colorBtns) b.classList.toggle('sig4cem-pe__color--on', b.dataset.color === (cible === 'fond' ? fillColor : color));
      btnAucun.classList.toggle('sig4cem-pe__color--on', cible === 'fond' && !fillColor);
      btnForme.hidden = !formes;
      btnForme.disabled = verrou;
      const kd = KINDS.find((k) => k[0] === reg.ellipse.kind);
      btnForme.innerHTML = svgIc(kd[2]);
      btnForme.title = `Forme : ${kd[1]}`;
      btnUndo.disabled = !list.length && !polyDraft;
      btnClear.disabled = verrou || !list.length;
      btnOk.disabled = verrou || propre() === etatInitial;
      btnCancel.disabled = verrou;
      if (r) {
        btnEp.innerHTML = icEp(r.ep);
        btnEp.title = `Épaisseur du trait (${NOM_EP[r.ep]})`;
        btnTy.innerHTML = icTy(r.ty);
        btnTy.title = `Type de trait (${r.ty})`;
        if (r.d) {
          btnDeb.innerHTML = svgIc(finIc(r.d, false));
          btnFin.innerHTML = svgIc(finIc(r.f, true));
          btnDeb.title = `Terminaison du début (${TITRES_T[r.d]})`;
          btnFin.title = `Terminaison de la fin (${TITRES_T[r.f]})`;
        }
      }
      btnSmaller.hidden = btnBigger.hidden = btnG.hidden = btnI.hidden = btnU.hidden = btnAl.hidden = !texte;
      sepTexte.forEach((e) => { e.hidden = !texte; });
      const it = selected ? selected.item : null;
      const gras = it ? it.b !== false : stT.b, ital = it ? !!it.i : stT.i, sou = it ? !!it.u : stT.u, al = it ? it.al || 'g' : stT.al;
      btnG.classList.toggle('sig4cem-pe__ic--on', gras);
      btnI.classList.toggle('sig4cem-pe__ic--on', ital);
      btnU.classList.toggle('sig4cem-pe__ic--on', sou);
      btnAl.innerHTML = svgIc(ALIGN[al]);
      btnAl.title = `Alignement du texte (${NOM_AL[al]})`;
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
      b.el.style.fontWeight = b.item.b === false ? '400' : '700';
      b.el.style.fontStyle = b.item.i ? 'italic' : 'normal';
      b.el.style.textDecoration = b.item.u ? 'underline' : 'none';
      b.body.style.textAlign = b.item.al === 'c' ? 'center' : b.item.al === 'd' ? 'right' : 'left';
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

    // ---- Formes : rectangle, ellipse, ligne brisée. Elles restent modifiables (poignées) jusqu'à confirmation (✓) ou changement d'outil.
    const poign = h('div', { class: 'sig4cem-pe__poign' });
    stage.append(poign);
    // Menu flottant dans l'image (comme la barre de lecture des captures) : valider ✓ / annuler ✗ la forme en cours.
    const btnFOk = btnIc('Valider la forme', '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="0.835" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11"/></svg>');
    const btnFNon = btnIc('Annuler cette forme', '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="0.835" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>');
    const pill = h('div', { class: 'sig4cem-pe__pill', hidden: '' }, btnFNon, btnFOk);
    btnFOk.addEventListener('click', () => { if (polyDraft) terminerPoly(false, true); else setEdit(null); });
    btnFNon.addEventListener('click', () => {
      if (polyDraft) { polyDraft = null; redraw(); refresh(); return; }
      const j = list.indexOf(edit);
      if (j >= 0) list.splice(j, 1);
      setEdit(null);
    });
    stage.append(pill);
    let poigns = []; // { el, kind: 'h' | 'rot' | 'move' | 'ok' | 'v', sx, sy, i }
    const cl = (t) => JSON.parse(JSON.stringify(t));
    const toPx = (p) => [p[0] * canvas.width, p[1] * canvas.height];
    const fromPx = (x, y) => [x / canvas.width, y / canvas.height];
    function setEdit(t) {
      edit = t;
      guide = null;
      poigns.forEach((o) => o.el.remove());
      poigns = [];
      if (t) {
        const mk = (kind, extra) => { const el = h('span', { class: `sig4cem-pe__hd sig4cem-pe__hd--${kind}` }); const o = Object.assign({ el, kind }, extra); poigns.push(o); poign.append(el); return o; };
        if (t.t === 'poly') t.p.forEach((_, i) => mk('v', { i }));
        else for (const [sx, sy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) mk('h', { sx, sy });
        if (t.t !== 'poly') mk('rot');
      }
      for (const o of poigns) liePoignee(o);
      redraw();
      refresh();
    }
    function finaliserTout() {
      if (polyDraft) { terminerPoly(false, true); }
      if (edit) setEdit(null);
    }
    function terminerPoly(ferme, silencieux) {
      const pts = polyDraft;
      polyDraft = null;
      if (pts && pts.length >= 2) {
        const r = reg.ellipse;
        const t = { t: 'poly', c: color, w: EPAISSEURS[r.ep], p: pts, cl: !!ferme };
        if (ferme && fillColor) t.fc = fillColor;
        if (opacity < 1) t.o = opacity;
        if (r.ty !== 'plein') t.ty = r.ty;
        if (!ferme) { t.ed = r.d; t.ef = r.f; }
        list.push(t);
        redoStack.length = 0;
        if (ferme && !silencieux) { setEdit(t); return; }
      }
      redraw(); refresh();
    }
    // Position des poignées (px écran) : coins/côtés (carrés pleins), sommets, rotation, déplacement, ✓.
    function placePoignees() {
      const f = canvas.clientWidth / canvas.width;
      const put = (el, x, y) => { el.style.left = `${x * f}px`; el.style.top = `${y * f}px`; };
      pill.hidden = !(edit || (polyDraft && polyDraft.length > 0));
      btnFOk.hidden = !!(polyDraft && polyDraft.length < 2);
      if (!edit) return;
      let haut = [Infinity, Infinity];
      if (edit.t === 'poly') {
        const P = contour(edit, canvas.width, canvas.height);
        for (const o of poigns) if (o.kind === 'v' && P[o.i]) put(o.el, P[o.i][0], P[o.i][1]);
        const xs = P.map((q) => q[0]), ys = P.map((q) => q[1]);
        haut = [Math.min(...xs), Math.min(...ys)];
      } else {
        const g = geom(edit, canvas.width, canvas.height);
        const pt = (lx, ly) => { const q = tourne(lx, ly, g.r); return [g.cx + q[0], g.cy + q[1]]; };
        for (const o of poigns) if (o.kind === 'h') { const q = pt(o.sx * g.hw, o.sy * g.hh); put(o.el, q[0], q[1]); const ar = o.el.querySelector('.sig4cem-pe__ar'); if (ar) ar.style.transform = `rotate(${g.r + (o.sx && !o.sy ? Math.PI / 2 : 0)}rad)`; }
        const dec = 28 / f;
        const d = tourne(-dec, -dec, g.r);
        haut = pt(-g.hw, -g.hh);
        haut = [haut[0] + d[0] + dec, haut[1] + d[1] + dec];
        const rotEl = poigns.find((o) => o.kind === 'rot');
        if (rotEl) { const sv = rotEl.el.querySelector('svg'); if (sv) sv.style.transform = `rotate(${g.r}rad)`; }
      }
      // rotation : sur la diagonale à 45° du coin haut-gauche (déplacer : toucher l'intérieur de la forme)
      const k = 1 / f, dec = 28 * k;
      const rot = poigns.find((o) => o.kind === 'rot');
      if (rot) put(rot.el, Math.max(16 * k, Math.min(canvas.width - 16 * k, haut[0] - dec)), Math.max(16 * k, Math.min(canvas.height - 16 * k, haut[1] - dec)));
    }
    function liePoignee(o) {
      const el = o.el;
      if (o.kind === 'rot') { el.innerHTML = '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="0.835" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.5v4.5h-4.5"/></svg>'; el.title = 'Faire pivoter'; }
      else if (o.kind === 'move') { el.innerHTML = '<span class="sig4cem-ic sig4cem-ic--deplacer"></span>'; el.title = 'Déplacer'; }
      else {
        const nom = o.kind === 'v' ? 'deplacer' : (o.sx && o.sy ? (o.sx * o.sy > 0 ? 'redim-diag2' : 'redim-diag1') : 'redim-vert');
        el.innerHTML = `<i class="sig4cem-pe__sq"></i><span class="sig4cem-ic sig4cem-ic--${nom} sig4cem-pe__ar" style="${o.sx && !o.sy && o.kind === 'h' ? 'transform:rotate(90deg)' : ''}"></span>`;
      }
      el.addEventListener('pointerdown', (e) => demarrerPoignee(o, e));
    }
    function dansForme(t, p) {
      const [x, y] = toPx(p);
      const k = canvas.width / (canvas.clientWidth || canvas.width);
      if (t.t === 'poly') {
        const P = contour(t, canvas.width, canvas.height);
        let dedans = false;
        for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) dedans = !dedans;
        return dedans;
      }
      const g = geom(t, canvas.width, canvas.height);
      const q = tourne(x - g.cx, y - g.cy, -g.r);
      const m = 8 * k;
      return t.t === 'rect' ? Math.abs(q[0]) <= g.hw + m && Math.abs(q[1]) <= g.hh + m : (q[0] / (g.hw + m)) ** 2 + (q[1] / (g.hh + m)) ** 2 <= 1;
    }
    let drag = null;
    function deplacerForme(orig, dx, dy) {
      if (edit.t === 'poly') edit.p = orig.p.map(([x, y]) => [x + dx, y + dy]);
      else { edit.a = [orig.a[0] + dx, orig.a[1] + dy]; edit.b = [orig.b[0] + dx, orig.b[1] + dy]; }
    }
    function demarrerPoignee(o, e) {
      e.preventDefault();
      e.stopPropagation();
      o.el.setPointerCapture(e.pointerId);
      o.el.classList.add('sig4cem-pe__hd--act');
      const p0 = pos(e);
      drag = { mode: o.kind, o, p0, orig: cl(edit) };
      if (o.kind === 'rot') { const g = geom(edit, canvas.width, canvas.height); const q = toPx(p0); drag.a0 = Math.atan2(q[1] - g.cy, q[0] - g.cx); }
      const bouge = (ev) => { ev.preventDefault(); suivre(ev); };
      const fin = () => { o.el.classList.remove('sig4cem-pe__hd--act'); o.el.removeEventListener('pointermove', bouge); o.el.removeEventListener('pointerup', fin); o.el.removeEventListener('pointercancel', fin); drag = null; guide = null; redraw(); refresh(); };
      o.el.addEventListener('pointermove', bouge);
      o.el.addEventListener('pointerup', fin);
      o.el.addEventListener('pointercancel', fin);
    }
    // Déplacement / redimensionnement / rotation en cours (pointeur `e`).
    function suivre(e) {
      if (!drag || !edit) return;
      const p = pos(e);
      const orig = drag.orig;
      if (drag.mode === 'move') { deplacerForme(orig, p[0] - drag.p0[0], p[1] - drag.p0[1]); }
      else if (drag.mode === 'v') { edit.p[drag.o.i] = p; }
      else if (drag.mode === 'rot') {
        const g = geom(orig, canvas.width, canvas.height), q = toPx(p);
        let r = (orig.r || 0) + Math.atan2(q[1] - g.cy, q[0] - g.cx) - drag.a0;
        const pas = Math.PI / 4, reste = ((r % pas) + pas) % pas;
        if (Math.min(reste, pas - reste) < 0.045) r = Math.round(r / pas) * pas; // aimant à 0 / 45 / 90°
        edit.r = r;
      } else if (drag.mode === 'h') {
        const g = geom(orig, canvas.width, canvas.height), q = toPx(p);
        const l = tourne(q[0] - g.cx, q[1] - g.cy, -g.r);
        const { sx, sy } = drag.o;
        let left = -g.hw, right = g.hw, top = -g.hh, bottom = g.hh;
        if (sx === 1) right = l[0]; else if (sx === -1) left = l[0];
        if (sy === 1) bottom = l[1]; else if (sy === -1) top = l[1];
        guide = null;
        if (sx && sy) {
          const w0 = g.hw * 2, h0 = g.hh * 2, asp0 = w0 / h0;
          let nw = Math.abs(right - left), nh = Math.abs(bottom - top);
          const tol = 0.06;
          if (Math.abs(asp0 - 1) > tol && nh > 1 && Math.abs(nw / nh - asp0) / asp0 < tol) {
            const f = Math.max(nw / w0, nh / h0);
            nw = w0 * f; nh = h0 * f;
            guide = { type: 'diag', sx, sy };
          } else if (Math.abs(nw - nh) < tol * Math.max(nw, nh)) {
            nh = nw;
            guide = { type: 'med' };
          }
          if (guide) {
            if (sx === 1) right = left + nw; else left = right - nw;
            if (sy === 1) bottom = top + nh; else top = bottom - nh;
          }
        }
        const lc = [(left + right) / 2, (top + bottom) / 2];
        const w = tourne(lc[0], lc[1], g.r);
        const cx = g.cx + w[0], cy = g.cy + w[1], hw = Math.abs(right - left) / 2, hh = Math.abs(bottom - top) / 2;
        edit.a = fromPx(cx - hw, cy - hh);
        edit.b = fromPx(cx + hw, cy + hh);
      }
      redraw();
    }
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const p = pos(e);
      select(null);
      if (nuancier) nuancier.hidden = true;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      if (tool === 'text') return; // la zone de texte se pose au clic (pour que le clavier s'ouvre sur mobile)
      canvas.setPointerCapture(e.pointerId);
      const r = reg[tool];
      if (tool === 'ellipse') {
        if (edit && dansForme(edit, p)) { drag = { mode: 'move', p0: p, orig: cl(edit), corps: true }; return; }
        if (edit) { drag = null; return; } // la forme en cours ne se quitte que par ✓ ou ✗
        if (r.kind === 'poly') { drag = { mode: 'tap', p0: p }; return; }
        draft = { t: r.kind, c: color, w: EPAISSEURS[r.ep], a: p, b: p };
        if (fillColor) draft.fc = fillColor;
        drag = { mode: 'creer', p0: p };
      } else {
        const w = EPAISSEURS[r.ep];
        draft = tool === 'pen' ? { t: 'pen', c: color, w, p: [p] } : { t: tool, c: color, w, a: p, b: p };
      }
      if (draft) {
        if (opacity < 1) draft.o = opacity;
        if (r.ty !== 'plein') draft.ty = r.ty;
        if (r.d && tool !== 'ellipse') { draft.ed = r.d; draft.ef = r.f; }
      }
      redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag && drag.mode === 'move' && drag.corps) { e.preventDefault(); suivre(e); return; }
      if (drag && drag.mode === 'tap') { const p = pos(e); if (Math.hypot(p[0] - drag.p0[0], p[1] - drag.p0[1]) > 0.02) drag = null; return; }
      if (!draft) return;
      e.preventDefault();
      let p = pos(e);
      if (draft.t === 'pen') draft.p.push(p);
      else {
        guide = null;
        if (drag && drag.mode === 'creer') {
          // aimant léger vers le carré / le cercle
          const dx = (p[0] - draft.a[0]) * canvas.width, dy = (p[1] - draft.a[1]) * canvas.height;
          if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.06 * Math.max(Math.abs(dx), Math.abs(dy)) && Math.abs(dx) > 8) {
            const m = Math.max(Math.abs(dx), Math.abs(dy));
            p = [draft.a[0] + Math.sign(dx) * m / canvas.width, draft.a[1] + Math.sign(dy) * m / canvas.height];
            guide = { type: 'med' };
          }
        }
        draft.b = p;
      }
      redraw();
    });
    const end = (e) => {
      if (drag && drag.mode === 'move') { drag = null; redraw(); refresh(); return; }
      if (drag && drag.mode === 'tap') {
        const p = drag.p0;
        drag = null;
        const [x, y] = toPx(p);
        if (polyDraft && polyDraft.length >= 3) {
          const [fx, fy] = toPx(polyDraft[0]);
          if (Math.hypot(x - fx, y - fy) < 18 * canvas.width / (canvas.clientWidth || canvas.width)) { terminerPoly(true); return; }
        }
        polyDraft = (polyDraft || []).concat([p]);
        redraw(); refresh();
        return;
      }
      drag = null;
      if (!draft) return;
      const t = draft;
      draft = null;
      const vide = t.t !== 'pen' && Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]) < 0.01;
      if (!vide) { list.push(t); redoStack.length = 0; }
      if (!vide && (t.t === 'rect' || t.t === 'ellipse')) { setEdit(t); return; }
      guide = null;
      refresh();
      redraw();
    };
    canvas.addEventListener('click', (e) => {
      if (tool !== 'text') return;
      const p = pos(e);
      const item = { t: 'text', c: color, s: 0.045, x: Math.min(0.9, p[0]), y: Math.min(0.9, p[1]), txt: '' };
      if (opacity < 1) item.o = opacity;
      item.b = stT.b; if (stT.i) item.i = true; if (stT.u) item.u = true; if (stT.al !== 'g') item.al = stT.al;
      list.push(item);
      redoStack.length = 0;
      addBox(item, true);
    });
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    btnUndo.addEventListener('click', () => {
      if (polyDraft) { polyDraft.pop(); if (!polyDraft.length) polyDraft = null; redraw(); refresh(); return; }
      const last = list[list.length - 1];
      if (last && last === edit) setEdit(null);
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
    btnClear.addEventListener('click', () => { polyDraft = null; if (edit) setEdit(null); for (const b of boxes.slice()) b.el.remove(); boxes.length = 0; selected = null; list = []; redoStack.length = 0; refresh(); redraw(); });

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
