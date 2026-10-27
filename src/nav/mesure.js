/**
 * Outils de mesure de la page Carte (home.html?page=carto) : un seul bouton « latte » en haut à droite.
 *
 *  - Appui court : l'outil utilisé en dernier (la chaîne d'arpenteur au premier usage) ; un nouvel appui l'arrête.
 *  - Appui long (500 ms) : la latte glisse vers la gauche et laisse apparaître les deux outils :
 *      · chaîne d'arpenteur : on touche la carte point après point (la carte reste déplaçable) ; longueur de chaque
 *        tronçon, longueur cumulée, et surface si l'on referme la ligne sur son premier point ;
 *      · compas : le rayon, outil existant (src/measureTool.js, inchangé).
 *  - Le résultat reste affiché le délai réglé dans Réglages > Mon appareil (0 = jusqu'à « Fermer »).
 *  - Disquette : enregistre une image de la carte avec la mesure (src/screenshotTool.js, inchangé) ;
 *    croix : ferme l'outil.
 *
 * Les anciens boutons (règle, 💾) existent toujours dans la page mais sont masqués (mesure.css) ; les outils
 * existants sont pilotés d'ici sans être modifiés (seules quelques méthodes de AMGT4CEM_MeasureTool sont
 * enveloppées, dans cette page seulement).
 */
