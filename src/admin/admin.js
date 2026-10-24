/**
 * Administration des intervenants (home.html?app=admin).
 *
 * Le référentiel des intervenants vit sur le serveur de dépôt (R2, jamais dans le dépôt public) : cette page le
 * lit et le modifie par les routes /admin/* , réservées aux comptes qui ont le droit administrateur. L'administrateur
 * ne connaît jamais les mots de passe : à la création d'une fiche (ou à la demande), le serveur génère un code
 * d'activation à usage unique (7 jours) ; la page prépare l'email d'accueil (lien + code) et l'ouvre dans la
 * messagerie de l'administrateur (mailto:). L'agent choisit son mot de passe en activant son compte.
 */
(function () {
const root = document.getElementById('admin-root');
AMGT4CEM_Auth.init(AMGT4CEM_CONFIG.depot || {});

const h = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  for (const c of kids) if (c) n.append(c);
  return n;
};

// ------------------------------------------------------------------ GSM
/** « 0475 12 34 56 », « 0032475123456 » -> « +32475123456 » (ce que le serveur enregistre) ; texte inchangé si douteux. */
function gsmNormalise(texte) {
  const brut = String(texte || '').replace(/[\s.\-/()]/g, '');
  if (!brut) return '';
  if (brut.startsWith('00')) return `+${brut.slice(2)}`;
  if (brut.startsWith('0')) return `+32${brut.slice(1)}`;
  return brut;
}

/** « +32475123456 » -> « +32 475 12 34 56 » (fixe à 8 chiffres : « +32 2 345 67 89 ») */
function gsmAffiche(gsm) {
  const m = /^\+32(\d+)$/.exec(gsm || '');
  if (!m) return gsm || '';
  const d = m[1];
  if (d.length === 9) return `+32 ${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7)}`;
  if (d.length === 8) return `+32 ${d.slice(0, 1)} ${d.slice(1, 4)} ${d.slice(4, 6)} ${d.slice(6)}`;
  return gsm;
}

const jour = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};

// ------------------------------------------------------------------ état
let liste = [];
let filtre = '';
let message = '';
let accueil = null; // { intervenant, code } : email d'accueil à envoyer (affiché une seule fois, le serveur ne garde pas le code en clair)
let edition = null; // fiche en cours d'édition (null : aucune ; {} : nouvelle)

function lienActivation(matricule, code) {
  const base = new URL('home.html', location.href);
  base.search = new URLSearchParams({ app: 'signal', m: matricule, code }).toString();
  return base.toString();
}

function emailAccueil(u, code, expire) {
  const moi = (AMGT4CEM_Auth.session() || {}).utilisateur || {};
  const sujet = 'Votre accès à SIG4CEM (signalements et demandes)';
  const corps = [
    `Bonjour ${u.prenom},`,
    '',
    'Un compte vient de vous être créé pour saisir et envoyer des signalements et des demandes (SIG4CEM).',
    '',
    'Première connexion : ouvrez le lien ci-dessous sur votre téléphone, puis choisissez votre mot de passe (8 caractères au moins).',
    lienActivation(u.matricule, code),
    '',
    `Votre matricule : ${u.matricule}`,
    `Code d'activation : ${code} (à usage unique, valable jusqu'au ${jour(expire)})`,
    '',
    'Ensuite, vous vous connectez avec votre matricule et votre mot de passe. Ne communiquez jamais votre mot de passe, à personne.',
    '',
    'Cordialement,',
    `${moi.prenom || ''} ${moi.nom || ''}`.trim(),
  ].join('\n');
  return { sujet, corps, mailto: `mailto:${encodeURIComponent(u.email)}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}` };
}

// ------------------------------------------------------------------ droits
const DROITS = {
  utilisateurs: { court: 'Utilisateurs', libelle: 'Gestion des utilisateurs', aide: 'comptes, codes d\'activation, sécurité, suppression des entrées des autres, purge' },
  attributs: { court: 'Attributs', libelle: 'Attributs', aide: 'attributs des stations, tunnels et planches, étiquettes, repères' },
  plans: { court: 'Plans', libelle: 'Plans', aide: 'shapefile, plans et scans, mise à jour des données publiques' },
  vocabulaire: { court: 'Vocabulaire', libelle: 'Vocabulaire', aide: 'listes de choix (types d\'entrée, niveaux)' },
};

