/**
 * Annotations de photo — historique par instantanés : chaque modification validée range l'état d'avant (annuler) ;
 * « refaire » rend l'état annulé. `snap()` sérialise l'état courant, `restaurer(str)` le remet.
 */
(function () {
const A = (window.AMGT4CEM_Annotate = window.AMGT4CEM_Annotate || {});

A.History = {
  create(snap, restaurer, max = 80) {
    const undoS = [];
    const redoS = [];
    return {
      undoS,
      redoS,
      /** Range `base` (état avant la modification) si l'état courant en diffère. */
      commit(base) {
        if (base != null && base !== snap()) { undoS.push(base); if (undoS.length > max) undoS.shift(); redoS.length = 0; }
      },
      /** Annule la dernière modification ; false s'il n'y en a pas. */
      undo() {
        const prev = undoS.pop();
        if (prev == null) return false;
        redoS.push(snap());
        restaurer(prev);
        return true;
      },
      redo() {
        const next = redoS.pop();
        if (next == null) return false;
        undoS.push(snap());
        restaurer(next);
        return true;
      },
      /** Revient à l'état `base` en oubliant les modifications au-delà de `n` instantanés. */
      revenir(n, base) { undoS.length = Math.min(undoS.length, n); redoS.length = 0; restaurer(base); },
    };
  },
};
})();
