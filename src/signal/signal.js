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
  if (name !== 'all') SIG.All.close();
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

/**
 * Menu SANS connexion : ni formulaire, ni listes, ni compteurs. Seule la connexion est proposée. Les entrées déjà
 * enregistrées sur l'appareil (brouillons, envois en attente) ne sont ni modifiées ni effacées : elles réapparaissent
 * à la connexion.
 */
async function renderMenuSansConnexion() {
  const c = await SIG.Entries.counts();
  const surAppareil = c.draft + c.file + c.erreur + c.envoye > 0;
  const connect = h('button', { type: 'button', class: 'sig4cem-btn sig4cem-btn--primary', text: 'Se connecter' });
  connect.addEventListener('click', async () => {
    const ok = await AMGT4CEM_Auth.ensure({ message: 'Connectez-vous pour saisir ou consulter des signalements et des demandes.' });
    if (ok) notice = `Connecté : ${AMGT4CEM_Auth.label(ok)}.`;
    await renderMenu();
  });
  const parts = [];
  if (notice) { parts.push(h('p', { class: 'sig4cem-notice', text: notice })); notice = ''; }
  parts.push(h('p', { text: 'Connexion requise : la saisie et la consultation des signalements et des demandes sont réservées aux agents identifiés.' }));
  if (surAppareil) parts.push(h('p', { text: 'Les entrées déjà enregistrées sur cet appareil réapparaîtront après la connexion.' }));
  parts.push(connect);
  screens.menu.textContent = '';
  screens.menu.append(
    h('header', { class: 'sig4cem-header' }, h('h1', { text: 'SIG4CEM' }), h('p', { text: 'Signalements et demandes' })),
    h('nav', { class: 'sig4cem-menu', 'aria-label': 'Connexion' }, ...parts),
    h('footer', { class: 'sig4cem-footer' }, identityLine(), h('span', { class: 'sig4cem-build', text: `BUILD ${AMGT4CEM_BUILD_TIMESTAMP}` })));
}

async function renderMenu() {
  if (!AMGT4CEM_Auth.session()) return renderMenuSansConnexion();
  const c = await SIG.Entries.counts();
  const enFile = c.file + c.erreur;
  // Toutes les entrées : compte du serveur (actives dans le système), demandé en arrière-plan pour ne pas retarder le menu.
  const allCounter = h('span', { class: 'sig4cem-item__counter', text: AMGT4CEM_Auth.session() ? '(…)' : '(connexion requise)' });
  const allItem = h('button', { type: 'button', class: 'sig4cem-item sig4cem-item--sub' }, h('span', { class: 'sig4cem-item__label', text: 'Signalement/demande' }), allCounter);
  allItem.addEventListener('click', () => openAll());
  if (AMGT4CEM_Auth.session()) SIG.All.count().then((n) => { allCounter.textContent = n == null ? '(indisponible)' : `(${n})`; });
  const nav = h('nav', { class: 'sig4cem-menu', 'aria-label': 'Signalements et demandes' },
    h('h2', { text: 'NOUVELLE ENTRÉE' }),
    item('Signalement/demande', { text: `(${c.draft} en local)`, sub: true }, startNewEntry),
    h('h3', { text: 'Mes entrées' }),
    item('Draft', { text: `(${c.draft} en local)`, sub: true }, () => openList('draft')),
    item('Téléversement en cours', { text: `(${enFile}/${c.lot})`, sub: true }, () => openList('file')),
    item('Mes dernières entrées', { text: `(${c.envoye})`, sub: true }, () => openList('envoye')),
    h('h3', { text: 'Toutes les entrées' }),
    allItem);
  const parts = [nav];
  if (c.erreur) parts.unshift(h('p', { class: 'sig4cem-badge', text: `${c.erreur} entrée(s) en erreur d'envoi` }));
  if (notice) { parts.unshift(h('p', { class: 'sig4cem-notice', text: notice })); notice = ''; }
  screens.menu.textContent = '';
  screens.menu.append(
    h('header', { class: 'sig4cem-header' }, h('h1', { text: 'SIG4CEM' }), h('p', { text: 'Signalements et demandes' })),
    ...parts,
    h('footer', { class: 'sig4cem-footer' }, identityLine(), h('span', { class: 'sig4cem-build', text: `BUILD ${AMGT4CEM_BUILD_TIMESTAMP}` })));
}