/** Droits d'une fiche ; fiche d'avant les droits (booléen admin) : les quatre si admin. */
function droitsDe(u) {
  if (Array.isArray(u.droits)) return Object.keys(DROITS).filter((d) => u.droits.includes(d));
  return u.admin ? Object.keys(DROITS) : [];
}

// ------------------------------------------------------------------ rendu
async function charger() {
  const r = await AMGT4CEM_Auth.call('/admin/intervenants');
  liste = r.intervenants;
}

function pastille(texte, classe) {
  return h('span', { class: `adm-badge ${classe || ''}`, text: texte });
}

function carte(u) {
  const org = [u.organisation, u.division, u.departement, u.service].filter(Boolean).join(' · ');
  const etat = [];
  for (const d of droitsDe(u)) etat.push(pastille(DROITS[d].court, 'adm-badge--admin'));
  if (!u.actif) etat.push(pastille('Inactif', 'adm-badge--off'));
  else if (u.motDePasseDefini && !u.activationExpire) etat.push(pastille('Compte activé', 'adm-badge--ok'));
  else if (u.activationExpire) etat.push(pastille(`En attente d'activation (jusqu'au ${jour(u.activationExpire)})`, 'adm-badge--wait'));
  const b = h('button', { type: 'button', class: 'adm-card' },
    h('strong', { text: `${u.prenom} ${u.nom.toLocaleUpperCase('fr-BE')}` }),
    h('span', { class: 'adm-card__mat', text: u.matricule }),
    h('span', { class: 'adm-card__line', text: org }),
    h('span', { class: 'adm-card__line', text: [gsmAffiche(u.gsm), u.email].filter(Boolean).join(' · ') }),
    h('span', { class: 'adm-card__badges' }, ...etat));
  b.addEventListener('click', () => { edition = u; accueil = null; message = ''; render(); window.scrollTo(0, 0); });
  return b;
}

function champ(id, label, valeur, extra) {
  const input = h('input', { id, type: 'text', autocomplete: 'off', ...(extra || {}) });
  input.value = valeur || '';
  return { input, row: h('div', { class: 'adm-row' }, h('label', { for: id, text: label }), input) };
}

