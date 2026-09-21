-- ============================================================
-- Base patrimoine - schema V1
-- Moteur : SQLite
-- Se greffe sur AMGT4CEM sans en faire partie : l'application
-- (src/, index.html, config.js...) n'est pas concernee par ce
-- fichier et continue de fonctionner independamment.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ============================================================
-- 1. VOCABULAIRE CONTROLE (ref_*)
-- ============================================================
-- Meme structure pour toutes les tables de reference : un code
-- stable (ne change jamais, utilise dans les requetes/le code),
-- un libelle affiche, un flag actif (pour desactiver une valeur
-- sans casser l'historique des lignes qui l'utilisent), un ordre
-- d'affichage optionnel.

CREATE TABLE ref_type_zone (
    id      INTEGER PRIMARY KEY,
    code    TEXT NOT NULL UNIQUE,   -- STATION, TUNNEL, NIVEAU, LOCAL, GRILLE, POINT, ZONE_INTERVENTION, EMPRISE_PLAN...
    libelle TEXT NOT NULL,
    actif   INTEGER NOT NULL DEFAULT 1,
    ordre   INTEGER
);

CREATE TABLE ref_type_actif (
    id      INTEGER PRIMARY KEY,
    code    TEXT NOT NULL UNIQUE,
    libelle TEXT NOT NULL,
    actif   INTEGER NOT NULL DEFAULT 1,
    ordre   INTEGER
);

CREATE TABLE ref_technique (
    id      INTEGER PRIMARY KEY,
    code    TEXT NOT NULL UNIQUE,   -- GC, ETAN, DRAIN, ARCH, ELEC, HVAC...
    libelle TEXT NOT NULL,
    actif   INTEGER NOT NULL DEFAULT 1,
    ordre   INTEGER
);

CREATE TABLE ref_type_observation (
    id      INTEGER PRIMARY KEY,
    code    TEXT NOT NULL UNIQUE,   -- SIGNALEMENT, CONSTAT
    libelle TEXT NOT NULL,
    actif   INTEGER NOT NULL DEFAULT 1,
    ordre   INTEGER
);

CREATE TABLE ref_statut_observation (
    id      INTEGER PRIMARY KEY,
    code    TEXT NOT NULL UNIQUE,   -- RECU, A_OBJECTIVER, OBJECTIVE, NON_CONFIRME, TRANSFERE, CLOS
    libelle TEXT NOT NULL,
    actif   INTEGER NOT NULL DEFAULT 1,
    ordre   INTEGER
);

CREATE TABLE ref_statut_dossier (
    id      INTEGER PRIMARY KEY,
    code    TEXT NOT NULL UNIQUE,   -- OUVERT, EN_COURS, EN_ATTENTE, CLOS
    libelle TEXT NOT NULL,
    actif   INTEGER NOT NULL DEFAULT 1,
    ordre   INTEGER
);

CREATE TABLE ref_type_media (
    id      INTEGER PRIMARY KEY,
    code    TEXT NOT NULL UNIQUE,   -- PHOTO, PLAN, DOCUMENT, AUTRE
    libelle TEXT NOT NULL,
    actif   INTEGER NOT NULL DEFAULT 1,
    ordre   INTEGER
);

-- ============================================================
-- 2. INTERVENANTS
-- ============================================================
-- Toute personne citee dans le systeme : auteur d'une observation,
-- responsable d'un suivi, etc. Remplace le texte libre.

