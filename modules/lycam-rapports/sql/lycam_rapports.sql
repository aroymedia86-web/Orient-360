-- =============================================================================
-- ORIENT 360 — Module « Rapports et tableaux statistiques LYCAM »
-- Schéma PostgreSQL (compatible Supabase). MySQL : voir les notes en fin de fichier.
--
-- Ce script N'ALTÈRE AUCUNE table existante d'ORIENT 360. Il ajoute :
--   1. trois tables propres au module (seuils versionnés, validations, journal) ;
--   2. une fonction de lecture qui assemble, à partir des tables EXISTANTES,
--      le jeu de données attendu par l'interface (JSON).
--
-- ⚠ Les noms des tables sources (eleves, classes, lycam_resultats, …) sont des
--   hypothèses : les remplacer dans la section 2 par les vrais noms d'ORIENT 360
--   (repérés par « À ADAPTER »).
-- =============================================================================

-- 1. TABLES DU MODULE ---------------------------------------------------------

-- Seuils et critères paramétrables par l'administrateur, conservés par année scolaire.
-- Une nouvelle ligne est créée à chaque modification : l'historique n'est jamais écrasé.
CREATE TABLE IF NOT EXISTS lycam_parametres (
  id                  BIGSERIAL PRIMARY KEY,
  annee_scolaire      TEXT        NOT NULL,
  seuil_eleve_sup_a   NUMERIC     NOT NULL DEFAULT 18,   -- risque élevé : score > 18
  seuil_modere_des    NUMERIC     NOT NULL DEFAULT 10,   -- risque modéré : 10 ≤ score ≤ 18
  formule_total       TEXT        NOT NULL DEFAULT 'somme' CHECK (formule_total IN ('somme', 'stocke')),
  criteres_dimensions JSONB       NOT NULL DEFAULT '{"AF":null,"PS":null,"RS":null,"CS":null,"AB":null,"BS":null,"IE":null}',
  modifie_par         TEXT,
  modifie_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (seuil_modere_des <= seuil_eleve_sup_a)
);
CREATE INDEX IF NOT EXISTS lycam_parametres_annee ON lycam_parametres (annee_scolaire, modifie_le DESC);

