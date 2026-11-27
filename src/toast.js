/**
 * Message bref en haut de l'écran (une ligne, disparaît seul après 2 secondes).
 *
 *   AMGT4CEM_Toast.show('Entrée enregistrée')            tout de suite
 *   AMGT4CEM_Toast.afterReload('Entrée enregistrée')     après le prochain chargement de page (changement d'écran par adresse)
 */
const AMGT4CEM_Toast = {
  KEY: 'amgt4cem-toast-en-attente',
  DUREE_MS: 2000,

  show(message, duree) {
    if (!message) return;
    const old = document.getElementById('amgt-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'amgt-toast';
    el.className = 'amgt-toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    document.body.append(el);
    setTimeout(() => el.classList.add('amgt-toast--fin'), Math.max(0, (duree || this.DUREE_MS) - 300));
    setTimeout(() => el.remove(), duree || this.DUREE_MS);
  },

  afterReload(message) {
    try { sessionStorage.setItem(this.KEY, JSON.stringify({ message, t: Date.now() })); } catch (err) { /* sans mémoire de session : pas de message */ }
  },

  /** Affiche le message laissé par la page précédente (s'il date de moins de 30 s). */
  _reprendre() {
    let v = null;
    try { v = JSON.parse(sessionStorage.getItem(this.KEY) || 'null'); sessionStorage.removeItem(this.KEY); } catch (err) { v = null; }
    if (v && v.message && Date.now() - (v.t || 0) < 30000) this.show(v.message);
  },
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => AMGT4CEM_Toast._reprendre());
else AMGT4CEM_Toast._reprendre();
