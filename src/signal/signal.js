/**
 * Interface « signal » (SIG4CEM) : saisie des signalements et demandes.
 *
 * Page chargée par home.html?app=signal (voir src/router.js), indépendante de la carte AMGT4CEM : elle
 * embarque son propre écran de carte pour choisir le point (mapPicker.js) et n'ouvre jamais la carte
 * complète. Écrans : menu, carte (choix du point), formulaire.
 *
 * « Nouvelle entrée » lance tout de suite le choix du point sur la carte, puis ouvre le formulaire.
 * L'enregistrement est local (statut `draft`) ou local + envoi demandé (`file`, puis `envoye` quand le
 * serveur a attribué la référence, `erreur` si l'envoi échoue). Les écrans « Mes entrées » (brouillons,
 * envois en cours, dernières entrées) restent à brancher : le menu en affiche déjà les compteurs.
 */
(function () {
const SIG = window.SIG4CEM;
const NS = window.AMGT4CEM_Signalements;
const h = SIG.h;
const S = SIG.STATUT;

const root = document.getElementById('sig4cem-root');
const screens = {};
let notice = ''; // message affiché une fois dans le menu (résultat du dernier enregistrement)

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `sg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showScreen(name) {
  screens.menu.classList.toggle('sig4cem-hidden', name !== 'menu');
  if (name !== 'map') SIG.MapPicker.close();
  if (name !== 'form') SIG.Form.close();
}

// ------------------------------------------------------------------ menu
function item(label, counter, onClick) {
  const btn = h('button', { type: 'button', class: `sig4cem-item${onClick ? '' : ' sig4cem-item--off'}${counter.sub ? ' sig4cem-item--sub' : ''}` },
    h('span', { class: 'sig4cem-item__label', text: label }),
    h('span', { class: 'sig4cem-item__counter', text: counter.text }));
  if (onClick) btn.addEventListener('click', onClick);
  else btn.disabled = true;
  return btn;
}

async function renderMenu() {
  const c = await SIG.Entries.counts();
  const enFile = c.file + c.erreur;
  const nav = h('nav', { class: 'sig4cem-menu', 'aria-label': 'Signalements et demandes' },
    h('h2', { text: 'SIGNALEMENTS ET DEMANDES' }),
    item('Nouvelle entrée', { text: `(${c.draft} en local)` }, startNewEntry),
    h('h3', { text: 'Mes entrées' }),
    item('Draft', { text: `(${c.draft} en local)`, sub: true }),
    item('Téléversement en cours', { text: `(${enFile}/${c.lot})`, sub: true }),
    item('Mes dernières entrées', { text: `(${c.envoye})`, sub: true }));
  const parts = [nav];
  if (c.erreur) parts.unshift(h('p', { class: 'sig4cem-badge', text: `${c.erreur} entrée(s) en erreur d'envoi` }));
  if (notice) { parts.unshift(h('p', { class: 'sig4cem-notice', text: notice })); notice = ''; }
  parts.push(h('p', { class: 'sig4cem-note', text: 'Brouillons, envois en cours et dernières entrées : listes à venir.' }));
  screens.menu.textContent = '';
  screens.menu.append(
    h('header', { class: 'sig4cem-header' }, h('h1', { text: 'SIG4CEM' }), h('p', { text: 'Signalements et demandes' })),
    ...parts,
    h('footer', { class: 'sig4cem-footer' }, h('span', { class: 'sig4cem-build', text: `BUILD ${AMGT4CEM_BUILD_TIMESTAMP}` })));
}

async function backToMenu() {
  showScreen('menu');
  await renderMenu();
}

// ------------------------------------------------------------------ nouvelle entrée
function startNewEntry() {
  const entryId = newId();
  pickPosition(entryId, null, false);
}

/** Écran carte, tout de suite ; la validation ouvre (ou rouvre) le formulaire. */
function pickPosition(entryId, position, reuse) {
  showScreen('map');
  SIG.MapPicker.open({
    position,
    onValidate: (pos) => openForm(entryId, pos, reuse),
    onCancel: async () => {
      if (reuse) openForm(entryId, position, true);
      else await backToMenu();
    },
  });
}

function openForm(entryId, position, reuse) {
  showScreen('form');
  SIG.Form.open({
    entryId,
    position,
    reuse,
    onChangePosition: () => pickPosition(entryId, position, true),
    onCancel: backToMenu,
    onSave: (data, { send }) => saveEntry(data, send),
  });
}

async function saveEntry(data, send) {
  try {
    await SIG.Entries.add({ ...data, statut: send ? S.FILE : S.DRAFT, lotOuvert: !!send });
  } catch (err) {
    console.error('[SIG4CEM] Enregistrement impossible :', err);
    alert(`Impossible d'enregistrer cette entrée : ${err.message}`);
    return;
  }
  notice = send ? "Entrée enregistrée, envoi demandé." : 'Entrée enregistrée en local (brouillon).';
  if (send) notice = await sendEntry(data.id);
  await backToMenu();
}

/** Envoie une entrée ; met à jour son statut et renvoie le message à afficher. */
async function sendEntry(id) {
  const entry = await SIG.Entries.get(id);
  if (!NS.Envoi.configured()) {
    await SIG.Entries.update(id, { statut: S.FILE, erreur: null });
    return "Entrée enregistrée en local, envoi demandé : elle attend qu'un serveur de dépôt soit configuré.";
  }
  try {
    const result = await NS.Envoi.send(entry);
    await SIG.Entries.update(id, { statut: S.ENVOYE, reference: result.reference, envoyeLe: result.recuLe, erreur: null });
    await SIG.Entries.closeLotIfDone();
    return `Entrée envoyée : référence ${result.reference}.`;
  } catch (err) {
    await SIG.Entries.update(id, { statut: S.ERREUR, erreur: err.message });
    return `Entrée enregistrée en local, envoi échoué : ${err.message}`;
  }
}

// ------------------------------------------------------------------ démarrage
(async function init() {
  screens.menu = h('section', { class: 'sig4cem-screen sig4cem-screen--menu' });
  root.append(screens.menu);
  const plugin = (AMGT4CEM_CONFIG.plugins || []).find((p) => p.id === 'signalements') || {};
  NS.Envoi.init(plugin.options || {});
  await NS.Depot.load(); // vocabulaire (natures, types, domaines)
  await renderMenu();
})();
})();