CREATE TABLE intervenant (
    id         INTEGER PRIMARY KEY,
    matricule  TEXT UNIQUE,   -- nullable : un intervenant externe peut ne pas avoir de matricule interne
    nom        TEXT NOT NULL,
    prenom     TEXT NOT NULL,
    email      TEXT,
    gsm        TEXT,
    actif      INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 3. ZONES (geographie / patrimoine)
-- ============================================================
-- Concept generique : station, tunnel, grille, simple point, zone
-- d'intervention ou emprise d'un plan sont tous des `zone`, distingues
-- par type_zone_id. La hierarchie (parent_id) sert notamment a
-- rattacher les niveaux/etages a leur zone parente (station > niveau
-- > local).

CREATE TABLE zone (
    id           INTEGER PRIMARY KEY,
    code         TEXT UNIQUE,                    -- identifiant metier court, optionnel
    nom          TEXT NOT NULL,
    type_zone_id INTEGER NOT NULL REFERENCES ref_type_zone(id),
    parent_id    INTEGER REFERENCES zone(id),     -- hierarchie : station > niveau > local
    geometry     TEXT,                            -- GeoJSON, coordonnees en Lambert 72 (EPSG:31370, coherent avec l'appli)
    niveau_label TEXT,                             -- ex: "-1", "-2" - affichage seulement, pas de logique dessus
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),

    CHECK (parent_id IS NULL OR parent_id <> id)   -- une zone ne peut pas etre son propre parent
);

CREATE INDEX idx_zone_parent ON zone(parent_id);
CREATE INDEX idx_zone_type ON zone(type_zone_id);

-- ============================================================
-- 4. ACTIFS (objets patrimoniaux)
-- ============================================================
-- Un actif est l'objet physique reel (un mur, un joint, une pompe...),
-- rattache a une zone. Hierarchie propre (parent_actif_id) independante
-- de celle des zones, pour descendre au niveau de detail voulu sans
-- devoir restructurer les zones.

CREATE TABLE actif (
    id                INTEGER PRIMARY KEY,
    code_actif        TEXT UNIQUE,
    type_actif_id     INTEGER NOT NULL REFERENCES ref_type_actif(id),
    zone_id           INTEGER REFERENCES zone(id),
    parent_actif_id   INTEGER REFERENCES actif(id),   -- hierarchie : mur > joint
    technique_id      INTEGER REFERENCES ref_technique(id),
    date_mise_service TEXT,
    statut            TEXT NOT NULL DEFAULT 'ACTIF',
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),

    CHECK (parent_actif_id IS NULL OR parent_actif_id <> id)
);

CREATE INDEX idx_actif_zone ON actif(zone_id);
CREATE INDEX idx_actif_parent ON actif(parent_actif_id);

-- ============================================================
-- 5. DOSSIERS (projet identifie ou maintenance)
-- ============================================================
-- Cree avant `observation` car observation.dossier_id y fait reference.
-- Le dossier regroupe les evenements lies a un meme probleme ou projet.

CREATE TABLE dossier (
    id             INTEGER PRIMARY KEY,
    reference      TEXT NOT NULL UNIQUE,   -- ex: D-2027-0042
    titre          TEXT NOT NULL,
    description    TEXT,
    actif_id       INTEGER REFERENCES actif(id),
    technique_id   INTEGER REFERENCES ref_technique(id),
    statut_id      INTEGER NOT NULL REFERENCES ref_statut_dossier(id),
    date_ouverture TEXT NOT NULL DEFAULT (date('now')),
    date_cloture   TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_dossier_actif ON dossier(actif_id);
CREATE INDEX idx_dossier_statut ON dossier(statut_id);

-- ============================================================
-- 6. OBSERVATIONS (signalements + constats)
-- ============================================================
-- Signalement = non objectivise (recu de l'exterieur, porte une
-- reference_demandeur). Constat = objectivise (technique, qualifie).
-- Les deux partagent la meme table, distingues par type_observation_id
-- et statut_id, ce qui permet de faire evoluer un signalement en
-- constat (ou de le clore sans confirmation) sans dupliquer la ligne.

CREATE TABLE observation (
    id                   INTEGER PRIMARY KEY,
    type_observation_id  INTEGER NOT NULL REFERENCES ref_type_observation(id),
    statut_id            INTEGER NOT NULL REFERENCES ref_statut_observation(id),
    date_observation     TEXT NOT NULL,

    zone_id              INTEGER REFERENCES zone(id),
    actif_id             INTEGER REFERENCES actif(id),
    dossier_id           INTEGER REFERENCES dossier(id),   -- NULL tant que non rattachee a un dossier

    x_lambert            REAL,
    y_lambert            REAL,
    description          TEXT NOT NULL,
    source               TEXT,                              -- ex: "usager", "agent terrain", "inspection"

    -- Specifique aux signalements (non objectives)
    reference_demandeur  TEXT,
    demandeur_nom        TEXT,   -- texte libre : le demandeur externe n'est pas forcement un `intervenant` connu du systeme

    -- Auteur interne de l'observation (celui qui l'encode), si connu
    auteur_id            INTEGER REFERENCES intervenant(id),

    created_at           TEXT NOT NULL DEFAULT (datetime('now')),

    -- une observation doit etre localisee d'une facon ou d'une autre
    CHECK (zone_id IS NOT NULL OR actif_id IS NOT NULL OR (x_lambert IS NOT NULL AND y_lambert IS NOT NULL))
);

