/**
 * Service worker de l'application (publié à la racine, servi par GitHub Pages comme les autres fichiers).
 *
 * 1. Ouverture sans réseau : les fichiers de l'application (liste ci-dessous, fabriquée par tools/stamp-sw.sh à chaque publication)
 *    sont gardés à l'installation, et tout autre fichier du site chargé en ligne l'est au passage. Stratégie « réseau d'abord » :
 *    en ligne, on reçoit toujours la dernière version publiée (comme sans service worker) ; hors ligne, ou si le réseau ne répond
 *    pas en 4 secondes, on sert la copie gardée.
 *    Les autres sites (tuiles UrbIS, services de la Région, relais, serveur de comptes) ne sont jamais interceptés.
 * 2. Téléchargement des tuiles du fond de plan (écran Réglages > Carte hors ligne) : il continue quand on quitte la page ;
 *    il se reprend tout seul quand l'application se rouvre (ou, sur Android, par la synchronisation en arrière-plan).
 *    Le travail en cours est gardé dans IndexedDB (magasin « travail »).
 */
'use strict';

const VERSION = '20261112-1426'; // @VERSION (écrit par tools/stamp-sw.sh)
const CACHE = 'amgt4cem-app';
const DELAI_RESEAU_MS = 4000;
const PARALLELE = 6;
// @DEBUT-FICHIERS
const FICHIERS = [
  './assets/logo-bruxelles.png',
  './assets/logo-vlaanderen.png',
  './config.js',
  './config/ditp-diov/vocabulaires.json',
  './config/fonds-de-plan/bruciel.json',
  './config/fonds-de-plan/flandre.json',
  './config/fonds-de-plan/geocodeur.json',
  './config/fonds-de-plan/menu-par-defaut-connectes.json',
  './config/fonds-de-plan/orthophotos-selection-par-defaut.json',
  './config/fonds-de-plan/services.json',
  './config/fonds-de-plan/urbis-orthophotos.json',
  './config/fonds-de-plan/urbis.json',
  './config/nappe/parametres.json',
  './config/nappe/selection-par-defaut.json',
  './config/plans-patrimoine/catalogue.js',
  './config/plans-patrimoine/selection-par-defaut.json',
  './config/plans-patrimoine/vocabulaires.json',
  './config/secours/region-metro.json',
  './config/secours/stib-arrets-tram-metro.json',
  './config/synoptique/liens.json',
  './config/urbis-topo/catalogue.js',
  './config/urbis-topo/parametres.json',
  './config/urbis-topo/selection-par-defaut.json',
  './data/ditp-diov/lignes.json',
  './data/ditp-diov/polygones.json',
  './data/lieux/lieux.json',
  './data/plans-patrimoine/etiquettes-planches.json',
  './data/plans-patrimoine/etiquettes-troncons.json',
  './data/plans-patrimoine/numeros-interstation.legacy.json',
  './data/plans-patrimoine/polygones.json',
  './data/plans-patrimoine/reperes-troncons.legacy.json',
  './data/plans-patrimoine/temp-delta-mod.json',
  './data/shapefile-test/test_shapefile.cpg',
  './data/shapefile-test/test_shapefile.dbf',
  './data/shapefile-test/test_shapefile.json',
  './data/shapefile-test/test_shapefile.prj',
  './data/shapefile-test/test_shapefile.shp',
  './data/shapefile-test/test_shapefile.shx',
  './data/shapefile/identifiants.json',
  './data/shapefile/polygones.cpg',
  './data/shapefile/polygones.dbf',
  './data/shapefile/polygones.prj',
  './data/shapefile/polygones.shp',
  './data/shapefile/polygones.shx',
  './data/signalements/vocabulaire.json',
  './data/synoptique/synoptique-reseau-v17.svg',
  './home.html',
  './index.html',
  './src/accountButton.js',
  './src/addPointMenu.js',
  './src/addPointTool.js',
  './src/admin.js',
  './src/admin/README.md',
  './src/admin/admin.css',
  './src/admin/admin.js',
  './src/annotate/README.md',
  './src/annotate/annotate.css',
  './src/annotate/annotate.js',
  './src/annotate/dom.js',
  './src/annotate/editor.js',
  './src/annotate/history.js',
  './src/annotate/icons/icone-cercle.svg',
  './src/annotate/icons/icone-crayon.svg',
  './src/annotate/icons/icone-deplacer.svg',
  './src/annotate/icons/icone-epaisseur.svg',
  './src/annotate/icons/icone-fleche.svg',
  './src/annotate/icons/icone-gomme.svg',
  './src/annotate/icons/icone-palette.svg',
  './src/annotate/icons/icone-pinceau.svg',
  './src/annotate/icons/icone-poubelle.svg',
  './src/annotate/icons/icone-redim-diag1.svg',
  './src/annotate/icons/icone-redim-diag2.svg',
  './src/annotate/icons/icone-redim-vert.svg',
  './src/annotate/icons/icone-rot-antihoraire.svg',
  './src/annotate/icons/icone-rot-horaire.svg',
  './src/annotate/icons/icone-rot-libre.svg',
  './src/annotate/icons/icone-selection.svg',
  './src/annotate/icons/icone-texte.svg',
  './src/annotate/layout.js',
  './src/annotate/render.js',
  './src/annotate/store.js',
  './src/app.js',
  './src/auth/auth.css',
  './src/auth/auth.js',
  './src/auth/authUi.js',
  './src/basemap.js',
  './src/buildInfo.js',
  './src/buildInfoControl.js',
  './src/buildInfoPage.js',
  './src/creditsLayout.js',
  './src/crs.js',
  './src/ditpDiovGenres.js',
  './src/ditpDiovLayer.js',
  './src/ditpDiovPicker.js',
  './src/ditpDiovPublicLayer.js',
  './src/horsLigne/ecran.js',
  './src/horsLigne/horsLigne.css',
  './src/horsLigne/magasin.js',
  './src/interstation.js',
  './src/layerOpacityStore.js',
  './src/lieuxTool.js',
  './src/mapMenu.js',
  './src/mapView.js',
  './src/measureTool.js',
  './src/menuPrefs.js',
  './src/mesureTuiles.css',
  './src/mesureTuiles.js',
  './src/nappeLayer.js',
  './src/nappeSelectionStore.js',
  './src/nav/ajouter-point.png',
  './src/nav/ajouter-point.svg',
  './src/nav/couches-bouton.png',
  './src/nav/couches-bouton.svg',
  './src/nav/couches.css',
  './src/nav/couches.js',
  './src/nav/icone-fermer-bandeau.svg',
  './src/nav/icone-reglages.svg',
  './src/nav/icone-reinitialiser-vue.svg',
  './src/nav/icone-saisie.svg',
  './src/nav/mesure.css',
  './src/nav/mesure.js',
  './src/nav/mesureIcones.js',
  './src/nav/nav.css',
  './src/nav/nav.js',
  './src/network.js',
  './src/orthoPicker.js',
  './src/orthoSelectionStore.js',
  './src/patrimoineLayer.js',
  './src/patrimoinePicker.js',
  './src/patrimoineSelectionStore.js',
  './src/peLabelAnchors.js',
  './src/peLabelEditor/README.md',
  './src/peLabelEditor/pe-label-editor.css',
  './src/peLabelEditor/pe-label-editor.js',
  './src/pickerDefaultBar.js',
  './src/plansPrefs.js',
  './src/plugins.js',
  './src/referentiel.js',
  './src/reglages/attributs.js',
  './src/reglages/reglages.css',
  './src/reglages/reglages.js',
  './src/reglages/serveur.js',
  './src/router.js',
  './src/scaleControl.js',
  './src/scaledText.js',
  './src/screenshotTool.js',
  './src/searchTool.js',
  './src/selectionStore.js',
  './src/services.js',
  './src/settingsPanel.js',
  './src/shpLoader.js',
  './src/signal/README.md',
  './src/signal/all.js',
  './src/signal/entries.js',
  './src/signal/form.js',
  './src/signal/icone-objectif.svg',
  './src/signal/icone-punaise.svg',
  './src/signal/img/amiante.svg',
  './src/signal/list.js',
  './src/signal/mapPicker.js',
  './src/signal/shims.js',
  './src/signal/signal.css',
  './src/signal/signal.js',
  './src/signalements/README.md',
  './src/signalements/depot.js',
  './src/signalements/envoi.js',
  './src/signalements/importer.js',
  './src/signalements/pdf.js',
  './src/signalements/zip-reader.js',
  './src/signalements/zip-writer.js',
  './src/signalementsLayer.js',
  './src/swRegister.js',
  './src/tuilesGeom.js',
  './src/tuningSynoptique.css',
  './src/tuningSynoptique.js',
  './src/urbisTopoLayer.js',
  './src/urbisTopoPicker.js',
  './src/urbisTopoSelectionStore.js',
  './src/virtualBoreTool.js',
  './src/zoomThresholds.js',
  './style.css',
  './vendor/html2canvas/html2canvas.min.js',
  './vendor/jspdf/LICENSE',
  './vendor/jspdf/jspdf.umd.min.js',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/polygon-clipping/LICENSE.md',
  './vendor/polygon-clipping/polygon-clipping.umd.min.js',
  './vendor/proj4/proj4.js',
  './vendor/proj4leaflet/proj4leaflet.js',
];
// @FIN-FICHIERS