function formulaire() {
  const nouveau = !edition.matricule;
  const f = {
    matricule: champ('adm-matricule', 'Matricule (clé, non modifiable ensuite)', edition.matricule, nouveau ? { autocapitalize: 'characters' } : { readonly: '' }),
    prenom: champ('adm-prenom', 'Prénom', edition.prenom),
    nom: champ('adm-nom', 'Nom', edition.nom),
    gsm: champ('adm-gsm', 'GSM (0475 12 34 56 ou +32…)', gsmAffiche(edition.gsm), { inputmode: 'tel' }),
    email: champ('adm-email', 'Email', edition.email, { inputmode: 'email', autocapitalize: 'none' }),
    organisation: champ('adm-org', 'Organisation', nouveau ? 'BM' : edition.organisation),
    division: champ('adm-div', 'Division', nouveau ? 'DITP' : edition.division),
    departement: champ('adm-dep', 'Département', nouveau ? 'AMGT' : edition.departement),
    service: champ('adm-srv', 'Service', nouveau ? 'CEM' : edition.service),
  };
  const droits = droitsDe(edition);
  const cases = Object.entries(DROITS).map(([code, d]) => {
    const c = h('input', { type: 'checkbox', id: `adm-droit-${code}`, value: code });
    c.checked = droits.includes(code);
    return { code, c, row: h('label', { class: 'adm-check' }, c, ` ${d.libelle}`, h('span', { class: 'adm-check__aide', text: ` — ${d.aide}` })) };
  });
  const actif = h('input', { type: 'checkbox', id: 'adm-actif' });
  actif.checked = nouveau ? true : edition.actif !== false;
  const msg = h('p', { class: 'adm-msg', role: 'alert' });
  const enregistrer = h('button', { type: 'button', class: 'adm-btn adm-btn--primary', text: nouveau ? 'Créer et préparer l\'email' : 'Enregistrer' });
  const annuler = h('button', { type: 'button', class: 'adm-btn', text: 'Fermer' });
  const actions = [annuler, enregistrer];
  if (!nouveau) {
    const code = h('button', { type: 'button', class: 'adm-btn', text: 'Nouveau code d\'activation + email' });
    code.addEventListener('click', async () => {
      code.disabled = true;
      try {
        const r = await AMGT4CEM_Auth.call('/admin/activation', { method: 'POST', body: { matricule: edition.matricule } });
        accueil = { intervenant: r.intervenant, code: r.codeActivation, expire: r.intervenant.activationExpire };
        edition = null;
        await charger();
        render();
      } catch (err) { msg.textContent = err.message; code.disabled = false; }
    });
    actions.unshift(code);
  }
  annuler.addEventListener('click', () => { edition = null; render(); });
  enregistrer.addEventListener('click', async () => {
    msg.textContent = '';
    enregistrer.disabled = true;
    try {
      const fiche = {
        matricule: f.matricule.input.value.trim(),
        prenom: f.prenom.input.value, nom: f.nom.input.value,
        gsm: gsmNormalise(f.gsm.input.value), email: f.email.input.value,
        organisation: f.organisation.input.value, division: f.division.input.value,
        departement: f.departement.input.value, service: f.service.input.value,
        droits: cases.filter((x) => x.c.checked).map((x) => x.code), actif: actif.checked,
        // Compatibilité avec un serveur pas encore à jour (il ne lit que `admin`) ; le serveur à jour lit `droits`.
        admin: cases.some((x) => x.code === 'utilisateurs' && x.c.checked),
      };
      const r = await AMGT4CEM_Auth.call('/admin/intervenants', { method: 'POST', body: { fiche } });
      accueil = r.codeActivation ? { intervenant: r.intervenant, code: r.codeActivation, expire: r.intervenant.activationExpire } : null;
      message = r.codeActivation ? '' : `Fiche ${r.intervenant.matricule} enregistrée.`;
      edition = null;
      await charger();
      render();
    } catch (err) {
      msg.textContent = err.message;
      enregistrer.disabled = false;
    }
  });
  return h('section', { class: 'adm-panel' },
    h('h2', { text: nouveau ? 'Nouvel intervenant' : `${edition.prenom} ${edition.nom} (${edition.matricule})` }),
    f.matricule.row, h('div', { class: 'adm-grid' }, f.prenom.row, f.nom.row), h('div', { class: 'adm-grid' }, f.gsm.row, f.email.row),
    h('div', { class: 'adm-grid' }, f.organisation.row, f.division.row), h('div', { class: 'adm-grid' }, f.departement.row, f.service.row),
    h('fieldset', { class: 'adm-droits' }, h('legend', { text: 'Droits' }), ...cases.map((x) => x.row),
      h('p', { class: 'adm-note', text: 'Sans droit coché : agent (lit les couches, crée et révise ses entrées).' })),
    nouveau ? null : h('label', { class: 'adm-check' }, actif, ' Compte actif (décoché : accès coupé immédiatement)'),
    msg, h('div', { class: 'adm-actions' }, ...actions));
}

