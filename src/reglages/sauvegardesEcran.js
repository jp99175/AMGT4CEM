/**
 * Réglages > Utilisateurs > « Sauvegardes » (droit « utilisateurs ») : applique tout de suite la politique de sauvegarde
 * aux archives et versions déjà présentes dans R2 (attributs, zones dessinées, shapefile). Le serveur l'applique aussi, seul,
 * après chaque enregistrement ; cet écran sert à ne pas attendre le prochain.
 * Politique (25/11/2026) : la version en cours, une sauvegarde (la version juste avant) et la dernière version de chaque mois écoulé.
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

function taille(o) {
  if (o < 1024) return `${o} o`;
  if (o < 1048576) return `${(o / 1024).toFixed(1).replace('.', ',')} Ko`;
  return `${(o / 1048576).toFixed(1).replace('.', ',')} Mo`;
}
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

async function monter(conteneur) {
  conteneur.replaceChildren();
  const statut = h('p', { class: 'rgl-statut', text: 'Lecture de l\'état du serveur…' });
  const corps = h('div', {});
  conteneur.append(statut, corps);
  const dire = (t, type) => { statut.className = `rgl-statut${type ? ` rgl-statut--${type}` : ''}`; statut.textContent = t; };

  async function afficher() {
    corps.replaceChildren();
    let a;
    try { a = await AMGT4CEM_Auth.call('/admin/sauvegardes'); } catch (err) { dire(`Lecture impossible : ${err.message}`, 'erreur'); return; }
    const total = a.groupes.reduce((s, g) => s + g.fichiers, 0);
    dire(total ? `${pluriel(total, 'fichier')} hors règle, à supprimer` : 'Rien à supprimer : tout est conforme à la règle.', total ? '' : 'ok');
    corps.append(
      h('p', { class: 'rgl-note', text: 'Règle : la version en cours, une sauvegarde (la version juste avant) et la dernière version de chaque mois écoulé. Pour le vrai shapefile des polygones, la toute première version est gardée en plus.' }),
      h('h3', { class: 'rgl-sous-titre', text: 'À supprimer' }));
    for (const g of a.groupes) {
      corps.append(h('div', { class: 'rgl-row' }, h('span', { class: 'rgl-row__body' },
        h('span', { class: 'rgl-row__text', text: g.titre }),
        h('span', { class: 'rgl-row__aide', text: g.fichiers ? `${pluriel(g.fichiers, 'fichier')} · ${taille(g.octets)}` : 'rien à supprimer' }))));
    }
    const bouton = h('button', { type: 'button', class: 'rgl-btn rgl-btn--primary', text: 'Appliquer la règle' });
    bouton.disabled = !total;
    bouton.addEventListener('click', async () => {
      if (!confirm(`Supprimer ${pluriel(total, 'fichier')} d'archives et de versions anciennes ?\n\nLa version en cours, la sauvegarde et les sauvegardes mensuelles sont gardées.`)) return;
      bouton.disabled = true;
      try {
        const r = await AMGT4CEM_Auth.call('/admin/sauvegardes', { method: 'POST', body: { confirmation: 'APPLIQUER' } });
        await afficher();
        dire(`${r.effaces} fichier${r.effaces > 1 ? 's' : ''} supprimé${r.effaces > 1 ? 's' : ''}.`, 'ok');
      } catch (err) { dire(err.message, 'erreur'); bouton.disabled = false; }
    });
    corps.append(h('div', { class: 'rgl-actions' }, bouton));
  }
  await afficher();
}

window.AMGT4CEM_SauvegardesEcran = { id: 'sauvegardes', titre: 'Sauvegardes', monter };
})();
