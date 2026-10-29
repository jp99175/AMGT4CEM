/**
 * Menu « Couches » de la page Carte de la nouvelle interface (home.html?page=carto).
 *
 * Le gabarit et les scripts de la carte sont ceux de l'interface actuelle (?app=carto), qui ne change pas : ce
 * module, chargé seulement par `pages.carto` (config.js), adapte le menu une fois la page construite :
 *   - « ☰ Carte » devient « ☰ Couches » ;
 *   - l'engrenage, l'icône de compte et la disquette disparaissent du menu (voir couches.css) : le compte est dans
 *     la barre de navigation, les réglages dans la page Réglages ;
 *   - un VISITEUR (non connecté) ne voit pas « Géotechnique » ni, par conséquent, le sondage virtuel (qui n'apparaît
 *     que couche cochée). Les données restent dans R2 public : seule l'interface les masque ;
 *   - « Mon affichage » : les couches cochées et opacités sont gardées toutes seules sur l'appareil (menuPrefs.js) ;
 *     « Revenir au défaut » reprend l'affichage par défaut qui s'applique à cet utilisateur ;
 *   - « Défaut pour tous » (droit `utilisateurs`) : enregistre l'affichage actuel comme défaut des utilisateurs
 *     connectés ou des visiteurs, par le relais (code administrateur, gardé le temps de l'onglet).
 */
