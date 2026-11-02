/**
 * Annotations de photo — mise en page réversible (rotation, cadre) : calculs purs, sans DOM.
 */
(function () {
const A = (window.AMGT4CEM_Annotate = window.AMGT4CEM_Annotate || {});

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

A.Layout = { MEP_VERSION, mepDefaut, mepNeutre, mepNormal, normAngle, pivoterMep, cadreInscrit, contenirMep, appliquerMep, tailleVue };
})();
