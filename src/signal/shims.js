/**
 * Pièces de raccord entre le réseau (src/metroLayer.js) et l'interface de saisie.
 *
 * metroLayer.js demande à l'outil « Ajouter un point » de la carte AMGT4CEM s'il est actif avant de relayer un
 * clic de polygone ; SIG4CEM n'a pas cet outil (son choix du point passe par AMGT4CEM_Plugins.captureClicks,
 * voir mapPicker.js). Ce raccord répond « jamais actif » pour que les clics soient relayés à la carte de choix.
 */
const AMGT4CEM_AddPointTool = { isActive: () => false, handleMapClick: () => {} };
