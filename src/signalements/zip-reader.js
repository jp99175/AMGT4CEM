/**
 * Lecture d'une archive ZIP (méthodes « stored » et « deflate »). Aucune dépendance : la décompression passe par
 * DecompressionStream (navigateurs récents). Sert au dépôt d'un shapefile (src/reglages/depotEcran.js).
 */
(function () {
const NS = (window.AMGT4CEM_Signalements = window.AMGT4CEM_Signalements || {});

async function inflate(octets) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Ce navigateur ne sait pas décompresser un ZIP ; décompressez le fichier et déposez les 5 fichiers dans un ZIP sans compression.');
  const flux = new Blob([octets]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

NS.ZipLecture = {
  /** @param {ArrayBuffer|Uint8Array} tampon  @returns {Promise<Map<string, Uint8Array>>} nom (chemin dans le ZIP) -> contenu */
  async lire(tampon) {
    const o = tampon instanceof Uint8Array ? tampon : new Uint8Array(tampon);
    const v = new DataView(o.buffer, o.byteOffset, o.byteLength);
    let fin = -1;
    for (let i = o.length - 22; i >= Math.max(0, o.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { fin = i; break; }
    if (fin < 0) throw new Error("Ce fichier n'est pas une archive ZIP.");
    const n = v.getUint16(fin + 10, true);
    let pos = v.getUint32(fin + 16, true);
    const sortie = new Map();
    for (let k = 0; k < n; k++) {
      if (v.getUint32(pos, true) !== 0x02014b50) throw new Error('Archive ZIP abîmée (répertoire central).');
      const methode = v.getUint16(pos + 10, true);
      const tailleComp = v.getUint32(pos + 20, true);
      const lenNom = v.getUint16(pos + 28, true); const lenExtra = v.getUint16(pos + 30, true); const lenCom = v.getUint16(pos + 32, true);
      const debutLocal = v.getUint32(pos + 42, true);
      const nom = new TextDecoder().decode(o.subarray(pos + 46, pos + 46 + lenNom));
      pos += 46 + lenNom + lenExtra + lenCom;
      if (nom.endsWith('/')) continue;
      if (v.getUint32(debutLocal, true) !== 0x04034b50) throw new Error(`Archive ZIP abîmée (${nom}).`);
      const debut = debutLocal + 30 + v.getUint16(debutLocal + 26, true) + v.getUint16(debutLocal + 28, true);
      const brut = o.subarray(debut, debut + tailleComp);
      if (methode === 0) sortie.set(nom, new Uint8Array(brut));
      else if (methode === 8) sortie.set(nom, await inflate(brut));
      else throw new Error(`Méthode de compression ${methode} non prise en charge (${nom}).`);
    }
    return sortie;
  },
};
})();