function panneauAccueil() {
  const { intervenant: u, code, expire } = accueil;
  const mail = emailAccueil(u, code, expire);
  const envoyer = h('a', { class: 'adm-btn adm-btn--primary', href: mail.mailto, text: 'Ouvrir dans ma messagerie' });
  const copier = h('button', { type: 'button', class: 'adm-btn', text: 'Copier le message' });
  copier.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(mail.corps); copier.textContent = 'Copié ✓'; } catch (err) { copier.textContent = 'Copie impossible : sélectionnez le texte'; }
  });
  const fermer = h('button', { type: 'button', class: 'adm-btn', text: 'Terminé' });
  fermer.addEventListener('click', () => { accueil = null; render(); });
  return h('section', { class: 'adm-panel adm-panel--accueil' },
    h('h2', { text: `Email d'accueil pour ${u.prenom} ${u.nom}` }),
    h('p', { class: 'adm-note', text: `Le code ${code} n'est affiché qu'ici : le serveur n'en garde que l'empreinte. Il est valable jusqu'au ${jour(expire)}. S'il est perdu, générez-en un nouveau.` }),
    h('p', { class: 'adm-to', text: `À : ${u.email}` }),
    h('p', { class: 'adm-to', text: `Objet : ${mail.sujet}` }),
    h('pre', { class: 'adm-mail', text: mail.corps }),
    h('div', { class: 'adm-actions' }, fermer, copier, envoyer));
}

function render() {
  root.textContent = '';
  const s = AMGT4CEM_Auth.session();
  const entete = h('header', { class: 'adm-head' }, h('h1', { text: 'Intervenants' }), h('p', { text: 'AMGT4CEM · administration' }));
  if (!s || !AMGT4CEM_Auth.aDroit('utilisateurs', s)) {
    const b = h('button', { type: 'button', class: 'adm-btn adm-btn--primary', text: 'Se connecter' });
    b.addEventListener('click', demarrer);
    root.append(entete, h('p', { class: 'adm-note', text: 'Cette page est réservée aux comptes qui ont le droit « gestion des utilisateurs ». Connexion requise.' }), b);
    return;
  }
  const sortir = h('button', { type: 'button', class: 'adm-link', text: 'Se déconnecter' });
  sortir.addEventListener('click', () => { AMGT4CEM_Auth.logout(); liste = []; render(); });
  root.append(entete, h('p', { class: 'adm-who' }, `Connecté : ${AMGT4CEM_Auth.label(s)} · `, sortir));
  if (message) root.append(h('p', { class: 'adm-notice', text: message }));
  if (accueil) { root.append(panneauAccueil()); return; }
  if (edition) { root.append(formulaire()); return; }

  const nouveau = h('button', { type: 'button', class: 'adm-btn adm-btn--primary', text: '＋ Nouvel intervenant' });
  nouveau.addEventListener('click', () => { edition = {}; message = ''; render(); });
  const chercher = h('input', { type: 'search', class: 'adm-search', placeholder: 'Rechercher (nom, matricule, service…)', 'aria-label': 'Rechercher' });
  chercher.value = filtre;
  const zone = h('div', { class: 'adm-list' });
  const montrer = () => {
    zone.textContent = '';
    const q = filtre.trim().toLowerCase();
    const sel = liste.filter((u) => !q || [u.matricule, u.prenom, u.nom, u.email, u.service, u.departement, u.division].join(' ').toLowerCase().includes(q));
    if (!sel.length) zone.append(h('p', { class: 'adm-note', text: liste.length ? 'Aucun résultat.' : 'Aucun intervenant.' }));
    for (const u of sel) zone.append(carte(u));
  };
  chercher.addEventListener('input', () => { filtre = chercher.value; montrer(); });
  root.append(h('div', { class: 'adm-bar' }, chercher, nouveau), zone,
    h('p', { class: 'adm-note', text: `${liste.length} intervenant(s) · les mots de passe ne sont jamais visibles, ni ici ni sur le serveur (seule une empreinte est conservée).` }),
    h('p', { class: 'adm-build', text: `BUILD ${AMGT4CEM_BUILD_TIMESTAMP}` }));
  montrer();
}

async function demarrer() {
  let s = AMGT4CEM_Auth.session();
  if (!s || !AMGT4CEM_Auth.aDroit('utilisateurs', s)) s = await AMGT4CEM_Auth.ensure({ admin: true, message: 'Page réservée au droit « gestion des utilisateurs ».' });
  if (!s) { render(); return; }
  try { await charger(); } catch (err) { message = err.message; liste = []; }
  render();
}

demarrer();
})();