CREATE INDEX idx_observation_dossier ON observation(dossier_id);
CREATE INDEX idx_observation_zone ON observation(zone_id);
CREATE INDEX idx_observation_actif ON observation(actif_id);
CREATE INDEX idx_observation_type ON observation(type_observation_id);
CREATE INDEX idx_observation_statut ON observation(statut_id);

-- ============================================================
-- 7. MEDIA (photos, plans... - polymorphe)
-- ============================================================
-- type_objet est un ensemble fixe et structurel (pas du vocabulaire
-- "metier" amene a evoluer), d'ou une contrainte CHECK plutot qu'une
-- table ref_ dediee. Attention : SQLite ne supporte pas de cle
-- etrangere polymorphe, donc objet_id n'est pas verifie par la base -
-- l'integrite de ce lien (est-ce que la ligne ciblee existe vraiment ?)
-- est a la charge de l'application ou des scripts d'import.

CREATE TABLE media (
    id             INTEGER PRIMARY KEY,
    type_objet     TEXT NOT NULL CHECK (type_objet IN ('ZONE', 'ACTIF', 'OBSERVATION', 'DOSSIER')),
    objet_id       INTEGER NOT NULL,
    type_media_id  INTEGER NOT NULL REFERENCES ref_type_media(id),
    chemin_fichier TEXT NOT NULL,
    description    TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_media_objet ON media(type_objet, objet_id);

-- ============================================================
-- 8. MARCHES
-- ============================================================
-- Ressource contractuelle. Version simple en V1 (pas encore de
-- marche_technique / marche_prestation) : reference, objet,
-- prestataire, periode, montant.

CREATE TABLE marche (
    id          INTEGER PRIMARY KEY,
    reference   TEXT NOT NULL UNIQUE,
    objet       TEXT NOT NULL,
    prestataire TEXT,
    date_debut  TEXT,
    date_fin    TEXT,
    montant     REAL,
    statut      TEXT NOT NULL DEFAULT 'ACTIF',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Un dossier peut mobiliser plusieurs marches (ex: un marche d'urgence
-- pour une intervention provisoire, un autre pour la reparation
-- definitive) : table de liaison many-to-many.
CREATE TABLE dossier_marche (
    dossier_id  INTEGER NOT NULL REFERENCES dossier(id),
    marche_id   INTEGER NOT NULL REFERENCES marche(id),
    commentaire TEXT,
    PRIMARY KEY (dossier_id, marche_id)
);

-- ============================================================
-- 9. SUIVI (intervenants assignes a un dossier, dans le temps)
-- ============================================================
-- Plusieurs lignes actives (date_fin NULL) peuvent coexister pour un
-- meme dossier : ex. un intervenant sur le volet technique et un autre
-- sur l'administratif, en parallele. Une reassignation cree une
-- nouvelle ligne plutot que d'ecraser l'ancienne, pour garder
-- l'historique.

CREATE TABLE suivi (
    id             INTEGER PRIMARY KEY,
    dossier_id     INTEGER NOT NULL REFERENCES dossier(id),
    intervenant_id INTEGER NOT NULL REFERENCES intervenant(id),
    role           TEXT,     -- ex: "technique", "administratif" - texte libre en V1
    date_debut     TEXT NOT NULL DEFAULT (date('now')),
    date_fin       TEXT,     -- NULL = toujours actif
    statut         TEXT NOT NULL DEFAULT 'ACTIF',
    commentaire    TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_suivi_dossier ON suivi(dossier_id);
CREATE INDEX idx_suivi_intervenant ON suivi(intervenant_id);
