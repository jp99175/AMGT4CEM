/**
 * Heure de prise de vue d'une photo, lue AVANT la réduction (la réduction par canvas efface les données EXIF).
 * Ordre : 1. heure EXIF (écrite par l'appareil photo) ; 2. heure écrite dans le nom du fichier (avec les secondes) ;
 * 3. date de dernière modification du fichier ; 4. instant de l'ajout.
 * Résultat : texte « AAAA-MM-JJTHH:MM:SS » en heure de Bruxelles (sans fuseau, c'est l'heure du mur).
 */
(function () {
const NS = (window.AMGT4CEM_Annotate = window.AMGT4CEM_Annotate || {});

const dateValide = (a, mo, j, h, mi, s) => a >= 2000 && a <= 2100 && mo >= 1 && mo <= 12 && j >= 1 && j <= 31 && h <= 23 && mi <= 59 && s <= 59;
const deux = (n) => String(n).padStart(2, '0');
const texte = (a, mo, j, h, mi, s) => `${a}-${deux(mo)}-${deux(j)}T${deux(h)}:${deux(mi)}:${deux(s)}`;

/** Heure EXIF (DateTimeOriginal, sinon DateTimeDigitized) d'un JPEG, ou null. @param {Uint8Array} u8 */
function lireExif(u8) {
  if (u8.length < 4 || u8[0] !== 0xff || u8[1] !== 0xd8) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let p = 2;
  while (p + 4 <= u8.length) {
    if (u8[p] !== 0xff) return null;
    const marqueur = u8[p + 1];
    if (marqueur === 0xda || marqueur === 0xd9) return null;
    const lon = dv.getUint16(p + 2);
    if (marqueur === 0xe1 && p + 10 <= u8.length && u8[p + 4] === 0x45 && u8[p + 5] === 0x78 && u8[p + 6] === 0x69 && u8[p + 7] === 0x66) {
      const t = p + 10; // début du bloc TIFF
      const little = u8[t] === 0x49;
      const g16 = (o) => dv.getUint16(t + o, little);
      const g32 = (o) => dv.getUint32(t + o, little);
      const ifd = (o) => {
        const res = {};
        if (o + 2 > u8.length - t) return res;
        const n = g16(o);
        for (let i = 0; i < n; i++) {
          const e = o + 2 + i * 12;
          if (t + e + 12 > u8.length) break;
          res[g16(e)] = { type: g16(e + 2), count: g32(e + 4), off: e + 8 };
        }
        return res;
      };
      const ascii = (e) => {
        const o = e.count > 4 ? g32(e.off) : e.off;
        if (t + o + e.count > u8.length) return null;
        return String.fromCharCode(...u8.subarray(t + o, t + o + e.count)).replace(/\0.*$/, '');
      };
      const ifd0 = ifd(g32(4));
      if (!ifd0[0x8769]) return null;
      const exif = ifd(g32(ifd0[0x8769].off));
      for (const tag of [0x9003, 0x9004]) {
        if (!exif[tag]) continue;
        const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(ascii(exif[tag]) || '');
        if (m && dateValide(...m.slice(1).map(Number))) return texte(...m.slice(1).map(Number));
      }
      return null;
    }
    p += 2 + lon;
  }
  return null;
}

/** Heure écrite dans un nom de fichier (IMG_20261127_181500.jpg, PXL_…, Screenshot_2026-11-27-18-15-00…), ou null. */
function heureDuNom(nom) {
  const m = /(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})[ _T.-](\d{2})[-_.:]?(\d{2})[-_.:]?(\d{2})/.exec(String(nom || ''));
  if (!m) return null;
  const v = m.slice(1).map(Number);
  return dateValide(...v) ? texte(...v) : null;
}

function bruxelles(ms) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const g = (t) => Number(parts.find((x) => x.type === t).value);
  return texte(g('year'), g('month'), g('day'), g('hour'), g('minute'), g('second'));
}

/** @param {File} file @returns {Promise<string>} */
async function heurePrise(file) {
  try {
    const t = lireExif(new Uint8Array(await file.slice(0, 262144).arrayBuffer()));
    if (t) return t;
  } catch (err) { /* repli */ }
  const n = heureDuNom(file && file.name);
  if (n) return n;
  if (file && file.lastModified > 0) return bruxelles(file.lastModified);
  return bruxelles(Date.now());
}

NS.heurePrise = heurePrise;
NS._heurePrise = { lireExif, heureDuNom, bruxelles };
})();