importScripts('./src/horsLigne/magasin.js');
const HL = self.AMGT4CEM_HorsLigne;

// ------------------------------------------------------------------ cycle de vie
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Un fichier manquant ne doit pas empêcher l'installation : chacun est gardé séparément.
    await Promise.allSettled(FICHIERS.map(async (f) => {
      const rep = await fetch(new Request(f, { cache: 'reload' }));
      if (rep.ok) await cache.put(f, rep);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    reprendreSiBesoin();
  })());
});

// ------------------------------------------------------------------ ouverture sans réseau
async function reseauPuisCopie(request) {
  const cache = await caches.open(CACHE);
  const copie = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
  const reseau = fetch(request).then((rep) => {
    if (rep && rep.ok && rep.type === 'basic') cache.put(request, rep.clone()).catch(() => {});
    return rep;
  });
  if (!copie) {
    // Jamais vu : le réseau ; hors ligne, une page de l'application (adresse sans nom de fichier, par exemple) retombe sur home.html.
    return reseau.catch(async (err) => {
      if (request.mode === 'navigate') { const accueil = await cache.match('./home.html', { ignoreSearch: true }); if (accueil) return accueil; }
      throw err;
    });
  }
  const delai = new Promise((ok) => setTimeout(() => ok(null), DELAI_RESEAU_MS));
  try {
    const rep = await Promise.race([reseau, delai]);
    return rep || copie;
  } catch (err) {
    return copie;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  reprendreSiBesoin(); // chaque ouverture de l'application relance un téléchargement interrompu
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // tuiles, services de la Région, relais, comptes : jamais interceptés
  if (url.pathname.endsWith('/sw.js')) return;
  event.respondWith(reseauPuisCopie(req));
});

