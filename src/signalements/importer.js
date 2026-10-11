/**
 * Rouvre une entrée DÉJÀ ENVOYÉE pour la réviser : l'archive du serveur est téléchargée puis reconstituée sur l'appareil
 * (champs du formulaire, photos, calques d'annotations et traits). L'entrée garde son identifiant : l'envoi suivant est
 * une nouvelle version de la même référence. Les photos ne changent pas ; seul le calque d'annotations peut être remplacé.
 */
(function () {
const NS = (window.AMGT4CEM_Signalements = window.AMGT4CEM_Signalements || {});

NS.Importer = {
  /** @returns {Promise<object>} l'entrée prête à être enregistrée (photos déjà dans le stockage local) */
  async fromServer(reference) {
    const blob = await AMGT4CEM_Auth.call(`/signalements/${encodeURIComponent(reference)}/archive`, { blob: true });
    const files = await NS.ZipReader.read(await blob.arrayBuffer());
    const raw = files.get('signalement.json');
    if (!raw) throw new Error('Archive sans signalement.json.');
    const dep = JSON.parse(new TextDecoder().decode(raw));
    const pieces = [];
    for (const [i, p] of (dep.pieces || []).entries()) {
      const jpg = files.get(p.nom);
      if (!jpg) throw new Error(`Photo ${i + 1} absente de l'archive.`);
      const photo = new Blob([jpg], { type: p.type || 'image/jpeg' });
      const overlay = p.annotations && files.get(p.annotations.nom) ? new Blob([files.get(p.annotations.nom)], { type: 'image/png' }) : null;
      const meta = await NS.Pieces.restore(dep.id, {
        blob: photo,
        sha256: p.sha256,
        sha256Original: p.sha256Original,
        annot: overlay,
        annotSha256: overlay ? p.annotations.sha256 : null,
        traits: overlay && Array.isArray(p.annotations.traits) ? p.annotations.traits : null,
      });
      meta.commentaire = p.commentaire || '';
      pieces.push(meta);
    }
    const loc = dep.localisation;
    return {
      id: dep.id,
      flux: 'STANDARD',
      nature: dep.nature,
      type: dep.type,
      domaine: dep.domaine || null,
      titre: dep.titre || '',
      label: NS.Depot.buildLabel(dep.type, dep.domaine),
      x: loc ? loc.x : null,
      y: loc ? loc.y : null,
      dateObservation: dep.dateObservation,
      lieu: dep.lieu || '',
      demandeur: (dep.provenance || {}).demandeur || '',
      referenceDemandeur: (dep.provenance || {}).referenceDemandeur || '',
      description: dep.description || '',
      pieces,
      creeLe: dep.creeLe,
      version: dep.version || 1,
      modifieLe: dep.modifieLe,
      redacteur: dep.redacteur || null,
      contributeurs: Array.isArray(dep.contributeurs) ? dep.contributeurs : [],
      reference,
    };
  },
};
})();
