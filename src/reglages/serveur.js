/**
 * Réglages > « Services et relais (avancé) » : adresses des services externes (UrbIS, orthophotos, géocodeur),
 * adresse du relais d'enregistrement et code administrateur. Reprend, en un seul écran, les onglets « Sources » et
 * « Serveur » de la fenêtre ⚙ de l'ancienne interface (src/settingsPanel.js, non modifiée), avec les mêmes
 * services (AMGT4CEM_Services, AMGT4CEM_PeLabelAnchors) : les valeurs enregistrées sont donc les mêmes.
 *
 * Réservé au droit « utilisateurs » (comme l'était l'engrenage). Le code administrateur du relais n'est jamais
 * enregistré : il n'est gardé que le temps de l'onglet du navigateur (sessionStorage).
 */
(function () {
const Reglages = window.AMGT4CEM_Reglages;

const h = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  for (const c of kids) if (c) n.append(c);
  return n;
};

const CHAMPS = [
  { cle: 'urbisUrl', libelle: 'Fond UrbIS — adresse du service WMS' },
  { cle: 'urbisLayers', libelle: 'Fond UrbIS — nom de la couche' },
  { cle: 'brucielHistoriqueUrl', libelle: 'Orthophotos historiques (1935–1996) — adresse du service WMS' },
  { cle: 'brucielRecentUrl', libelle: 'Orthophotos récentes (2004–2022) — adresse du service WMS' },
  { cle: 'flandreUrl', libelle: 'Orthophotos Flandre (2000–2025) — adresse du service WMS' },
  { cle: 'geocoderUrl', libelle: 'Recherche d\'adresses — adresse du géocodeur' },
  { cle: 'relayUrl', libelle: 'Adresse du relais d\'enregistrement', placeholder: 'https://…workers.dev' },
];

async function monter(conteneur) {
  conteneur.textContent = '';
  conteneur.append(h('p', { class: 'rgl-note', text: 'Chargement…' }));
  await AMGT4CEM_Services.load(); // valeurs du serveur à jour
  conteneur.textContent = '';

  const valeurs = AMGT4CEM_Services.current();
  const champs = {};
  const ligne = (c) => {
    const input = h('input', { type: 'text', class: 'rgl-input rgl-input--large', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', ...(c.placeholder ? { placeholder: c.placeholder } : {}) });
    input.value = valeurs[c.cle] || '';
    champs[c.cle] = input;
    return h('label', { class: 'rgl-champ' }, h('span', { text: c.libelle }), input);
  };

  const code = h('input', { type: 'password', class: 'rgl-input rgl-input--large', autocomplete: 'off' });
  const majCode = () => {
    code.value = '';
    code.placeholder = AMGT4CEM_PeLabelAnchors.getAdminCode() ? 'Code déjà saisi (laisser vide pour le garder)' : 'Code administrateur du relais';
  };
  majCode();
  const codeActuel = () => code.value.trim() || AMGT4CEM_PeLabelAnchors.getAdminCode();

  const statut = h('p', { class: 'rgl-statut', role: 'status', hidden: '' });
  const dire = (texte, genre) => {
    statut.textContent = texte;
    statut.hidden = !texte;
    statut.className = `rgl-statut${genre ? ` rgl-statut--${genre}` : ''}`;
  };

  const tester = h('button', { type: 'button', class: 'rgl-btn', text: 'Tester le relais' });
  tester.addEventListener('click', async () => {
    dire('Test en cours…');
    try { dire(await AMGT4CEM_PeLabelAnchors.checkConnection(champs.relayUrl.value.trim(), codeActuel()), 'ok'); } catch (err) { dire(err.message, 'erreur'); }
  });

  const enregistrer = h('button', { type: 'button', class: 'rgl-btn rgl-btn--primary', text: 'Enregistrer' });
  enregistrer.addEventListener('click', async () => {
    const saisie = Object.fromEntries(Object.entries(champs).map(([k, input]) => [k, input.value.trim()]));
    const c = codeActuel();
    const relais = saisie.relayUrl || AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl;
    if (!relais || !c) { dire('Pour enregistrer sur le serveur : renseigner l\'adresse du relais et le code administrateur.', 'erreur'); return; }
    dire('Enregistrement sur le serveur…');
    enregistrer.disabled = true;
    try {
      await AMGT4CEM_Services.save(saisie, relais, c);
      AMGT4CEM_PeLabelAnchors.setAdminCode(c);
      majCode();
      dire('Enregistré sur le serveur. Appliqué à tous après le redéploiement du site (environ 1 minute) ; rechargez ensuite la page.', 'ok');
    } catch (err) {
      AMGT4CEM_PeLabelAnchors.setAdminCode(''); // un code refusé ne doit pas rester en mémoire
      majCode();
      dire(err.message, 'erreur');
    } finally { enregistrer.disabled = false; }
  });

  conteneur.append(
    h('p', { class: 'rgl-note', text: 'Réglages communs à tous les agents, enregistrés sur le serveur. À modifier uniquement si l\'un de ces services externes change d\'adresse.' }),
    h('section', { class: 'rgl-bloc rgl-bloc--formulaire' }, h('h2', { class: 'rgl-bloc__titre', text: 'Services externes' }), ...CHAMPS.slice(0, 6).map(ligne)),
    h('section', { class: 'rgl-bloc rgl-bloc--formulaire' }, h('h2', { class: 'rgl-bloc__titre', text: 'Relais d\'enregistrement' }),
      ligne(CHAMPS[6]),
      h('label', { class: 'rgl-champ' }, h('span', { text: 'Code administrateur' }), code),
      h('p', { class: 'rgl-aide', text: 'Le code n\'est jamais enregistré : il n\'est gardé que le temps de cet onglet du navigateur.' })),
    statut,
    h('div', { class: 'rgl-actions' }, tester, enregistrer));
}

Reglages.register({
  id: 'services',
  ordre: 90,
  titre: 'Avancé',
  droit: 'utilisateurs',
  lignes: () => [
    {
      texte: 'Services et relais',
      aide: 'Adresses des services externes (UrbIS, orthophotos, géocodeur) et du relais d\'enregistrement.',
      ecran: { id: 'services', titre: 'Services et relais', monter },
    },
  ],
});
})();
