/**
 * Lecture d'une archive ZIP (méthodes « stored » et « deflate »), côté navigateur : sert à rouvrir une entrée
 * déjà envoyée (voir importer.js). Pendant de zip-writer.js.
 * NS.ZipReader.read(arrayBuffer) -> Promise<Map<nom, Uint8Array>>
 */
(function () {
const NS = (window.AMGT4CEM_Signalements = window.AMGT4CEM_Signalements || {});

NS.ZipReader = {
  async read(buffer) {
    const dv = new DataView(buffer);
    const u8 = new Uint8Array(buffer);
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Archive illisible (ce n'est pas un ZIP).");
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const out = new Map();
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Archive illisible (répertoire central).');
      const methode = dv.getUint16(p + 10, true);
      const taille = dv.getUint32(p + 20, true);
      const lN = dv.getUint16(p + 28, true);
      const lE = dv.getUint16(p + 30, true);
      const lC = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + lN));
      const debut = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const brut = u8.subarray(debut, debut + taille);
      if (methode === 0) out.set(name, brut);
      else if (methode === 8) out.set(name, new Uint8Array(await new Response(new Blob([brut]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
      else throw new Error(`Méthode de compression non gérée (${methode}).`);
      p += 46 + lN + lE + lC;
    }
    return out;
  },
};
})();