// ------------------------------------------------------------------ téléchargement des tuiles
let enCours = false;

function adresse(cfg, cle) {
  const [z, x, y] = cle.split('/').map(Number);
  const sep = cfg.url.includes('?') ? '&' : '?';
  return `${cfg.url}${sep}service=WMTS&request=GetTile&version=1.0.0&layer=${encodeURIComponent(cfg.layer)}&style=`
    + `&tilematrixset=${encodeURIComponent(cfg.tileMatrixSet)}&tilematrix=${encodeURIComponent(cfg.tileMatrixSet)}:${z}`
    + `&tilerow=${y}&tilecol=${x}&format=${encodeURIComponent(cfg.format || 'image/png')}`;
}

async function diffuser(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  clients.forEach((c) => c.postMessage(msg));
}

/** Avancement d'un travail : { faites, total } d'après ce qui est réellement gardé. */
function avancement(t) {
  let faites = 0;
  for (const k of t.cles) if (HL.index.has(k)) faites += 1;
  return { faites, total: t.cles.length };
}

async function lancer() {
  if (enCours) return;
  enCours = true;
  try {
    await HL.ouvrir();
    await HL.recharger();
    let t = await HL.lireTravail();
    if (!t || t.etat !== 'actif') return;
    const restantes = t.cles.filter((k) => !HL.index.has(k));
    let i = 0; let reussies = 0; let erreurs = t.erreurs || 0; let fatal = null;
    let ajoutees = []; let derniere = 0;
    const envoyer = async (force) => {
      const maintenant = Date.now();
      if (!force && maintenant - derniere < 400) return;
      derniere = maintenant;
      const a = avancement(t);
      const lot = ajoutees; ajoutees = [];
      await diffuser({ type: 'progression', faites: a.faites, total: a.total, erreurs, etat: 'actif', ajoutees: lot });
    };
    async function travailleur() {
      while (i < restantes.length && !fatal) {
        const cle = restantes[i]; i += 1;
        const cur = await HL.lireTravail();
        if (!cur || cur.etat !== 'actif') { fatal = 'arret'; return; }
        try {
          const rep = await fetch(adresse(t.cfg, cle), { mode: 'cors', cache: 'no-store' });
          if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
          const b = await rep.blob();
          if (!/^image\//.test(b.type) || b.size < 50) throw new Error('réponse inattendue');
          try { await HL.ecrire(cle, b); reussies += 1; ajoutees.push([cle, b.size]); } catch (err) { fatal = 'Le stockage de l\'appareil est plein ou refusé.'; }
        } catch (err) {
          erreurs += 1;
          if (reussies === 0 && erreurs >= 12) fatal = 'Le service de cartes ne répond pas ou n\'autorise pas la lecture depuis cette application.';
        }
        await envoyer(false);
      }
    }
    await Promise.all(Array.from({ length: PARALLELE }, travailleur));
    t = (await HL.lireTravail()) || t;
    const a = avancement(t);
    if (fatal === 'arret' || t.etat === 'arret') {
      await diffuser({ type: 'progression', faites: a.faites, total: a.total, erreurs, etat: 'arret', ajoutees });
    } else if (fatal) {
      t.etat = 'erreur'; t.message = fatal; t.erreurs = erreurs;
      await HL.ecrireTravail(t);
      await diffuser({ type: 'progression', faites: a.faites, total: a.total, erreurs, etat: 'erreur', message: fatal, ajoutees });
    } else {
      t.etat = 'fini'; t.erreurs = erreurs;
      await HL.ecrireTravail(t);
      await diffuser({ type: 'progression', faites: a.faites, total: a.total, erreurs, etat: 'fini', ajoutees });
    }
  } finally {
    enCours = false;
  }
}

/** Reprend un travail resté « actif » (service worker arrêté par le navigateur, application fermée). */
function reprendreSiBesoin() {
  if (enCours) return;
  HL.ouvrir().then(() => HL.lireTravail()).then((t) => { if (t && t.etat === 'actif') lancer(); }).catch(() => {});
}

self.addEventListener('message', (event) => {
  const m = event.data || {};
  if (m.type === 'telecharger') {
    event.waitUntil((async () => {
      await HL.ouvrir();
      await HL.ecrireTravail({ cles: m.cles, cfg: m.cfg, etat: 'actif', erreurs: 0, debut: Date.now() });
      await lancer();
    })());
  } else if (m.type === 'arret') {
    event.waitUntil((async () => {
      await HL.ouvrir();
      const t = await HL.lireTravail();
      if (t) { t.etat = 'arret'; await HL.ecrireTravail(t); }
    })());
  } else if (m.type === 'etat') {
    event.waitUntil((async () => {
      await HL.ouvrir();
      await HL.recharger();
      const t = await HL.lireTravail();
      const a = t ? avancement(t) : { faites: 0, total: 0 };
      if (event.source) event.source.postMessage({ type: 'etat', version: VERSION, travail: t ? { etat: t.etat, message: t.message || '', erreurs: t.erreurs || 0, ...a } : null });
      if (t && t.etat === 'actif') reprendreSiBesoin();
    })());
  }
});

// Android (Chrome) : le navigateur relance ce travail s'il a été interrompu, même application fermée.
self.addEventListener('sync', (event) => {
  if (event.tag === 'hl-tuiles') event.waitUntil(lancer());
});