(function () {
if (typeof AMGT4CEM_Router === 'undefined' || AMGT4CEM_Router.mode !== 'page' || AMGT4CEM_Router.app !== 'carto') return;

const h = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  for (const c of kids) if (c) n.append(c);
  return n;
};

/** Icônes de 23 px, trait de 0,8 px (0,835 unité sur 24), bleu des boutons (même trait, même taille), sans cadre de bouton : disquette, flèches, croix dans un carré. */
const svgIcone = (contenu) => `<svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="0.835" stroke-linecap="round" stroke-linejoin="round">${contenu}</svg>`;
const ICONES = {
  disquette: svgIcone('<path d="M5 3h11.5L21 7.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3"/><path d="M7 21v-8h10v8"/>'),
  horaire: svgIcone('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.5v4.5h-4.5"/>'), // ↻ réinitialiser la vue
  antihoraire: svgIcone('<g transform="matrix(-1 0 0 1 24 0)"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3.5v4.5h-4.5"/></g>'), // ↺ défaut
  fermer: svgIcone('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9l6 6M15 9l-6 6"/>'),
};
/** Bouton réduit à son icône (sans cadre). */
const boutonIcone = (icone, titre, classe) => {
  const b = h('button', { type: 'button', class: `amgt-ic-btn ${classe || ''}`.trim(), title: titre, 'aria-label': titre });
  b.innerHTML = ICONES[icone];
  return b;
};

const Couches = {
  _initial: null, // affichage du gabarit, avant tout réglage : sert de base à « Revenir au défaut »

  connecte() { return !!AMGT4CEM_Auth.session(); },
  admin() { const s = AMGT4CEM_Auth.session(); return !!s && AMGT4CEM_Auth.aDroit('utilisateurs', s); },

  init() {
    const bouton = document.getElementById('amgt-menu-btn');
    if (!bouton) return;
    bouton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="26" height="26" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"> <path d="M24 6 42 16 24 26 6 16Z"/> <path d="M6 24 24 34 42 24"/> <path d="M6 32 24 42 42 32"/> </svg>';
    bouton.title = 'Couches';
    bouton.setAttribute('aria-label', 'Couches');
    this._bandeau(bouton);
    this._selecteurs();

    this._initial = AMGT4CEM_MenuPrefs.capture();
    this._construireAffichage();

    // L'affichage de départ (menuPrefs.js) est posé par app.js une fois les couches prêtes : on repasse ensuite
    // sur les règles d'accès, qui l'emportent sur un affichage enregistré (ex. Géotechnique coché avant une déconnexion).
    const demarrage = AMGT4CEM_MenuPrefs.applyStartup.bind(AMGT4CEM_MenuPrefs);
    AMGT4CEM_MenuPrefs.applyStartup = () => { demarrage(); this.appliquerAcces(); };

    this.appliquerAcces();
    AMGT4CEM_Auth.onChange(() => { this.appliquerAcces(); this._majAdmin(); this._classeAdmin(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { this.appliquerAcces(); this._majAdmin(); this._classeAdmin(); } });
    this._classeAdmin();
  },

  // ---------------------------------------------------------------- bandeau latéral
  /** Titre du bandeau et voile : le voile suit l'ouverture du bandeau (la classe amgt-hidden est posée par mapMenu.js). */
  _bandeau(bouton) {
    const panneau = document.getElementById('amgt-map-menu');
    // En-tête du bandeau : le logo (cœur et deux feuilles) à la place du titre.
    const logo = h('div', { class: 'amgt-couches-logo', role: 'img', 'aria-label': 'Couches' });
    logo.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 344 217" aria-hidden="true" focusable="false"><defs><clipPath id="amgt-logo-petales"><path d="M158.0 206.0C157.0 206.2 156.3 207.1 154.2 205.8C152.2 204.5 148.3 200.4 145.5 198.3C142.7 196.2 140.3 194.8 137.5 193.3C134.7 191.9 131.4 190.4 128.5 189.4C125.6 188.4 123.2 187.9 120.2 187.4C117.3 186.8 114.0 186.4 110.8 186.2C107.5 186.0 107.2 185.6 100.5 186.4C93.8 187.1 77.8 190.0 70.5 190.8C63.2 191.6 61.4 191.6 56.5 191.3C51.6 191.0 45.0 189.9 41.1 189.0C37.3 188.1 35.6 186.9 33.5 185.9C31.4 184.8 30.4 184.3 28.2 182.8C26.1 181.3 23.2 179.2 20.8 176.8C18.3 174.5 15.6 171.2 13.8 168.6C11.9 166.1 10.9 164.6 9.6 161.5C8.3 158.4 6.6 153.4 5.8 150.0C5.0 146.6 4.7 144.2 4.7 141.0C4.6 137.8 5.0 134.0 5.7 130.8C6.4 127.5 7.6 124.1 8.7 121.2C9.9 118.4 11.1 116.2 12.8 113.8C14.4 111.2 16.3 108.7 18.8 106.2C21.3 103.8 24.9 100.9 27.8 99.0C30.6 97.2 32.4 96.2 35.8 95.0C39.1 93.8 43.8 92.4 48.0 91.9C52.2 91.4 57.4 91.7 60.8 91.9C64.1 92.1 65.0 92.2 68.2 93.1C71.5 94.0 76.2 95.3 80.5 97.1C84.8 98.9 89.6 101.4 94.0 104.1C98.4 106.8 102.1 109.4 106.8 113.2C111.4 117.1 117.2 122.4 121.7 127.0C126.1 131.6 129.9 136.1 133.5 140.8C137.2 145.4 140.2 149.4 143.5 154.8C146.8 160.2 150.8 167.0 153.6 173.2C156.5 179.5 159.2 188.2 160.6 192.2C162.0 196.3 161.7 196.1 161.9 197.8C162.1 199.4 162.1 200.8 161.8 202.0C161.6 203.2 160.9 204.1 160.3 204.8C159.6 205.4 159.0 205.9 158.0 206.0Z"/><path d="M185.0 206.1C182.9 207.3 182.5 206.3 181.5 206.0C180.5 205.7 179.6 205.0 179.0 204.2C178.4 203.5 178.0 202.9 177.9 201.8C177.7 200.6 177.0 200.8 177.9 197.2C178.8 193.7 181.0 185.9 183.2 180.2C185.4 174.6 188.3 168.5 191.2 163.2C194.0 158.0 196.6 153.9 200.2 148.8C203.9 143.6 208.6 137.5 213.2 132.2C217.9 127.0 223.4 121.6 228.2 117.2C233.1 112.9 237.7 109.3 242.5 106.1C247.3 103.0 252.8 100.1 257.0 98.1C261.2 96.1 264.4 95.1 268.0 94.0C271.6 93.0 274.6 92.3 278.5 91.9C282.4 91.6 287.0 91.4 291.2 91.9C295.5 92.4 300.5 93.8 304.0 95.0C307.5 96.2 309.2 97.2 312.0 99.0C314.8 100.9 318.4 103.8 320.9 106.2C323.4 108.7 325.3 111.2 327.0 113.8C328.7 116.3 329.8 118.4 331.0 121.3C332.2 124.1 333.4 127.5 334.0 130.8C334.7 134.0 335.1 137.8 335.1 141.0C335.1 144.2 334.8 146.6 334.0 150.0C333.1 153.4 331.5 158.4 330.2 161.5C328.8 164.6 327.9 166.0 326.0 168.6C324.1 171.1 321.4 174.4 319.0 176.8C316.6 179.2 313.6 181.3 311.5 182.8C309.4 184.3 308.4 184.8 306.2 185.9C304.1 186.9 302.4 188.1 298.6 189.0C294.8 189.9 288.1 191.0 283.2 191.3C278.4 191.6 276.6 191.6 269.2 190.8C261.9 190.0 246.0 187.1 239.2 186.4C232.5 185.6 232.3 186.0 229.0 186.2C225.7 186.3 222.5 186.8 219.5 187.4C216.5 187.9 213.9 188.5 211.0 189.5C208.1 190.5 204.8 192.0 202.0 193.5C199.2 194.9 197.1 196.2 194.2 198.3C191.4 200.4 187.1 204.8 185.0 206.1Z"/></clipPath></defs><path fill="#0b5c75" fill-rule="evenodd" d="M171.0 167.1C169.9 167.5 169.2 167.3 168.2 166.9C167.2 166.5 166.4 166.7 165.0 164.5C163.6 162.4 161.7 157.7 159.7 154.0C157.6 150.3 155.7 146.8 152.6 142.2C149.4 137.7 144.5 131.0 140.6 126.5C136.8 122.0 134.3 119.5 129.5 115.1C124.7 110.6 116.2 103.6 112.0 99.6C107.8 95.5 106.5 93.8 104.0 90.8C101.5 87.9 99.0 85.1 97.0 81.7C95.0 78.3 93.1 74.0 91.9 70.5C90.7 67.0 90.2 64.1 89.8 60.8C89.5 57.4 89.5 53.9 89.8 50.5C90.1 47.1 91.0 43.5 91.8 40.5C92.7 37.5 93.6 35.4 95.0 32.8C96.4 30.2 98.0 27.5 100.0 25.0C102.0 22.5 104.7 19.8 107.1 17.8C109.5 15.7 111.6 14.3 114.4 12.8C117.1 11.2 120.7 9.7 123.8 8.7C126.8 7.8 130.3 7.2 132.5 6.8C134.7 6.5 135.2 6.6 136.8 6.6C138.3 6.5 139.7 6.4 141.8 6.6C143.8 6.8 146.2 6.9 149.1 7.8C152.0 8.6 155.8 9.7 159.2 11.8C162.7 13.9 166.7 20.3 170.0 20.5C173.3 20.6 176.6 14.5 179.0 12.7C181.4 10.9 182.6 10.7 184.5 9.8C186.4 9.0 188.0 8.3 190.5 7.8C193.0 7.2 197.1 6.7 199.8 6.5C202.4 6.3 204.4 6.5 206.5 6.7C208.6 6.9 209.4 6.9 212.2 7.7C215.1 8.5 220.8 10.6 223.5 11.8C226.3 12.9 227.1 13.6 228.8 14.8C230.5 15.9 231.6 16.6 233.8 18.8C235.9 21.0 240.1 25.6 241.9 28.0C243.8 30.4 243.9 30.9 244.9 33.0C245.9 35.1 247.1 37.6 247.9 40.5C248.8 43.4 249.6 46.8 249.9 50.2C250.2 53.8 250.2 58.1 249.8 61.5C249.4 64.9 248.9 67.4 247.7 70.8C246.6 74.1 245.7 77.3 242.8 81.7C239.8 86.2 235.2 92.0 229.8 97.6C224.3 103.2 215.5 110.1 210.2 115.1C205.0 120.0 202.1 123.0 198.2 127.5C194.4 132.1 190.2 137.8 187.2 142.2C184.2 146.7 182.2 150.3 180.1 154.0C178.0 157.7 176.3 162.3 174.8 164.5C173.2 166.7 172.1 166.7 171.0 167.1Z  M170.4 144.2C172.0 141.8 175.9 133.8 178.8 129.2C181.8 124.7 185.2 120.5 188.0 117.2C190.8 113.9 190.2 114.2 195.4 109.2C200.5 104.3 213.0 93.4 218.8 87.6C224.5 81.7 227.6 77.3 229.9 74.2C232.3 71.2 231.9 71.2 232.8 69.0C233.6 66.8 234.6 64.0 235.0 61.2C235.4 58.5 235.4 55.4 235.2 52.8C235.0 50.1 234.6 47.9 233.7 45.2C232.8 42.6 231.5 39.6 229.8 37.0C228.0 34.4 225.8 31.8 223.5 29.8C221.3 27.7 218.9 26.1 216.2 24.8C213.6 23.5 210.3 22.4 207.8 21.8C205.2 21.2 202.8 21.2 200.8 21.1C198.7 21.1 197.7 21.0 195.2 21.6C192.8 22.2 188.5 23.8 186.2 24.8C184.0 25.8 183.0 26.6 181.5 27.8C180.0 28.9 178.3 30.5 177.1 31.8C175.9 33.0 175.4 33.3 174.2 35.0C173.1 36.7 170.8 40.8 170.0 41.9C169.2 43.0 170.0 42.7 169.2 41.6C168.5 40.5 166.8 36.9 165.7 35.2C164.6 33.6 163.9 33.0 162.7 31.8C161.4 30.5 159.8 28.9 158.3 27.8C156.7 26.6 155.6 25.8 153.4 24.8C151.2 23.8 147.4 22.4 145.1 21.8C142.8 21.1 141.6 21.1 139.5 21.1C137.4 21.1 134.4 21.5 132.5 21.7C130.6 22.0 130.0 22.1 128.2 22.8C126.4 23.4 123.6 24.7 121.8 25.8C119.9 26.8 118.7 27.6 117.1 29.0C115.5 30.4 113.5 32.4 112.0 34.2C110.5 36.1 109.2 38.1 108.2 40.0C107.2 41.9 106.6 43.4 105.9 45.5C105.3 47.6 104.8 50.4 104.5 52.8C104.3 55.1 104.4 57.5 104.6 59.8C104.8 62.0 105.1 63.9 106.0 66.4C106.9 68.9 108.0 71.5 110.0 74.5C112.0 77.5 112.2 78.6 118.0 84.4C123.8 90.2 138.3 103.2 144.5 109.4C150.7 115.6 152.2 117.6 155.3 121.5C158.5 125.4 160.8 129.0 163.1 132.8C165.5 136.5 168.0 142.2 169.2 144.1C170.5 146.0 168.8 146.7 170.4 144.2Z"/><g fill="none" stroke="#0b5c75" stroke-linejoin="round"><path stroke-width="4.34" d="M158.0 206.0C157.0 206.2 156.3 207.1 154.2 205.8C152.2 204.5 148.3 200.4 145.5 198.3C142.7 196.2 140.3 194.8 137.5 193.3C134.7 191.9 131.4 190.4 128.5 189.4C125.6 188.4 123.2 187.9 120.2 187.4C117.3 186.8 114.0 186.4 110.8 186.2C107.5 186.0 107.2 185.6 100.5 186.4C93.8 187.1 77.8 190.0 70.5 190.8C63.2 191.6 61.4 191.6 56.5 191.3C51.6 191.0 45.0 189.9 41.1 189.0C37.3 188.1 35.6 186.9 33.5 185.9C31.4 184.8 30.4 184.3 28.2 182.8C26.1 181.3 23.2 179.2 20.8 176.8C18.3 174.5 15.6 171.2 13.8 168.6C11.9 166.1 10.9 164.6 9.6 161.5C8.3 158.4 6.6 153.4 5.8 150.0C5.0 146.6 4.7 144.2 4.7 141.0C4.6 137.8 5.0 134.0 5.7 130.8C6.4 127.5 7.6 124.1 8.7 121.2C9.9 118.4 11.1 116.2 12.8 113.8C14.4 111.2 16.3 108.7 18.8 106.2C21.3 103.8 24.9 100.9 27.8 99.0C30.6 97.2 32.4 96.2 35.8 95.0C39.1 93.8 43.8 92.4 48.0 91.9C52.2 91.4 57.4 91.7 60.8 91.9C64.1 92.1 65.0 92.2 68.2 93.1C71.5 94.0 76.2 95.3 80.5 97.1C84.8 98.9 89.6 101.4 94.0 104.1C98.4 106.8 102.1 109.4 106.8 113.2C111.4 117.1 117.2 122.4 121.7 127.0C126.1 131.6 129.9 136.1 133.5 140.8C137.2 145.4 140.2 149.4 143.5 154.8C146.8 160.2 150.8 167.0 153.6 173.2C156.5 179.5 159.2 188.2 160.6 192.2C162.0 196.3 161.7 196.1 161.9 197.8C162.1 199.4 162.1 200.8 161.8 202.0C161.6 203.2 160.9 204.1 160.3 204.8C159.6 205.4 159.0 205.9 158.0 206.0Z M185.0 206.1C182.9 207.3 182.5 206.3 181.5 206.0C180.5 205.7 179.6 205.0 179.0 204.2C178.4 203.5 178.0 202.9 177.9 201.8C177.7 200.6 177.0 200.8 177.9 197.2C178.8 193.7 181.0 185.9 183.2 180.2C185.4 174.6 188.3 168.5 191.2 163.2C194.0 158.0 196.6 153.9 200.2 148.8C203.9 143.6 208.6 137.5 213.2 132.2C217.9 127.0 223.4 121.6 228.2 117.2C233.1 112.9 237.7 109.3 242.5 106.1C247.3 103.0 252.8 100.1 257.0 98.1C261.2 96.1 264.4 95.1 268.0 94.0C271.6 93.0 274.6 92.3 278.5 91.9C282.4 91.6 287.0 91.4 291.2 91.9C295.5 92.4 300.5 93.8 304.0 95.0C307.5 96.2 309.2 97.2 312.0 99.0C314.8 100.9 318.4 103.8 320.9 106.2C323.4 108.7 325.3 111.2 327.0 113.8C328.7 116.3 329.8 118.4 331.0 121.3C332.2 124.1 333.4 127.5 334.0 130.8C334.7 134.0 335.1 137.8 335.1 141.0C335.1 144.2 334.8 146.6 334.0 150.0C333.1 153.4 331.5 158.4 330.2 161.5C328.8 164.6 327.9 166.0 326.0 168.6C324.1 171.1 321.4 174.4 319.0 176.8C316.6 179.2 313.6 181.3 311.5 182.8C309.4 184.3 308.4 184.8 306.2 185.9C304.1 186.9 302.4 188.1 298.6 189.0C294.8 189.9 288.1 191.0 283.2 191.3C278.4 191.6 276.6 191.6 269.2 190.8C261.9 190.0 246.0 187.1 239.2 186.4C232.5 185.6 232.3 186.0 229.0 186.2C225.7 186.3 222.5 186.8 219.5 187.4C216.5 187.9 213.9 188.5 211.0 189.5C208.1 190.5 204.8 192.0 202.0 193.5C199.2 194.9 197.1 196.2 194.2 198.3C191.4 200.4 187.1 204.8 185.0 206.1Z"/><path stroke-width="4.34" clip-path="url(#amgt-logo-petales)" d="M0 88.00H344M0 96.68H344M0 105.36H344M0 114.04H344M0 122.72H344M0 131.40H344M0 140.08H344M0 148.76H344M0 157.44H344M0 166.12H344M0 174.80H344M0 183.48H344M0 192.16H344M0 200.84H344M0 209.52H344"/></g></svg>';
    panneau.prepend(logo);
    const voile = h('div', { class: 'amgt-couches-voile' });
    // Fermeture du bandeau, en haut à droite de celui-ci : même effet qu'un clic à côté.
    const fermer = h('button', { type: 'button', class: 'amgt-couches-fermer', title: 'Fermer', 'aria-label': 'Fermer le menu' });
    fermer.innerHTML = '<span class="amgt-couches-fermer__ic" aria-hidden="true"></span>';
    fermer.addEventListener('click', (e) => { e.stopPropagation(); panneau.classList.add('amgt-hidden'); });
    document.body.append(voile, fermer);
    const maj = () => {
      const ouvert = !panneau.classList.contains('amgt-hidden');
      voile.classList.toggle('amgt-couches-voile--on', ouvert);
      fermer.classList.toggle('amgt-couches-fermer--on', ouvert);
      document.documentElement.classList.toggle('amgt-couches-ouvert', ouvert);
      bouton.setAttribute('aria-expanded', String(ouvert));
    };
    new MutationObserver(maj).observe(panneau, { attributes: true, attributeFilter: ['class'] });
    maj();
  },

  // ---------------------------------------------------------------- sélecteurs plein écran
  /** `amgt-admin` sur <html> : seuls les administrateurs voient « Modifier le défaut pour tous » dans les sélecteurs. */
  _classeAdmin() { document.documentElement.classList.toggle('amgt-admin', this.admin()); },

  /**
   * Sélecteurs plein écran (UrbIS Topo, Plans patrimoine, Orthophotos, Géotechnique) :
   *   - la sélection est gardée toute seule sur l'appareil (plus de 💾 ni de barre 🔒, masqués par couches.css) ;
   *   - « ↺ Défaut » : la sélection par défaut partagée s'applique de nouveau ;
   *   - à droite, une disquette réservée au droit `utilisateurs` : la sélection EN COURS devient le défaut de tous les
   *     utilisateurs connectés (écriture par le relais, code administrateur gardé le temps de l'onglet).
   * Les fichiers des sélecteurs ne sont pas modifiés.
   */
  _selecteurs() {
    const liste = [
      { id: 'amgt-topo-picker', nom: 'UrbIS Topo', store: () => AMGT4CEM_UrbisTopoSelectionStore, rafraichir: () => { AMGT4CEM_UrbisTopoPicker._zoomControl && AMGT4CEM_UrbisTopoPicker._zoomControl.refresh(); AMGT4CEM_UrbisTopoPicker._render(); } },
      { id: 'amgt-patrimoine-picker', nom: 'Plans patrimoine', store: () => AMGT4CEM_PatrimoineSelectionStore, rafraichir: () => AMGT4CEM_PatrimoinePicker._render() },
      { id: 'amgt-ortho-picker', nom: 'Orthophotos', store: () => AMGT4CEM_OrthoSelectionStore, rafraichir: () => AMGT4CEM_OrthoPicker._render() },
      { id: 'amgt-nappe-picker', nom: 'Géotechnique', store: () => AMGT4CEM_NappeSelectionStore, rafraichir: () => AMGT4CEM_NappeLayer._renderPicker() },
    ];
    for (const { id, nom, store, rafraichir } of liste) {
      const ecran = document.getElementById(id);
      if (!ecran) continue;
      const actions = ecran.querySelector('.amgt-fs-picker-header-actions');
      const zone = h('div', { class: 'amgt-defaut-zone', role: 'status', hidden: '' });
      const dire = (texte, erreur) => { zone.textContent = texte || ''; zone.hidden = !texte; zone.className = `amgt-defaut-zone${erreur ? ' amgt-defaut-zone--erreur' : ''}`; };

      const revenir = boutonIcone('antihoraire', 'Revenir à la sélection par défaut');
      revenir.addEventListener('click', () => {
        store().resetToDefault();
        try { rafraichir(); } catch (err) { /* sélecteur fermé ou pas encore prêt */ }
        dire('');
      });

      const enregistrer = async (code) => {
        dire('Enregistrement…');
        try {
          await AMGT4CEM_PeLabelAnchors.checkConnection(AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl, code);
          AMGT4CEM_PeLabelAnchors.setAdminCode(code);
          await store().saveShared(store().getSelection(), code, store().getExtra());
          dire(`✓ Sélection « ${nom} » enregistrée par défaut pour tous les utilisateurs connectés (visible après le redéploiement du site, environ 1 minute).`);
        } catch (err) {
          AMGT4CEM_PeLabelAnchors.setAdminCode('');
          dire(err.message, true);
        }
      };
      const demanderCode = () => {
        zone.className = 'amgt-defaut-zone'; zone.hidden = false; zone.textContent = '';
        const champ = h('input', { type: 'password', placeholder: 'Code administrateur du relais', autocomplete: 'off', class: 'amgt-defaut-zone__code' });
        const ok = h('button', { type: 'button', class: 'amgt-btn amgt-btn--primary', text: 'Valider' });
        const non = h('button', { type: 'button', class: 'amgt-btn', text: 'Annuler' });
        const valider = () => (champ.value.trim() ? enregistrer(champ.value.trim()) : dire('Saisir le code administrateur.', true));
        ok.addEventListener('click', valider);
        champ.addEventListener('keydown', (e) => { if (e.key === 'Enter') valider(); });
        non.addEventListener('click', () => dire(''));
        zone.append(h('p', { text: 'Enregistrer la sélection en cours comme défaut de tous les utilisateurs connectés : code administrateur du relais.' }), champ, ok, non);
        champ.focus();
      };
      const sauver = boutonIcone('disquette', 'Enregistrer la sélection en cours comme défaut pour tous les utilisateurs connectés', 'amgt-defaut-disquette');
      sauver.addEventListener('click', async () => {
        if (!this.admin()) return;
        if (!AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl) { dire('Adresse du relais non renseignée (Réglages > Avancé > Services et relais).', true); return; }
        const code = AMGT4CEM_PeLabelAnchors.getAdminCode();
        if (code) enregistrer(code); else demanderCode();
      });
      actions.prepend(revenir, sauver);
      const fermer = ecran.querySelector('[id$="-picker-close"]');
      if (fermer) { fermer.className = 'amgt-ic-btn'; fermer.innerHTML = ICONES.fermer; fermer.title = 'Fermer'; fermer.setAttribute('aria-label', 'Fermer'); }
      ecran.querySelector('.amgt-fs-picker-header').after(zone);
    }
  },

  // ---------------------------------------------------------------- accès visiteur
  /** Géotechnique : absente de l'interface d'un visiteur (case, curseur, lien) et décochée. */
  appliquerAcces() {
    const visible = this.connecte();
    const case_ = document.getElementById('amgt-layer-nappe');
    if (!case_) return;
    const ligne = case_.closest('.amgt-layer-row');
    const reglages = document.querySelector('.amgt-opacity-slider-row[data-layer="nappe"]');
    for (const el of [ligne, reglages]) if (el) el.style.display = visible ? '' : 'none';
    if (!visible) {
      if (case_.checked) { case_.checked = false; case_.dispatchEvent(new Event('change', { bubbles: true })); } // non fiable : pas enregistré comme choix de l'utilisateur
      if (typeof AMGT4CEM_NappeLayer !== 'undefined') AMGT4CEM_NappeLayer.closePicker();
    }
  },

  // ---------------------------------------------------------------- Mon affichage
  _construireAffichage() {
    // Pied du bandeau, même formalisme que les sélecteurs plein écran : à gauche « ↺ Défaut » et, avec le droit
    // `utilisateurs`, la disquette (défaut pour tous) ; à droite « Réinitialiser la vue ».
    const revenir = boutonIcone('antihoraire', 'Revenir à l\'affichage par défaut');
    revenir.addEventListener('click', () => this.revenirAuDefaut());
    const disquette = boutonIcone('disquette', 'Enregistrer l\'affichage actuel comme défaut pour tous', 'amgt-defaut-disquette');
    disquette.addEventListener('click', () => { if (this.admin()) this._ouvrirDefautPourTous(); });

    this._dit = h('p', { class: 'amgt-couches__msg', role: 'status', hidden: '' });
    this._admin = h('div', { class: 'amgt-couches__admin' });
    const reinit = document.getElementById('amgt-reset-view-btn');
    reinit.className = 'amgt-ic-btn';
    reinit.innerHTML = ICONES.horaire;
    reinit.title = 'Réinitialiser la vue';
    reinit.setAttribute('aria-label', 'Réinitialiser la vue');
    const rangee = h('div', { class: 'amgt-couches-pied' }, h('div', { class: 'amgt-couches-pied__gauche' }, revenir, disquette), reinit);
    const bloc = h('div', { class: 'amgt-couches' }, rangee, this._dit, this._admin);

    const pied = document.querySelector('.amgt-map-menu__footer');
    pied.parentNode.insertBefore(bloc, pied);
    pied.style.display = 'none'; // vidé : ses autres boutons sont masqués dans cette interface
  },

  _msg(texte, erreur) {
    this._dit.textContent = texte || '';
    this._dit.hidden = !texte;
    this._dit.className = `amgt-couches__msg${erreur ? ' amgt-couches__msg--erreur' : ''}`;
  },

  /** Affichage par défaut qui s'applique à cet utilisateur, sinon celui du gabarit. */
  _defaut() {
    const partage = AMGT4CEM_MenuPrefs._defaultState() || { layers: {}, opacity: {} };
    return {
      layers: { ...this._initial.layers, ...(partage.layers || {}) },
      opacity: { ...this._initial.opacity, ...(partage.opacity || {}) },
    };
  },

  revenirAuDefaut() {
    const d = this._defaut();
    for (const [nom, actif] of Object.entries(d.layers)) {
      const c = document.getElementById(`amgt-layer-${nom}`);
      if (c && c.checked !== Boolean(actif)) { c.checked = Boolean(actif); c.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    for (const [nom, facteur] of Object.entries(d.opacity)) {
      const curseur = document.querySelector(`.amgt-opacity-slider-row[data-layer="${nom}"] .amgt-opacity-slider`);
      if (!curseur) continue;
      curseur.value = String(Math.round(Number(facteur) * 100));
      curseur.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Plus de réglage propre à l'appareil : l'affichage par défaut s'applique de nouveau (et suit ses changements).
    try { localStorage.removeItem(AMGT4CEM_MenuPrefs._lastKey); localStorage.removeItem('amgt4cem.layer-opacity.v1'); } catch (err) { /* stockage indisponible */ }
    this.appliquerAcces();
    this._msg('✓ Affichage par défaut rétabli.');
  },

  // ---------------------------------------------------------------- Défaut pour tous
  _majAdmin() {
    if (this._admin) { this._admin.textContent = ''; this._msg(''); }
  },

  _ouvrirDefautPourTous() {
    this._admin.textContent = '';
    const cible = (valeur, texte, coche) => {
      const r = h('input', { type: 'radio', name: 'amgt-couches-cible', value: valeur });
      r.checked = coche;
      return { r, ligne: h('label', { class: 'amgt-radio-row' }, r, ` ${texte}`) };
    };
    const connectes = cible('connectes', 'Utilisateurs connectés', true);
    const publics = cible('public', 'Visiteurs non connectés', false);
    const code = h('input', { type: 'password', placeholder: 'Code administrateur du relais', autocomplete: 'off', class: 'amgt-couches__code' });
    const codeConnu = !!AMGT4CEM_PeLabelAnchors.getAdminCode();
    const enregistrer = h('button', { type: 'button', class: 'amgt-btn amgt-btn--primary', text: 'Enregistrer' });
    const annuler = h('button', { type: 'button', class: 'amgt-btn', text: 'Annuler' });
    annuler.addEventListener('click', (e) => { e.stopPropagation(); this._msg(''); this._majAdmin(); });

    enregistrer.addEventListener('click', async (e) => {
      e.stopPropagation();
      const kind = connectes.r.checked ? 'connectes' : 'public';
      const relais = AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl;
      if (!relais) { this._msg('Adresse du relais non renseignée (Réglages > Avancé > Services et relais).', true); return; }
      const c = code.value.trim() || AMGT4CEM_PeLabelAnchors.getAdminCode();
      if (!c) { this._msg('Saisir le code administrateur du relais.', true); return; }
      this._msg('Vérification…');
      enregistrer.disabled = true;
      try {
        await AMGT4CEM_PeLabelAnchors.checkConnection(relais, c);
        AMGT4CEM_PeLabelAnchors.setAdminCode(c);
        await AMGT4CEM_MenuPrefs._saveShared(kind, c);
        this._majAdmin();
        this._msg(`✓ Affichage enregistré pour ${kind === 'connectes' ? 'les utilisateurs connectés' : 'les visiteurs non connectés'} (visible après le redéploiement du site, environ 1 minute).`);
        
      } catch (err) {
        AMGT4CEM_PeLabelAnchors.setAdminCode('');
        this._msg(err.message, true);
        enregistrer.disabled = false;
      }
    });

    this._admin.append(
      h('p', { class: 'amgt-couches__aide', text: 'Enregistrer l\'affichage actuel (couches cochées et opacités) comme défaut de :' }),
      connectes.ligne, publics.ligne,
      codeConnu ? null : code,
      h('div', { class: 'amgt-couches__actions' }, annuler, enregistrer));
  },
};

Couches.init();
Couches.ICONES = ICONES; // réutilisées par le sondage virtuel
window.AMGT4CEM_Couches = Couches;
})();
