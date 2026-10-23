/**
 * Écran de connexion (plein écran, au-dessus de l'interface) : « Connexion » et « Première connexion ».
 *
 *   AMGT4CEM_AuthUi.prompt({ message, onglet: 'connexion' | 'activation', matricule, code, admin, titre, fermer, sansActivation })
 *     -> Promise<session | null>   null si l'agent ferme l'écran. `admin: true` exige le droit administrateur.
 *     `titre` (défaut « Identification »), `fermer` (libellé du bouton de fermeture, défaut « Fermer »),
 *     `sansActivation: true` masque l'onglet « Première connexion » (prolongation de session).
 *
 * Première connexion : matricule + code d'activation reçu par email + mot de passe choisi (8 caractères au moins).
 */
const AMGT4CEM_AuthUi = {
  prompt(options = {}) {
    return new Promise((resolve) => {
      const el = (tag, attrs, ...kids) => {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
          if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
        }
        for (const c of kids) if (c) n.append(c);
        return n;
      };
      let onglet = options.onglet === 'activation' ? 'activation' : 'connexion';

      const field = (id, label, type, value, extra) => {
        const input = el('input', { id, type, autocomplete: 'off', ...(extra || {}) });
        if (value) input.value = value;
        return { input, row: el('div', { class: 'auth-row' }, el('label', { for: id, text: label }), input) };
      };
      const matricule = field('auth-matricule', 'Matricule', 'text', options.matricule || '', { autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false' });
      const code = field('auth-code', "Code d'activation (reçu par email)", 'text', options.code || '', { autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false' });
      const mdp = field('auth-mdp', 'Mot de passe', 'password', '', { autocomplete: 'current-password' });
      const mdp2 = field('auth-mdp2', 'Mot de passe (répétez-le)', 'password', '', { autocomplete: 'new-password' });
      const msg = el('p', { class: 'auth-msg', role: 'alert' });
      const intro = el('p', { class: 'auth-intro', text: options.message || '' });
      const tabs = ['connexion', 'activation'].map((k) => {
        const b = el('button', { type: 'button', class: 'auth-tab', text: k === 'connexion' ? 'Connexion' : 'Première connexion' });
        b.addEventListener('click', () => { onglet = k; refresh(); });
        return [k, b];
      });
      const ok = el('button', { type: 'button', class: 'auth-btn auth-btn--primary' });
      const cancel = el('button', { type: 'button', class: 'auth-btn', text: options.fermer || 'Fermer' });
      const form = el('form', { class: 'auth-form' }, matricule.row, code.row, mdp.row, mdp2.row, msg, el('div', { class: 'auth-actions' }, cancel, ok));
      const tabsBar = el('div', { class: 'auth-tabs' }, ...tabs.map((t) => t[1]));
      tabsBar.hidden = !!options.sansActivation;
      const box = el('div', { class: 'auth-box' }, el('h2', { text: options.titre || 'Identification' }), intro, tabsBar, form);
      const root = el('div', { class: 'auth-overlay' }, box);
      document.body.append(root);

      function refresh() {
        const act = onglet === 'activation';
        for (const [k, b] of tabs) b.classList.toggle('auth-tab--on', k === onglet);
        code.row.hidden = !act;
        mdp2.row.hidden = !act;
        mdp.input.setAttribute('autocomplete', act ? 'new-password' : 'current-password');
        mdp.row.querySelector('label').textContent = act ? 'Choisissez votre mot de passe (8 caractères au moins)' : 'Mot de passe';
        ok.textContent = act ? 'Activer mon compte' : 'Se connecter';
        msg.textContent = '';
      }
      function close(result) {
        root.remove();
        resolve(result);
      }
      async function submit() {
        msg.textContent = '';
        const m = matricule.input.value.trim();
        if (!m || !mdp.input.value) { msg.textContent = 'Merci de remplir tous les champs.'; return; }
        if (onglet === 'activation') {
          if (!code.input.value.trim()) { msg.textContent = "Merci d'indiquer le code d'activation."; return; }
          if (mdp.input.value !== mdp2.input.value) { msg.textContent = 'Les deux mots de passe ne sont pas identiques.'; return; }
        }
        ok.disabled = true;
        const attente = ok.textContent;
        ok.textContent = 'Vérification…';
        try {
          const s = onglet === 'activation'
            ? await AMGT4CEM_Auth.activer(m, code.input.value.trim(), mdp.input.value)
            : await AMGT4CEM_Auth.login(m, mdp.input.value);
          if (options.admin && !s.utilisateur.admin) {
            AMGT4CEM_Auth.logout();
            msg.textContent = "Ce compte n'a pas le droit administrateur.";
            return;
          }
          close(s);
        } catch (err) {
          msg.textContent = err.message;
        } finally {
          ok.disabled = false;
          ok.textContent = attente;
        }
      }
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
      ok.addEventListener('click', submit);
      cancel.addEventListener('click', () => close(null));
      refresh();
      (matricule.input.value ? (onglet === 'activation' ? mdp.input : mdp.input) : matricule.input).focus();
    });
  },
};
