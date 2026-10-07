/**
 * Signalements et demandes (points métier) : vocabulaire, noms de fichiers et dépôt.
 *
 * - Vocabulaire : data/signalements/vocabulaire.json (public, aucune donnée de suivi).
 *   Une nature (SIGNALEMENT, DEMANDE) regroupe des types ; chaque type appartient à un
 *   FLUX (STANDARD ou AMIANTE) et se combine avec un domaine technique, obligatoire ou non.
 * - Noms de fichiers : convention « Corporate » STIB TYPE_Titre_date_LANGUE, adaptée
 *   (IMG pour les images). Le titre (40 caractères au plus, sans accents) est généré :
 *   <référence courte du point>-<type court>[-<domaine court>]-<n°>.
 * - Dépôt : une archive ZIP par signalement (signalement.json + photos), à déposer à la main
 *   en attendant l'import automatique. La référence officielle (AAAA-NNNN) est attribuée
 *   par le système à l'import : elle est donc vide ici.
 *
 * Aucun nom de personne, initiales ni matricule dans les noms de fichiers : l'identification
 * des rédacteurs viendra avec le référentiel des intervenants (champ `redacteur`, vide pour l'instant).
 */
const AMGT4CEM_Signalements = {
  vocab: null,

  async load() {
    if (this.vocab) return this.vocab;
    try {
      const response = await fetch(AMGT4CEM_CONFIG.signalementsVocabUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.vocab = await response.json();
    } catch (err) {
      console.error('[AMGT4CEM] Vocabulaire des signalements illisible :', err);
      this.vocab = { natures: [], domaines: [], types: [], flux: [] };
    }
    return this.vocab;
  },

  natures() { return this.vocab.natures; },
  typesFor(nature) { return this.vocab.types.filter((t) => t.nature === nature); },
  type(code) { return this.vocab.types.find((t) => t.code === code) || null; },
  domaine(code) { return this.vocab.domaines.find((d) => d.code === code) || null; },
  nature(code) { return this.vocab.natures.find((n) => n.code === code) || null; },

  /** Date locale AAAA-MM-JJ du jour (valeur par défaut du champ date d'observation). */
  today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  /** Libellé affiché du point : « Avarie – Gros œuvre ». */
  buildLabel(typeCode, domaineCode) {
    const t = this.type(typeCode);
    const d = domaineCode ? this.domaine(domaineCode) : null;
    return d ? `${t.fr} – ${d.fr}` : t.fr;
  },

  /** Huit premiers caractères hexadécimaux de l'identifiant du point, en majuscules. */
  shortRef(pointId) {
    return pointId.replace(/[^0-9a-f]/gi, '').slice(0, 8).toUpperCase().padEnd(8, '0');
  },

  /** Nom de photo : IMG_<titre>_<AAAAMMJJ>_MX.jpg (convention de nommage de l'organisation). */
  pieceFileName(point, index) {
    const p = point.properties;
    const t = this.type(point.type);
    const titre = [this.shortRef(point.id), t.court]
      .concat(p.domaine ? [this.domaine(p.domaine).court] : [])
      .concat([String(index + 1).padStart(2, '0')])
      .join('-');
    return `IMG_${titre}_${p.dateObservation.replace(/-/g, '')}_MX.jpg`;
  },

  /** Nom de l'archive de dépôt : FICH_<titre>_<AAAAMMJJ>_FR.zip. */
  depotFileName(point) {
    const p = point.properties;
    const t = this.type(point.type);
    return `FICH_${this.shortRef(point.id)}-${t.court}_${p.dateObservation.replace(/-/g, '')}_FR.zip`;
  },

  /** Contenu de signalement.json : schéma d'échange du dépôt (version 1). */
  async buildDepot(point) {
    const p = point.properties;
    const pieces = [];
    for (let i = 0; i < (p.pieces || []).length; i++) {
      const meta = p.pieces[i];
      pieces.push({
        nom: this.pieceFileName(point, i),
        type: 'image/jpeg',
        taille: meta.taille,
        sha256: meta.sha256,
        sha256Original: meta.sha256Original,
      });
    }
    return {
      schema: 'amgt4cem-depot-signalement',
      version: 1,
      id: point.id,
      reference: null, // attribuée par le système à l'import (AAAA-NNNN)
      flux: p.flux || 'STANDARD',
      nature: p.nature,
      type: point.type,
      domaine: p.domaine || null,
      contexte: p.flux === 'AMIANTE' ? 'AMIANTE' : null,
      // Provenance : le demandeur n'est pas le rédacteur (celui qui saisit). Sa référence est un
      // identifiant externe à l'import (système du demandeur, type REF_DEMANDEUR, valeur).
      provenance: { demandeur: p.demandeur || '', referenceDemandeur: p.referenceDemandeur || '' },
      description: p.description || '',
      lieu: p.lieu || '',
      dateObservation: p.dateObservation,
      localisation: { x: point.x, y: point.y, crs: 'EPSG:31370' },
      redacteur: null, // renseigné quand le référentiel des intervenants existera
      creeLe: point.createdAt,
      pieces,
    };
  },

  /** Construit l'archive de dépôt d'un point et la télécharge. */
  async exportPoint(point) {
    const enc = new TextEncoder();
    const depot = await this.buildDepot(point);
    const entries = [{ name: 'signalement.json', data: enc.encode(JSON.stringify(depot, null, 2)) }];
    for (let i = 0; i < (point.properties.pieces || []).length; i++) {
      const record = await AMGT4CEM_PiecesStore.get(point.properties.pieces[i].id);
      if (!record) throw new Error(`Photo ${i + 1} introuvable dans cet appareil.`);
      entries.push({ name: depot.pieces[i].nom, data: new Uint8Array(await record.blob.arrayBuffer()) });
    }
    const blob = AMGT4CEM_ZipWriter.build(entries);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.depotFileName(point);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return depot;
  },
};