-- Validation des données par l'Inspecteur d'Orientation (une par établissement et par année).
-- L'empreinte permet de détecter toute modification ultérieure des données (« à revalider »).
CREATE TABLE IF NOT EXISTS lycam_validations (
  id               BIGSERIAL PRIMARY KEY,
  etablissement_id TEXT        NOT NULL,
  annee_scolaire   TEXT        NOT NULL,
  empreinte        TEXT        NOT NULL,
  observations     TEXT,
  valide_par       TEXT        NOT NULL,
  valide_par_id    TEXT,
  valide_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lycam_validations_cle ON lycam_validations (etablissement_id, annee_scolaire, valide_le DESC);

-- Journal des générations et téléchargements (traçabilité).
CREATE TABLE IF NOT EXISTS lycam_journal_rapports (
  id               BIGSERIAL PRIMARY KEY,
  etablissement_id TEXT,
  annee_scolaire   TEXT,
  action           TEXT        NOT NULL,   -- generation | telechargement_pdf | telechargement_xlsx
  tableau          TEXT,
  empreinte        TEXT,
  utilisateur_id   TEXT,
  cree_le          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Derniers paramètres en vigueur pour une année.
CREATE OR REPLACE FUNCTION lycam_parametres_actuels(p_annee TEXT)
RETURNS JSON LANGUAGE sql STABLE AS $$
  SELECT json_build_object(
    'seuils', json_build_object('eleve_strictement_superieur_a', seuil_eleve_sup_a, 'modere_a_partir_de', seuil_modere_des),
    'formule_total', formule_total,
    'criteres_dimensions', criteres_dimensions,
    'version', id, 'date_effet', modifie_le)
  FROM lycam_parametres WHERE annee_scolaire = p_annee
  ORDER BY modifie_le DESC LIMIT 1;
$$;

-- 2. LECTURE DES DONNÉES EXISTANTES D'ORIENT 360 -------------------------------
-- Retourne exactement le format attendu par LycamCore.preparer().
-- Lecture seule : aucune donnée source n'est modifiée.
CREATE OR REPLACE FUNCTION lycam_jeu_donnees(p_etablissement TEXT, p_annee TEXT)
RETURNS JSON LANGUAGE sql STABLE AS $$
  SELECT json_build_object(
    'annee_scolaire', p_annee,
    'date_reference', current_date,

    'etablissement', (
      SELECT json_build_object(
        'id', e.id, 'nom', e.nom,
        -- Lignes d'en-tête administratif du PDF (ministère, DRENA, CIO…), dans l'ordre.
        'entete_lignes', COALESCE(e.entete_lignes, '[]'::jsonb))     -- À ADAPTER
      FROM etablissements e                                           -- À ADAPTER
      WHERE e.id::text = p_etablissement),

    'classes', COALESCE((
      SELECT json_agg(json_build_object(
        'id', c.id, 'nom', c.nom, 'ordre', c.ordre,
        'concernee_lycam', c.concernee_lycam,                          -- À ADAPTER (classes retenues pour le test)
        'motif_choix', c.motif_choix_lycam)                            -- À ADAPTER (motif du choix de la classe)
        ORDER BY c.ordre, c.nom)
      FROM classes c                                                   -- À ADAPTER
      WHERE c.etablissement_id::text = p_etablissement AND c.annee_scolaire = p_annee), '[]'),

    'eleves', COALESCE((
      SELECT json_agg(json_build_object(
        'id', el.id,
        'matricule', el.matricule,
        'nom', el.nom,
        'prenoms', el.prenoms,
        'genre', el.genre,                    -- 'F' / 'G' (ou 'M', 'Fille', 'Garçon' : normalisé par le module)
        'date_naissance', el.date_naissance,
        'classe_id', i.classe_id,
        'redoublant', i.redoublant,
        'present_test', lp.present,           -- présence au test LYCAM
        'moyenne_t1', n.moyenne_t1))
      FROM inscriptions i                                              -- À ADAPTER
      JOIN eleves el ON el.id = i.eleve_id                             -- À ADAPTER
      JOIN classes c ON c.id = i.classe_id
      LEFT JOIN lycam_passations lp ON lp.eleve_id = el.id AND lp.annee_scolaire = p_annee   -- À ADAPTER
      LEFT JOIN moyennes_trimestrielles n ON n.eleve_id = el.id AND n.annee_scolaire = p_annee AND n.trimestre = 1  -- À ADAPTER
      WHERE c.etablissement_id::text = p_etablissement AND i.annee_scolaire = p_annee), '[]'),

    'resultats', COALESCE((
      SELECT json_agg(json_build_object(
        'eleve_id', r.eleve_id,
        'depouille', r.depouille,
        'scores', json_build_object('AF', r.af, 'PS', r.ps, 'RS', r.rs, 'CS', r.cs, 'AB', r.ab, 'BS', r.bs, 'IE', r.ie),
        'total', r.total,
        'nb_dimensions_suivre', r.nb_dimensions_suivre,
        'niveau_risque', r.niveau_risque,     -- classification enregistrée par le module LYCAM
        'valide', r.valide,                   -- résultat validé : sa classification historique est conservée
        'date_test', r.date_test))
      FROM lycam_resultats r                                           -- À ADAPTER
      JOIN inscriptions i ON i.eleve_id = r.eleve_id AND i.annee_scolaire = p_annee
      JOIN classes c ON c.id = i.classe_id
      WHERE c.etablissement_id::text = p_etablissement AND r.annee_scolaire = p_annee), '[]')
  );
$$;

-- 3. DROITS (Supabase / RLS) ----------------------------------------------------
-- Activer la sécurité au niveau des lignes et n'autoriser que les profils habilités.
-- Adapter la fonction de rôle à celle d'ORIENT 360 (ex. auth.jwt() ->> 'role').
ALTER TABLE lycam_parametres       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lycam_validations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lycam_journal_rapports ENABLE ROW LEVEL SECURITY;
-- Exemples :
-- CREATE POLICY lecture_parametres ON lycam_parametres FOR SELECT USING (true);
-- CREATE POLICY admin_parametres  ON lycam_parametres FOR INSERT WITH CHECK ((auth.jwt() ->> 'role') = 'administrateur');
-- CREATE POLICY ins_validation    ON lycam_validations FOR INSERT WITH CHECK ((auth.jwt() ->> 'role') IN ('inspecteur', 'administrateur'));

-- 4. ACTUALISATION AUTOMATIQUE ------------------------------------------------
-- Notifie l'interface lorsqu'un résultat LYCAM change (relayé en Server-Sent Events
-- par l'API, ou via Supabase Realtime sur la table lycam_resultats).
CREATE OR REPLACE FUNCTION lycam_notifier() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_notify('lycam_modifie', COALESCE(NEW.annee_scolaire, OLD.annee_scolaire)); RETURN NULL; END $$;
-- DROP TRIGGER IF EXISTS lycam_resultats_notifier ON lycam_resultats;
-- CREATE TRIGGER lycam_resultats_notifier AFTER INSERT OR UPDATE OR DELETE ON lycam_resultats
--   FOR EACH ROW EXECUTE FUNCTION lycam_notifier();                   -- À ACTIVER après adaptation

-- Notes MySQL / MariaDB : remplacer BIGSERIAL par BIGINT AUTO_INCREMENT, JSONB par JSON,
-- TIMESTAMPTZ par DATETIME, json_build_object par JSON_OBJECT, json_agg par JSON_ARRAYAGG,
-- et écrire les fonctions de lecture comme requêtes dans l'API (pas de RLS ni de pg_notify).