/** « Connecté : Prénom Nom (matricule) · Se déconnecter » ou « Non connecté · Se connecter ». */
function identityLine() {
  const s = AMGT4CEM_Auth.session();
  const btn = h('button', { type: 'button', class: 'sig4cem-link', text: s ? 'Se déconnecter' : 'Se connecter' });
  btn.addEventListener('click', async () => {
    if (s) { AMGT4CEM_Auth.logout(); notice = 'Déconnecté.'; } else {
      const ok = await AMGT4CEM_Auth.ensure({});
      if (ok) notice = `Connecté : ${AMGT4CEM_Auth.label(ok)}.`;
    }
    await renderMenu();
  });
  return h('p', { class: 'sig4cem-identity' }, s ? `Connecté : ${AMGT4CEM_Auth.label(s)} · ` : 'Non connecté · ', btn);
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

// ------------------------------------------------------------------ révision d'une entrée déjà envoyée
/** Rouvre une entrée du serveur (par sa référence) dans le formulaire : nouvelle version à enregistrer puis à envoyer. */
async function startRevision(reference) {
  const s = AMGT4CEM_Auth.session() || await AMGT4CEM_Auth.ensure({ message: 'Connectez-vous pour modifier une entrée.' });
  if (!s) return;
  // Une révision déjà en cours sur cet appareil (brouillon ou envoi en attente) : on la reprend telle quelle.
  const local = (await SIG.Entries.all()).find((e) => e.reference === reference && e.statut !== S.ENVOYE);
  if (local) { origin = null; startEdit(local); return; }
  showScreen('menu');
  notice = `Chargement de ${reference}…`;
  await renderMenu();
  try {
    const entry = await NS.Importer.fromServer(reference);
    const old = await SIG.Entries.get(entry.id);
    if (old) await SIG.Entries.remove(entry.id); // copie locale envoyée : remplacée par la version du serveur
    const saved = await SIG.Entries.add({ ...entry, statut: S.DRAFT, importe: true, lotOuvert: false });
    notice = '';
    origin = null;
    openForm(saved.id, saved.x == null ? null : { x: saved.x, y: saved.y }, false, saved);
  } catch (err) {
    console.error('[SIG4CEM] Entrée non rouverte :', err);
    notice = `Impossible de rouvrir ${reference} : ${err.message}`;
    await renderMenu();
  }
}

// ------------------------------------------------------------------ « Toutes les entrées »
async function openAll() {
  if (!AMGT4CEM_Auth.session()) {
    const ok = await AMGT4CEM_Auth.ensure({ message: 'Connectez-vous pour voir les entrées du système.' });
    if (!ok) return;
  }
  origin = null;
  showScreen('all');
  await SIG.All.open({ back: backToMenu, revise: startRevision });
}

// ------------------------------------------------------------------ listes « Mes entrées »
/** Session valide, sinon écran de connexion ; false si l'agent y renonce (on reste sur le menu de connexion). */
async function requireSession(message) {
  if (AMGT4CEM_Auth.session()) return true;
  const ok = await AMGT4CEM_Auth.ensure({ message });
  if (!ok) { showScreen('menu'); await renderMenu(); return false; }
  return true;
}

async function openList(kind, message) {
  if (!(await requireSession('Connectez-vous pour consulter vos entrées.'))) return;
  origin = kind;
  showScreen('list');
  await SIG.List.open({ kind, notice: message || '', back: backToMenu, edit: startEdit, send: sendEntry, revise: startRevision });
}

/** Rouvre un brouillon ou un envoi en attente dans le formulaire. */
function startEdit(entry) {
  openForm(entry.id, entry.x == null ? null : { x: entry.x, y: entry.y }, false, entry);
}

// ------------------------------------------------------------------ nouvelle entrée
async function startNewEntry() {
  if (!(await requireSession('Connectez-vous pour saisir un signalement ou une demande.'))) return;
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
    onCancel: async () => {
      // Révision ouverte puis abandonnée sans rien enregistrer : la copie de travail n'a plus lieu d'être (la version du serveur reste).
      const e = await SIG.Entries.get(entryId);
      if (e && e.importe) await SIG.Entries.remove(entryId);
      await backToOrigin();
    },
    onSave: (data, { send }) => saveEntry(data, send),
  });
}

