/**
 * Page jetable ?page=lambert : essai d'une carte AFFICHÉE EN LAMBERT 72 (EPSG:31370), séparée de la carte principale.
 *
 * Pourquoi : le service de tuiles UrbIS ne propose plus la grille Web Mercator (EPSG:900913) pour la couche grise
 * (constaté le 26/11/2026) ; il garde officiellement les grilles Lambert 72 (EPSG:31370) et Lambert 2008 (EPSG:3812).
 * Cette page vérifie, sans rien changer à la carte principale :
 *  1. que les tuiles Lambert 72 s'affichent (gris et couleur) ;
 *  2. que les géométries du projet (shapefile des polygones, en Lambert 72) tombent au bon endroit ;
 *  3. que l'échelle et le niveau de zoom de l'application (src/scaleControl.js) sont justes dans ce système ;
 *  4. ce que valent les niveaux de zoom (mètres par pixel), pour recaler les seuils d'affichage.
 *
 * Grille des tuiles : relevée dans le GetCapabilities du service (TileMatrixSet « EPSG:31370 », 16 niveaux de 256 px) :
 * coin haut-gauche (16478 ; 304073), dénominateur d'échelle du niveau 0 = 3 973 618,066406251, divisé par 2 à chaque niveau.
 * Résolution (m/pixel) = dénominateur × 0,00028 (pixel standard OGC de 0,28 mm).
 */
