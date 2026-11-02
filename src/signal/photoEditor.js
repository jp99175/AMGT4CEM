/**
 * SIG4CEM — annotations d'une photo : pinceau, ligne (flèche), formes (ellipse), texte. Ligne 1 : historique et outils ; ligne 2 : palette
 * (couleur + opacité) puis options de l'outil actif.
 * Le texte est une boîte de texte : un rectangle (cadre et fond « aucun » par défaut) dont l'intérieur se saisit au clavier.
 * Une couleur et une taille par boîte, formats mélangeables (gras, italique, souligné, indice, exposant). Même édition que les
 * formes : poignées, rotation, déplacement, ✓ / ✗. Se pose avec le bouton Texte ou avec le « T » de l'outil rectangle.
 *
 * La photo d'origine n'est jamais modifiée : les annotations sont dessinées sur un calque TRANSPARENT (PNG)
 * enregistré à part (AMGT4CEM_Signalements.Pieces.setAnnotations) et superposé à l'affichage. Les traits sont
 * aussi conservés (coordonnées relatives à l'image, 0..1) pour pouvoir les reprendre et en annuler un.
 * Outil Sélection : toucher un objet pour le modifier (poignées) ; liste des objets (ordre de superposition, masquer `hid`, supprimer) ;
 * annuler / refaire par instantanés ; mode Mise en page (pivoter, recadrer, transformation libre, réversible : `mep`) ; zoom à deux doigts ; à l'enregistrement, question sur les objets masqués (garder ou supprimer).
 */
