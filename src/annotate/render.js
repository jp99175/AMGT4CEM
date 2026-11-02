/**
 * Annotations de photo — dessin des objets (pur : aucun DOM, aucun état). Partagé par l'éditeur, le calque PNG
 * des signalements, le PDF et les aperçus. Coordonnées des objets : relatives à l'image source (0..1).
 */
(function () {
const A = (window.AMGT4CEM_Annotate = window.AMGT4CEM_Annotate || {});

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

A.Render = { EPAISSEURS, GOMMES, TYPES, TYPES_FORMES, TERMINAISONS, terminaison, tirets, geom, tourne, contour, nuage, render };
})();
