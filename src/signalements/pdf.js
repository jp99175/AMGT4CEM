/**
 * Export PDF d'une révision d'entrée (fiche + photos avec leur calque d'annotations fondu dans l'image pour la lecture).
 * Produit sur l'appareil, joint à l'archive de dépôt (`revision.pdf`) ; le serveur le range dans <entrée>/revisions/.
 * Les photos du dépôt, elles, restent intactes (calque séparé). Bibliothèque : vendor/jspdf (jsPDF, licence MIT).
 * NS.Pdf.build(entrée) -> Promise<Blob>
 */
(function () {
const NS = (window.AMGT4CEM_Signalements = window.AMGT4CEM_Signalements || {});

/** Les polices PDF standard ne connaissent que le Latin-1 : on remplace le reste par un équivalent lisible. */
function txt(v) {
  return String(v == null ? '' : v)
    .replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/[’‘]/g, "'").replace(/[“”«»]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[  ]/g, ' ').replace(/[^\x09\x0a\x0d\x20-\xff]/g, '?');
}

function day(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Photo + calque dans un seul JPEG (grand côté 1100 px) : { data, w, h } */
async function composite(record) {
  const base = await createImageBitmap(record.blob);
  const scale = Math.min(1, 1100 / Math.max(base.width, base.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(base.width * scale));
  c.height = Math.max(1, Math.round(base.height * scale));
  const ctx = c.getContext('2d');
  ctx.drawImage(base, 0, 0, c.width, c.height);
  if (base.close) base.close();
  if (record.annot) {
    const o = await createImageBitmap(record.annot);
    ctx.drawImage(o, 0, 0, c.width, c.height);
    if (o.close) o.close();
  }
  return { data: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height };
}

NS.Pdf = {
  async build(s) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, M = 15, TW = W - 2 * M;
    let y = M;
    const need = (h) => { if (y + h > 297 - M) { doc.addPage(); y = M; } };
    const write = (text, { size = 10, bold = false, color = 0, gap = 1.5 } = {}) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(color);
      for (const line of doc.splitTextToSize(txt(text), TW)) {
        need(size * 0.45);
        y += size * 0.35;
        doc.text(line, M, y);
        y += size * 0.12;
      }
      y += gap;
    };
    const field = (k, v) => { if (v) { write(k, { size: 8, bold: true, color: 90, gap: 0 }); write(v, { gap: 2.5 }); } };

    const D = NS.Depot;
    const type = D.type(s.type) || {};
    const nature = (D.nature(s.nature || type.nature) || {}).fr;
    const domaine = s.domaine ? (D.domaine(s.domaine) || {}).fr : '';
    const v = `v0.${String(s.version || 1).padStart(2, '0')}`;

    write('SIG4CEM - Signalement / demande', { size: 9, color: 90, gap: 1 });
    write(s.titre || type.fr || 'Entrée', { size: 17, bold: true, gap: 1 });
    write([nature, type.fr, domaine].filter(Boolean).join(' - ').toUpperCase(), { size: 10, bold: true, color: 90, gap: 2 });
    write(`${s.reference || 'Référence attribuée à la réception'}  ${v}  du ${day(s.modifieLe || s.creeLe) || day(new Date().toISOString())}`, { size: 10, color: 60, gap: 4 });
    doc.setDrawColor(200); doc.line(M, y, W - M, y); y += 4;

    field("Date d'observation", day(s.dateObservation));
    field('Lieu', s.lieu);
    field('Position (Lambert 72)', s.x == null ? 'non renseignée' : `X ${Math.round(s.x * 100) / 100} - Y ${Math.round(s.y * 100) / 100}`);
    field('Demandeur', s.demandeur);
    field('Référence du demandeur', s.referenceDemandeur);
    field('Description', s.description);
    field('Rédacteur', s.redacteur);
    field('Contributeurs', (s.contributeurs || []).join(', '));

    const pieces = s.pieces || [];
    for (const [i, meta] of pieces.entries()) {
      const record = await NS.Pieces.get(meta.id);
      if (!record) continue;
      const img = await composite(record);
      const w = Math.min(TW, 120);
      const h = w * img.h / img.w;
      const maxH = 297 - 2 * M - 12;
      const k = h > maxH ? maxH / h : 1;
      need(h * k + 14);
      write(`Photo ${i + 1}${record.annot ? ' (avec annotations)' : ''}`, { size: 9, bold: true, color: 90, gap: 1 });
      doc.addImage(img.data, 'JPEG', M, y, w * k, h * k);
      y += h * k + 2;
      if (meta.commentaire) write(meta.commentaire, { size: 9, gap: 3 });
      else y += 3;
    }
    return doc.output('blob');
  },
};
})();