(function () {
const NS = window.SIG4CEM;
const h = NS.h;
const COULEURS = ['#e53935', '#fdd835', '#1e88e5', '#212121'];
const svgIc = (contenu) => `<svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="0.835" stroke-linecap="round" stroke-linejoin="round">${contenu}</svg>`;
const FLECHE = '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.5v4.5h-4.5"/>';
const maskIc = (n) => `<span class="sig4cem-ic sig4cem-ic--${n}" aria-hidden="true"></span>`;
// Ligne 1 : le pinceau ouvre le mode « édition » (dessin : crayon, trait, ligne brisée, rectangle, ellipse, choisis en ligne 2) ; le texte a le sien.
const OUTILS = [
  ['edit', 'Édition', maskIc('pinceau')],
  ['text', 'Texte', maskIc('texte')],
  ['select', 'Sélection : toucher un objet pour le modifier', maskIc('selection')],
  ['mep', 'Mise en page : pivoter, recadrer', svgIc('<rect x="4.5" y="9" width="12" height="11" rx="1"/><path d="M9 4.5a6.5 6.5 0 0 1 9 1.2"/><path d="M18.8 2.8v3.4h-3.4"/>')],
];
// Outils de dessin du menu de la ligne 2 : [clé, libellé, icône].
const SOUS_OUTILS = [
  ['pen', 'Crayon (dessin libre)', maskIc('crayon')],
  ['gomme', 'Gomme (efface le dessin libre)', maskIc('gomme')],
  ['arrow', 'Trait (flèches, cotes)', maskIc('fleche')],
  ['poly', 'Ligne brisée', svgIc('<path d="M4 17.5l5-9.5 5.5 6.5L20 6"/>')],
  ['rect', 'Rectangle', svgIc('<rect x="4" y="6.5" width="16" height="11" rx="1.2"/>')],
  ['ellipse', 'Ellipse', svgIc('<ellipse cx="12" cy="12" rx="9" ry="6"/>')],
];
const OVERLAY_SIDE = 1000; // grand côté du calque PNG (la photo, elle, garde sa définition)

const EPAISSEURS = [0.004, 0.008, 0.014];
const GOMMES = [0.008, 0.016, 0.03]; // rayon de la gomme (fraction de la largeur)
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

/** Texte riche d'une boîte : segments [{ t, b, i, u, x: 'sub' | 'sup' }], une seule couleur (`tc`) et une seule taille (`s`) par boîte. */
const POS = { sub: 0.175, sup: -0.385 }; // décalage vertical (en fraction de la taille) ; indice et exposant sont à 70 %
const policeSeg = (sg, size) => `${sg.i ? 'italic ' : ''}${sg.b ? 'bold ' : ''}${sg.x ? size * 0.7 : size}px sans-serif`;
/** Retour à la ligne : coupe aux espaces (et au caractère si un mot dépasse la largeur). Renvoie des lignes de morceaux { t, sg, w }. */
function mettreEnPage(ctx, segs, size, inner) {
  const lignes = [[]];
  let x = 0;
  const nl = () => { lignes.push([]); x = 0; };
  const ajoute = (t, sg, w) => { lignes[lignes.length - 1].push({ t, sg, w }); x += w; };
  for (const sg of segs) {
    ctx.font = policeSeg(sg, size);
    String(sg.t).split('\n').forEach((m, k) => {
      if (k) nl();
      for (const tok of m.match(/\s+|\S+/g) || []) {
        const esp = /^\s/.test(tok);
        const w = ctx.measureText(tok).width;
        if (esp) { ajoute(tok, sg, w); continue; }
        if (x + w > inner && x > 0) nl();
        if (w > inner) {
          let cur = '';
          for (const ch of tok) {
            if (cur && ctx.measureText(cur + ch).width > inner) { ajoute(cur, sg, ctx.measureText(cur).width); nl(); cur = ch; } else cur += ch;
          }
          if (cur) ajoute(cur, sg, ctx.measureText(cur).width);
        } else ajoute(tok, sg, w);
      }
    });
  }
  return lignes;
}
function texteRiche(ctx, t, W, H) {
  const segs = Array.isArray(t.txt) ? t.txt : [];
  if (!segs.some((sg) => String(sg.t).trim())) return;
  const g = geom(t, W, H), size = Math.max(8, t.s * W), pad = size * 0.3, inner = Math.max(size, g.hw * 2 - 2 * pad), lh = size * 1.2;
  const lignes = mettreEnPage(ctx, segs, size, inner);
  const k = t.al === 'c' ? 0.5 : t.al === 'd' ? 1 : 0;
  ctx.save();
  ctx.translate(g.cx, g.cy);
  ctx.rotate(g.r);
  ctx.setLineDash([]);
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.fillStyle = ctx.strokeStyle = t.tc || '#e53935';
  lignes.forEach((ligne, i) => {
    let n = ligne.length;
    while (n > 0 && !ligne[n - 1].t.trim()) n--;
    let wl = 0;
    for (let j = 0; j < n; j++) wl += ligne[j].w;
    let x = -g.hw + pad + (inner - wl) * k;
    const base = -g.hh + pad + i * lh + lh * 0.5 + size * 0.275;
    for (let j = 0; j < n; j++) {
      const { t: tx, sg, w } = ligne[j];
      const y = base + (sg.x ? POS[sg.x] * size : 0);
      ctx.font = policeSeg(sg, size);
      if (!t.fc) { ctx.save(); ctx.lineWidth = Math.max(2, size / 8); ctx.strokeStyle = '#fff'; ctx.strokeText(tx, x, y); ctx.restore(); }
      ctx.fillText(tx, x, y);
      if (sg.u) { ctx.lineWidth = Math.max(1.5, size / 14); ctx.beginPath(); ctx.moveTo(x, y + size * 0.12); ctx.lineTo(x + w, y + size * 0.12); ctx.stroke(); }
      x += w;
    }
  });
  ctx.restore();
}

/** Dessine les traits (coordonnées relatives) sur un contexte de W×H pixels (`sansTexte` : ne dessine aucun texte ; `exclure` : une boîte dont le texte est en cours de saisie). */
function render(ctx, W, H, traits, sansTexte, exclure) {
  ctx.clearRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const t of traits) {
    if (t.t === 'gomme' || t.hid) continue; // marqueur d'une ancienne passe de gomme, ou objet masqué : sans dessin
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
        if (!t.c) { /* cadre sans couleur (boîte de texte) */ }
        else if (t.ty === 'nuage') nuage(ctx, pts, ferme, lw);
        else {
          ctx.beginPath();
          pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          if (ferme) ctx.closePath();
          ctx.stroke();
        }
        if (t.tx && !sansTexte && t !== exclure) texteRiche(ctx, t, W, H);
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

/**
 * Mise en page d'une photo (réversible, la photo d'origine n'est jamais modifiée) : { v: 1, a, c: [x, y], w, h }.
 * a = rotation en degrés (sens horaire) autour du centre de la photo ; le cadre (la vue finale) est un rectangle de w × h,
 * centré en c, dans le repère pivoté et centré sur la photo. Toutes les longueurs sont en largeurs de photo (la photo mesure 1 × H/W).
 * Les annotations restent dans le repère de la photo entière (0..1) : seule la vue change.
 */
const MEP_VERSION = 1;
const mepDefaut = (W, H) => ({ v: MEP_VERSION, a: 0, c: [0, 0], w: 1, h: H / W });
const mepNeutre = (m, W, H) => !m || (Math.abs(m.a) < 0.01 && Math.abs(m.c[0]) < 1e-4 && Math.abs(m.c[1]) < 1e-4 && Math.abs(m.w - 1) < 1e-4 && Math.abs(m.h - H / W) < 1e-4);
const mepNormal = (m, W, H) => (mepNeutre(m, W, H) ? null : m);
const normAngle = (a) => { const r = ((a + 180) % 360 + 360) % 360 - 180; return r === -180 ? 180 : r; };
/** Pivote la mise en page d'un quart de tour (sens = 1 horaire, -1 anti-horaire) : le cadre suit la photo. */
function pivoterMep(m, sens, W, H) {
  const b = m || mepDefaut(W, H), r = sens * Math.PI / 2;
  return mepNormal({ v: MEP_VERSION, a: normAngle(b.a + sens * 90), c: [b.c[0] * Math.cos(r) - b.c[1] * Math.sin(r), b.c[0] * Math.sin(r) + b.c[1] * Math.cos(r)], w: b.h, h: b.w }, W, H);
}
/** Plus grand cadre centré, de proportion `aspect` (largeur / hauteur), entièrement dans la photo tournée de `a` degrés. */
function cadreInscrit(a, aspect, W, H) {
  const th = a * Math.PI / 180, co = Math.abs(Math.cos(th)), si = Math.abs(Math.sin(th)), r = H / W;
  const h = Math.min(1 / (aspect * co + si), r / (aspect * si + co));
  return { w: aspect * h, h };
}
/** Ramène le cadre dans la photo (translation, puis réduction si besoin) : pas de coin vide. */
function contenirMep(m, W, H) {
  const r = H / W, th = m.a * Math.PI / 180, co = Math.cos(th), si = Math.sin(th);
  const o = { v: MEP_VERSION, a: m.a, c: m.c.slice(), w: m.w, h: m.h };
  for (let it = 0; it < 40; it++) {
    let ok = true;
    for (const [kx, ky] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = o.c[0] + kx * o.w / 2, y = o.c[1] + ky * o.h / 2, sx = x * co + y * si, sy = -x * si + y * co;
      const ex = Math.abs(sx) > 0.5 ? (Math.abs(sx) - 0.5) * Math.sign(sx) : 0, ey = Math.abs(sy) > r / 2 ? (Math.abs(sy) - r / 2) * Math.sign(sy) : 0;
      if (ex || ey) { ok = false; o.c = [o.c[0] - (ex * co - ey * si), o.c[1] - (ex * si + ey * co)]; }
    }
    if (ok) break;
    if (it >= 8 && it % 4 === 0) { o.w *= 0.92; o.h *= 0.92; }
  }
  return o;
}
/** Place le contexte pour dessiner la photo (ou ses annotations) dans le cadre : `u` pixels par largeur de photo. */
function appliquerMep(ctx, m, u, W, H) {
  ctx.translate(m.w * u / 2, m.h * u / 2);
  ctx.translate(-m.c[0] * u, -m.c[1] * u);
  ctx.rotate(m.a * Math.PI / 180);
  ctx.translate(-u / 2, -u * H / W / 2);
}
const tailleVue = (m, W, H, cote) => { const u = Math.min(W, cote / Math.max(m.w, m.h)); return { u, ow: Math.max(1, Math.round(m.w * u)), oh: Math.max(1, Math.round(m.h * u)) }; };

NS.PhotoEditor = {
  mepNormal,
  pivoterMep,
  /** Photo vue à travers sa mise en page (Blob JPEG, grand côté `cote` px) ; la photo d'origine reste inchangée. */
  async vue(blob, mep, cote) {
    const bmp = await createImageBitmap(blob);
    const W = bmp.width, H = bmp.height, m = mep || mepDefaut(W, H), { u, ow, oh } = tailleVue(m, W, H, cote || 1000);
    const c = document.createElement('canvas');
    c.width = ow; c.height = oh;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ow, oh);
    ctx.save();
    appliquerMep(ctx, m, u, W, H);
    ctx.drawImage(bmp, 0, 0, u, u * H / W);
    ctx.restore();
    if (bmp.close) bmp.close();
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Encodage JPEG impossible'))), 'image/jpeg', 0.85));
  },
  /** Calque PNG transparent pour des traits donnés, dans le cadre de la mise en page (null s'il n'y a pas de traits). */
  async overlayPng(traits, largeur, hauteur, mep) {
    if (!traits || !traits.length) return null;
    const m = mep || mepDefaut(largeur, hauteur), { u, ow, oh } = tailleVue(m, largeur, hauteur, OVERLAY_SIDE);
    const c = document.createElement('canvas');
    c.width = ow; c.height = oh;
    const ctx = c.getContext('2d');
    ctx.save();
    appliquerMep(ctx, m, u, largeur, hauteur);
    render(ctx, u, u * hauteur / largeur, traits);
    ctx.restore();
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Encodage PNG impossible'))), 'image/png'));
  },

  /**
   * Ouvre l'éditeur sur une photo. `onDone(traits)` à la validation ; rien n'est modifié si on annule.
   * @param {Blob} blob - la photo (JPEG réduit)
   * @param {Array} traits - traits existants
   * @param {Function} onDone - (traits, mep) à la validation
   * @param {object|null} mep0 - mise en page enregistrée (rotation, cadre)
   * @param {{outil?: string}} [opts] - `outil: 'mep'` ouvre directement la mise en page
   */
  open(blob, traits, onDone, mep0, opts) {
    const url = URL.createObjectURL(blob);
    let list = (traits || []).map((t) => JSON.parse(JSON.stringify(t)));
    let tool = 'pen'; // 'pen' | 'arrow' | 'gomme' | 'ellipse' (dessin), 'text', 'select'
    let color = COULEURS[0];
    let textColor = COULEURS[0]; // couleur du texte des boîtes de texte
    let opacity = 1;
    let fillColor = null; // remplissage des formes fermées (null = aucun)
    let cible = 'trait'; // ce que modifie la palette : 'trait' ou 'fond'
    let edit = null; // forme en cours d'édition (poignées) tant qu'elle n'est pas confirmée
    let polyDraft = null; // sommets d'une ligne brisée en cours de pose
    let guide = null; // repère en pointillés : { type: 'med' | 'diag', sx, sy }
    let mep = mep0 ? JSON.parse(JSON.stringify(mep0)) : null; // mise en page enregistrée (null : photo entière)
    let mepEntry = null; // état à l'entrée en mode Mise en page : « Annuler » le rétablit
    let sousMep = 'crop'; // en mode Mise en page : 'crop' (cadre) ou 'libre' (transformation libre à deux doigts)
    let ratioCadre = null; // proportion verrouillée du cadre (largeur / hauteur), null : libre
    const vz = { z: 1, tx: 0, ty: 0 }; // zoom d'affichage (non enregistré), en px du cadre
    let sw = 1, sh = 1, M = new DOMMatrix(), sTot = 1, thTot = 0, fr = { x: 0, y: 0, w: 1, h: 1 }, sBase = 1, bw = 1, bh = 1;
    // Réglages propres à chaque outil (épaisseur, type de trait, terminaisons).
    const reg = { pen: { ep: 1, ty: 'plein', d: 'aucune', f: 'aucune' }, arrow: { ep: 1, ty: 'plein', d: 'aucune', f: 'fleche' }, ellipse: { ep: 1, ty: 'plein', d: 'aucune', f: 'aucune', kind: 'ellipse', tx: false }, gomme: { ep: 1 } };
    let draft = null;
    let gommePos = null; // position de la gomme (px du canvas) pour le cercle d'aperçu
    const W = 800; // résolution du dessin à l'écran : relative, les traits sont stockés en 0..1

    const img = h('img', { class: 'sig4cem-pe__img', src: url, alt: 'Photo à annoter', draggable: 'false' });
    const canvas = h('canvas', { class: 'sig4cem-pe__canvas' });
    const stage = h('div', { class: 'sig4cem-pe__stage' }, img, canvas);
    const frame = h('div', { class: 'sig4cem-pe__frame' }, stage);
    const corps = h('div', { class: 'sig4cem-pe__body' }, frame);
    const btnIc = (titre, svg, extra) => { const b = h('button', { type: 'button', class: 'sig4cem-pe__ic' + (extra ? ' ' + extra : ''), title: titre, 'aria-label': titre }); b.innerHTML = svg; return b; };
    let dernierDessin = 'pen';
    const sousOutil = () => (tool === 'pen' || tool === 'arrow' || tool === 'gomme' ? tool : tool === 'ellipse' ? reg.ellipse.kind : null);
    function choisirSousOutil(k) {
      if (k === 'pen' || k === 'arrow' || k === 'gomme') tool = k;
      else { tool = 'ellipse'; reg.ellipse.kind = k; }
      dernierDessin = tool;
    }
    const toolBtns = OUTILS.map(([k, label, ic]) => {
      const b = btnIc(label, ic);
      b.addEventListener('click', () => {
        if (polyDraft || (edit && tool !== 'select')) return;
        if (edit) setEdit(null);
        const modes = ['text', 'select', 'mep'];
        const entrait = tool !== 'mep' && k === 'mep';
        if (modes.includes(k)) { if (tool !== k) { if (!modes.includes(tool)) dernierDessin = tool; tool = k; vz.z = 1; vz.tx = vz.ty = 0; } } else if (modes.includes(tool)) { tool = dernierDessin; vz.z = 1; vz.tx = vz.ty = 0; }
        if (entrait) mepEntry = { base: snap(), n: undoS.length }; else if (tool !== 'mep') mepEntry = null;
        nuancier.hidden = true; fermerMenu(); fermerObjets(); disposition(); refresh(); redraw();
      });
      b.dataset.tool = k;
      return b;
    });
    // Outil dont les réglages s'affichent : l'outil actif, ou celui de l'objet sélectionné en mode Sélection.
    const outil = () => (tool === 'select' ? (edit ? (edit.tx ? 'text' : edit.t === 'pen' || edit.t === 'arrow' ? edit.t : 'ellipse') : null) : tool);
    const colorBtns = COULEURS.map((c) => {
      const b = h('button', { type: 'button', class: 'sig4cem-pe__color', title: 'Couleur', 'aria-label': 'Couleur' });
      b.style.background = c;
      b.addEventListener('click', () => {
        if (cible === 'fond') { fillColor = c; if (edit) edit.fc = c; }
        else if (cible === 'texte') { textColor = c; if (edit && edit.tx) edit.tc = c; }
        else { color = c; if (edit) edit.c = c; }
        redraw(); refresh();
      });
      b.dataset.color = c;
      return b;
    });
    const btnAucun = h('button', { type: 'button', class: 'sig4cem-pe__color sig4cem-pe__color--aucun', title: 'Aucun remplissage', 'aria-label': 'Aucun remplissage' });
    btnAucun.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#e53935" stroke-width="1.6"><path d="M5 19L19 5"/></svg>';
    btnAucun.addEventListener('click', () => { if (cible === 'fond') { fillColor = null; if (edit) delete edit.fc; } else if (edit) edit.c = null; redraw(); refresh(); });
    // Palette : couleurs + opacité, dans une fenêtre sous la ligne 2.
    const opaVal = h('span', { class: 'sig4cem-pe__opaval' });
    const opaRange = h('input', { type: 'range', min: '10', max: '100', step: '5', value: '100', 'aria-label': 'Opacité' });
    opaRange.addEventListener('input', () => { opacity = Number(opaRange.value) / 100; if (edit) { if (opacity === 1) delete edit.o; else edit.o = opacity; redraw(); } refresh(); });
    const ongletBtns = [['texte', 'Texte'], ['trait', 'Cadre'], ['fond', 'Fond']].map(([k, nom]) => {
      const b = h('button', { type: 'button', class: 'sig4cem-pe__onglet', text: nom });
      b.dataset.cible = k;
      b.addEventListener('click', () => { cible = k; refresh(); });
      return b;
    });
    const onglets = h('div', { class: 'sig4cem-pe__onglets', hidden: '' }, ...ongletBtns);
    const nuancier = h('div', { class: 'sig4cem-pe__nuancier', hidden: '' },
      onglets,
      h('div', { class: 'sig4cem-pe__nuancier-c' }, ...colorBtns, btnAucun),
      h('label', { class: 'sig4cem-pe__opa' }, h('span', { text: 'Opacité' }), opaRange, opaVal));
    const btnTF = btnIc('Couleur du trait / du remplissage', '');
    btnTF.addEventListener('click', (e) => {
      e.stopPropagation();
      fermerMenu();
      // Pour les formes, un 2e toucher passe du trait au remplissage ; ailleurs seul le trait se règle.
      if (texteCtx()) nuancier.hidden = !nuancier.hidden; // trois cibles : onglets Texte / Cadre / Fond
      else if (outil() === 'ellipse' && !nuancier.hidden) cible = cible === 'trait' ? 'fond' : 'trait';
      else { cible = 'trait'; nuancier.hidden = !nuancier.hidden; }
      refresh();
    });
    const texteCtx = () => (edit ? !!edit.tx : tool === 'text' || (tool === 'ellipse' && reg.ellipse.kind === 'rect' && !!reg.ellipse.tx));
    const tfSvg = () => texteCtx() ? `<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke-linejoin="round"><rect x="9.5" y="9.5" width="11.5" height="11.5" rx="1" fill="${fillColor && !(edit && !edit.fc) ? fillColor : 'none'}" stroke="#0b5c75" stroke-width=".835"/><rect x="3" y="3" width="12" height="12" rx="1" stroke="${(edit ? edit.c : tool === 'ellipse') ? ((edit && edit.c) || color) : '#9aa5b1'}" stroke-width="${(edit ? edit.c : tool === 'ellipse') ? 2.4 : 1}" ${(edit ? edit.c : tool === 'ellipse') ? '' : 'stroke-dasharray="2 2"'}/><text x="9" y="12.6" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="700" fill="${edit && edit.tx ? edit.tc : textColor}" stroke="#fff" stroke-width=".7" paint-order="stroke">A</text></svg>` : `<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke-linejoin="round">${outil() === 'ellipse' ? `<rect x="9.5" y="9.5" width="11.5" height="11.5" rx="1" fill="${fillColor || 'none'}" stroke="#0b5c75" stroke-width=".835"/>` : ''}<rect x="3" y="3" width="12" height="12" rx="1" stroke="${color}" stroke-width="2.4"/><rect x="3" y="3" width="12" height="12" rx="1" stroke="#0b5c75" stroke-width=".835"/></svg>`;
    const btnOutil = btnIc('Outil de dessin', '');
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
        const b = btnIc(c.titre, c.texte ? `${c.ic}<span>${c.texte}</span>` : c.ic, (c.val === courant ? 'sig4cem-pe__ic--on' : '') + (c.texte ? ' sig4cem-pe__ic--large' : ''));
        b.addEventListener('click', (e) => { e.stopPropagation(); choisir(c.val); fermerMenu(); });
        menuEl.append(b);
      }
      menuEl.style.left = `${btn.offsetLeft}px`;
      menuEl.hidden = false;
      menuBtn = btn;
    }
    for (const b of [btnOutil, btnEp, btnDeb, btnTy, btnFin]) b.classList.add('sig4cem-pe__ic--menu');
    btnOutil.addEventListener('click', (e) => { e.stopPropagation(); if (edit || polyDraft) return; ouvrirMenu(btnOutil, SOUS_OUTILS.map(([k, titre, ic]) => ({ val: k, titre, ic, texte: titre })), sousOutil(), (k) => { choisirSousOutil(k); refresh(); }); });
    btnEp.addEventListener('click', (e) => { e.stopPropagation(); const T = outil(); const r = reg[T] || (T === 'text' ? reg.ellipse : null); if (r) ouvrirMenu(btnEp, [0, 1, 2].map((i) => ({ val: i, titre: `Épaisseur ${NOM_EP[i]}`, ic: icEp(i) })), r.ep, (v) => { if (T === 'gomme') reg.gomme.ep = v; else { for (const [k, o] of Object.entries(reg)) if (k !== 'gomme') o.ep = v; if (edit) edit.w = EPAISSEURS[v]; } redraw(); refresh(); }); });
    btnTy.addEventListener('click', (e) => { e.stopPropagation(); const T = outil(); const r = reg[T]; if (r) ouvrirMenu(btnTy, (T === 'ellipse' ? TYPES_FORMES : TYPES).map((t) => ({ val: t, titre: `Trait ${t}`, ic: icTy(t) })), r.ty, (v) => { for (const [k, o] of Object.entries(reg)) if (v !== 'nuage' || k === 'ellipse') o.ty = v; if (edit) { if (v === 'plein') delete edit.ty; else edit.ty = v; } redraw(); refresh(); }); });
    btnDeb.addEventListener('click', (e) => { e.stopPropagation(); const r = reg[outil()]; if (r && r.d) ouvrirMenu(btnDeb, TERMINAISONS.map((k) => ({ val: k, titre: `Début : ${TITRES_T[k]}`, ic: svgIc(finIc(k, false)) })), r.d, (v) => { r.d = v; if (edit && ['poly', 'pen', 'arrow'].includes(edit.t)) edit.ed = v; redraw(); refresh(); }); });
    btnFin.addEventListener('click', (e) => { e.stopPropagation(); const r = reg[outil()]; if (r && r.f) ouvrirMenu(btnFin, TERMINAISONS.map((k) => ({ val: k, titre: `Fin : ${TITRES_T[k]}`, ic: svgIc(finIc(k, true)) })), r.f, (v) => { r.f = v; if (edit && ['poly', 'pen', 'arrow'].includes(edit.t)) edit.ef = v; redraw(); refresh(); }); });
    const btnG = btnIc('Gras', '<span class="sig4cem-pe__t"><b>G</b></span>');
    const btnI = btnIc('Italique', '<span class="sig4cem-pe__t"><i style="font-family:serif">I</i></span>');
    const btnU = btnIc('Souligné', svgIc('<path d="M7 4v7.5a5 5 0 0 0 10 0V4"/><path d="M5 20h14"/>'));
    const btnPos = btnIc('Position : normal, indice, exposant', '');
    const btnAl = btnIc('Alignement du texte', '');
    const btnTx = btnIc('Texte dans le rectangle', maskIc('texte'));
    const ALIGN = { g: '<path d="M4 6h16M4 10.5h10M4 15h16M4 19.5h10"/>', c: '<path d="M4 6h16M7 10.5h10M4 15h16M7 19.5h10"/>', d: '<path d="M4 6h16M10 10.5h10M4 15h16M10 19.5h10"/>' };
    const NOM_AL = { g: 'gauche', c: 'centré', d: 'droite' };
    const stT = { s: 0.045, al: 'g' }; // taille et alignement des prochaines boîtes de texte
    const MIN_S = 0.02, MAX_S = 0.12;
    const btnSmaller = btnIc('Texte plus petit', '<span class="sig4cem-pe__t">A<small>−</small></span>');
    const btnBigger = btnIc('Texte plus grand', '<span class="sig4cem-pe__t">A<small>+</small></span>');
    const sousTexte = [btnG, btnI, btnU, btnPos, btnAl];
    const hint = h('div', { class: 'sig4cem-pe__hint', hidden: '' });
    // Ligne 1 : icônes en trait fin (mêmes dessins que le menu Couches).
    const btnUndo = btnIc('Annuler', svgIc(`<g transform="matrix(-1 0 0 1 24 0)">${FLECHE}</g>`));
    const btnRedo = btnIc('Refaire', svgIc(FLECHE));
    const btnClear = btnIc('Feuille blanche : effacer tout le dessin', svgIc('<path d="M6.5 3h7.5l4.5 4.5V20a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v4.5h4.5"/>'));
    const btnOk = btnIc('Enregistrer les annotations', svgIc('<path d="M5 3h11.5L21 7.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3"/><path d="M7 21v-8h10v8"/>'), 'sig4cem-pe__ic--droite');
    const btnCancel = btnIc('Fermer sans enregistrer', svgIc('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9l6 6M15 9l-6 6"/>'));
    const LAY = svgIc('<path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12.2L12 16.7l8.5-4.5"/><path d="M3.5 16.2L12 20.7l8.5-4.5"/>');
    const btnObjets = btnIc('Liste des objets : ordre de superposition, masquer, supprimer', LAY, 'sig4cem-pe__ic--menu');
    const btnSupp = btnIc('Supprimer cet objet', maskIc('poubelle'), 'sig4cem-pe__ic--droite');
    const sep = () => h('span', { class: 'sig4cem-pe__sep' });
    const sep2 = () => { const e = sep(); sepTexte.push(e); return e; };
    // Historique par instantanés : chaque modification validée range l'état d'avant (annuler) ; « refaire » rend l'état annulé.
    const undoS = [];
    const redoS = [];
    let editBase = null; // état de la liste quand on a commencé à modifier l'objet en cours
    const snap = () => JSON.stringify([list, mep]);
    const restaurer = (str) => { const o = JSON.parse(str); list = o[0]; mep = o[1]; disposition(); };
    const commit = (base) => { if (base != null && base !== snap()) { undoS.push(base); if (undoS.length > 80) undoS.shift(); redoS.length = 0; } };
    const sepObj = sep();
    const ligne2 = h('div', { class: 'sig4cem-pe__bar sig4cem-pe__bar--2' }, btnObjets, sepObj, btnTF, sep(), btnOutil, btnEp, btnDeb, btnTy, btnFin, btnTx, btnG, btnI, btnU, btnPos, btnAl, sep2(), btnSmaller, btnBigger, btnSupp, menuEl, nuancier);
    const root = h('section', { class: 'sig4cem-screen sig4cem-screen--editor' },
      h('div', { class: 'sig4cem-pe__bar' }, btnUndo, btnRedo, btnClear, sep(), ...toolBtns, btnOk, btnCancel),
      ligne2,
      hint,
      corps);
    document.getElementById('sig4cem-root').append(root);
    root.addEventListener('pointerdown', (e) => {
      if (!nuancier.hidden && !nuancier.contains(e.target) && !btnTF.contains(e.target)) nuancier.hidden = true;
      if (!menuEl.hidden && !menuEl.contains(e.target) && !(menuBtn && menuBtn.contains(e.target))) fermerMenu();
    });
    const txVide = (x) => !!x.tx && !(x.txt || []).some((sg) => String(sg.t).trim()) && !x.c && !x.fc;
    const propre = () => JSON.stringify([list.filter((t) => t.t !== 'gomme' && !txVide(t)), mep]);
    let etatInitial = propre();

    function fit() {
      const ratio = img.naturalHeight / img.naturalWidth || 0.75;
      canvas.width = W;
      canvas.height = Math.round(W * ratio);
      convertirAnciens();
      disposition();
      redraw();
      refresh();
      if (opts && opts.outil === 'mep' && tool !== 'mep') { dernierDessin = tool; tool = 'mep'; mepEntry = { base: snap(), n: undoS.length }; disposition(); refresh(); }
    }
    function redraw() {
      const ctx = canvas.getContext('2d');
      const poly = polyDraft && polyDraft.length > 1 ? [{ t: 'poly', c: color, w: EPAISSEURS[reg.ellipse.ep], p: polyDraft, cl: false, ed: reg.ellipse.d, ef: reg.ellipse.f }] : [];
      const dr = draft && draft.tx && !draft.c ? Object.assign({}, draft, { c: '#1e88e5', ty: 'tirets', w: 0.003 }) : draft; // cadre provisoire en pointillés pendant le tracé
      render(ctx, canvas.width, canvas.height, (dr ? list.concat([dr]) : list).concat(poly), false, edit);
      const cw = canvas.width, ch = canvas.height, k = kEcr();
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
      if (tool === 'gomme' && gommePos) {
        ctx.setLineDash([]);
        ctx.lineWidth = 1.4 * k;
        ctx.beginPath();
        ctx.arc(gommePos[0], gommePos[1], GOMMES[reg.gomme.ep] * cw, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      placePoignees();
    }
    function refresh() {
      const verrou = !!(polyDraft || (edit && tool !== 'select'));
      for (const b of toolBtns) { const actif = b.dataset.tool === 'text' ? tool === 'text' : b.dataset.tool === 'select' ? tool === 'select' : b.dataset.tool === 'mep' ? tool === 'mep' : tool !== 'text' && tool !== 'select' && tool !== 'mep'; b.classList.toggle('sig4cem-pe__ic--on', actif); b.disabled = verrou && !actif; }
      opaVal.textContent = `${Math.round(opacity * 100)} %`;
      btnRedo.disabled = !redoS.length || verrou;
      const tx = texteCtx();
      const T = outil();
      const r = reg[T];
      const formes = T === 'ellipse' || tx;
      if (tx && !['texte', 'trait', 'fond'].includes(cible)) cible = 'texte';
      if (!tx && cible === 'texte') cible = 'trait';
      if (!formes) cible = 'trait';
      btnOutil.hidden = !r || tool === 'select';
      btnEp.hidden = !r && T !== 'text';
      btnTy.hidden = btnDeb.hidden = btnFin.hidden = !r || tx || T === 'gomme';
      btnTF.disabled = T === 'gomme';
      btnTx.hidden = !(tool === 'ellipse' && reg.ellipse.kind === 'rect');
      btnTx.classList.toggle('sig4cem-pe__ic--on', !!reg.ellipse.tx);
      btnTx.disabled = verrou;
      onglets.hidden = !tx;
      for (const b of ongletBtns) b.classList.toggle('sig4cem-pe__onglet--on', b.dataset.cible === cible);
      // réglages sans objet pour la forme choisie : grisés (la ligne ne bouge pas)
      const termOk = !!(r && r.d && (!formes || (edit ? edit.t === 'poly' && !edit.cl : r.kind === 'poly')));
      btnDeb.disabled = btnFin.disabled = !termOk;
      btnTF.innerHTML = tfSvg();
      btnTF.title = tx ? `Couleurs : texte, cadre, fond (on modifie : ${cible === 'texte' ? 'le texte' : cible === 'fond' ? 'le fond' : 'le cadre'})` : `Couleur du trait / du remplissage (on modifie : ${cible === 'fond' ? 'le remplissage' : 'le trait'})`;
      btnAucun.hidden = !(cible === 'fond' || (tx && cible === 'trait'));
      btnAucun.title = cible === 'fond' ? 'Aucun remplissage' : 'Aucun cadre';
      const courante = cible === 'fond' ? (edit && tx ? edit.fc : fillColor) : cible === 'texte' ? (edit && tx ? edit.tc : textColor) : (edit && tx ? edit.c : color);
      for (const b of colorBtns) b.classList.toggle('sig4cem-pe__color--on', b.dataset.color === courante);
      btnAucun.classList.toggle('sig4cem-pe__color--on', !courante);
      btnOutil.disabled = verrou;
      const so = SOUS_OUTILS.find((k) => k[0] === sousOutil());
      if (so) { btnOutil.innerHTML = so[2]; btnOutil.title = `Outil : ${so[1]}`; }
      btnUndo.disabled = !undoS.length && !polyDraft && !edit;
      btnClear.disabled = verrou || !list.length;
      btnOk.disabled = verrou || propre() === etatInitial;
      btnObjets.hidden = sepObj.hidden = tool !== 'select';
      sepObj.hidden = tool !== 'select' || !edit;
      btnObjets.disabled = !list.length;
      btnObjets.classList.toggle('sig4cem-pe__ic--on', !objetsEl.hidden);
      btnSupp.hidden = !(tool === 'select' && edit);
      btnCancel.disabled = verrou;
      btnEp.innerHTML = maskIc('epaisseur');
      btnEp.title = `Épaisseur du trait (${NOM_EP[(r || reg.ellipse).ep]})`;
      if (r) {
        if (r.ty) { btnTy.innerHTML = icTy(r.ty); btnTy.title = `Type de trait (${r.ty})`; }
        if (r.d) {
          btnDeb.innerHTML = svgIc(finIc(r.d, false));
          btnFin.innerHTML = svgIc(finIc(r.f, true));
          btnDeb.title = `Terminaison du début (${TITRES_T[r.d]})`;
          btnFin.title = `Terminaison de la fin (${TITRES_T[r.f]})`;
        }
      }
      btnSmaller.hidden = btnBigger.hidden = !tx;
      for (const b of sousTexte) b.hidden = !tx;
      sepTexte.forEach((e) => { e.hidden = !tx; });
      const it = edit && edit.tx ? edit : null;
      const al = it ? it.al || 'g' : stT.al;
      const cur = it ? it.s : stT.s;
      btnAl.innerHTML = svgIc(ALIGN[al]);
      btnAl.title = `Alignement du texte (${NOM_AL[al]})`;
      btnG.disabled = btnI.disabled = btnU.disabled = btnPos.disabled = !tbox;
      btnSmaller.disabled = cur <= MIN_S + 1e-6;
      btnBigger.disabled = cur >= MAX_S - 1e-6;
      if (tool === 'select' && !edit) { for (const b of [btnTF, btnEp, btnTy, btnDeb, btnFin, btnTx, btnOutil, btnSmaller, btnBigger, ...sousTexte]) b.hidden = true; sepTexte.forEach((e) => { e.hidden = true; }); ligne2.querySelectorAll('.sig4cem-pe__sep').forEach((e) => { e.hidden = true; }); }
      const em = tool === 'mep';
      for (const b of mepBtns) b.hidden = !em;
      if (em) {
        for (const b of [btnTF, btnEp, btnTy, btnDeb, btnFin, btnTx, btnOutil, btnSmaller, btnBigger, btnObjets, btnSupp, ...sousTexte]) b.hidden = true;
        ligne2.querySelectorAll('.sig4cem-pe__sep').forEach((e) => { e.hidden = e !== sepMep; });
        btnLibre.classList.toggle('sig4cem-pe__ic--on', sousMep === 'libre');
        btnCrop.classList.toggle('sig4cem-pe__ic--on', sousMep === 'crop');
        btnReset.disabled = mepNormal(mep, srcW(), srcH()) == null;
      }
      majFormats();
      if (!objetsEl.hidden) majObjets();
      const selVide = tool === 'select' && !edit && objetsEl.hidden;
      hint.hidden = !((tool === 'text' && !edit) || tool === 'gomme' || selVide || em);
      hint.textContent = hint.hidden ? '' : em ? (sousMep === 'libre' ? 'Deux doigts sur la photo : pivoter, zoomer, déplacer.' : 'Déplacez les poignées du cadre. Appui long sur le recadrage : proportions standard.') : tool === 'gomme' ? 'Passez la gomme sur un tracé au crayon pour en effacer une partie.' : tool === 'select' ? (list.some((t) => !t.hid) || list.length ? 'Touchez un objet pour le sélectionner, ou ouvrez la liste des objets.' : 'Aucun objet à sélectionner pour le moment.') : 'Tracez ou touchez la photo pour poser une boîte de texte.';
    }
    // ---- Boîtes de texte : un rectangle dont l'intérieur se saisit au clavier. Une couleur et une taille par boîte,
    // mais des formats mélangeables (gras, italique, souligné, indice, exposant) : texte = [{ t, b, i, u, x }].
    let tbox = null; // zone de saisie de la boîte en cours d'édition : { el, body }
    let focusPlan = false;
    function segsVersDom(segs, body) {
      body.textContent = '';
      for (const sg of segs) {
        String(sg.t).split('\n').forEach((m, k) => {
          if (k) body.append(document.createElement('br'));
          if (!m) return;
          let n = document.createTextNode(m);
          for (const [cle, tag] of [['u', 'u'], ['i', 'i'], ['b', 'b']]) if (sg[cle]) { const e = document.createElement(tag); e.append(n); n = e; }
          if (sg.x) { const e = document.createElement(sg.x); e.append(n); n = e; }
          body.append(n);
        });
      }
    }
    function domVersSegs(body) {
      const out = [];
      const push = (t, f) => {
        if (!t) return;
        const sg = { t };
        if (f.b) sg.b = 1;
        if (f.i) sg.i = 1;
        if (f.u) sg.u = 1;
        if (f.x) sg.x = f.x;
        const l = out[out.length - 1];
        if (l && l.b === sg.b && l.i === sg.i && l.u === sg.u && l.x === sg.x) l.t += t; else out.push(sg);
      };
      const walk = (n, f) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) push(c.nodeValue.replace(/[\u00a0\u200b]/g, (m) => (m === '\u200b' ? '' : ' ')), f);
          else if (c.nodeName === 'BR') push('\n', f);
          else if (c.nodeType === 1) {
            const g = Object.assign({}, f), tag = c.nodeName, st = c.style || {};
            if (tag === 'B' || tag === 'STRONG') g.b = 1; else if (tag === 'I' || tag === 'EM') g.i = 1; else if (tag === 'U') g.u = 1; else if (tag === 'SUB') g.x = 'sub'; else if (tag === 'SUP') g.x = 'sup';
            if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) g.b = 1;
            if (st.fontStyle === 'italic') g.i = 1;
            if (/underline/.test(st.textDecorationLine || st.textDecoration || '')) g.u = 1;
            if ((tag === 'DIV' || tag === 'P') && out.length && !/\n$/.test(out[out.length - 1].t)) push('\n', f);
            walk(c, g);
          }
        }
      };
      walk(body, {});
      return out;
    }
    function detruireTbox() { if (tbox) { tbox.el.remove(); tbox = null; } }
    function creerTbox(t) {
      detruireTbox();
      const body = h('div', { class: 'sig4cem-pe__tb-body', contenteditable: 'true', spellcheck: 'false', role: 'textbox', 'aria-label': 'Texte de la boîte', 'aria-multiline': 'true' });
      segsVersDom(t.txt || [], body);
      const el = h('div', { class: 'sig4cem-pe__tbox' }, body);
      stage.append(el);
      tbox = { el, body };
      body.addEventListener('beforeinput', (e) => { if (e.inputType === 'insertParagraph') { e.preventDefault(); if (!document.execCommand('insertLineBreak')) document.execCommand('insertHTML', false, '<br>'); } });
      body.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); });
      body.addEventListener('input', () => { t.txt = domVersSegs(body); ajusterHauteur(); redraw(); refresh(); });
      body.addEventListener('focus', () => refresh());
    }
    // La hauteur dessinée est un minimum : si le texte déborde, la boîte grandit vers le bas (le haut reste fixe).
    function ajusterHauteur() {
      if (!tbox || !edit || !canvas.clientWidth) return;
      const f = canvas.clientWidth / canvas.width;
      const need = tbox.body.offsetHeight / f;
      const g = geom(edit, canvas.width, canvas.height);
      if (need > g.hh * 2 + 0.5) {
        const dh = (need - g.hh * 2) / 2, d = tourne(0, dh, g.r);
        const cx = g.cx + d[0], cy = g.cy + d[1], hh = g.hh + dh;
        edit.a = fromPx(cx - g.hw, cy - hh);
        edit.b = fromPx(cx + g.hw, cy + hh);
      }
    }
    function placeTbox() {
      if (!tbox || !edit) return;
      const f = canvas.clientWidth / canvas.width;
      const g = geom(edit, canvas.width, canvas.height);
      const st = tbox.el.style;
      st.left = `${(g.cx - g.hw) * f}px`;
      st.top = `${(g.cy - g.hh) * f}px`;
      st.width = `${g.hw * 2 * f}px`;
      st.height = `${g.hh * 2 * f}px`;
      st.transform = `rotate(${g.r}rad)`;
      st.fontSize = `${Math.max(8, edit.s * canvas.clientWidth)}px`;
      st.color = edit.tc || '#e53935';
      st.opacity = edit.o == null ? 1 : edit.o;
      st.textAlign = edit.al === 'c' ? 'center' : edit.al === 'd' ? 'right' : 'left';
      tbox.el.classList.toggle('sig4cem-pe__tbox--halo', !edit.fc);
    }
    // Formats : appliqués à la sélection (ou à la suite de la frappe) par le navigateur ; la boîte garde le focus.
    function selDansBoite() { const sel = window.getSelection(); return !!(tbox && sel && sel.rangeCount && tbox.body.contains(sel.anchorNode)); }
    function exec(cmd) {
      if (!tbox) return;
      if (!selDansBoite()) { tbox.body.focus(); const r = document.createRange(); r.selectNodeContents(tbox.body); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      document.execCommand(cmd);
      tbox.body.focus();
      majFormats();
    }
    // État d'un format au curseur : on lit les balises autour de la sélection (queryCommandState seul est peu fiable pour indice/exposant).
    const BALISES = { bold: ['B', 'STRONG'], italic: ['I', 'EM'], underline: ['U'], subscript: ['SUB'], superscript: ['SUP'] };
    const etat = (cmd) => {
      if (!selDansBoite()) return false;
      for (let n = window.getSelection().getRangeAt(0).startContainer; n && n !== tbox.body; n = n.parentNode) if (n.nodeType === 1 && BALISES[cmd].includes(n.nodeName)) return true;
      try { return document.queryCommandState(cmd); } catch (_) { return false; }
    };
    function majFormats() {
      btnG.classList.toggle('sig4cem-pe__ic--on', etat('bold'));
      btnI.classList.toggle('sig4cem-pe__ic--on', etat('italic'));
      btnU.classList.toggle('sig4cem-pe__ic--on', etat('underline'));
      const x = etat('subscript') ? 'sub' : etat('superscript') ? 'sup' : 'norm';
      btnPos.innerHTML = `<span class="sig4cem-pe__t">${x === 'sub' ? 'x<sub>2</sub>' : x === 'sup' ? 'x<sup>2</sup>' : 'x'}</span>`;
      btnPos.classList.toggle('sig4cem-pe__ic--on', x !== 'norm');
    }
    document.addEventListener('selectionchange', majFormats);
    btnG.addEventListener('click', () => exec('bold'));
    btnI.addEventListener('click', () => exec('italic'));
    btnU.addEventListener('click', () => exec('underline'));
    function sortirPos() {
      const sel = window.getSelection();
      let el = null;
      for (let n = sel.getRangeAt(0).startContainer; n && n !== tbox.body; n = n.parentNode) if (n.nodeType === 1 && (n.nodeName === 'SUB' || n.nodeName === 'SUP')) el = n;
      if (!el) return;
      const z = document.createTextNode('\u200b');
      el.after(z);
      const r = document.createRange();
      r.setStart(z, 1);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    btnPos.classList.add('sig4cem-pe__ic--menu');
    btnPos.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!tbox) return;
      const cur = etat('subscript') ? 'sub' : etat('superscript') ? 'sup' : 'norm';
      ouvrirMenu(btnPos, [['norm', 'Normal', 'x'], ['sub', 'Indice', 'x<sub>2</sub>'], ['sup', 'Exposant', 'x<sup>2</sup>']].map(([val, titre, g]) => ({ val, titre, ic: `<span class="sig4cem-pe__t">${g}</span>`, texte: titre })), cur, (v) => {
        if (v === cur) return;
        if (!selDansBoite()) tbox.body.focus();
        const sel = window.getSelection();
        if (cur !== 'norm' && sel.rangeCount && sel.getRangeAt(0).collapsed) sortirPos(); // curseur seul : on sort de l'indice / de l'exposant
        else if (cur === 'sub') exec('subscript'); else if (cur === 'sup') exec('superscript');
        if (v === 'sub') exec('subscript'); else if (v === 'sup') exec('superscript');
        if (tbox) { edit.txt = domVersSegs(tbox.body); ajusterHauteur(); redraw(); }
        refresh();
      });
    });
    btnTx.addEventListener('click', () => { if (edit) return; reg.ellipse.tx = !reg.ellipse.tx; nuancier.hidden = true; fermerMenu(); refresh(); });
    const appliquerTaille = (f) => {
      const it = edit && edit.tx ? edit : null;
      const v = Math.min(MAX_S, Math.max(MIN_S, (it ? it.s : stT.s) * f));
      stT.s = v;
      if (it) { it.s = v; placeTbox(); ajusterHauteur(); redraw(); }
      refresh();
    };
    btnBigger.addEventListener('click', () => appliquerTaille(1.2));
    btnSmaller.addEventListener('click', () => appliquerTaille(1 / 1.2));
    btnAl.addEventListener('click', () => {
      const it = edit && edit.tx ? edit : null;
      stT.al = suivant(['g', 'c', 'd'], it ? it.al || 'g' : stT.al);
      if (it) { it.al = stT.al; redraw(); }
      refresh();
    });
    // Les boutons de la barre ne prennent pas le focus (la sélection du texte reste active dans la boîte).
    root.addEventListener('mousedown', (e) => { if (e.target.closest && e.target.closest('.sig4cem-pe__ic')) e.preventDefault(); });
    window.addEventListener('resize', () => { disposition(); redraw(); });
    // Conversion des anciens textes (zone libre) en boîtes de texte sans cadre, à l'ouverture.
    function convertirAnciens() {
      if (!list.some((t) => t.t === 'text')) return;
      const ctx = canvas.getContext('2d');
      list = list.map((t) => {
        if (t.t !== 'text') return t;
        const size = Math.max(10, t.s * canvas.width), pad = size * 0.3;
        const lignes = String(t.txt || '').split('\n');
        ctx.font = `${t.i ? 'italic ' : ''}${t.b === false ? '' : 'bold '}${size}px sans-serif`;
        const maxL = Math.max(0, ...lignes.map((l) => ctx.measureText(l).width));
        const sg = { t: String(t.txt || '') };
        if (t.b !== false) sg.b = 1;
        if (t.i) sg.i = 1;
        if (t.u) sg.u = 1;
        const n = { t: 'rect', c: null, w: EPAISSEURS[1], a: [t.x - pad / canvas.width, t.y - pad / canvas.height], b: [t.x + (maxL + pad + 4) / canvas.width, t.y + (lignes.length * size * 1.2 + pad) / canvas.height], tx: true, tc: t.c, s: t.s, txt: [sg] };
        if (t.al && t.al !== 'g') n.al = t.al;
        if (t.o != null) n.o = t.o;
        return n;
      });
      etatInitial = propre();
    }

    // Gomme : retire, dans les tracés au crayon, la partie qui passe à moins du rayon de la gomme ; le tracé est coupé en morceaux qui gardent son style.
    // Chaque modification est notée dans le marqueur `m` : { i, a: tracés remplacés, b: morceaux }, pour que « Annuler » rende le dessin.
    function gommer(q0, q1, m) {
      const r = GOMMES[reg.gomme.ep] * canvas.width, r2 = r * r;
      const x0 = Math.min(q0[0], q1[0]) - r, x1 = Math.max(q0[0], q1[0]) + r, y0 = Math.min(q0[1], q1[1]) - r, y1 = Math.max(q0[1], q1[1]) + r;
      const vx = q1[0] - q0[0], vy = q1[1] - q0[1], L = vx * vx + vy * vy;
      const proche = (x, y) => {
        const u = L ? Math.max(0, Math.min(1, ((x - q0[0]) * vx + (y - q0[1]) * vy) / L)) : 0;
        const dx = x - (q0[0] + u * vx), dy = y - (q0[1] + u * vy);
        return dx * dx + dy * dy < r2;
      };
      for (let i = list.length - 1; i >= 0; i--) {
        const t = list[i];
        if (t.t !== 'pen' || t.hid) continue;
        const P = t.p.map(([x, y]) => [x * canvas.width, y * canvas.height]);
        const pts = [{ x: P[0][0], y: P[0][1], e: proche(P[0][0], P[0][1]) }];
        for (let j = 1; j < P.length; j++) {
          const [ax, ay] = P[j - 1], [bx, by] = P[j];
          if (Math.max(ax, bx) >= x0 && Math.min(ax, bx) <= x1 && Math.max(ay, by) >= y0 && Math.min(ay, by) <= y1) {
            const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (r / 4)));
            for (let k = 1; k <= n; k++) { const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n; pts.push({ x, y, e: proche(x, y) }); }
          } else pts.push({ x: bx, y: by, e: false });
        }
        if (!pts.some((o) => o.e)) continue;
        const morceaux = [];
        let cur = [];
        pts.forEach((o, k) => {
          if (o.e) { if (cur.length) morceaux.push({ pts: cur, debut: cur[0] === pts[0], fin: false }); cur = []; } else cur.push(o);
          if (k === pts.length - 1 && cur.length) morceaux.push({ pts: cur, debut: cur[0] === pts[0], fin: true });
        });
        const nouveaux = morceaux.filter((o) => o.pts.length >= 2).map((o) => {
          const n = JSON.parse(JSON.stringify(t));
          n.p = o.pts.map((q) => fromPx(q.x, q.y));
          if (!o.debut) delete n.ed;
          if (!o.fin) delete n.ef;
          return n;
        });
        list.splice(i, 1, ...nouveaux);
        m.ch.push({ i, a: [t], b: nouveaux });
      }
    }

    const pos = (e) => {
      const r = frame.getBoundingClientRect(), p = M.inverse().transformPoint(new DOMPoint(e.clientX - r.left, e.clientY - r.top));
      return [Math.min(1, Math.max(0, p.x / sw)), Math.min(1, Math.max(0, p.y / sh))];
    };
    // Pixels du dessin par pixel d'écran (le zoom et la rotation d'affichage sont dans la matrice M).
    const kEcr = () => canvas.width / (canvas.clientWidth || canvas.width) / sTot;

    // ---- Affichage : la photo et son calque sont dans `stage` (repère de la photo entière) ; la matrice M le place dans `frame`
    // (mise en page + zoom d'affichage). En mode « Mise en page / cadre », on voit la photo entière pivotée avec le cadre par-dessus.
    const srcW = () => img.naturalWidth || 1, srcH = () => img.naturalHeight || 1;
    const mepEff = () => mep || mepDefaut(srcW(), srcH());
    const modeCadre = () => tool === 'mep' && sousMep === 'crop';
    function disposition() {
      const br = corps.getBoundingClientRect();
      bw = br.width; bh = br.height;
      if (!bw || !bh) return;
      const pad = 4, ratio = srcH() / srcW(), m = mepEff();
      sw = Math.max(1, Math.min(bw - 2 * pad, (bh - 2 * pad) / ratio)); sh = sw * ratio;
      stage.style.width = `${sw}px`; stage.style.height = `${sh}px`;
      const sc = [sw / 2, sh / 2];
      if (modeCadre()) {
        const rad = m.a * Math.PI / 180, cw = Math.abs(Math.cos(rad)) * sw + Math.abs(Math.sin(rad)) * sh, ch = Math.abs(Math.sin(rad)) * sw + Math.abs(Math.cos(rad)) * sh;
        sBase = Math.min((bw - 2 * pad) / cw, (bh - 2 * pad) / ch);
        fr = { x: 0, y: 0, w: bw, h: bh };
        M = new DOMMatrix().translate(bw / 2, bh / 2).scale(sBase).rotate(m.a).translate(-sc[0], -sc[1]);
      } else {
        const Fw = m.w * sw, Fh = m.h * sw, s0 = Math.min((bw - 2 * pad) / Fw, (bh - 2 * pad) / Fh);
        sBase = s0;
        fr = { x: (bw - Fw * s0) / 2, y: (bh - Fh * s0) / 2, w: Fw * s0, h: Fh * s0 };
        M = new DOMMatrix().translate(fr.w / 2, fr.h / 2).scale(s0).translate(-m.c[0] * sw, -m.c[1] * sw).rotate(m.a).translate(-sc[0], -sc[1]);
        if (vz.z !== 1) M = new DOMMatrix().translate(vz.tx, vz.ty).scale(vz.z).multiply(M);
      }
      sTot = Math.hypot(M.a, M.b);
      thTot = Math.atan2(M.b, M.a);
      Object.assign(frame.style, { left: `${fr.x}px`, top: `${fr.y}px`, width: `${fr.w}px`, height: `${fr.h}px` });
      stage.style.transform = M.toString();
      canvas.style.pointerEvents = tool === 'mep' ? 'none' : '';
      badgeZoom.hidden = !(vz.z > 1.001 && tool !== 'mep');
      badgeZoom.textContent = `⤢ ${Math.round(vz.z * 100)} %`;
      majCadre();
      if (typeof placePoignees === 'function' && canvas.width > 1) placePoignees();
    }
    const badgeZoom = h('button', { type: 'button', class: 'sig4cem-pe__zoom', title: 'Revenir à la photo entière', hidden: '' });
    badgeZoom.addEventListener('click', () => { vz.z = 1; vz.tx = vz.ty = 0; disposition(); });
    frame.append(badgeZoom);
    const gridLibre = h('div', { class: 'sig4cem-pe__grille', hidden: '' });
    // Curseur d'angle (écran non tactile, ou réglage fin) : −180° à +180°, zéro au centre ; la rotation se fait autour du centre du cadre.
    const rotRange = h('input', { type: 'range', min: '-180', max: '180', step: '0.5', value: '0', 'aria-label': 'Angle de rotation en degrés' });
    const rotVal = h('button', { type: 'button', class: 'sig4cem-pe__rot-val', title: 'Remettre à 0°' });
    const rotBar = h('div', { class: 'sig4cem-pe__rot', hidden: '' }, h('div', { class: 'sig4cem-pe__rot-t' }, h('span', { text: '−180°' }), rotVal, h('span', { text: '+180°' })), rotRange);
    frame.append(rotBar);
    let rotBase = null;
    function fixerAngle(a1, final) {
      const m = mepEff();
      if (rotBase == null) rotBase = snap();
      const pas = 45, reste = ((a1 % pas) + pas) % pas;
      if (Math.min(reste, pas - reste) < 0.3) a1 = Math.round(a1 / pas) * pas; // aimant à 0, ±45, ±90°…
      const d = (a1 - m.a) * Math.PI / 180, co = Math.cos(d), si = Math.sin(d);
      mep = { v: MEP_VERSION, a: normAngle(a1), c: [m.c[0] * co - m.c[1] * si, m.c[0] * si + m.c[1] * co], w: m.w, h: m.h }; // le point de la photo au centre du cadre y reste
      if (final) { mep = mepNormal(contenirMep(mep, srcW(), srcH()), srcW(), srcH()); commit(rotBase); rotBase = null; refresh(); }
      disposition();
    }
    rotRange.addEventListener('input', () => fixerAngle(Number(rotRange.value), false));
    rotRange.addEventListener('change', () => fixerAngle(Number(rotRange.value), true));
    rotVal.addEventListener('click', () => fixerAngle(0, true));
    const angleEl = h('div', { class: 'sig4cem-pe__angle', hidden: '' });
    frame.append(gridLibre, angleEl);

    // ---- Cadre de recadrage (mode Mise en page / cadre) : rectangle à poignées par-dessus la photo entière pivotée.
    const cadreEl = h('div', { class: 'sig4cem-pe__crop', hidden: '' });
    const cadreInfo = h('div', { class: 'sig4cem-pe__crop-info' });
    const cadreH = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].map(([sx, sy]) => { const e = h('span', { class: 'sig4cem-pe__crop-h' + (sx && sy ? ' sig4cem-pe__crop-h--c' : '') }); e.dataset.sx = sx; e.dataset.sy = sy; e.style.left = `${(sx + 1) * 50}%`; e.style.top = `${(sy + 1) * 50}%`; return e; });
    cadreEl.append(...cadreH, cadreInfo);
    frame.append(cadreEl);
    const rectCadre = () => { const m = mepEff(); return { x: bw / 2 + sBase * m.c[0] * sw - sBase * m.w * sw / 2, y: bh / 2 + sBase * m.c[1] * sw - sBase * m.h * sw / 2, w: sBase * m.w * sw, h: sBase * m.h * sw }; };
    const mepDepuisRect = (r) => ({ v: MEP_VERSION, a: mepEff().a, c: [(r.x + r.w / 2 - bw / 2) / sBase / sw, (r.y + r.h / 2 - bh / 2) / sBase / sw], w: r.w / sBase / sw, h: r.h / sBase / sw });
    function majCadre() {
      cadreEl.hidden = !modeCadre();
      gridLibre.hidden = !(tool === 'mep' && sousMep === 'libre');
      angleEl.hidden = gridLibre.hidden;
      rotBar.hidden = gridLibre.hidden;
      if (!rotBar.hidden) { rotRange.value = String(mepEff().a); rotVal.textContent = `${mepEff().a > 0 ? '+' : mepEff().a < 0 ? '−' : ''}${Math.abs(mepEff().a).toFixed(1).replace('.', ',')}°`; }
      if (!gridLibre.hidden) angleEl.textContent = `${mepEff().a >= 0 ? '+' : '−'}${Math.abs(mepEff().a).toFixed(1).replace('.', ',')}°`;
      if (cadreEl.hidden) return;
      const r = rectCadre();
      Object.assign(cadreEl.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      const m = mepEff();
      cadreInfo.textContent = `${Math.round(m.w * srcW())} × ${Math.round(m.h * srcW())}`;
      for (const e of cadreH) e.hidden = !!ratioCadre && (!Number(e.dataset.sx) || !Number(e.dataset.sy));
    }
    let cadreDrag = null;
    cadreEl.addEventListener('pointerdown', (e) => {
      if (!modeCadre()) return;
      e.preventDefault(); e.stopPropagation();
      cadreEl.setPointerCapture(e.pointerId);
      const hd = e.target.closest('.sig4cem-pe__crop-h');
      const br = corps.getBoundingClientRect();
      cadreDrag = { sx: hd ? Number(hd.dataset.sx) : 0, sy: hd ? Number(hd.dataset.sy) : 0, move: !hd, r0: rectCadre(), p0: [e.clientX - br.left, e.clientY - br.top], base: snap() };
      if (!mep) mep = mepDefaut(srcW(), srcH());
    });
    cadreEl.addEventListener('pointermove', (e) => {
      if (!cadreDrag) return;
      e.preventDefault();
      const br = corps.getBoundingClientRect(), d = cadreDrag, dx = e.clientX - br.left - d.p0[0], dy = e.clientY - br.top - d.p0[1], r0 = d.r0, MIN = 36;
      let r;
      if (d.move) r = { x: Math.min(bw - r0.w, Math.max(0, r0.x + dx)), y: Math.min(bh - r0.h, Math.max(0, r0.y + dy)), w: r0.w, h: r0.h };
      else {
        let x0 = r0.x, x1 = r0.x + r0.w, y0 = r0.y, y1 = r0.y + r0.h;
        if (d.sx === -1) x0 = Math.min(x1 - MIN, r0.x + dx); else if (d.sx === 1) x1 = Math.max(x0 + MIN, r0.x + r0.w + dx);
        if (d.sy === -1) y0 = Math.min(y1 - MIN, r0.y + dy); else if (d.sy === 1) y1 = Math.max(y0 + MIN, r0.y + r0.h + dy);
        if (ratioCadre && d.sx && d.sy) { // proportion verrouillée : on suit la plus grande variation, le coin opposé reste fixe
          const w = Math.max(MIN, Math.max(x1 - x0, (y1 - y0) * ratioCadre)), hh = w / ratioCadre;
          if (d.sx === -1) x0 = x1 - w; else x1 = x0 + w;
          if (d.sy === -1) y0 = y1 - hh; else y1 = y0 + hh;
        }
        r = { x: Math.max(0, x0), y: Math.max(0, y0), w: Math.min(bw, x1) - Math.max(0, x0), h: Math.min(bh, y1) - Math.max(0, y0) };
      }
      mep = mepDepuisRect(r);
      majCadre();
    });
    const finCadre = () => {
      if (!cadreDrag) return;
      const base = cadreDrag.base;
      cadreDrag = null;
      mep = mepNormal(contenirMep(mepEff(), srcW(), srcH()), srcW(), srcH());
      commit(base);
      disposition(); refresh();
    };
    cadreEl.addEventListener('pointerup', finCadre);
    cadreEl.addEventListener('pointercancel', finCadre);

    // ---- Gestes à deux doigts (et molette) : zoom d'affichage ; en transformation libre, rotation + zoom + déplacement de la photo.
    const ptrs = new Map();
    let geste = null;
    const milieu = () => { const r = frame.getBoundingClientRect(), p = [...ptrs.values()]; const a = p[0], b = p[1] || p[0]; return { x: (a[0] + b[0]) / 2 - r.left, y: (a[1] + b[1]) / 2 - r.top, d: p[1] ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0, ang: p[1] ? Math.atan2(b[1] - a[1], b[0] - a[0]) : 0 }; };
    const libreActif = () => tool === 'mep' && sousMep === 'libre';
    function debutGeste() {
      const g = milieu();
      geste = { m0: g, z0: vz.z, tx0: vz.tx, ty0: vz.ty, M0: M, mep0: mepDefautSiNul(), base: snap(), libre: libreActif(), n: ptrs.size };
      if (!geste.libre) { draft = null; drag = null; guide = null; redraw(); }
    }
    const mepDefautSiNul = () => JSON.parse(JSON.stringify(mepEff()));
    function suiteGeste() {
      const g = milieu(), G = geste;
      const k = G.m0.d > 8 && g.d > 0 ? g.d / G.m0.d : 1;
      if (!G.libre) {
        const z = Math.min(8, Math.max(1, G.z0 * k)), kk = z / G.z0;
        vz.z = z;
        vz.tx = z <= 1.001 ? 0 : g.x + kk * (G.tx0 - G.m0.x);
        vz.ty = z <= 1.001 ? 0 : g.y + kk * (G.ty0 - G.m0.y);
        if (z <= 1.001) { vz.z = 1; }
        disposition(); redraw();
        return;
      }
      const dA = G.m0.d > 8 && g.d > 0 ? g.ang - G.m0.ang : 0;
      const Mn = new DOMMatrix().translate(g.x, g.y).rotate(dA * 180 / Math.PI).scale(k).translate(-G.m0.x, -G.m0.y).multiply(G.M0);
      const s1 = Math.hypot(Mn.a, Mn.b);
      let a1 = Math.atan2(Mn.b, Mn.a) * 180 / Math.PI;
      const pas = 45, reste = ((a1 % pas) + pas) % pas;
      if (Math.min(reste, pas - reste) < 1.2) a1 = Math.round(a1 / pas) * pas; // aimant à 0, 45, 90°…
      const p0 = Mn.inverse().transformPoint(new DOMPoint(fr.w / 2, fr.h / 2)), th = a1 * Math.PI / 180;
      const qx = p0.x - sw / 2, qy = p0.y - sh / 2;
      mep = { v: MEP_VERSION, a: normAngle(a1), c: [(qx * Math.cos(th) - qy * Math.sin(th)) / sw, (qx * Math.sin(th) + qy * Math.cos(th)) / sw], w: fr.w / s1 / sw, h: fr.h / s1 / sw };
      disposition();
    }
    frame.addEventListener('pointerdown', (e) => {
      if (e.target.closest && e.target.closest('.sig4cem-pe__rot, .sig4cem-pe__zoom')) return; // curseur d'angle et bandeau de zoom : leurs propres commandes
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2 || (libreActif() && ptrs.size === 1)) {
        if (libreActif() && ptrs.size === 1) { try { frame.setPointerCapture(e.pointerId); } catch (_) { /* ignoré */ } }
        e.preventDefault(); e.stopPropagation();
        debutGeste();
      }
    }, true);
    frame.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (geste) { e.preventDefault(); e.stopPropagation(); suiteGeste(); }
    }, true);
    const finPtr = (e) => {
      if (!ptrs.delete(e.pointerId) || !geste) return;
      if (ptrs.size >= 1 && geste.libre) { debutGeste(); return; } // un doigt en moins : on repart de l'état courant
      const G = geste;
      geste = null;
      if (G.libre) { mep = mepNormal(contenirMep(mepEff(), srcW(), srcH()), srcW(), srcH()); commit(G.base); disposition(); refresh(); }
    };
    frame.addEventListener('pointerup', finPtr, true);
    frame.addEventListener('pointercancel', finPtr, true);
    frame.addEventListener('wheel', (e) => {
      if (tool === 'mep') return;
      e.preventDefault();
      const r = frame.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const z = Math.min(8, Math.max(1, vz.z * Math.exp(-e.deltaY / 400))), kk = z / vz.z;
      vz.tx = z <= 1.001 ? 0 : x + kk * (vz.tx - x); vz.ty = z <= 1.001 ? 0 : y + kk * (vz.ty - y); vz.z = z <= 1.001 ? 1 : z;
      disposition();
    }, { passive: false });

    // ---- Boutons de la mise en page (ligne 2) : pivoter, transformation libre, recadrage (appui long : proportions), réinitialiser.
    const btnRotH = btnIc('Pivoter de 90° dans le sens horaire', maskIc('rot-horaire'));
    const btnRotA = btnIc('Pivoter de 90° dans le sens anti-horaire', maskIc('rot-antihoraire'));
    const btnLibre = btnIc('Transformation libre : pivoter de −180° à +180°, zoomer, déplacer (deux doigts)', maskIc('rot-libre'));
    const btnCrop = btnIc('Recadrer (appui long : proportions standard)', svgIc('<path d="M7 2.5v14.5h14.5"/><path d="M2.5 7H17v14.5"/>'), 'sig4cem-pe__ic--menu');
    const btnReset = btnIc('Remettre le cadrage d\'origine (photo entière, sans rotation)', svgIc('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'), 'sig4cem-pe__ic--droite');
    btnReset.addEventListener('click', () => agirMep(() => { mep = null; ratioCadre = null; vz.z = 1; vz.tx = vz.ty = 0; }));
    const sepMep = h('span', { class: 'sig4cem-pe__sep' });
    // Sortie du mode Mise en page : ✓ garde les changements, ✗ les annule tous ; on revient à l'outil précédent.
    const quitterMep = (garder) => {
      if (edit) setEdit(null);
      if (!garder && mepEntry) { undoS.length = Math.min(undoS.length, mepEntry.n); redoS.length = 0; restaurer(mepEntry.base); }
      mepEntry = null; sousMep = 'crop'; ratioCadre = null; vz.z = 1; vz.tx = vz.ty = 0;
      tool = dernierDessin;
      fermerMenu(); disposition(); refresh(); redraw();
    };
    const btnMNon = btnIc('Annuler les changements de mise en page', '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="0.835" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>');
    const btnMOk = btnIc('Valider la mise en page', '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="0.835" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l5 5 10-11"/></svg>');
    btnMNon.addEventListener('click', () => quitterMep(false));
    btnMOk.addEventListener('click', () => quitterMep(true));
    const mepBtns = [btnRotH, btnRotA, btnLibre, sepMep, btnCrop, btnReset, btnMNon, btnMOk];
    ligne2.prepend(...mepBtns);
    function agirMep(fn) {
      if (edit) setEdit(null);
      const base = snap();
      fn();
      commit(base);
      disposition(); refresh();
    }
    btnRotH.addEventListener('click', () => agirMep(() => { mep = pivoterMep(mep, 1, srcW(), srcH()); if (ratioCadre) ratioCadre = 1 / ratioCadre; vz.z = 1; }));
    btnRotA.addEventListener('click', () => agirMep(() => { mep = pivoterMep(mep, -1, srcW(), srcH()); if (ratioCadre) ratioCadre = 1 / ratioCadre; vz.z = 1; }));
    btnLibre.addEventListener('click', () => { sousMep = sousMep === 'libre' ? 'crop' : 'libre'; vz.z = 1; vz.tx = vz.ty = 0; fermerMenu(); disposition(); refresh(); });
    const RATIOS = [['libre', 'Libre'], ['orig', 'Original'], [1, '1 : 1'], [4 / 3, '4 : 3'], [3 / 2, '10 : 15'], [16 / 9, '16 : 9'], ['inv', 'Inverser portrait / paysage']];
    function appliquerRatio(v) {
      if (v === 'libre') { ratioCadre = null; refresh(); disposition(); return; }
      agirMep(() => {
        const m = mepEff(), W = srcW(), H = srcH();
        if (v === 'inv') { if (ratioCadre) ratioCadre = 1 / ratioCadre; const c = m.c.slice(); mep = contenirMep({ v: MEP_VERSION, a: m.a, c, w: m.h, h: m.w }, W, H); return; }
        const paysage = m.w >= m.h;
        let asp;
        if (v === 'orig') asp = Math.abs(Math.round(m.a / 90)) % 2 ? H / W : W / H;
        else asp = paysage ? v : 1 / v;
        ratioCadre = v === 'orig' ? null : asp;
        const cur = { w: m.w, h: m.h };
        let w = Math.min(cur.w, cur.h * asp), hh = w / asp;
        if (v === 'orig') { const ins = cadreInscrit(m.a, asp, W, H); w = ins.w; hh = ins.h; mep = { v: MEP_VERSION, a: m.a, c: [0, 0], w, h: hh }; mep = mepNormal(mep, W, H); return; }
        mep = mepNormal(contenirMep({ v: MEP_VERSION, a: m.a, c: m.c, w, h: hh }, W, H), W, H);
      });
    }
    let appuiLong = null, longFait = false;
    btnCrop.addEventListener('pointerdown', () => { longFait = false; clearTimeout(appuiLong); appuiLong = setTimeout(() => { longFait = true; ouvrirMenu(btnCrop, RATIOS.map(([val, txt]) => ({ val, titre: txt, ic: '', texte: txt })), ratioCadre ? RATIOS.find((r) => typeof r[0] === 'number' && Math.abs(Math.max(r[0], 1 / r[0]) - Math.max(ratioCadre, 1 / ratioCadre)) < 1e-3)?.[0] : 'libre', appliquerRatio); }, 450); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btnCrop.addEventListener(ev, () => clearTimeout(appuiLong));
    btnCrop.addEventListener('click', (e) => { e.stopPropagation(); if (longFait) { longFait = false; return; } sousMep = 'crop'; vz.z = 1; vz.tx = vz.ty = 0; fermerMenu(); disposition(); refresh(); });


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
      if (editBase != null) { const b = editBase; editBase = null; restaurer(b); } else { const j = list.indexOf(edit); if (j >= 0) list.splice(j, 1); }
      setEdit(null);
    });
    frame.append(pill);
    let poigns = []; // { el, kind: 'h' | 'rot' | 'move' | 'ok' | 'v', sx, sy, i }
    const cl = (t) => JSON.parse(JSON.stringify(t));
    const toPx = (p) => [p[0] * canvas.width, p[1] * canvas.height];
    const fromPx = (x, y) => [x / canvas.width, y / canvas.height];
    function setEdit(t, base) {
      if (edit && edit !== t) {
        if (txVide(edit)) { const j = list.indexOf(edit); if (j >= 0) list.splice(j, 1); } // boîte sans texte ni cadre : écartée
        commit(editBase);
        editBase = null;
      }
      if (t && edit !== t) editBase = base === undefined ? snap() : base;
      if (edit && edit !== t && document.activeElement && document.activeElement.blur) document.activeElement.blur();
      edit = t;
      guide = null;
      detruireTbox();
      if (t && t.tx) creerTbox(t);
      poigns.forEach((o) => o.el.remove());
      poigns = [];
      if (t) {
        const mk = (kind, extra) => { const el = h('span', { class: `sig4cem-pe__hd sig4cem-pe__hd--${kind}` }); const o = Object.assign({ el, kind }, extra); poigns.push(o); poign.append(el); return o; };
        if (t.t === 'poly') t.p.forEach((_, i) => mk('v', { i }));
        else if (t.t === 'arrow') [0, 1].forEach((i) => mk('v', { i }));
        else for (const [sx, sy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) mk('h', { sx, sy });
        if (t.t === 'rect' || t.t === 'ellipse') mk('rot');
        if (t.tx) mk('move');
      }
      for (const o of poigns) liePoignee(o);
      redraw();
      if (tbox) { ajusterHauteur(); redraw(); }
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
        const base = snap();
        const t = { t: 'poly', c: color, w: EPAISSEURS[r.ep], p: pts, cl: !!ferme };
        if (ferme && fillColor) t.fc = fillColor;
        if (opacity < 1) t.o = opacity;
        if (r.ty !== 'plein') t.ty = r.ty;
        if (!ferme) { t.ed = r.d; t.ef = r.f; }
        list.push(t);
        if (ferme && !silencieux) { setEdit(t, base); return; }
        commit(base);
      }
      redraw(); refresh();
    }
    // Position des poignées (px écran) : coins/côtés (carrés pleins), sommets, rotation, déplacement, ✓.
    function placePoignees() {
      const f = canvas.clientWidth / canvas.width;
      const put = (el, x, y) => { el.style.left = `${x * f}px`; el.style.top = `${y * f}px`; };
      for (const o of poigns) o.el.style.transform = `rotate(${-thTot}rad) scale(${1 / sTot})`; // les poignées gardent la même taille à l'écran
      pill.hidden = !(edit || (polyDraft && polyDraft.length > 0));
      btnFOk.hidden = !!(polyDraft && polyDraft.length < 2);
      if (!edit) return;
      placeTbox();
      let haut = [Infinity, Infinity];
      if (edit.t === 'poly' || edit.t === 'arrow') {
        const P = edit.t === 'arrow' ? [toPx(edit.a), toPx(edit.b)] : contour(edit, canvas.width, canvas.height);
        for (const o of poigns) if (o.kind === 'v' && P[o.i]) put(o.el, P[o.i][0], P[o.i][1]);
        const xs = P.map((q) => q[0]), ys = P.map((q) => q[1]);
        haut = [Math.min(...xs), Math.min(...ys)];
      } else {
        const g = geomE(edit);
        const pt = (lx, ly) => { const q = tourne(lx, ly, g.r); return [g.cx + q[0], g.cy + q[1]]; };
        for (const o of poigns) if (o.kind === 'h') { const q = pt(o.sx * g.hw, o.sy * g.hh); put(o.el, q[0], q[1]); const ar = o.el.querySelector('.sig4cem-pe__ar'); if (ar) ar.style.transform = `rotate(${g.r + thTot + (o.sx && !o.sy ? Math.PI / 2 : 0)}rad)`; }
        const dec = 28 / f / sTot;
        const d = tourne(-dec, -dec, g.r);
        haut = pt(-g.hw, -g.hh);
        haut = [haut[0] + d[0] + dec, haut[1] + d[1] + dec];
        const rotEl = poigns.find((o) => o.kind === 'rot');
        if (rotEl) { const sv = rotEl.el.querySelector('svg'); if (sv) sv.style.transform = `rotate(${g.r + thTot}rad)`; }
      }
      // rotation : sur la diagonale à 45° du coin haut-gauche (déplacer : toucher l'intérieur de la forme)
      const k = 1 / f / sTot, dec = 28 * k;
      const rot = poigns.find((o) => o.kind === 'rot');
      if (rot) {
        const rx = Math.max(16 * k, Math.min(canvas.width - 16 * k, haut[0] - dec)), ry = Math.max(16 * k, Math.min(canvas.height - 16 * k, haut[1] - dec));
        put(rot.el, rx, ry);
        const mv = poigns.find((o) => o.kind === 'move'); // boîte de texte : le symbole de déplacement juste à côté de la rotation
        if (mv) { put(mv.el, rx + 34 * k, ry); const sv = mv.el.querySelector('.sig4cem-ic'); if (sv) sv.style.transform = `rotate(${(edit.r || 0) + thTot}rad)`; }
      }
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
    function bboxPen(t) {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (const [x, y] of t.p) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      return { a: [x0, y0], b: [x1, y1] };
    }
    const geomE = (t) => geom(t.t === 'pen' ? bboxPen(t) : t, canvas.width, canvas.height);
    // Distance (px) du point (x, y) à une suite de segments.
    function distSeg(x, y, P, ferme) {
      const n = P.length;
      if (n === 1) return Math.hypot(x - P[0][0], y - P[0][1]);
      let d = Infinity;
      for (let i = 0; i < (ferme ? n : n - 1); i++) {
        const A = P[i], B = P[(i + 1) % n], vx = B[0] - A[0], vy = B[1] - A[1], L = vx * vx + vy * vy;
        const u = L ? Math.max(0, Math.min(1, ((x - A[0]) * vx + (y - A[1]) * vy) / L)) : 0;
        d = Math.min(d, Math.hypot(x - A[0] - u * vx, y - A[1] - u * vy));
      }
      return d;
    }
    function dansForme(t, p) {
      const [x, y] = toPx(p);
      const k = kEcr();
      if (t.t === 'arrow') return distSeg(x, y, [toPx(t.a), toPx(t.b)], false) < 16 * k;
      if (t.t === 'pen') { const g = geomE(t); return Math.abs(x - g.cx) <= g.hw + 12 * k && Math.abs(y - g.cy) <= g.hh + 12 * k; }
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
      if (edit.t === 'poly' || edit.t === 'pen') edit.p = orig.p.map(([x, y]) => [x + dx, y + dy]);
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
      else if (drag.mode === 'v') { if (edit.t === 'arrow') edit[drag.o.i ? 'b' : 'a'] = p; else edit.p[drag.o.i] = p; }
      else if (drag.mode === 'rot') {
        const g = geom(orig, canvas.width, canvas.height), q = toPx(p);
        let r = (orig.r || 0) + Math.atan2(q[1] - g.cy, q[0] - g.cx) - drag.a0;
        const pas = Math.PI / 4, reste = ((r % pas) + pas) % pas;
        if (Math.min(reste, pas - reste) < 0.045) r = Math.round(r / pas) * pas; // aimant à 0 / 45 / 90°
        edit.r = r;
      } else if (drag.mode === 'h') {
        const g = geomE(orig), q = toPx(p);
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
        const na = fromPx(cx - hw, cy - hh), nb = fromPx(cx + hw, cy + hh);
        if (edit.t === 'pen') { // tracé libre : mise à l'échelle des points dans le nouveau cadre
          const bb = bboxPen(orig), ox = bb.b[0] - bb.a[0], oy = bb.b[1] - bb.a[1];
          edit.p = orig.p.map(([x, y]) => [ox > 1e-6 ? na[0] + (x - bb.a[0]) * (nb[0] - na[0]) / ox : x, oy > 1e-6 ? na[1] + (y - bb.a[1]) * (nb[1] - na[1]) / oy : y]);
        } else { edit.a = na; edit.b = nb; }
      }
      redraw();
    }
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const p = pos(e);
      if (nuancier) nuancier.hidden = true;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      canvas.setPointerCapture(e.pointerId);
      fermerObjets();
      if (tool === 'select') {
        if (edit && dansForme(edit, p)) { drag = { mode: 'move', p0: p, orig: cl(edit), corps: true }; return; }
        const t = toucher(p);
        if (t && t !== edit) { selectionner(t); drag = { mode: 'move', p0: p, orig: cl(edit), corps: true }; return; }
        if (!t && edit) setEdit(null);
        return;
      }
      if (tool === 'gomme') {
        const q = toPx(p);
        drag = { mode: 'gommer', last: q, marque: { t: 'gomme', ch: [] }, base: snap() };
        gommePos = q;
        gommer(q, q, drag.marque);
        redraw();
        return;
      }
      const r = reg[tool] || (tool === 'text' ? reg.ellipse : null);
      if (tool === 'ellipse' || tool === 'text') {
        if (edit && !edit.tx && dansForme(edit, p)) { drag = { mode: 'move', p0: p, orig: cl(edit), corps: true }; return; }
        if (edit) { drag = null; return; } // la forme en cours ne se quitte que par ✓ ou ✗
        if (tool === 'ellipse' && r.kind === 'poly') { drag = { mode: 'tap', p0: p }; return; }
        const boite = tool === 'text' || (r.kind === 'rect' && r.tx);
        draft = { t: tool === 'text' ? 'rect' : r.kind, c: tool === 'text' ? null : color, w: EPAISSEURS[r.ep], a: p, b: p };
        if (boite) { draft.tx = true; draft.tc = textColor; draft.s = stT.s; draft.txt = []; if (stT.al !== 'g') draft.al = stT.al; }
        if (fillColor && tool !== 'text') draft.fc = fillColor;
        drag = { mode: 'creer', p0: p };
      } else {
        const w = EPAISSEURS[r.ep];
        draft = tool === 'pen' ? { t: 'pen', c: color, w, p: [p] } : { t: tool, c: color, w, a: p, b: p };
      }
      if (draft) {
        if (opacity < 1) draft.o = opacity;
        if (r.ty !== 'plein') draft.ty = r.ty;
        if (r.d && (tool === 'pen' || tool === 'arrow')) { draft.ed = r.d; draft.ef = r.f; }
      }
      redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (tool === 'gomme') {
        const q = toPx(pos(e));
        if (drag && drag.mode === 'gommer') { e.preventDefault(); gommer(drag.last, q, drag.marque); drag.last = q; }
        gommePos = q;
        redraw();
        return;
      }
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
      if (drag && drag.mode === 'gommer') {
        const m = drag.marque, base = drag.base;
        drag = null;
        if (m.ch.length) commit(base);
        refresh(); redraw();
        return;
      }
      if (drag && drag.mode === 'move') { drag = null; redraw(); refresh(); return; }
      if (drag && drag.mode === 'tap') {
        const p = drag.p0;
        drag = null;
        const [x, y] = toPx(p);
        if (polyDraft && polyDraft.length >= 3) {
          const [fx, fy] = toPx(polyDraft[0]);
          if (Math.hypot(x - fx, y - fy) < 18 * kEcr()) { terminerPoly(true); return; }
        }
        polyDraft = (polyDraft || []).concat([p]);
        redraw(); refresh();
        return;
      }
      drag = null;
      if (!draft) return;
      const t = draft;
      draft = null;
      let vide = t.t !== 'pen' && Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]) < 0.01;
      if (vide && t.tx) { // simple toucher : boîte de texte de largeur par défaut (40 % de l'image), une ligne de haut
        const w = 0.4, hr = (t.s * canvas.width * 1.8) / canvas.height;
        const x0 = Math.min(Math.max(0, t.a[0]), 1 - w), y0 = Math.min(Math.max(0, t.a[1]), Math.max(0, 1 - hr));
        t.a = [x0, y0];
        t.b = [x0 + w, y0 + hr];
        vide = false;
      }
      const base = snap();
      if (!vide) list.push(t);
      if (!vide && (t.t === 'rect' || t.t === 'ellipse')) {
        setEdit(t, base);
        if (t.tx && tbox) { focusPlan = true; tbox.body.focus({ preventScroll: true }); }
        return;
      }
      if (!vide) commit(base);
      guide = null;
      refresh();
      redraw();
    };
    // Sur mobile, le clavier ne s'ouvre que depuis un vrai toucher : on redonne le focus au clic qui suit la création de la boîte.
    stage.addEventListener('click', () => { if (focusPlan && tbox) { focusPlan = false; if (document.activeElement !== tbox.body) tbox.body.focus(); } });
    canvas.addEventListener('pointerleave', () => { if (gommePos && !drag) { gommePos = null; redraw(); } });
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    btnUndo.addEventListener('click', () => {
      if (polyDraft) { polyDraft.pop(); if (!polyDraft.length) polyDraft = null; redraw(); refresh(); return; }
      if (edit) setEdit(null);
      const prev = undoS.pop();
      if (prev == null) { refresh(); redraw(); return; }
      redoS.push(snap());
      restaurer(prev);
      refresh(); redraw();
    });
    btnRedo.addEventListener('click', () => {
      if (edit) setEdit(null);
      const next = redoS.pop();
      if (next == null) { refresh(); return; }
      undoS.push(snap());
      restaurer(next);
      refresh(); redraw();
    });
    btnClear.addEventListener('click', () => { polyDraft = null; if (edit) setEdit(null); const base = snap(); list = []; commit(base); refresh(); redraw(); });
    btnSupp.addEventListener('click', () => { if (!edit) return; const j = list.indexOf(edit); if (j >= 0) list.splice(j, 1); setEdit(null); refresh(); redraw(); });

    // ---- Sélection : le plus haut objet touché ; ses réglages et ses poignées sont ceux d'une forme en cours de création.
    function toucher(p) {
      const [x, y] = toPx(p), k = kEcr(), m = 14 * k;
      for (let i = list.length - 1; i >= 0; i--) {
        const t = list[i];
        if (t.t === 'gomme' || t.hid) continue;
        const marge = (t.w || 0) * canvas.width / 2;
        let hit = false;
        if (t.t === 'pen') hit = distSeg(x, y, t.p.map(([a, b]) => toPx([a, b])), false) < m + marge;
        else if (t.t === 'arrow') hit = distSeg(x, y, [toPx(t.a), toPx(t.b)], false) < m + marge;
        else if (t.t === 'poly') hit = (!!t.cl && !!t.fc && dansForme(t, p)) || distSeg(x, y, contour(t, canvas.width, canvas.height), !!t.cl) < m + marge;
        else if (t.t === 'rect' || t.t === 'ellipse') {
          const g = geom(t, canvas.width, canvas.height), q = tourne(x - g.cx, y - g.cy, -g.r);
          if (t.fc || t.tx || Math.min(g.hw, g.hh) < m * 1.5) hit = dansForme(t, p);
          else if (t.t === 'rect') hit = Math.abs(q[0]) <= g.hw + m && Math.abs(q[1]) <= g.hh + m && !(Math.abs(q[0]) < g.hw - m && Math.abs(q[1]) < g.hh - m);
          else hit = Math.abs(Math.hypot(q[0] / Math.max(1, g.hw), q[1] / Math.max(1, g.hh)) - 1) * Math.min(g.hw, g.hh) < m;
        }
        if (hit) return t;
      }
      return null;
    }
    const idxEp = (w) => { let b = 0; EPAISSEURS.forEach((e, i) => { if (Math.abs(e - w) < Math.abs(EPAISSEURS[b] - w)) b = i; }); return b; };
    // Les réglages affichés en ligne 2 reprennent ceux de l'objet choisi.
    function synchroniser(t) {
      if (t.c) color = t.c;
      opacity = t.o == null ? 1 : t.o;
      opaRange.value = String(Math.round(opacity * 100));
      fillColor = t.fc || null;
      const R = t.t === 'pen' ? reg.pen : t.t === 'arrow' ? reg.arrow : reg.ellipse;
      R.ep = idxEp(t.w); R.ty = t.ty || 'plein';
      if (t.t === 'pen' || t.t === 'arrow' || t.t === 'poly') { R.d = t.ed || 'aucune'; R.f = t.ef == null ? (t.t === 'arrow' ? 'fleche' : 'aucune') : t.ef; }
      if (t.tx) { textColor = t.tc || textColor; stT.s = t.s; stT.al = t.al || 'g'; }
    }
    function selectionner(t) {
      if (edit && edit !== t) setEdit(null);
      synchroniser(t);
      setEdit(t, snap());
    }

    // ---- Liste des objets : du plus haut au plus bas ; ordre de superposition, masquer / afficher, supprimer.
    const COULEUR_NOM = { '#e53935': 'rouge', '#fdd835': 'jaune', '#1e88e5': 'bleu', '#212121': 'noir' };
    const iconeDe = (cle) => SOUS_OUTILS.find((k) => k[0] === cle)[2];
    function descr(t) {
      let cle = t.t, nom = { pen: 'Tracé libre', arrow: 'Trait', poly: t.cl ? 'Polygone' : 'Ligne brisée', rect: 'Rectangle', ellipse: 'Ellipse' }[t.t] || 'Objet';
      const sub = [];
      if (t.tx) {
        const brut = (t.txt || []).map((sg) => sg.t).join('').replace(/\s+/g, ' ').trim();
        nom = t.c || t.fc ? 'Texte dans un cadre' : 'Texte';
        sub.push(brut ? `« ${brut.length > 28 ? `${brut.slice(0, 28)}…` : brut} »` : '(vide)');
      } else {
        if (COULEUR_NOM[t.c]) sub.push(COULEUR_NOM[t.c]);
        if (t.fc) sub.push(`rempli ${COULEUR_NOM[t.fc] || ''}`.trim());
      }
      if (t.o != null && t.o < 1) sub.push(`${Math.round(t.o * 100)} %`);
      if (t.hid) sub.push('masqué');
      return { ic: t.tx ? maskIc('texte') : t.t === 'poly' && t.cl ? iconeDe('poly') : iconeDe(cle), nom, sub: sub.join(' · ') };
    }
    const objetsEl = h('div', { class: 'sig4cem-pe__objets', hidden: '' });
    frame.append(objetsEl);
    function fermerObjets() { if (!objetsEl.hidden) { objetsEl.hidden = true; refresh(); } }
    function agir(t, fn, reselect) {
      if (edit) setEdit(null);
      const base = snap();
      fn();
      commit(base);
      if (reselect && list.includes(t)) selectionner(t);
      refresh(); redraw();
    }
    function majObjets() {
      objetsEl.textContent = '';
      objetsEl.append(h('div', { class: 'sig4cem-pe__objets-t', text: `Objets (${list.length}) · du plus haut au plus bas` }));
      for (let i = list.length - 1; i >= 0; i--) {
        const t = list[i];
        if (t.t === 'gomme') continue;
        const d = descr(t);
        const ic = h('span', { class: 'sig4cem-pe__obj-ic' });
        ic.innerHTML = d.ic;
        const bUp = btnIc('Monter (au-dessus)', svgIc('<path d="M12 19V5M6 11l6-6 6 6"/>'), 'sig4cem-pe__ic--mini');
        const bDn = btnIc('Descendre (en dessous)', svgIc('<path d="M12 5v14M6 13l6 6 6-6"/>'), 'sig4cem-pe__ic--mini');
        const bEye = btnIc(t.hid ? 'Afficher' : 'Masquer', svgIc(t.hid ? '<path d="M2.5 12S6 5.5 12 5.5c1.6 0 3 .5 4.2 1.2M21.5 12S18 18.5 12 18.5c-1.6 0-3-.5-4.2-1.2"/><path d="M4 4l16 16"/>' : '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'), 'sig4cem-pe__ic--mini');
        const bDel = btnIc('Supprimer', maskIc('poubelle'), 'sig4cem-pe__ic--mini');
        bUp.disabled = i === list.length - 1 || list.slice(i + 1).every((u) => u.t === 'gomme');
        bDn.disabled = i === 0;
        bUp.addEventListener('click', () => agir(t, () => { let j = list.indexOf(t) + 1; while (j < list.length && list[j].t === 'gomme') j++; if (j < list.length) { list.splice(list.indexOf(t), 1); list.splice(j, 0, t); } }, true));
        bDn.addEventListener('click', () => agir(t, () => { const j = list.indexOf(t); if (j > 0) { list.splice(j, 1); list.splice(j - 1, 0, t); } }, true));
        bEye.addEventListener('click', () => agir(t, () => { if (t.hid) delete t.hid; else t.hid = true; }, false));
        bDel.addEventListener('click', () => agir(t, () => { list.splice(list.indexOf(t), 1); }, false));
        const ligneEl = h('div', { class: 'sig4cem-pe__obj' + (t === edit ? ' sig4cem-pe__obj--sel' : '') + (t.hid ? ' sig4cem-pe__obj--hid' : '') }, ic, h('span', { class: 'sig4cem-pe__obj-t' }, h('b', { text: d.nom }), h('small', { text: d.sub })), bUp, bDn, bEye, bDel);
        ligneEl.addEventListener('click', (e) => { if (e.target.closest('button')) return; if (t !== edit) { selectionner(t); redraw(); } refresh(); });
        objetsEl.append(ligneEl);
      }
    }
    btnObjets.addEventListener('click', (e) => { e.stopPropagation(); fermerMenu(); nuancier.hidden = true; if (objetsEl.hidden) { objetsEl.hidden = false; majObjets(); } else objetsEl.hidden = true; refresh(); });

    const close = () => { document.removeEventListener('selectionchange', majFormats); root.remove(); URL.revokeObjectURL(url); };
    btnCancel.addEventListener('click', () => {
      finaliserTout();
      if (propre() !== etatInitial && !window.confirm('Fermer sans enregistrer ? Les modifications seront perdues.')) return;
      close();
    });
    // Objets masqués : l'utilisateur choisit à l'enregistrement de les garder (dans la source modifiable) ou de les supprimer.
    function dialogueMasques(masques, suite) {
      const lignes = masques.map((t) => { const d = descr(t); const ic = h('span', { class: 'sig4cem-pe__obj-ic' }); ic.innerHTML = d.ic; return h('div', { class: 'sig4cem-pe__obj' }, ic, h('span', { class: 'sig4cem-pe__obj-t' }, h('b', { text: d.nom }), h('small', { text: d.sub.replace(/ ?· ?masqué|^masqué$/, '') }))); });
      const bt = (txt, cls, fn) => { const b = h('button', { type: 'button', class: 'sig4cem-pe__dlg-b' + (cls ? ` ${cls}` : ''), text: txt }); b.addEventListener('click', fn); return b; };
      const voile = h('div', { class: 'sig4cem-pe__voile' });
      const fermer = () => voile.remove();
      voile.append(h('div', { class: 'sig4cem-pe__dlg', role: 'dialog', 'aria-modal': 'true' },
        h('h4', { text: 'Enregistrer les annotations' }),
        h('p', { text: masques.length === 1 ? '1 objet est masqué. Voulez-vous le conserver dans la source modifiable ? Il ne figure pas sur l\'image du rapport.' : `${masques.length} objets sont masqués. Voulez-vous les conserver dans la source modifiable ? Ils ne figurent pas sur l'image du rapport.` }),
        h('div', { class: 'sig4cem-pe__dlg-l' }, ...lignes),
        bt(masques.length === 1 ? 'Conserver masqué' : 'Conserver masqués', '', () => { fermer(); suite(true); }),
        bt('Supprimer définitivement', '', () => { fermer(); suite(false); }),
        bt('Revenir', 'sig4cem-pe__dlg-b--sec', fermer)));
      root.append(voile);
    }
    btnOk.addEventListener('click', () => {
      finaliserTout();
      mep = mepNormal(mep, img.naturalWidth, img.naturalHeight);
      list = list.filter((t) => t.t !== 'gomme' && !txVide(t));
      const masques = list.filter((t) => t.hid);
      const fin = (garder) => { if (!garder) list = list.filter((t) => !t.hid); close(); onDone(list, mep); };
      if (masques.length) dialogueMasques(masques, fin); else fin(true);
    });
    img.addEventListener('load', () => fit());
    if (img.complete) fit();
    refresh();
  },

  /** Dessine un calque de traits sur un canvas (utilisé pour les tests et les aperçus). */
  render,
};
})();
