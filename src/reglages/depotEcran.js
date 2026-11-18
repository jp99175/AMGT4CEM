/**
 * Réglages > Avancé > Adaptations de plans : cadre « Déposer un shapefile » (droit « plans »).
 *
 * Lot C de l'écriture du shapefile (18/11/2026). Un agent charge le ZIP reçu d'un dessinateur : l'application le contrôle sur le
 * serveur (workers/depot/geometries.js), affiche un résumé (objets sans identifiant, contours modifiés, objets disparus), puis, après
 * confirmation, enregistre une nouvelle version dans R2. Chaque dépôt garde son auteur, sa date et le ZIP tel que reçu ; on peut
 * restaurer une ancienne version. Les contours ne sont jamais ré-encodés ; le .dbf est reconstruit (id, GENRE, NOM_FR, NOM_NL).
 *
 * Couches offertes : seul l'essai pour l'instant. Le vrai shapefile (polygones) s'ajoutera ici après le feu vert explicite de Jph.
 */
(function () {
const COUCHES_OFFERTES = [{ cle: 'essai', libelle: 'Essai (fichier de test)' }];

const h = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  for (const c of kids) if (c) n.append(c);
  return n;
};

const EXTENSIONS = ['shp', 'shx', 'dbf', 'prj', 'cpg'];

/** Bouton « occupé » : grisé, libellé d'attente, plus cliquable. Renvoie la fonction qui le remet en état. */
function occuper(bouton, libelleAttente) {
  const avant = bouton.textContent;
  bouton.disabled = true; bouton.textContent = libelleAttente; bouton.style.opacity = '0.6';
  return () => { bouton.disabled = false; bouton.textContent = avant; bouton.style.opacity = ''; };
}

function enBase64(octets) {
  let s = '';
  for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
  return btoa(s);
}

/** vAAAAMMJJ_HHMMSS -> JJ/MM/AAAA HH:MM */
function dateVersion(v) {
  const m = /^v(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})\d{2}/.exec(v || '');
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : (v || '—');
}

/** Cherche les 5 fichiers dans le ZIP (un seul nom de base accepté) ; renvoie { fichiers, nomBase } ou lève une Error. */
function trouverFichiers(entrees) {
  const parBase = new Map();
  for (const [chemin, octets] of entrees) {
    const m = /([^/\\]+)\.(shp|shx|dbf|prj|cpg)$/i.exec(chemin);
    if (!m) continue;
    const base = m[1];
    if (!parBase.has(base)) parBase.set(base, {});
    parBase.get(base)[m[2].toLowerCase()] = octets;
  }
  const complets = [...parBase.entries()].filter(([, f]) => f.shp && f.shx && f.dbf && f.prj);
  if (!complets.length) throw new Error('Le ZIP ne contient pas de shapefile complet (il faut au moins .shp, .shx, .dbf et .prj du même nom).');
  if (complets.length > 1) throw new Error(`Le ZIP contient plusieurs shapefiles (${complets.map(([b]) => b).join(', ')}) : déposez-en un seul.`);
  return { nomBase: complets[0][0], fichiers: complets[0][1] };
}