(function () {
const R = typeof AMGT4CEM_Router !== 'undefined' ? AMGT4CEM_Router : null;
if (!R || R.mode !== 'page' || R.app !== 'carto') return;

const COULEUR = '#f50057';
const CLE_DERNIER = 'amgt4cem.mesure.dernier.v1';
const APPUI_LONG_MS = 500;
const GLISSE_PX = 54; // largeur d'un bouton (46) + espace (8)

const svgIcone = (contenu) => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${contenu}</svg>`;
const ICONES = {
  disquette: svgIcone('<path d="M5 3h11.5L21 7.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3"/><path d="M7 21v-8h10v8"/>'),
  fermer: svgIcone('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9l6 6M15 9l-6 6"/>'),
  annuler: svgIcone('<g transform="matrix(-1 0 0 1 24 0)"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.5v4.5h-4.5"/></g>'),
  terminer: svgIcone('<path d="M4.5 12.5l5 5 10-11"/>'),
  latte: '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(-35 24 24)"><rect x="5" y="16" width="38" height="16" rx="1.8"/><line x1="11" y1="16" x2="11" y2="24"/><line x1="17" y1="16" x2="17" y2="21"/><line x1="23" y1="16" x2="23" y2="24"/><line x1="29" y1="16" x2="29" y2="21"/><line x1="35" y1="16" x2="35" y2="24"/></g></svg>',
};

/** Les trois variantes (téléphone, tablette, PC) d'une icône d'outil ; mesure.css n'en montre qu'une. */
function iconeOutil(nom) {
  const tous = window.AMGT4CEM_MESURE_ICONES || {};
  return ['tel', 'tab', 'pc'].map((k) => {
    const d = tous[`${nom}_${k}`];
    if (!d) return '';
    return `<svg class="mes-ic mes-ic--${k}" viewBox="${d.vb}" aria-hidden="true" focusable="false">${d.inner}</svg>`;
  }).join('');
}

const h = (tag, attrs, html) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  if (html) n.innerHTML = html;
  return n;
};
const bouton = (id, classe, titre, html) => {
  const b = h('button', { type: 'button', id, class: `amgt-btn mes-btn ${classe || ''}`, title: titre, 'aria-label': titre }, html);
  return b;
};

const fmtDist = (m) => AMGT4CEM_MeasureTool._formatDistance(m);
const fmtSurface = (m2) => (m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${m2.toFixed(1)} m²`);

/** Surface (m²) d'un polygone en latitude/longitude : plan local centré sur le polygone (suffisant à l'échelle d'un chantier). */
function surface(pts) {
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lng0 = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110574;
  const xy = pts.map((p) => [(p.lng - lng0) * kx, (p.lat - lat0) * ky]);
  let a = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

// ------------------------------------------------------------------ chaîne d'arpenteur
const Chaine = {
  actif: false,
  pts: [],
  ferme: false,
  fini: false,
  _couches: [],
  _timer: null,

  map() { return AMGT4CEM_MeasureTool._map; },

  demarrer() {
    const map = this.map();
    this.actif = true;
    AMGT4CEM_ScreenshotTool.invalidateBackground();
    this._onClic = (e) => this.clic(e.latlng);
    this._onPopup = (e) => e.popup.close(); // un clic sur une station ou un tunnel n'ouvre pas sa fiche pendant la mesure
    map.on('click', this._onClic);
    map.on('popupopen', this._onPopup);
    map.getContainer().classList.add('amgt-placing-mode');
    this.vider();
  },

  arreter() {
    if (!this.actif) return;
    const map = this.map();
    this.actif = false;
    map.off('click', this._onClic);
    map.off('popupopen', this._onPopup);
    map.getContainer().classList.remove('amgt-placing-mode');
    this.vider();
    AMGT4CEM_ScreenshotTool.invalidateBackground();
  },

  /** Efface le tracé (pas l'outil). */
  vider() {
    clearTimeout(this._timer);
    this._timer = null;
    this._couches.forEach((c) => this.map().removeLayer(c));
    this._couches = [];
    this.pts = [];
    this.ferme = false;
    this.fini = false;
    AMGT4CEM_ScreenshotTool.discardIfUnsaved();
    Mesure.majControles();
  },

  clic(latlng) {
    if (this.fini) this.vider(); // un résultat est affiché : un nouvel appui recommence une chaîne
    const map = this.map();
    if (this.pts.length >= 3) {
      const a = map.latLngToContainerPoint(this.pts[0]);
      const b = map.latLngToContainerPoint(latlng);
      if (a.distanceTo(b) <= 16) { this.fermer(); return; }
    }
    this.pts.push(latlng);
    this.dessiner();
    Mesure.majControles();
  },

  annuler() {
    if (this.fini) { this.fini = false; this.ferme = false; clearTimeout(this._timer); AMGT4CEM_ScreenshotTool.discardIfUnsaved(); }
    this.pts.pop();
    this.dessiner();
    Mesure.majControles();
  },

  fermer() {
    this.ferme = true;
    this.terminer();
  },

  terminer() {
    if (this.pts.length < 2) return;
    this.fini = true;
    this.dessiner();
    Mesure.majControles();
    AMGT4CEM_ScreenshotTool.capture();
    clearTimeout(this._timer);
    const delai = Reglages().delaiMesureMs();
    if (delai > 0) this._timer = setTimeout(() => this.vider(), delai);
  },

  /** Longueur de chaque tronçon (le dernier ferme la ligne si elle est refermée). */
  troncons() {
    const map = this.map();
    const n = this.pts.length;
    const res = [];
    for (let i = 0; i < n - 1; i++) res.push({ a: this.pts[i], b: this.pts[i + 1], m: map.distance(this.pts[i], this.pts[i + 1]) });
    if (this.ferme && n >= 3) res.push({ a: this.pts[n - 1], b: this.pts[0], m: map.distance(this.pts[n - 1], this.pts[0]) });
    return res;
  },

  total() { return this.troncons().reduce((s, t) => s + t.m, 0); },

  texteResultat() {
    if (this.pts.length < 2) return '';
    const l = this.ferme ? `Périmètre : ${fmtDist(this.total())}` : `Longueur : ${fmtDist(this.total())}`;
    return this.ferme ? `${l} · Surface : ${fmtSurface(surface(this.pts))}` : l;
  },

  dessiner() {
    const map = this.map();
    this._couches.forEach((c) => map.removeLayer(c));
    this._couches = [];
    const pane = 'amgtMeasurePane';
    const ajout = (c) => { c.addTo(map); this._couches.push(c); };
    if (this.pts.length >= 2) {
      const lignes = this.ferme ? [...this.pts, this.pts[0]] : this.pts;
      if (this.ferme) ajout(L.polygon(this.pts, { pane, color: COULEUR, weight: 2.5, fillColor: COULEUR, fillOpacity: 0.1, interactive: false }));
      else ajout(L.polyline(lignes, { pane, color: COULEUR, weight: 2.5, interactive: false }));
    }
    this.pts.forEach((p, i) => ajout(L.circleMarker(p, { pane, radius: i === 0 ? 6 : 4, color: COULEUR, weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false })));
    for (const t of this.troncons()) {
      const a = map.latLngToContainerPoint(t.a);
      const b = map.latLngToContainerPoint(t.b);
      if (a.distanceTo(b) < 46) continue; // tronçon trop court à l'écran : pas de place pour la cote
      const span = h('span', { class: 'amgt-measure-label__text' });
      span.textContent = fmtDist(t.m);
      span.style.transform = 'translate(-50%, -50%)';
      ajout(L.marker(map.containerPointToLatLng(a.add(b).divideBy(2)), { icon: L.divIcon({ className: 'amgt-measure-label', html: span }), interactive: false, pane }));
    }
    Mesure.majResume();
  },

  /** Même tracé sur le canvas de la capture (contexte déjà en pixels CSS de la carte). */
  dessinerCapture(ctx) {
    if (!this.actif || this.pts.length < 1) return;
    const map = this.map();
    const P = this.pts.map((p) => map.latLngToContainerPoint(p));
    ctx.save();
    if (P.length >= 2) {
      ctx.beginPath();
      P.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (this.ferme) { ctx.closePath(); ctx.fillStyle = 'rgba(245, 0, 87, 0.1)'; ctx.fill(); }
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = COULEUR;
      ctx.stroke();
    }
    P.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === 0 ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    const boite = (texte, cx, cy, ancre) => {
      ctx.font = 'bold 12px system-ui, -apple-system, "Segoe UI", sans-serif';
      const w = ctx.measureText(texte).width + 10;
      const x = ancre === 'centre' ? cx - w / 2 : cx;
      const y = ancre === 'centre' ? cy - 12 : cy;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.fillRect(x, y, w, 24);
      ctx.fillStyle = COULEUR;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(texte, x + 5, y + 12);
    };
    for (const t of this.troncons()) {
      const a = map.latLngToContainerPoint(t.a);
      const b = map.latLngToContainerPoint(t.b);
      if (a.distanceTo(b) < 46) continue;
      const m = a.add(b).divideBy(2);
      boite(fmtDist(t.m), m.x, m.y, 'centre');
    }
    const texte = this.texteResultat();
    if (texte) boite(texte, 10, 10, 'coin');
    ctx.restore();
  },
};

/** Délai d'affichage du résultat : Réglages > Mon appareil (même clé que src/reglages/reglages.js, non chargé dans cette page). */
const Reglages = () => ({
  delaiMesureMs() {
    try {
      const brut = localStorage.getItem('amgt4cem.mesure.delaiMs.v1');
      const v = Number(brut);
      if (brut !== null && Number.isFinite(v) && v >= 0) return v;
    } catch (err) { /* réglage local indisponible : valeur par défaut */ }
    return 5000;
  },
});

// ------------------------------------------------------------------ boutons et pilotage des deux outils
const Mesure = {
  outil: null, // 'chaine' | 'compas' | null
  _bloc: null,
  _timerAppui: null,
  _appuiLong: false,

  dernier() {
    try { const v = localStorage.getItem(CLE_DERNIER); if (v === 'compas' || v === 'chaine') return v; } catch (err) { /* réglage local indisponible */ }
    return 'chaine';
  },
  retenir(o) { try { localStorage.setItem(CLE_DERNIER, o); } catch (err) { /* valable pour la session seulement */ } },

  init() {
    const haut = document.getElementById('amgt-topright');
    const ancienne = document.getElementById('amgt-measure-btn');
    if (!haut || !ancienne || typeof AMGT4CEM_MeasureTool === 'undefined') return;

    // --- bloc latte (+ plateau des deux outils) à la place de la règle
    const bloc = h('div', { id: 'mes-bloc', class: 'mes-bloc' });
    this._chaineBtn = bouton('mes-chaine', 'mes-btn--outil', 'Chaîne d\'arpenteur : longueurs et surface', iconeOutil('chaine'));
    this._compasBtn = bouton('mes-compas', 'mes-btn--outil', 'Compas : rayon', iconeOutil('compas'));
    this._latte = bouton('mes-latte', 'mes-btn--latte', 'Mesurer (appui long : choisir l\'outil)', ICONES.latte);
    bloc.append(this._chaineBtn, this._compasBtn, this._latte);
    ancienne.after(bloc);
    this._bloc = bloc;

    // --- commandes de l'outil actif, sous le forage virtuel
    const cmd = h('div', { id: 'mes-cmd', class: 'mes-cmd' });
    this._fermer = bouton('mes-fermer', 'mes-btn--cmd', 'Fermer la mesure', ICONES.fermer);
    this._disquette = bouton('mes-disquette', 'mes-btn--cmd', 'Enregistrer une image de la mesure', ICONES.disquette);
    this._terminer = bouton('mes-terminer', 'mes-btn--cmd', 'Terminer la chaîne', ICONES.terminer);
    this._annuler = bouton('mes-annuler', 'mes-btn--cmd', 'Annuler le dernier point', ICONES.annuler);
    cmd.append(this._fermer, this._disquette, this._terminer, this._annuler);
    haut.append(cmd);

    // --- résultat de la chaîne (hors de la carte : il n'entre pas dans la capture HTML, il est dessiné à part)
    this._resume = h('div', { id: 'mes-resume', class: 'mes-resume', role: 'status', hidden: '' });
    document.body.append(this._resume);

    this._brancherLatte();
    this._chaineBtn.addEventListener('click', () => this.choisir('chaine'));
    this._compasBtn.addEventListener('click', () => this.choisir('compas'));
    this._fermer.addEventListener('click', () => this.arreter());
    this._terminer.addEventListener('click', () => Chaine.terminer());
    this._annuler.addEventListener('click', () => Chaine.annuler());
    this._disquette.addEventListener('click', () => document.getElementById('amgt-screenshot-btn').click());
    document.addEventListener('pointerdown', (e) => { if (!bloc.contains(e.target)) this.fermerPlateau(); });

    this._envelopper();
    this.majControles();
  },

  /** Quelques méthodes de l'outil « rayon » sont enveloppées (dans cette page seulement) : délai réglable,
   *  disparition de l'outil quand un autre prend la main, état des boutons, tracé de la chaîne dans la capture. */
  _envelopper() {
    const M = AMGT4CEM_MeasureTool;
    const deactivate = M.deactivate.bind(M);
    M.deactivate = () => {
      deactivate();
      if (Mesure.outil === 'compas') Mesure.outil = null;
      if (Mesure.outil === 'chaine' && !Mesure._transition) { Chaine.arreter(); Mesure.outil = null; }
      Mesure.majControles();
    };
    const relache = M._handleRelease.bind(M);
    M._handleRelease = () => {
      const delai = Reglages().delaiMesureMs();
      M._hideDelayMs = delai > 0 ? delai : 4000;
      relache();
      if (delai === 0) { clearTimeout(M._clearTimer); M._clearTimer = null; }
      Mesure.majControles();
    };
    const vide = M._clearMeasurement.bind(M);
    M._clearMeasurement = () => { vide(); Mesure.majControles(); };
    const dessin = M.drawOverlayOnContext.bind(M);
    M.drawOverlayOnContext = (ctx) => { dessin(ctx); Chaine.dessinerCapture(ctx); };
  },

  _brancherLatte() {
    const b = this._latte;
    const annule = () => { clearTimeout(this._timerAppui); this._timerAppui = null; };
    b.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      this._appuiLong = false;
      annule();
      this._timerAppui = setTimeout(() => { this._appuiLong = true; this._timerAppui = null; this.ouvrirPlateau(); }, APPUI_LONG_MS);
    });
    b.addEventListener('pointerup', () => {
      const long = this._appuiLong;
      const enCours = this._timerAppui !== null;
      annule();
      if (!long && enCours) this.toucher();
    });
    b.addEventListener('pointercancel', annule);
    b.addEventListener('pointerleave', annule);
    b.addEventListener('contextmenu', (e) => e.preventDefault()); // l'appui long ne doit pas ouvrir le menu du navigateur
    b.addEventListener('click', (e) => { if (e.detail === 0) this.toucher(); }); // clavier
  },

  /** Appui court. */
  toucher() {
    if (this._bloc.classList.contains('mes-bloc--ouvert')) { this.fermerPlateau(); return; }
    if (this.outil) this.arreter();
    else this.demarrer(this.dernier());
  },

  ouvrirPlateau() {
    this._bloc.classList.add('mes-bloc--ouvert');
    this._bloc.style.setProperty('--mes-glisse', `${GLISSE_PX}px`);
  },
  fermerPlateau() { this._bloc.classList.remove('mes-bloc--ouvert'); },

  choisir(o) {
    this.fermerPlateau();
    this.demarrer(o);
  },

  demarrer(o) {
    AMGT4CEM_AddPointTool.deactivate();
    AMGT4CEM_VirtualBoreTool.deactivate();
    if (typeof AMGT4CEM_Plugins !== 'undefined') AMGT4CEM_Plugins.notifyCoreToolActivated('measure');
    this._transition = true; // l'arrêt de l'outil précédent fait partie du changement d'outil
    if (this.outil === 'chaine') Chaine.arreter();
    AMGT4CEM_MeasureTool.deactivate();
    this._transition = false;
    this.outil = o;
    this.retenir(o);
    if (o === 'chaine') Chaine.demarrer();
    else {
      AMGT4CEM_MeasureTool._hideDelayMs = Reglages().delaiMesureMs() || 4000;
      AMGT4CEM_MeasureTool.activate();
    }
    this.majControles();
  },

  arreter() {
    this.fermerPlateau();
    if (this.outil === 'chaine') Chaine.arreter();
    this.outil = null;
    AMGT4CEM_MeasureTool.deactivate();
    this.majControles();
  },

  /** Un résultat est-il affiché (donc enregistrable) ? */
  aResultat() {
    if (this.outil === 'chaine') return Chaine.fini;
    if (this.outil === 'compas') return !!AMGT4CEM_MeasureTool._circle && AMGT4CEM_MeasureTool._state === 'idle';
    return false;
  },

  majControles() {
    if (!this._bloc) return;
    const o = this.outil;
    this._latte.classList.toggle('amgt-btn--active', !!o);
    this._chaineBtn.classList.toggle('amgt-btn--active', o === 'chaine');
    this._compasBtn.classList.toggle('amgt-btn--active', o === 'compas');
    const montre = (b, oui) => b.classList.toggle('mes-cache', !oui);
    montre(this._fermer, !!o);
    montre(this._disquette, this.aResultat());
    montre(this._terminer, o === 'chaine' && !Chaine.fini && Chaine.pts.length >= 2);
    montre(this._annuler, o === 'chaine' && Chaine.pts.length >= 1);
    this.majResume();
  },

  majResume() {
    if (!this._resume) return;
    const texte = this.outil === 'chaine' ? Chaine.texteResultat() : '';
    this._resume.textContent = texte;
    this._resume.hidden = !texte;
  },
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Mesure.init());
else Mesure.init();
window.AMGT4CEM_Mesure = Mesure;
})();
