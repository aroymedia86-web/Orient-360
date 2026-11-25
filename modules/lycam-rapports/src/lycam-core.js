/*
 * ORIENT 360 — Module « Rapports et tableaux statistiques LYCAM »
 * Noyau de calcul (sans dépendance, utilisable dans le navigateur et sous Node).
 *
 * Principe : les tableaux sont une représentation automatique, fidèle et
 * vérifiable des données LYCAM enregistrées dans ORIENT 360. Ce fichier ne
 * modifie jamais les données reçues et n'invente aucune valeur : un champ
 * absent reste vide (null) et est signalé par les contrôles.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LycamCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Acronymes officiels LYCAM : conservés tels quels, sans réinterprétation. */
  var DIMENSIONS = ['AF', 'PS', 'RS', 'CS', 'AB', 'BS', 'IE'];

  var RISQUES = {
    ELEVE: { code: 'ELEVE', libelle: 'Élevé' },
    MODERE: { code: 'MODERE', libelle: 'Modéré' },
    AUCUN: { code: 'AUCUN', libelle: 'Aucun' }
  };

  /**
   * Seuils du document de référence :
   *  - risque élevé  : score > 18
   *  - risque modéré : 10 ≤ score ≤ 18
   *  - inférieur     : score < 10
   * Paramétrables par l'administrateur (voir parametres.seuils).
   */
  var SEUILS_REFERENCE = { eleve_strictement_superieur_a: 18, modere_a_partir_de: 10 };

  var PARAMETRES_DEFAUT = {
    seuils: SEUILS_REFERENCE,
    // Formule de cotation du total. 'stocke' : on reprend le total calculé par
    // le module LYCAM d'ORIENT 360 ; à défaut, 'somme' des 7 dimensions.
    formule_total: 'somme',
    // Critère officiel « dimension à suivre (+) » : seuil par dimension.
    // Tant qu'il n'est pas configuré (null), on reprend la valeur enregistrée
    // par le module LYCAM ; sinon la cellule reste vide et est signalée.
    criteres_dimensions: { AF: null, PS: null, RS: null, CS: null, AB: null, BS: null, IE: null },
    registre_inclure_absents: false
  };

  // ---------------------------------------------------------------- utilitaires
  function estVide(v) { return v === null || v === undefined || (typeof v === 'string' && v.trim() === ''); }

  function nombre(v) {
    if (estVide(v)) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var n = Number(String(v).replace(',', '.').trim());
    return isFinite(n) ? n : null;
  }

  function booleen(v) {
    if (v === true || v === false) return v;
    if (estVide(v)) return null;
    var s = String(v).trim().toLowerCase();
    if (['1', 'oui', 'o', 'true', 'vrai', 'r', 'red', 'redoublant', 'present', 'présent', 'p', 'x'].indexOf(s) >= 0) return true;
    if (['0', 'non', 'n', 'false', 'faux', 'nr', 'absent', 'a', 'abs'].indexOf(s) >= 0) return false;
    return null;
  }

  function normaliserGenre(v) {
    if (estVide(v)) return null;
    var s = String(v).trim().toLowerCase();
    if (['f', 'fille', 'féminin', 'feminin', 'femme', 'féminine'].indexOf(s) >= 0) return 'F';
    if (['g', 'm', 'garçon', 'garcon', 'masculin', 'homme', 'h'].indexOf(s) >= 0) return 'G';
    return null;
  }

  function fgt() { return { F: 0, G: 0, T: 0 }; }
  function ajouter(c, genre) { c.T += 1; if (genre === 'F') c.F += 1; else if (genre === 'G') c.G += 1; }
  function cumuler(a, b) { a.F += b.F; a.G += b.G; a.T += b.T; }

  function fusionnerParametres(p) {
    p = p || {};
    var s = p.seuils || {};
    return {
      seuils: {
        eleve_strictement_superieur_a: nombre(s.eleve_strictement_superieur_a) != null ? nombre(s.eleve_strictement_superieur_a) : SEUILS_REFERENCE.eleve_strictement_superieur_a,
        modere_a_partir_de: nombre(s.modere_a_partir_de) != null ? nombre(s.modere_a_partir_de) : SEUILS_REFERENCE.modere_a_partir_de
      },
      formule_total: p.formule_total || PARAMETRES_DEFAUT.formule_total,
      criteres_dimensions: Object.assign({}, PARAMETRES_DEFAUT.criteres_dimensions, p.criteres_dimensions || {}),
      registre_inclure_absents: !!p.registre_inclure_absents
    };
  }

  function validerSeuils(seuils) {
    var e = nombre(seuils.eleve_strictement_superieur_a), m = nombre(seuils.modere_a_partir_de);
    var erreurs = [];
    if (e == null) erreurs.push('Le seuil du risque élevé est obligatoire.');
    if (m == null) erreurs.push('Le seuil du risque modéré est obligatoire.');
    if (e != null && m != null && m > e) erreurs.push('Le seuil du risque modéré doit être inférieur ou égal au seuil du risque élevé.');
    return erreurs;
  }

  /** Classement d'un score selon les seuils paramétrés. */
  function classerScore(total, seuils) {
    if (total == null) return null;
    if (total > seuils.eleve_strictement_superieur_a) return 'ELEVE';
    if (total >= seuils.modere_a_partir_de) return 'MODERE';
    return 'AUCUN';
  }

  function normaliserRisque(v) {
    if (estVide(v)) return null;
    var s = String(v).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (s.indexOf('eleve') === 0 || s === 'haut' || s === 'fort') return 'ELEVE';
    if (s.indexOf('modere') === 0 || s === 'moyen') return 'MODERE';
    if (s.indexOf('aucun') === 0 || s.indexOf('faible') === 0 || s.indexOf('pas') === 0 || s === 'nul') return 'AUCUN';
    return null;
  }

  function calculerAge(dateNaissance, dateReference) {
    if (estVide(dateNaissance)) return null;
    var n = new Date(dateNaissance), r = new Date(dateReference);
    if (isNaN(n.getTime()) || isNaN(r.getTime())) return null;
    var age = r.getFullYear() - n.getFullYear();
    var m = r.getMonth() - n.getMonth();
    if (m < 0 || (m === 0 && r.getDate() < n.getDate())) age -= 1;
    return age >= 0 && age < 100 ? age : null;
  }

  // ------------------------------------------------------- préparation des données
  /**
   * Transforme le jeu de données brut fourni par ORIENT 360 en une liste
   * d'élèves enrichis. Ne modifie pas l'objet reçu.
   *
   * jeu = {
   *   etablissement: { id, nom, ... }, annee_scolaire: '2026-2027',
   *   classes:   [{ id, nom, ordre, concernee_lycam, motif_choix }],
   *   eleves:    [{ id, matricule, nom, prenoms, genre, date_naissance, age,
   *                 classe_id, redoublant, present_test, moyenne_t1 }],
   *   resultats: [{ eleve_id, depouille, scores:{AF..IE}, total,
   *                 nb_dimensions_suivre, niveau_risque, valide, date_test }]
   * }
   */
  function preparer(jeu, parametres) {
    var p = fusionnerParametres(parametres);
    jeu = jeu || {};
    var classes = (jeu.classes || []).filter(function (c) { return c.concernee_lycam !== false; })
      .map(function (c, i) { return { id: c.id, nom: c.nom, ordre: c.ordre != null ? c.ordre : i, motif_choix: estVide(c.motif_choix) ? null : String(c.motif_choix).trim() }; })
      .sort(function (a, b) { return (a.ordre - b.ordre) || String(a.nom).localeCompare(String(b.nom), 'fr', { numeric: true }); });
    var classeParId = {};
    classes.forEach(function (c) { classeParId[c.id] = c; });

    var resultatParEleve = {};
    var resultatsOrphelins = [];
    (jeu.resultats || []).forEach(function (r) {
      if (resultatParEleve[r.eleve_id]) resultatsOrphelins.push({ type: 'doublon', r: r });
      else resultatParEleve[r.eleve_id] = r;
    });

    var dateRef = jeu.date_reference || new Date().toISOString().slice(0, 10);
    var eleves = (jeu.eleves || []).map(function (e) {
      var r = resultatParEleve[e.id] || null;
      var present = booleen(e.present_test);
      // Dépouillé : indicateur explicite du module LYCAM ; s'il est absent, un
      // résultat qui porte des scores ou un total est considéré comme dépouillé.
      var depouille = false;
      if (r) {
        var d0 = booleen(r.depouille);
        if (d0 !== null) depouille = d0;
        else depouille = nombre(r.total) != null || (r.scores && DIMENSIONS.some(function (d) { return nombre(r.scores[d]) != null; }));
      }
      var scores = {};
      DIMENSIONS.forEach(function (d) { scores[d] = r && r.scores ? nombre(r.scores[d]) : null; });
      var scoresComplets = DIMENSIONS.every(function (d) { return scores[d] != null; });
      var somme = scoresComplets ? DIMENSIONS.reduce(function (s, d) { return s + scores[d]; }, 0) : null;
      var totalStocke = r ? nombre(r.total) : null;
      var total = null, origineTotal = null;
      if (present === true && depouille) {
        if (p.formule_total === 'stocke') { total = totalStocke; origineTotal = 'ORIENT 360'; }
        else if (totalStocke != null) { total = totalStocke; origineTotal = 'ORIENT 360'; }
        else if (somme != null) { total = somme; origineTotal = 'calculé'; }
      }

      // Nombre de dimensions à suivre
      var nbSuivre = null;
      var criteresConfigures = DIMENSIONS.every(function (d) { return nombre(p.criteres_dimensions[d]) != null; });
      if (present === true && depouille) {
        if (criteresConfigures && scoresComplets) {
          nbSuivre = DIMENSIONS.filter(function (d) { return scores[d] >= nombre(p.criteres_dimensions[d]); }).length;
        } else if (r && nombre(r.nb_dimensions_suivre) != null) {
          nbSuivre = nombre(r.nb_dimensions_suivre);
        }
      }

      // Niveau de risque : un résultat déjà validé conserve sa classification
      // historique ; sinon on applique les seuils paramétrés.
      var risque = null, origineRisque = null;
      var risqueStocke = r ? normaliserRisque(r.niveau_risque) : null;
      if (present === true && depouille) {
        if (r && booleen(r.valide) === true && risqueStocke) { risque = risqueStocke; origineRisque = 'validé'; }
        else if (total != null) { risque = classerScore(total, p.seuils); origineRisque = 'seuils'; }
      }

      var age = nombre(e.age);
      if (age == null) age = calculerAge(e.date_naissance, (r && r.date_test) || dateRef);

      return {
        id: e.id,
        matricule: estVide(e.matricule) ? null : String(e.matricule).trim(),
        nom: estVide(e.nom) ? null : String(e.nom).trim(),
        prenoms: estVide(e.prenoms) ? null : String(e.prenoms).trim(),
        genre: normaliserGenre(e.genre),
        genre_brut: e.genre,
        age: age,
        classe_id: e.classe_id,
        classe: classeParId[e.classe_id] || null,
        redoublant: booleen(e.redoublant),
        present: present,
        resultat: r,
        depouille: present === true && depouille,
        scores: scores,
        scores_complets: scoresComplets,
        somme_dimensions: somme,
        total: total,
        total_stocke: totalStocke,
        origine_total: origineTotal,
        nb_dimensions_suivre: nbSuivre,
        criteres_configures: criteresConfigures,
        risque: risque,
        risque_stocke: risqueStocke,
        origine_risque: origineRisque,
        moyenne_t1: nombre(e.moyenne_t1)
      };
    });

    return { parametres: p, classes: classes, classeParId: classeParId, eleves: eleves, resultatsOrphelins: resultatsOrphelins, jeu: jeu };
  }

  function filtrerClasses(prep, classeIds) {
    if (!classeIds || !classeIds.length) return prep.classes;
    return prep.classes.filter(function (c) { return classeIds.indexOf(c.id) >= 0; });
  }

  function elevesDeClasse(prep, classeId) {
    return prep.eleves.filter(function (e) { return e.classe_id === classeId; });
  }

  // ----------------------------------------------------------------- Tableau 1
  function tableau1(prep, filtre) {
    var classes = filtrerClasses(prep, filtre && filtre.classes);
    var total = { inscrits: fgt(), redoublants: fgt(), presents: fgt() };
    var lignes = classes.map(function (c) {
      var l = { classe: c.nom, classe_id: c.id, inscrits: fgt(), redoublants: fgt(), presents: fgt(), motifs: c.motif_choix };
      elevesDeClasse(prep, c.id).forEach(function (e) {
        ajouter(l.inscrits, e.genre);
        if (e.redoublant === true) ajouter(l.redoublants, e.genre);
        if (e.present === true) ajouter(l.presents, e.genre);
      });
      cumuler(total.inscrits, l.inscrits); cumuler(total.redoublants, l.redoublants); cumuler(total.presents, l.presents);
      return l;
    });
    return { titre: 'Tableau 1 : Motifs des choix des classes', lignes: lignes, total: total, nb_classes: lignes.length };
  }

  // ----------------------------------------------------------------- Tableau 2
  function tableau2(prep, filtre) {
    var classes = filtrerClasses(prep, filtre && filtre.classes);
    var cles = ['inscrits', 'redoublants', 'eleve', 'modere', 'aucun', 'presents'];
    var total = {}; cles.forEach(function (k) { total[k] = fgt(); });
    var lignes = classes.map(function (c) {
      var l = { classe: c.nom, classe_id: c.id };
      cles.forEach(function (k) { l[k] = fgt(); });
      elevesDeClasse(prep, c.id).forEach(function (e) {
        ajouter(l.inscrits, e.genre);
        if (e.redoublant === true) ajouter(l.redoublants, e.genre);
        if (e.present === true) ajouter(l.presents, e.genre);
        // Les absents et les tests non dépouillés ne sont jamais classés.
        if (e.depouille && e.risque === 'ELEVE') ajouter(l.eleve, e.genre);
        else if (e.depouille && e.risque === 'MODERE') ajouter(l.modere, e.genre);
        else if (e.depouille && e.risque === 'AUCUN') ajouter(l.aucun, e.genre);
      });
      cles.forEach(function (k) { cumuler(total[k], l[k]); });
      return l;
    });
    return { titre: 'Tableau 2 : Effectifs par genre', lignes: lignes, total: total, nb_classes: lignes.length };
  }

  // ----------------------------------------------------------------- Tableau 3
  function tableau3(prep, filtre) {
    var classes = filtrerClasses(prep, filtre && filtre.classes);
    var s = prep.parametres.seuils;
    var total = { effectif_total: 0, effectif_present: 0, eleve: 0, modere: 0, aucun: 0, non_classes: 0 };
    var lignes = classes.map(function (c) {
      var l = { classe: c.nom, classe_id: c.id, effectif_total: 0, effectif_present: 0, eleve: 0, modere: 0, aucun: 0, non_classes: 0 };
      elevesDeClasse(prep, c.id).forEach(function (e) {
        l.effectif_total += 1;
        if (e.present === true) {
          l.effectif_present += 1;
          if (e.depouille && e.risque === 'ELEVE') l.eleve += 1;
          else if (e.depouille && e.risque === 'MODERE') l.modere += 1;
          else if (e.depouille && e.risque === 'AUCUN') l.aucun += 1;
          else l.non_classes += 1;
        }
      });
      Object.keys(total).forEach(function (k) { total[k] += l[k]; });
      return l;
    });
    return {
      titre: 'Tableau 3 : Résultats par risque de décrochage',
      entetes: {
        eleve: 'Élèves présentant un risque élevé (+ de ' + s.eleve_strictement_superieur_a + ')',
        modere: 'Élèves présentant un risque modéré (entre ' + s.modere_a_partir_de + ' et ' + s.eleve_strictement_superieur_a + ')',
        aucun: 'Élèves ne présentant pas de risque élevé (- de ' + s.modere_a_partir_de + ')'
      },
      lignes: lignes, total: total, nb_classes: lignes.length
    };
  }

  // ----------------------------------------------------------------- Tableau 4
  var COLONNES_REGISTRE = ['N°', 'Matricule', 'Nom', 'Prénoms', 'Genre', 'Âge', 'Classe', 'Red', 'AF', 'PS', 'RS', 'CS', 'AB', 'BS', 'IE', 'Total', 'Nombre de dimensions à suivre (+)', 'Risque de décrochage', 'Moyenne du 1er trimestre'];

  function libelleRisque(e) {
    if (e.present === false) return 'Absent';
    if (e.present !== true) return '';
    if (!e.depouille) return 'Non dépouillé';
    return e.risque ? RISQUES[e.risque].libelle : '';
  }

  function tableau4(prep, filtre) {
    filtre = filtre || {};
    var classes = filtrerClasses(prep, filtre.classes);
    var ordreClasse = {}; classes.forEach(function (c, i) { ordreClasse[c.id] = i; });
    var inclureAbsents = filtre.inclure_absents != null ? filtre.inclure_absents : prep.parametres.registre_inclure_absents;
    var rech = estVide(filtre.matricule) ? null : String(filtre.matricule).trim().toLowerCase();
    var eleves = prep.eleves.filter(function (e) {
      if (!(e.classe_id in ordreClasse)) return false;
      if (!inclureAbsents && e.present !== true) return false;
      if (filtre.genre && e.genre !== filtre.genre) return false;
      if (filtre.risque) {
        if (filtre.risque === 'NON_CLASSE') { if (e.risque) return false; }
        else if (e.risque !== filtre.risque) return false;
      }
      if (rech && !(e.matricule && e.matricule.toLowerCase().indexOf(rech) >= 0)) return false;
      return true;
    }).sort(function (a, b) {
      return (ordreClasse[a.classe_id] - ordreClasse[b.classe_id]) ||
        String(a.nom || '').localeCompare(String(b.nom || ''), 'fr') ||
        String(a.prenoms || '').localeCompare(String(b.prenoms || ''), 'fr');
    });
    var lignes = eleves.map(function (e, i) {
      var l = {
        eleve_id: e.id, n: i + 1, matricule: e.matricule, nom: e.nom, prenoms: e.prenoms,
        genre: e.genre, age: e.age, classe: e.classe ? e.classe.nom : null,
        red: e.redoublant === true ? 'R' : (e.redoublant === false ? '' : null),
        total: e.total, nb_dimensions_suivre: e.nb_dimensions_suivre,
        risque: libelleRisque(e), risque_code: e.risque, moyenne_t1: e.moyenne_t1,
        present: e.present, depouille: e.depouille
      };
      DIMENSIONS.forEach(function (d) { l[d] = e.depouille ? e.scores[d] : null; });
      return l;
    });
    return { titre: 'REGISTRE INDIVIDUEL DE DÉPOUILLEMENT ET DE SUIVI LYCAM', colonnes: COLONNES_REGISTRE, lignes: lignes, nb_classes: classes.length, nb_eleves: lignes.length };
  }

  // ------------------------------------------------------------ contrôles qualité
  /**
   * Vérification automatique des données manquantes et des incohérences.
   * niveau : 'bloquant' (empêche la validation définitive), 'avertissement', 'info'.
   */
  function verifier(prep) {
    var anomalies = [];
    function a(niveau, code, message, ref) { anomalies.push({ niveau: niveau, code: code, message: message, ref: ref || null }); }
    function nomE(e) { return [e.nom, e.prenoms].filter(Boolean).join(' ') || ('élève ' + e.id) ; }
    var s = prep.parametres.seuils;

    if (!prep.classes.length) a('bloquant', 'AUCUNE_CLASSE', 'Aucune classe concernée par le test LYCAM pour cette sélection.');
    validerSeuils(s).forEach(function (m) { a('bloquant', 'SEUILS', m); });

    var matricules = {};
    prep.eleves.forEach(function (e) {
      var qui = nomE(e) + (e.matricule ? ' (' + e.matricule + ')' : '');
      var ref = { eleve_id: e.id, classe_id: e.classe_id };
      if (!e.classe) { a('bloquant', 'CLASSE_INCONNUE', qui + ' : classe absente ou non concernée par LYCAM.', ref); return; }
      if (!e.matricule) a('avertissement', 'MATRICULE_MANQUANT', qui + ' : matricule manquant.', ref);
      else if (matricules[e.matricule]) a('bloquant', 'MATRICULE_DOUBLON', 'Matricule ' + e.matricule + ' attribué à plusieurs élèves.', ref);
      else matricules[e.matricule] = true;
      if (!e.nom || !e.prenoms) a('avertissement', 'IDENTITE_INCOMPLETE', qui + ' : nom ou prénoms manquants.', ref);
      if (!e.genre) a('avertissement', 'GENRE_MANQUANT', qui + ' : genre non renseigné' + (estVide(e.genre_brut) ? '' : ' (valeur « ' + e.genre_brut + ' » non reconnue)') + ' — compté dans T uniquement.', ref);
      if (e.redoublant == null) a('avertissement', 'REDOUBLEMENT_MANQUANT', qui + ' : statut redoublant non renseigné.', ref);
      if (e.present == null) a('avertissement', 'PRESENCE_MANQUANTE', qui + ' : présence au test non renseignée (élève non compté parmi les présents).', ref);
      if (e.present === false && e.resultat && (e.resultat.total != null || (e.resultat.scores && Object.keys(e.resultat.scores).length))) a('bloquant', 'RESULTAT_ABSENT', qui + ' : marqué absent mais possède des résultats LYCAM.', ref);
      if (e.present === true) {
        if (!e.depouille) a('avertissement', 'NON_DEPOUILLE', qui + ' : présent mais test non dépouillé (non classé).', ref);
        else {
          var manquants = DIMENSIONS.filter(function (d) { return e.scores[d] == null; });
          if (manquants.length) a('avertissement', 'DIMENSION_MANQUANTE', qui + ' : score(s) manquant(s) ' + manquants.join(', ') + '.', ref);
          if (e.total == null) a('avertissement', 'TOTAL_MANQUANT', qui + ' : total impossible à établir (non classé).', ref);
          if (e.total_stocke != null && e.somme_dimensions != null && prep.parametres.formule_total === 'somme' && Math.abs(e.total_stocke - e.somme_dimensions) > 1e-9)
            a('bloquant', 'TOTAL_INCOHERENT', qui + ' : total enregistré (' + e.total_stocke + ') différent de la somme des dimensions (' + e.somme_dimensions + ').', ref);
          if (e.origine_risque === 'validé' && e.total != null && classerScore(e.total, s) !== e.risque)
            a('info', 'RISQUE_HISTORIQUE', qui + ' : classification validée (' + RISQUES[e.risque].libelle + ') conservée, différente des seuils actuels.', ref);
          if (e.nb_dimensions_suivre == null) a('info', 'DIMENSIONS_SUIVRE_MANQUANT', qui + ' : nombre de dimensions à suivre non disponible.', ref);
        }
        if (e.moyenne_t1 == null) a('info', 'MOYENNE_MANQUANTE', qui + ' : moyenne du 1er trimestre non disponible.', ref);
        else if (e.moyenne_t1 < 0 || e.moyenne_t1 > 20) a('avertissement', 'MOYENNE_HORS_BORNES', qui + ' : moyenne du 1er trimestre hors de l\'intervalle 0–20 (' + e.moyenne_t1 + ').', ref);
      }
      if (e.age != null && (e.age < 8 || e.age > 30)) a('avertissement', 'AGE_IMPROBABLE', qui + ' : âge improbable (' + e.age + ' ans).', ref);
    });
    prep.resultatsOrphelins.forEach(function (o) { a('bloquant', 'RESULTAT_DOUBLON', 'Plusieurs résultats LYCAM pour l\'élève ' + o.r.eleve_id + '.', { eleve_id: o.r.eleve_id }); });
    var ids = {}; prep.eleves.forEach(function (e) { ids[e.id] = true; });
    (prep.jeu.resultats || []).forEach(function (r) { if (!ids[r.eleve_id]) a('bloquant', 'RESULTAT_SANS_ELEVE', 'Résultat LYCAM rattaché à un élève inconnu (' + r.eleve_id + ').', { eleve_id: r.eleve_id }); });

    // Cohérence inscrits / présents / dépouillés, par classe
    var t2 = tableau2(prep), t3 = tableau3(prep);
    t3.lignes.forEach(function (l, i) {
      var l2 = t2.lignes[i];
      var classes = l2.eleve.T + l2.modere.T + l2.aucun.T;
      if (l.effectif_present > l.effectif_total) a('bloquant', 'PRESENTS_SUP_INSCRITS', l.classe + ' : plus de présents que d\'inscrits.', { classe_id: l.classe_id });
      if (classes + l.non_classes !== l.effectif_present) a('bloquant', 'REPARTITION_INCOHERENTE', l.classe + ' : la répartition par risque ne correspond pas aux présents.', { classe_id: l.classe_id });
      if (l.non_classes > 0) a('avertissement', 'CLASSE_INCOMPLETE', l.classe + ' : ' + l.non_classes + ' présent(s) non classé(s) (dépouillement incomplet).', { classe_id: l.classe_id });
      if (l.effectif_total === 0) a('avertissement', 'CLASSE_VIDE', l.classe + ' : aucun élève inscrit.', { classe_id: l.classe_id });
    });
    prep.classes.forEach(function (c) { if (!c.motif_choix) a('info', 'MOTIF_MANQUANT', c.nom + ' : motif du choix de la classe non renseigné.', { classe_id: c.id }); });

    var bilan = { bloquant: 0, avertissement: 0, info: 0 };
    anomalies.forEach(function (x) { bilan[x.niveau] += 1; });
    return { anomalies: anomalies, bilan: bilan, validable: bilan.bloquant === 0 };
  }

  /** Vérification des totaux avant exportation : la ligne TOTAL doit être la somme exacte des lignes. */
  function verifierTotaux(t) {
    var erreurs = [];
    function cmp(chemin, attendu, obtenu) { if (attendu !== obtenu) erreurs.push(t.titre + ' — total ' + chemin + ' : ' + obtenu + ' au lieu de ' + attendu); }
    if (!t.total) return erreurs;
    Object.keys(t.total).forEach(function (k) {
      var v = t.total[k];
      if (typeof v === 'number') cmp(k, t.lignes.reduce(function (s, l) { return s + l[k]; }, 0), v);
      else if (v && typeof v === 'object') ['F', 'G', 'T'].forEach(function (g) {
        cmp(k + '.' + g, t.lignes.reduce(function (s, l) { return s + l[k][g]; }, 0), v[g]);
        if (g === 'T' && v.T < v.F + v.G) erreurs.push(t.titre + ' — ' + k + ' : T inférieur à F + G');
      });
    });
    return erreurs;
  }

  // ------------------------------------------------------ empreinte et validation
  /** Empreinte stable des données sources : détecte toute modification après validation. */
  function empreinte(prep) {
    var src = JSON.stringify({
      p: prep.parametres,
      c: prep.classes.map(function (c) { return [c.id, c.nom, c.motif_choix]; }),
      e: prep.eleves.map(function (e) {
        return [e.id, e.matricule, e.nom, e.prenoms, e.genre, e.age, e.classe_id, e.redoublant, e.present, e.depouille,
          DIMENSIONS.map(function (d) { return e.scores[d]; }), e.total, e.nb_dimensions_suivre, e.risque, e.moyenne_t1];
      })
    });
    // FNV-1a 32 bits ×2 (suffisant pour détecter un changement, pas un usage cryptographique)
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < src.length; i++) {
      var c = src.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= c; h2 = Math.imul(h2 ^ (h2 >>> 15), 0x85ebca6b) >>> 0;
    }
    return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
  }

  /**
   * Statut du rapport : 'brouillon', 'valide' (validation à jour) ou
   * 'a_revalider' (les données ont changé depuis la validation).
   */
  function statutValidation(prep, validation) {
    if (!validation || !validation.empreinte) return 'brouillon';
    return validation.empreinte === empreinte(prep) ? 'valide' : 'a_revalider';
  }

  // ------------------------------------------------------------- droits d'accès
  var DROITS_PAR_ROLE = {
    administrateur: ['consulter', 'generer', 'valider', 'telecharger', 'registre_nominatif', 'parametrer_seuils', 'gerer_droits'],
    inspecteur: ['consulter', 'generer', 'valider', 'telecharger', 'registre_nominatif']
  };
  /** utilisateur = { role: 'administrateur'|'inspecteur'|autre, autorisations: [...] } */
  function peut(utilisateur, action) {
    if (!utilisateur) return false;
    var droits = DROITS_PAR_ROLE[utilisateur.role] || [];
    return droits.indexOf(action) >= 0 || (utilisateur.autorisations || []).indexOf(action) >= 0;
  }

  /** Génère les quatre tableaux et les contrôles en une seule passe. */
  function genererRapport(jeu, parametres, filtre) {
    var prep = preparer(jeu, parametres);
    var t = [tableau1(prep, filtre), tableau2(prep, filtre), tableau3(prep, filtre), tableau4(prep, filtre)];
    var erreursTotaux = [];
    t.slice(0, 3).forEach(function (x) { erreursTotaux = erreursTotaux.concat(verifierTotaux(x)); });
    return {
      prep: prep,
      tableaux: t,
      controles: verifier(prep),
      erreurs_totaux: erreursTotaux,
      empreinte: empreinte(prep),
      date_generation: new Date().toISOString()
    };
  }

  return {
    DIMENSIONS: DIMENSIONS, RISQUES: RISQUES, SEUILS_REFERENCE: SEUILS_REFERENCE, PARAMETRES_DEFAUT: PARAMETRES_DEFAUT,
    COLONNES_REGISTRE: COLONNES_REGISTRE, DROITS_PAR_ROLE: DROITS_PAR_ROLE,
    fusionnerParametres: fusionnerParametres, validerSeuils: validerSeuils, classerScore: classerScore, calculerAge: calculerAge,
    preparer: preparer, tableau1: tableau1, tableau2: tableau2, tableau3: tableau3, tableau4: tableau4,
    verifier: verifier, verifierTotaux: verifierTotaux, empreinte: empreinte, statutValidation: statutValidation,
    peut: peut, genererRapport: genererRapport
  };
});