function cadre() {
  const Auth = typeof AMGT4CEM_Auth !== 'undefined' ? AMGT4CEM_Auth : null; // déclaré en const global : pas sur window
  if (!Auth) return h('section', { class: 'rgl-bloc' }, h('p', { class: 'rgl-statut rgl-statut--erreur', text: 'Connexion indisponible : rechargez la page.' }));
  const bloc = h('section', { class: 'rgl-bloc' });
  const statut = h('p', { class: 'rgl-statut', text: 'Choisissez le fichier ZIP reçu du dessinateur.' });
  const dire = (texte, type) => { statut.className = `rgl-statut${type ? ` rgl-statut--${type}` : ''}`; statut.textContent = texte; };

  const couche = h('select', { class: 'rgl-input', 'aria-label': 'Couche à écrire' }, ...COUCHES_OFFERTES.map((c) => h('option', { value: c.cle, text: c.libelle })));
  const fichier = h('input', { type: 'file', accept: '.zip,application/zip', class: 'rgl-input', 'aria-label': 'Fichier ZIP à déposer' });
  const par = h('input', { type: 'text', class: 'rgl-input', maxlength: '100', placeholder: 'Nom du dessinateur ou du service', 'aria-label': 'Déposé par' });
  const controler = h('button', { type: 'button', class: 'rgl-btn', text: 'Contrôler le fichier' });
  const zone = h('div', {});
  const histo = h('div', {});
  const champ = (libelle, ...contenu) => h('div', { class: 'rgl-row' }, h('span', { class: 'rgl-row__body' }, h('span', { class: 'rgl-row__text', text: libelle }), ...contenu));
  bloc.append(h('h2', { class: 'rgl-bloc__titre', text: 'Déposer un shapefile' }), statut,
    champ('Couche', couche), champ('Fichier ZIP', fichier), champ('Déposé par', par), h('div', { class: 'rgl-actions' }, controler), zone, histo);

  let courant = null; // { fichiers, zip, nomZip, versionBase }

  async function lireChoix() {
    const f = fichier.files && fichier.files[0];
    if (!f) throw new Error('Choisissez d\'abord un fichier ZIP.');
    if (!par.value.trim()) throw new Error('Indiquez qui a déposé le fichier (« Déposé par »).');
    if (!window.AMGT4CEM_Signalements || !AMGT4CEM_Signalements.ZipLecture) throw new Error('Lecteur de ZIP indisponible : rechargez la page.');
    const zip = new Uint8Array(await f.arrayBuffer());
    const { fichiers } = trouverFichiers(await AMGT4CEM_Signalements.ZipLecture.lire(zip));
    const m = /_v(\d{8})_(\d{6})/.exec(f.name);
    const b64 = {};
    for (const ext of EXTENSIONS) if (fichiers[ext]) b64[ext] = enBase64(fichiers[ext]);
    return { fichiers: b64, zip: enBase64(zip), nomZip: f.name, versionBase: m ? `v${m[1]}_${m[2]}` : null };
  }

  const ligne = (libelle, valeur, rouge) => h('div', { class: 'rgl-row' }, h('span', { class: 'rgl-row__body' },
    h('span', { class: 'rgl-row__text', text: libelle }), h('span', { class: 'rgl-row__aide', text: valeur, ...(rouge ? { style: 'color: #9b1c1c; font-weight: 500;' } : {}) })));

  function montrerResume(resume, erreurs) {
    zone.replaceChildren();
    if (erreurs && erreurs.length) {
      zone.append(h('p', { class: 'rgl-statut rgl-statut--erreur', text: 'Fichier refusé : rien n\'a été enregistré.' }),
        ...erreurs.slice(0, 20).map((e) => h('p', { class: 'rgl-row__aide', text: `• ${e}` })));
      if (erreurs.length > 20) zone.append(h('p', { class: 'rgl-row__aide', text: `… et ${erreurs.length - 20} autres.` }));
      return;
    }
    const lignes = [
      ligne('Contrôles', 'Fichiers cohérents, Lambert 72, contours valides, identifiants sans doublon ambigu.'),
      ligne(`Version courante : ${dateVersion(resume.versionCourante)}`, resume.versionCourante ? `Objets dans le fichier déposé : ${resume.objetsDeposes}` : `Première écriture de cette couche. Objets dans le fichier : ${resume.objetsDeposes}`),
      ligne('Objets sans identifiant (Pn)', `${resume.sansId}${resume.sansId ? ` — Les références ${resume.premierId} à ${resume.dernierId} seront appliquées à l'import.` : ''}`),
      ligne('Contours modifiés', String(resume.modifies)),
      ligne('Objets disparus du fichier', String(resume.disparus.length), resume.disparus.length > 0),
      ligne('Inchangés', String(resume.inchanges)),
    ];
    if (resume.doublons.length) lignes.push(ligne('Identifiants en double', `${resume.doublons.map((d) => `${d.id} (${d.copies} copie${d.copies > 1 ? 's' : ''})`).join(', ')} : les copies recevront un nouvel identifiant.`));
    zone.append(...lignes);
    const conf = {};
    const cases = [];
    if (resume.disparus.length) {
      const c = h('input', { type: 'checkbox' });
      cases.push([c, 'retraits', `Je confirme le retrait de ${resume.disparus.length} objet${resume.disparus.length > 1 ? 's' : ''} (${resume.disparus.slice(0, 6).join(', ')}${resume.disparus.length > 6 ? '…' : ''}) ; leurs attributs et leur identifiant sont conservés.`]);
    }
    if (resume.versionAncienne) {
      const c = h('input', { type: 'checkbox' });
      cases.push([c, 'versionAncienne', resume.versionBase ? `Ce fichier part de la version du ${dateVersion(resume.versionBase)}, pas de la version courante : je confirme qu'il peut la remplacer.` : 'La version de départ de ce fichier est inconnue (nom du ZIP modifié) : je confirme qu\'il peut remplacer la version courante.']);
    }
    for (const [c, , texte] of cases) zone.append(h('label', { class: 'rgl-row__aide', style: 'display:flex;gap:8px;align-items:flex-start;margin:8px 0;' }, c, h('span', { text: texte })));
    const ecrire = h('button', { type: 'button', class: 'rgl-btn rgl-btn--primary', text: couche.value === 'essai' ? 'Enregistrer sur l\'essai' : 'Enregistrer dans le vrai shapefile' });
    ecrire.addEventListener('click', async () => {
      if (ecrire.disabled) return; // un seul envoi : un second appui ne doit pas écrire une deuxième version
      for (const [c, cle] of cases) conf[cle] = c.checked;
      if (cases.some(([c]) => !c.checked)) { dire('Cochez les confirmations demandées avant d\'enregistrer.', 'erreur'); return; }
      const liberer = occuper(ecrire, 'Enregistrement…');
      try {
        dire('Enregistrement…');
        const out = await Auth.call(`/geometries/shapefile/${couche.value}/deposer`, { method: 'POST', body: { fichiers: courant.fichiers, zip: courant.zip, nomZip: courant.nomZip, versionBase: courant.versionBase, deposePar: par.value.trim(), confirmations: conf } });
        zone.replaceChildren();
        courant = null;
        dire(`Version du ${dateVersion(out.version)} enregistrée : ${out.objets} objets${out.attribues.length ? `, identifiants attribués : ${out.attribues.join(', ')}` : ''}. ${out.attribues.some((i) => i[0] === 'P') ? 'Les nouveaux objets sont à compléter dans Attributs (genre, noms). ' : ''}Téléchargez la version à jour avant de la renvoyer au dessinateur.`, 'ok');
        await montrerHistorique();
      } catch (err) { liberer(); dire(err.message + (err.data && err.data.manque ? ' (confirmation manquante)' : ''), 'erreur'); }
    });
    zone.append(h('div', { class: 'rgl-actions' }, ecrire));
  }

  controler.addEventListener('click', async () => {
    if (controler.disabled) return;
    const liberer = occuper(controler, 'Contrôle en cours…');
    try {
      dire('Contrôle en cours…');
      zone.replaceChildren();
      courant = await lireChoix();
      let out;
      try {
        out = await Auth.call(`/geometries/shapefile/${couche.value}/deposer`, { method: 'POST', body: { fichiers: courant.fichiers, versionBase: courant.versionBase, deposePar: par.value.trim(), apercu: true } });
      } catch (err) {
        if (err.data && err.data.erreurs) { montrerResume(null, err.data.erreurs); dire('Le fichier est refusé.', 'erreur'); return; }
        throw err;
      }
      montrerResume(out.resume);
      dire('Contrôles passés. Vérifiez le résumé, puis enregistrez.', 'ok');
    } catch (err) { dire(err.message, 'erreur'); } finally { liberer(); }
  });

  async function montrerHistorique() {
    histo.replaceChildren();
    try {
      const { versions } = await Auth.call(`/geometries/depots/${couche.value}`);
      if (!versions.length) return;
      histo.append(h('h3', { class: 'rgl-bloc__titre', text: 'Historique des versions' }));
      for (const v of versions.slice(0, 15)) {
        const qui = v.source === 'restauration' ? `Restauration de la version du ${dateVersion(v.restaureDepuis)}` : `Déposé par ${v.deposePar || '—'}`;
        const boutons = h('span', { class: 'rgl-actions' });
        if (v.zipDisponible) {
          const z = h('button', { type: 'button', class: 'rgl-btn', text: 'ZIP reçu' });
          z.addEventListener('click', async () => {
            try {
              const r = await fetch(`${Auth.serverUrl}/geometries/depots/${couche.value}/${v.version}/zip`, { headers: { Authorization: `Bearer ${Auth.session().jeton}` } });
              if (!r.ok) throw new Error(`Téléchargement impossible (HTTP ${r.status}).`);
              const a = h('a', { href: URL.createObjectURL(await r.blob()), download: v.nomZip || `${couche.value}_${v.version}.zip` });
              document.body.append(a); a.click(); a.remove();
            } catch (err) { dire(err.message, 'erreur'); }
          });
          boutons.append(z);
        }
        if (v.disponible) {
          const r = h('button', { type: 'button', class: 'rgl-btn', text: 'Restaurer' });
          r.addEventListener('click', async () => {
            if (r.disabled) return;
            if (!confirm(`Remettre la version du ${dateVersion(v.version)} comme version courante ?\n\nC'est une nouvelle version : l'historique reste intact.`)) return;
            const liberer = occuper(r, 'Restauration…');
            try {
              const out = await Auth.call(`/geometries/shapefile/${couche.value}/restaurer`, { method: 'POST', body: { version: v.version } });
              dire(`Version du ${dateVersion(v.version)} restaurée (nouvelle version du ${dateVersion(out.version)}).`, 'ok');
              await montrerHistorique();
            } catch (err) { liberer(); dire(err.message, 'erreur'); }
          });
          boutons.append(r);
        }
        histo.append(h('div', { class: 'rgl-row' }, h('span', { class: 'rgl-row__body' },
          h('span', { class: 'rgl-row__text', text: `${dateVersion(v.version)} · ${v.objets} objets` }),
          h('span', { class: 'rgl-row__aide', text: `${qui}${v.attribues && v.attribues.length ? ` · ${v.attribues.length} identifiant(s) attribué(s)` : ''}${v.disponible ? '' : ' · version supprimée (règle de conservation)'}` }),
          boutons)));
      }
    } catch (err) { /* couche pas encore écrite : pas d'historique */ }
  }
  couche.addEventListener('change', () => { zone.replaceChildren(); montrerHistorique(); });
  montrerHistorique();
  return bloc;
}

window.AMGT4CEM_DepotEcran = { cadre };
})();
