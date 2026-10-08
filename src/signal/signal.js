/**
 * Interface « signal » (SIG4CEM) : saisie des signalements et demandes.
 *
 * Page chargée par home.html?app=signal (voir src/router.js). Distincte de la carte : elle ne charge
 * ni Leaflet ni aucun module cartographique ; le choix de l'emplacement renverra vers la carte
 * (home.html?app=carto, mode « choisir un point »).
 *
 * ÉTAPE ACTUELLE : squelette du menu seulement. Les entrées sont affichées mais pas encore actives ;
 * elles se branchent une à une (formulaire, brouillons, file d'envoi, dernières entrées).
 */
(function () {
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Entrée de menu pas encore branchée : visible, non cliquable, avec son compteur futur. */
function item(label, counter, sub) {
  const btn = h('button', { type: 'button', class: `sig4cem-item${sub ? ' sig4cem-item--sub' : ''}`, disabled: '' },
    h('span', { class: 'sig4cem-item__label', text: label }),
    h('span', { class: 'sig4cem-item__counter', text: counter }));
  return btn;
}

const root = document.getElementById('sig4cem-root');
root.append(
  h('header', { class: 'sig4cem-header' },
    h('h1', { text: 'SIG4CEM' }),
    h('p', { text: 'Signalements et demandes' })),
  h('nav', { class: 'sig4cem-menu', 'aria-label': 'Signalements et demandes' },
    h('h2', { text: 'SIGNALEMENTS ET DEMANDES' }),
    item('Nouvelle entrée', '(– en local)', false),
    h('h3', { text: 'Mes entrées' }),
    item('Draft', '(– en local)', true),
    item('Téléversement en cours', '(–/–)', true),
    item('Mes dernières entrées', '', true)),
  h('p', { class: 'sig4cem-note', text: 'Squelette du menu : les fonctions seront branchées étape par étape.' }),
  h('footer', { class: 'sig4cem-footer' },
    h('a', { href: AMGT4CEM_Router.url('carto'), text: '← Ouvrir la carte (AMGT4CEM)' }),
    h('span', { class: 'sig4cem-build', text: `BUILD ${AMGT4CEM_BUILD_TIMESTAMP}` })));
})();
