/**
 * Annotations de photo — API publique (`window.AMGT4CEM_Annotate`), à utiliser par tous les formulaires (signalements, plus tard
 * inspections, constats…). Voir README.md : format des objets (`traits`) et de la mise en page (`mep`).
 *
 *   open(blob, traits, onDone, mep, opts)   ouvre l'éditeur ; onDone(traits, mep) à la validation
 *   overlayPng(traits, largeur, hauteur, mep)  calque PNG transparent des annotations, dans le cadre de la mise en page
 *   vue(blob, mep, cote)                    photo vue à travers sa mise en page (JPEG)
 *   pivoterMep(mep, sens, W, H)             quart de tour de la mise en page
 *   mepNormal(mep, W, H)                    null si la mise en page est neutre
 *   render(ctx, W, H, traits)               dessine des objets sur un canvas
 */
(function () {
const A = (window.AMGT4CEM_Annotate = window.AMGT4CEM_Annotate || {});
const { render } = A.Render;
const { mepDefaut, mepNormal, pivoterMep, appliquerMep, tailleVue } = A.Layout;
const OVERLAY_SIDE = 1000; // grand côté du calque PNG (la photo, elle, garde sa définition)

Object.assign(A, {
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
  open: (...args) => A.Editor.open(...args),
  render,
});

// Ancien nom, le temps de la transition.
window.SIG4CEM = window.SIG4CEM || {};
window.SIG4CEM.PhotoEditor = A;
})();
