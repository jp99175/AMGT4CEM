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
let origin = null; // liste d'où vient l'entrée en cours de modification (on y revient après), ou null : menu

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `sg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function showScreen(name) {
  screens.menu.classList.toggle('sig4cem-hidden', name !== 'menu');
  if (name !== 'map') SIG.MapPicker.close();
  if (name !== 'form') SIG.Form.close();
  if (name !== 'list') SIG.List.close();
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
    item('Draft', { text: `(${c.draft} en local)`, sub: true }, () => openList('draft')),
    item('Téléversement en cours', { text: `(${enFile}/${c.lot})`, sub: true }, () => openList('file')),
    item('Mes dernières entrées', { text: `(${c.envoye})`, sub: true }, () => openList('envoye')));
  const parts = [nav];
  if (c.erreur) parts.unshift(h('p', { class: 'sig4cem-badge', text: `${c.erreur} entrée(s) en erreur d'envoi` }));
  if (notice) { parts.unshift(h('p', { class: 'sig4cem-notice', text: notice })); notice = ''; }
  screens.menu.textContent = '';
  screens.menu.append(
    h('header', { class: 'sig4cem-header' }, h('h1', { text: 'SIG4CEM' }), h('p', { text: 'Signalements et demandes' })),
    ...parts,
    h('footer', { class: 'sig4cem-footer' }, h('span', { class: 'sig4cem-build', text: `BUILD ${AMGT4CEM_BUILD_TIMESTAMP}` })));
}

async function backToMenu() {
  origin = null;
  showScreen('menu');
  await renderMenu();
}

/** Retour à la liste d'où l'on vient (après modification d'une entrée), sinon au menu. */
async function backToOrigin() {
  if (origin) await openList(origin);
  else await backToMenu();
}

// ------------------------------------------------------------------ listes « Mes entrées »
async function openList(kind, message) {
  origin = kind;
  showScreen('list');
  await SIG.List.open({ kind, notice: message || '', back: backToMenu, edit: startEdit, send: sendEntry });
}

/** Rouvre un brouillon ou un envoi en attente dans le formulaire. */
function startEdit(entry) {
  openForm(entry.id, entry.x == null ? null : { x: entry.x, y: entry.y }, false, entry);
}

// ------------------------------------------------------------------ nouvelle entrée
function startNewEntry() {
  origin = null;
  openForm(newId(), null, false); // formulaire complet tout de suite ; la position se pointe depuis son champ
}

/** Écran carte, tout de suite ; la validation ouvre (ou rouvre) le formulaire. */
function pickPosition(entryId, position) {
  showScreen('map');
  SIG.MapPicker.open({
    position,
    onValidate: (pos) => openForm(entryId, pos, true),
    onCancel: () => openForm(entryId, position, true),
  });
}

function openForm(entryId, position, reuse, entry) {
  showScreen('form');
  SIG.Form.open({
    entryId,
    position,
    reuse,
    entry,
    onChangePosition: () => pickPosition(entryId, SIG.Form.position),
    onCancel: backToOrigin,
    onSave: (data, { send }) => saveEntry(data, send),
  });
}

async function saveEntry(data, send) {
  try {
    // Version : v0.01 à la première saisie, +1 à chaque enregistrement d'une modification (même règle que les documents : v0.nn avant diffusion).
    const prev = await SIG.Entries.get(data.id);
    const version = prev ? (prev.version || 1) + 1 : 1;
    await SIG.Entries.add({ ...data, version, modifieLe: new Date().toISOString(), statut: send ? S.FILE : S.DRAFT, lotOuvert: !!send });
  } catch (err) {
    console.error('[SIG4CEM] Enregistrement impossible :', err);
    alert(`Impossible d'enregistrer cette entrée : ${err.message}`);
    return false;
  }
  notice = send ? "Entrée enregistrée, envoi demandé." : 'Entrée enregistrée en local (brouillon).';
  if (send) notice = await sendEntry(data.id);
  if (origin) {
    const message = notice;
    notice = '';
    await openList(origin, message);
  } else {
    await backToMenu();
  }
  return true;
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
  try {
    const n = await SIG.Entries.migrateLegacy();
    if (n) notice = `${n} signalement(s) saisi(s) avec l'ancien outil de la carte repris dans « Draft » ou « Mes dernières entrées ».`;
  } catch (err) {
    console.error('[SIG4CEM] Reprise des anciens signalements impossible :', err);
  }
  await renderMenu();
})();
})();
