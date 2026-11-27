/**
 * Réglages > Administration temporaire > « Arborescence du stockage » (droit « utilisateurs ») : liste en lecture seule de tout ce que
 * contient le bucket R2, dossiers dépliés, avec le nombre de fichiers et la taille de chaque dossier.
 * Le serveur renvoie la liste à plat, 1000 objets par page (GET /admin/arborescence) ; l'arbre est construit ici.
 */
(function () {
const h = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  for (const c of kids) if (c) n.append(c);
  return n;
};

const MAX_PAGES = 200; // garde-fou : 200 000 objets

function taille(o) {
  if (o < 1024) return `${o} o`;
  if (o < 1048576) return `${(o / 1024).toFixed(1).replace('.', ',')} Ko`;
  return `${(o / 1048576).toFixed(1).replace('.', ',')} Mo`;
}

function date(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/** Liste plate -> arbre { nom, dossiers: Map, fichiers: [], nb, octets }. */
function construire(objets) {
  const racine = { nom: '', dossiers: new Map(), fichiers: [], nb: 0, octets: 0 };
  for (const o of objets) {
    const parts = o.cle.split('/');
    const nom = parts.pop();
    let n = racine;
    n.nb += 1; n.octets += o.taille;
    for (const p of parts) {
      if (!n.dossiers.has(p)) n.dossiers.set(p, { nom: p, dossiers: new Map(), fichiers: [], nb: 0, octets: 0 });
      n = n.dossiers.get(p);
      n.nb += 1; n.octets += o.taille;
    }
    n.fichiers.push({ nom, taille: o.taille, date: o.date });
  }
  return racine;
}

const trier = (a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true });

function dessiner(noeud, ouvert) {
  const ul = h('ul', { class: 'rgl-arbo__liste' });
  for (const d of [...noeud.dossiers.values()].sort(trier)) {
    const det = h('details', ouvert ? { open: '' } : {});
    det.append(h('summary', {}, h('span', { class: 'rgl-arbo__dossier', text: `${d.nom}/` }), h('span', { class: 'rgl-arbo__info', text: `${pluriel(d.nb, 'fichier')} · ${taille(d.octets)}` })), dessiner(d, ouvert));
    ul.append(h('li', {}, det));
  }
  for (const f of noeud.fichiers.sort(trier)) {
    ul.append(h('li', { class: 'rgl-arbo__fichier' }, h('span', { class: 'rgl-arbo__nom', text: f.nom }), h('span', { class: 'rgl-arbo__info', text: `${taille(f.taille)} · ${date(f.date)}` })));
  }
  return ul;
}

/** Texte simple, un élément par ligne, indenté de deux espaces par niveau. */
function enTexte(noeud, niveau = 0, lignes = []) {
  const marge = '  '.repeat(niveau);
  for (const d of [...noeud.dossiers.values()].sort(trier)) {
    lignes.push(`${marge}${d.nom}/  (${pluriel(d.nb, 'fichier')}, ${taille(d.octets)})`);
    enTexte(d, niveau + 1, lignes);
  }
  for (const f of noeud.fichiers.sort(trier)) lignes.push(`${marge}${f.nom}  (${taille(f.taille)}, ${date(f.date)})`);
  return lignes;
}

async function copier(texte) {
  try { await navigator.clipboard.writeText(texte); return true; } catch (e) { /* repli ci-dessous */ }
  const zone = h('textarea', { style: 'position:fixed;opacity:0' });
  zone.value = texte;
  document.body.append(zone);
  zone.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  zone.remove();
  return ok;
}

async function monter(conteneur) {
  conteneur.replaceChildren();
  const statut = h('p', { class: 'rgl-statut', text: 'Lecture du stockage…' });
  const barre = h('div', { class: 'rgl-arbo__barre' });
  const zone = h('div', { class: 'rgl-arbo' });
  conteneur.append(h('p', { class: 'rgl-note', text: 'Contenu du bucket R2, en lecture seule. Rien ne peut être modifié ni effacé depuis cet écran.' }), statut, barre, zone);

  const dire = (t, type) => { statut.className = `rgl-statut${type ? ` rgl-statut--${type}` : ''}`; statut.textContent = t; };

  async function lire() {
    zone.replaceChildren(); barre.replaceChildren();
    const objets = [];
    try {
      let suite = null;
      for (let i = 0; i < MAX_PAGES; i++) {
        const r = await AMGT4CEM_Auth.call(`/admin/arborescence${suite ? `?suite=${encodeURIComponent(suite)}` : ''}`);
        objets.push(...r.objets);
        dire(`Lecture du stockage… ${objets.length} fichiers`);
        suite = r.suite;
        if (!suite) break;
        if (i === MAX_PAGES - 1) throw new Error(`Liste trop longue : lecture arrêtée à ${objets.length} fichiers.`);
      }
    } catch (err) {
      dire(`Lecture impossible : ${err.message}`, 'erreur');
      barre.append(h('button', { class: 'rgl-btn', type: 'button', text: 'Réessayer' }));
      barre.firstChild.addEventListener('click', lire);
      return;
    }
    const arbre = construire(objets);
    dire(`${pluriel(arbre.nb, 'fichier')} · ${taille(arbre.octets)} · lu le ${date(new Date().toISOString())}`, 'ok');
    const actualiser = h('button', { class: 'rgl-btn', type: 'button', text: 'Actualiser' });
    const copie = h('button', { class: 'rgl-btn', type: 'button', text: 'Copier en texte' });
    const replier = h('button', { class: 'rgl-btn', type: 'button', text: 'Tout replier' });
    actualiser.addEventListener('click', lire);
    copie.addEventListener('click', async () => {
      const ok = await copier(enTexte(arbre).join('\n'));
      copie.textContent = ok ? 'Copié' : 'Copie impossible';
      setTimeout(() => { copie.textContent = 'Copier en texte'; }, 2500);
    });
    let tout = true;
    replier.addEventListener('click', () => {
      tout = !tout;
      zone.querySelectorAll('details').forEach((d) => { d.open = tout; });
      replier.textContent = tout ? 'Tout replier' : 'Tout déplier';
    });
    barre.append(actualiser, replier, copie);
    zone.append(arbre.nb ? dessiner(arbre, true) : h('p', { class: 'rgl-note', text: 'Le bucket est vide.' }));
  }
  await lire();
}

window.AMGT4CEM_ArborescenceEcran = { id: 'arborescence', titre: 'Arborescence du stockage', monter };
})();
