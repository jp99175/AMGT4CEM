/**
 * Barre « sélection par défaut partagée » sous la liste d'un sélecteur plein écran (UrbIS Topo,
 * Plans patrimoine). Trois états :
 *
 *  - repos : bouton « 🔒 Modifier la sélection par défaut » ;
 *  - authentification : champ du code administrateur (gardé le temps de l'onglet, comme pour le
 *    mode édition des étiquettes), vérifié auprès du relais avant d'entrer en édition ;
 *  - édition : le sélecteur affiche et modifie un BROUILLON de la sélection par défaut partagée (la carte
 *    et la sélection de l'appareil ne changent pas) ; « Enregistrer » l'envoie au relais, « Annuler »
 *    l'abandonne.
 *
 * Le sélecteur fournit : hooks.start() (passe en mode brouillon), hooks.save(code) (Promise : envoie
 * le brouillon), hooks.cancel() (abandonne le brouillon).
 */
const AMGT4CEM_PickerDefaultBar = {
  attach(container, hooks) {
    container.classList.add('amgt-default-bar');
    container.innerHTML = '';
    const status = document.createElement('p');
    status.className = 'amgt-settings-hint amgt-default-bar-status';
    const row = document.createElement('div');
    row.className = 'amgt-default-bar-row';
    container.append(row, status);

    const button = (text, onClick, cls = 'amgt-btn') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = text;
      b.addEventListener('click', onClick);
      return b;
    };
    const say = (text, isError) => {
      status.textContent = text || '';
      status.classList.toggle('amgt-default-bar-error', Boolean(isError));
    };
    const relayError = () =>
      AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl ? '' : "Adresse du relais non renseignée (⚙ Paramètres > Serveur) : enregistrement impossible.";

    const showIdle = () => {
      row.innerHTML = '';
      row.append(button('🔒 Modifier la sélection par défaut (administrateur)', startAuth));
      say('');
    };

    const startAuth = async () => {
      if (!(await AMGT4CEM_Admin.requestAccess())) return;
      const problem = relayError();
      if (problem) return say(problem, true);
      // Code déjà saisi dans cet onglet (⚙ Paramètres ou mode édition) : on le vérifie sans le redemander.
      const known = AMGT4CEM_PeLabelAnchors.getAdminCode();
      if (known && (await verify(known))) return;
      row.innerHTML = '';
      const input = document.createElement('input');
      input.type = 'password';
      input.placeholder = 'Code administrateur';
      input.autocomplete = 'off';
      input.className = 'amgt-default-bar-input';
      const go = () => verify(input.value.trim());
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      row.append(input, button('Valider', go, 'amgt-btn amgt-btn--primary'), button('Annuler', showIdle));
      input.focus();
    };

    /** Vérifie le code auprès du relais ; en cas de succès, passe en édition. */
    const verify = async (code) => {
      if (!code) return say('Saisir le code administrateur.', true);
      say('Vérification…');
      try {
        await AMGT4CEM_PeLabelAnchors.checkConnection(AMGT4CEM_CONFIG.peLabelAnchorsRelayUrl, code);
      } catch (err) {
        AMGT4CEM_PeLabelAnchors.setAdminCode('');
        say(err.message, true);
        return false;
      }
      AMGT4CEM_PeLabelAnchors.setAdminCode(code);
      startEdit(code);
      return true;
    };

    const startEdit = (code) => {
      hooks.start();
      row.innerHTML = '';
      const saveBtn = button('Enregistrer la sélection par défaut', async () => {
        saveBtn.disabled = true;
        say('Enregistrement…');
        try {
          await hooks.save(code);
        } catch (err) {
          saveBtn.disabled = false;
          return say(err.message, true);
        }
        showIdle();
        say('✓ Sélection par défaut enregistrée (visible par tous après le redéploiement du site, environ 1 minute).');
      }, 'amgt-btn amgt-btn--primary');
      row.append(saveBtn, button('Annuler', () => { hooks.cancel(); showIdle(); }));
      say('Modification de la sélection par défaut PARTAGÉE : la carte et votre sélection ne changent pas tant que vous n’enregistrez pas.');
    };

    showIdle();
    return {
      /** À appeler à la fermeture du sélecteur : abandonne toute édition en cours. */
      reset() {
        showIdle();
      },
    };
  },
};
