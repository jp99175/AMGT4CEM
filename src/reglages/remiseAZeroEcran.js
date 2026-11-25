/**
 * Réglages > Utilisateurs > « Remise à zéro des fiches » (droit « utilisateurs »).
 * Phase d'essai seulement : efface sur le serveur l'ancien rangement des fiches, les fiches de signalement et l'historique
 * de la couche d'essai du shapefile, remet à zéro les références (prochaine fiche : AAAA-0001) et fait avancer le numéro
 * de remise à zéro : chaque appareil efface ses fiches et photos locales à sa prochaine connexion.
 * À retirer à la mise en service (étape 8 de la spécification du stockage).
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
    try { a = await AMGT4CEM_Auth.call('/admin/remise-a-zero'); } catch (err) { dire(`Lecture impossible : ${err.message}`, 'erreur'); return; }
    const annee = new Date().getFullYear();
    const total = a.groupes.reduce((s, g) => s + g.fichiers, 0);
    dire(`${pluriel(total, 'fichier')} à effacer · remise à zéro n° ${a.epoque}`, total ? '' : 'ok');

    corps.append(h('h3', { class: 'rgl-sous-titre', text: 'Sera effacé sur le serveur' }));
    for (const g of a.groupes) {
      corps.append(h('div', { class: 'rgl-row' }, h('span', { class: 'rgl-row__body' },
        h('span', { class: 'rgl-row__text', text: g.titre }),
        h('span', { class: 'rgl-row__aide', text: `${pluriel(g.fichiers, 'fichier')} · ${taille(g.octets)}${g.partiel ? ' (liste partielle)' : ''}` }))));
    }
    corps.append(
      h('h3', { class: 'rgl-sous-titre', text: 'Références et appareils' }),
      h('p', { class: 'rgl-note', text: `La prochaine fiche sera ${annee}-0001. Chaque appareil effacera ses fiches et photos locales (brouillons, envois en attente, fiches envoyées) à sa prochaine connexion : la remise à zéro passera du n° ${a.epoque} au n° ${a.epoque + 1}. Un envoi préparé avant la remise à zéro est refusé.` }),
      h('h3', { class: 'rgl-sous-titre', text: 'Ne sera pas touché' }),
      h('p', { class: 'rgl-note', text: 'Comptes, shapefile des polygones, version courante du shapefile d\'essai, zones dessinées (lieux), attributs, nappe, compteurs d\'identifiants P, L et G.' }));

    const champ = h('input', { type: 'text', class: 'rgl-input', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': 'Confirmation', placeholder: 'Écrire EFFACER' });
    const bouton = h('button', { type: 'button', class: 'rgl-btn rgl-btn--primary', text: 'Effacer' });
    bouton.disabled = true;
    champ.addEventListener('input', () => { bouton.disabled = champ.value.trim() !== 'EFFACER'; });
    bouton.addEventListener('click', async () => {
      bouton.disabled = true; champ.disabled = true;
      let effaces = 0;
      try {
        for (let i = 0; i < 100; i++) {
          dire(`Effacement en cours… ${effaces} fichiers effacés`);
          const r = await AMGT4CEM_Auth.call('/admin/remise-a-zero', { method: 'POST', body: { confirmation: 'EFFACER' } });
          effaces += r.effaces;
          if (!r.restant) break;
          if (i === 99) throw new Error('Effacement interrompu : trop de lots. Relancez-le.');
        }
        const fin = await AMGT4CEM_Auth.call('/admin/remise-a-zero', { method: 'POST', body: { confirmation: 'EFFACER', finale: true } });
        await AMGT4CEM_Auth.rafraichirDroits(); // met aussi cet appareil à jour
        await afficher();
        dire(`${effaces} fichier${effaces > 1 ? 's' : ''} effacé${effaces > 1 ? 's' : ''}. Prochaine référence ${annee}-0001. Remise à zéro n° ${fin.epoque}.`, 'ok');
      } catch (err) {
        dire(`${effaces} fichiers effacés, puis : ${err.message}`, 'erreur');
        await afficher();
        dire(`${effaces} fichiers effacés, puis : ${err.message}`, 'erreur');
      }
    });
    corps.append(h('div', { class: 'rgl-actions' }, champ, bouton));
  }
  await afficher();
}

window.AMGT4CEM_RemiseAZeroEcran = { id: 'remise-a-zero', titre: 'Remise à zéro des fiches', monter };
})();