const AMGT4CEM_LambertTest = (function () {
  const GRILLE = {
    matrice: 'EPSG:31370',
    origine: [16478, 304073], // [X, Y] du coin haut-gauche de la tuile (0, 0)
    echelle0: 3973618.066406251,
    niveaux: 16,
    pixelOGC: 0.00028,
  };
  const SERVICE_PAR_DEFAUT = 'https://geoservices-basemap.irisnet.be/geowebcache/service/wmts';
  const COUCHES = [
    { cle: 'gris', libelle: 'Gris', couche: 'UrbISFrenchLabeledGray' },
    { cle: 'couleur', libelle: 'Couleur', couche: 'UrbISFrenchLabeledColor' },
  ];
  const ZOOM_DEPART = 4;

  const resolutions = Array.from({ length: GRILLE.niveaux }, (_, z) => GRILLE.echelle0 * GRILLE.pixelOGC / 2 ** z);

  const S = { map: null, crs: null, fond: null, poly: null, couche: 'gris', ok: 0, erreurs: 0, nbPoly: null, urlService: SERVICE_PAR_DEFAUT };

  /** CRS Leaflet « Lambert 72 », avec la grille des tuiles de la Région. La distance se calcule dans le plan Lambert (en mètres au sol). */
  function creerCrs() {
    const crs = new L.Proj.CRS(AMGT4CEM_CONFIG.businessCRS.epsg, AMGT4CEM_CONFIG.businessCRS.proj4def, {
      origin: GRILLE.origine,
      resolutions,
    });
    // L.Proj.CRS n'a pas de calcul de distance : sans lui, l'échelle de Leaflet et celle de l'application échouent. Lambert 72 est
    // conforme et son facteur d'échelle vaut presque 1 sur Bruxelles : la distance dans le plan est la distance au sol (à quelques cm/km près).
    crs.distance = function (a, b) {
      const p = this.project(a); const q = this.project(b);
      return Math.hypot(q.x - p.x, q.y - p.y);
    };
    return crs;
  }

  /** Adresse d'une tuile (modèle Leaflet {z} {x} {y}), couche au choix. */
  function modeleTuiles(couche) {
    const sep = S.urlService.includes('?') ? '&' : '?';
    return `${S.urlService}${sep}service=WMTS&request=GetTile&version=1.0.0&layer=${encodeURIComponent(couche)}&style=`
      + `&tilematrixset=${encodeURIComponent(GRILLE.matrice)}&tilematrix=${encodeURIComponent(GRILLE.matrice)}:{z}`
      + '&tilerow={y}&tilecol={x}&format=image%2Fpng';
  }

  function poserFond(cle) {
    const def = COUCHES.find((c) => c.cle === cle) || COUCHES[0];
    S.couche = def.cle;
    S.ok = 0; S.erreurs = 0;
    if (S.fond) S.map.removeLayer(S.fond);
    S.fond = L.tileLayer(modeleTuiles(def.couche), {
      tileSize: 256, minZoom: 0, maxZoom: GRILLE.niveaux - 1, noWrap: true,
      attribution: '&copy; CIRB/CIBG &ndash; UrbIS',
    });
    S.fond.on('tileload', () => { S.ok += 1; majInfo(); });
    S.fond.on('tileerror', () => { S.erreurs += 1; majInfo(); });
    S.fond.addTo(S.map);
    S.fond.bringToBack();
    for (const b of document.querySelectorAll('[data-lt-fond]')) b.classList.toggle('lt-btn--on', b.dataset.ltFond === S.couche);
    majInfo();
  }

  async function poserPolygones(afficher) {
    const bouton = document.querySelector('[data-lt-poly]');
    if (!afficher) {
      if (S.poly) S.map.removeLayer(S.poly);
      if (bouton) bouton.classList.remove('lt-btn--on');
      return;
    }
    if (!S.poly) {
      try {
        const fc = await AMGT4CEM_ShpLoader.load('./data/shapefile/polygones');
        S.poly = L.layerGroup();
        let n = 0;
        for (const f of fc.features) {
          const g = f.geometry;
          const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
          for (const rings of polys) {
            // Même conversion que sur la carte principale : Lambert 72 -> lat/lon ; c'est le CRS de la carte qui reprojette ensuite.
            L.polygon(rings.map((r) => r.map((pt) => AMGT4CEM_CRS.lambertToLatLng(pt))), { weight: 1.2, color: '#b42318', fill: false, interactive: false }).addTo(S.poly);
            n += 1;
          }
        }
        S.nbPoly = n;
      } catch (err) {
        S.nbPoly = `erreur : ${err.message}`;
        majInfo();
        return;
      }
    }
    S.poly.addTo(S.map);
    if (bouton) bouton.classList.add('lt-btn--on');
    majInfo();
  }

  const fmt = (v, d = 0) => Number(v).toLocaleString('fr-BE', { minimumFractionDigits: d, maximumFractionDigits: d });

  function majInfo() {
    const el = document.getElementById('lt-info');
    if (!el || !S.map) return;
    const z = S.map.getZoom();
    const res = resolutions[Math.round(z)] || 0;
    const c = AMGT4CEM_CRS.latLngToLambert(S.map.getCenter());
    // 1 pixel d'écran = 0,28 mm dans la convention OGC : échelle = résolution / 0,00028.
    const lignes = [
      `Zoom ${fmt(z)} sur ${GRILLE.niveaux - 1} · ${fmt(res, 2)} m par pixel · échelle OGC 1:${fmt(res / GRILLE.pixelOGC)}`,
      `Centre Lambert 72 : X ${fmt(c.x)} · Y ${fmt(c.y)}`,
      `Tuiles ${S.couche} : ${S.ok} chargées, ${S.erreurs} en erreur${S.erreurs && !S.ok ? ' (service injoignable ou grille refusée ?)' : ''}`,
      `Polygones du réseau : ${S.nbPoly === null ? 'non affichés' : typeof S.nbPoly === 'number' ? `${S.nbPoly} contours` : S.nbPoly}`,
    ];
    el.replaceChildren(...lignes.map((t) => { const d = document.createElement('div'); d.textContent = t; return d; }));
  }

  function construireEntete() {
    const ent = document.getElementById('lt-entete');
    const titre = document.createElement('div');
    titre.className = 'lt-titre';
    titre.textContent = 'Essai : carte en Lambert 72';
    const rang = document.createElement('div');
    rang.className = 'lt-boutons';
    for (const c of COUCHES) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'lt-btn'; b.textContent = c.libelle; b.dataset.ltFond = c.cle;
      b.addEventListener('click', () => poserFond(c.cle));
      rang.append(b);
    }
    const p = document.createElement('button');
    p.type = 'button'; p.className = 'lt-btn'; p.textContent = 'Polygones'; p.dataset.ltPoly = '1';
    p.addEventListener('click', () => poserPolygones(!(S.poly && S.map.hasLayer(S.poly))));
    rang.append(p);
    const retour = document.createElement('a');
    retour.className = 'lt-btn lt-lien'; retour.textContent = 'Carte'; retour.href = './home.html?page=carto';
    rang.append(retour);
    const info = document.createElement('div');
    info.id = 'lt-info'; info.className = 'lt-info';
    ent.append(titre, rang, info);
  }

  async function demarrer() {
    construireEntete();
    try { await AMGT4CEM_Services.load(); } catch (err) { /* repli : adresse par défaut */ }
    const t = AMGT4CEM_Services.tuilesConfig && AMGT4CEM_Services.tuilesConfig();
    if (t && t.url) S.urlService = t.url;
    S.crs = creerCrs();
    S.map = L.map('lt-carte', { crs: S.crs, zoomControl: false, attributionControl: false, minZoom: 0, maxZoom: GRILLE.niveaux - 1, center: [50.85, 4.37], zoom: ZOOM_DEPART });
    L.control.attribution({ prefix: false }).addTo(S.map);
    L.control.zoom({ position: 'topright' }).addTo(S.map);
    AMGT4CEM_BuildInfoControl.init(S.map);
    AMGT4CEM_ScaleControl.init(S.map); // l'échelle et le niveau de zoom de la carte principale, tels quels
    poserFond('gris');
    S.map.on('moveend zoomend', majInfo);
    new ResizeObserver(() => S.map.invalidateSize()).observe(document.getElementById('lt-carte-zone'));
    majInfo();
  }

  demarrer(); // le routeur a déjà inséré le gabarit de la page avant de charger les scripts

  return { GRILLE, resolutions, creerCrs, modeleTuiles };
})();