async function saveEntry(data, send) {
  try {
    // Version : v0.01 à la première saisie, +1 à chaque enregistrement d'une modification (même règle que les documents : v0.nn avant diffusion).
    const prev = await SIG.Entries.get(data.id);
    // Une révision sans changement de contenu n'est pas une modification : ni nouvelle version, ni nouveau contributeur.
    const changed = !prev || Object.keys(data).some((k) => JSON.stringify(data[k]) !== JSON.stringify(prev[k]));
    const version = prev ? (changed ? (prev.version || 1) + 1 : (prev.version || 1)) : 1;
    if (prev && prev.importe && !changed) {
      // Révision sans aucune modification : rien à enregistrer ni à envoyer.
      await SIG.Entries.remove(data.id);
      notice = 'Aucune modification : la version du serveur reste inchangée.';
      if (origin) await openList(origin, notice); else await backToMenu();
      return true;
    }
    // Rédacteur = créateur, contributeurs = ceux qui ajoutent ou révisent : tirés de la session connectée, pas du formulaire.
    const me = AMGT4CEM_Auth.session();
    const matricule = me ? me.utilisateur.matricule : null;
    const redacteur = (prev && prev.redacteur) || matricule || null;
    const contributeurs = [...new Set([...((prev && prev.contributeurs) || []), ...(matricule && changed ? [matricule] : [])])];
    await SIG.Entries.add({ ...data, reference: (prev && prev.reference) || null, envoyeLe: prev ? prev.envoyeLe : undefined, redacteur, contributeurs, version, modifieLe: changed || !prev ? new Date().toISOString() : (prev.modifieLe || new Date().toISOString()), statut: send ? S.FILE : S.DRAFT, lotOuvert: !!send });
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
    await SIG.Entries.update(id, { statut: S.ENVOYE, reference: result.reference, envoyeLe: result.recuLe, erreur: null, redacteur: result.redacteur, contributeurs: result.contributeurs });
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
  // Session qui change (déconnexion depuis un autre onglet, jeton refusé) : le menu suit, sans toucher à un formulaire ouvert.
  AMGT4CEM_Auth.onChange(() => { if (!screens.menu.classList.contains('sig4cem-hidden')) renderMenu(); });
  // Session proche de son expiration (7 derniers jours) : le mot de passe est redemandé, une fois par 24 h.
  AMGT4CEM_Auth.surveillerExpiration();
  // Lien reçu par email : première connexion (matricule et code déjà remplis).
  const pm = AMGT4CEM_Router.params.get('m');
  const pc = AMGT4CEM_Router.params.get('code');
  if (pm && pc) {
    history.replaceState(null, '', AMGT4CEM_Router.url('signal')); // le code ne reste pas dans l'adresse
    const s = await AMGT4CEM_Auth.ensure({ onglet: 'activation', matricule: pm, code: pc, message: 'Bienvenue. Choisissez votre mot de passe pour activer votre compte.' });
    if (s) { notice = `Compte activé. Connecté : ${AMGT4CEM_Auth.label(s)}.`; await renderMenu(); }
  }
  // Lien « Modifier » de la bulle de la carte : ?app=signal&edit=AAAA-NNNN
  const pe = AMGT4CEM_Router.params.get('edit');
  if (pe && /^\d{4}-\d{4}$/.test(pe)) {
    history.replaceState(null, '', AMGT4CEM_Router.url('signal'));
    await startRevision(pe);
    return;
  }
  // Arrivée depuis « Ajouter un point » de la carte : formulaire tout de suite, position pré-remplie.
  const px = Number(AMGT4CEM_Router.params.get('x'));
  const py = Number(AMGT4CEM_Router.params.get('y'));
  if (AMGT4CEM_Router.params.has('x') && Number.isFinite(px) && Number.isFinite(py) && px > 0 && py > 0 && px < 400000 && py < 400000) {
    history.replaceState(null, '', AMGT4CEM_Router.url('signal')); // un rechargement ne rouvre pas un nouveau formulaire
    if (!(await requireSession('Connectez-vous pour saisir un signalement ou une demande.'))) return;
    origin = null;
    openForm(newId(), { x: px, y: py }, false);
  }
})();
})();
