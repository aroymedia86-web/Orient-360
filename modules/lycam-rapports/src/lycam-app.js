/*
 * ORIENT 360 — Espace « LYCAM → Rapports statistiques » (interface).
 *
 * Montage :
 *   LycamRapports.monter(document.getElementById('lycam-rapports'), {
 *     source: new LycamSource.RestSource({ base: '/api/lycam-rapports' })
 *   });
 */
(function (root) {
  'use strict';
  var L = root.LycamCore, X = root.LycamExports;

  var ONGLETS = [
    { id: 't1', index: 0, libelle: 'Tableau 1 – Motifs des choix des classes', court: 'Motifs des choix' },
    { id: 't2', index: 1, libelle: 'Tableau 2 – Effectifs par genre', court: 'Effectifs par genre' },
    { id: 't3', index: 2, libelle: 'Tableau 3 – Résultats par risque de décrochage', court: 'Risque de décrochage' },
    { id: 't4', index: 3, libelle: 'Tableau 4 – Registre individuel des résultats', court: 'Registre individuel' },
    { id: 'controles', libelle: 'Contrôles des données', court: 'Contrôles' },
    { id: 'parametres', libelle: 'Paramètres', court: 'Paramètres', droit: 'parametrer_seuils' }
  ];

  function h(tag, attrs, enfants) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var val = attrs[k];
      if (val === null || val === undefined || val === false) return;
      if (k === 'class') el.className = val;
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), val);
      else if (k === 'html') el.innerHTML = val;
      else el.setAttribute(k, val === true ? '' : val);
    });
    [].concat(enfants || []).forEach(function (c) { if (c === null || c === undefined || c === false) return; el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); });
    return el;
  }
  function vide(x) { return x === null || x === undefined || x === ''; }
  function cell(x, cls) { return h('td', { class: (cls || '') + (vide(x) ? ' manquant' : '') }, vide(x) ? '' : String(typeof x === 'number' ? (Math.round(x * 100) / 100).toString().replace('.', ',') : x)); }
  function dateFr(iso) { var d = new Date(iso); return d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
  function slug(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, ''); }

  function monter(racine, options) {
    var source = options.source;
    var etat = {
      contexte: null, utilisateur: null, etablissement: null, annee: null, classe: '',
      jeu: null, parametres: null, validation: null, rapport: null, statut: 'brouillon',
      onglet: 't1', filtreRegistre: { genre: '', risque: '', matricule: '', inclure_absents: false },
      chargement: false, erreur: null, message: null
    };

    function peut(a) { return L.peut(etat.utilisateur, a); }
    function filtre() { return { classes: etat.classe ? [etat.classe] : null }; }

    // ------------------------------------------------------------ chargement
    function chargerContexte() {
      etat.chargement = true; rendre();
      return source.contexte().then(function (c) {
        etat.contexte = c; etat.utilisateur = c.utilisateur;
        etat.etablissement = (c.etablissements[0] || {}).id;
        etat.annee = c.annees[0];
        if (!peut('consulter')) { etat.erreur = 'Vous n\'êtes pas autorisé à consulter les rapports statistiques LYCAM.'; etat.chargement = false; rendre(); return; }
        return generer();
      }).catch(echec);
    }

    function generer(motif) {
      if (!etat.etablissement || !etat.annee) return Promise.resolve();
      etat.chargement = true; etat.erreur = null; rendre();
      var f = { etablissement: etat.etablissement, annee: etat.annee };
      return Promise.all([source.donnees(f), source.parametres({ annee: etat.annee }), source.validation(f)]).then(function (r) {
        etat.jeu = r[0]; etat.parametres = L.fusionnerParametres(r[1]); etat.validation = r[2];
        if (etat.classe && !(etat.jeu.classes || []).some(function (c) { return c.id === etat.classe; })) etat.classe = '';
        etat.rapport = L.genererRapport(etat.jeu, etat.parametres, Object.assign(filtre(), etat.filtreRegistre));
        // La validation porte sur l'ensemble des données de l'établissement pour l'année.
        etat.statut = L.statutValidation(etat.rapport.prep, etat.validation);
        etat.chargement = false;
        if (motif) etat.message = motif;
        if (source.journaliser && peut('generer')) source.journaliser({ etablissement: etat.etablissement, annee: etat.annee, action: 'generation', empreinte: etat.rapport.empreinte });
        rendre();
      }).catch(echec);
    }

    function recalculer() {
      if (!etat.jeu) return;
      var date = etat.rapport && etat.rapport.date_generation;
      etat.rapport = L.genererRapport(etat.jeu, etat.parametres, Object.assign(filtre(), etat.filtreRegistre));
      if (date) etat.rapport.date_generation = date;
      rendre();
    }

    function echec(e) { etat.chargement = false; etat.erreur = (e && e.message) || String(e); rendre(); }

    // ---------------------------------------------------------- téléchargement
    function contexteExport() {
      return { etablissement: etat.jeu.etablissement, annee_scolaire: etat.jeu.annee_scolaire || etat.annee, statut: etat.statut, validation: etat.validation };
    }
    function avantExport(indices) {
      if (!peut('telecharger')) { alert('Vous n\'êtes pas autorisé à télécharger les rapports.'); return false; }
      if (indices.indexOf(3) >= 0 && !peut('registre_nominatif')) { alert('Le registre individuel contient des données nominatives : accès réservé aux profils habilités.'); return false; }
      var erreurs = [];
      indices.forEach(function (i) { if (i < 3) erreurs = erreurs.concat(L.verifierTotaux(etat.rapport.tableaux[i])); });
      if (erreurs.length) { alert('Exportation bloquée : les totaux ne sont pas cohérents.\n\n' + erreurs.join('\n')); return false; }
      if (etat.statut !== 'valide' && !confirm('Les données n\'ont pas été validées' + (etat.statut === 'a_revalider' ? ' depuis leur dernière modification' : '') + '.\nLe document sera marqué « PROVISOIRE ». Continuer ?')) return false;
      return true;
    }
    function nomFichier(base, ext) { return 'LYCAM_' + base + '_' + slug(etat.jeu.etablissement && etat.jeu.etablissement.nom) + '_' + slug(etat.annee) + (etat.statut === 'valide' ? '' : '_PROVISOIRE') + '.' + ext; }
    function telecharger(indices, format, base) {
      if (!avantExport(indices)) return;
      // L'export reprend exactement ce qui est affiché (filtres établissement, année, classe et filtres du registre).
      var r = etat.rapport;
      try {
        if (format === 'pdf') X.pdf(r, indices, contexteExport(), nomFichier(base, 'pdf'));
        else X.excel(r, indices, contexteExport(), nomFichier(base, 'xlsx'));
        if (source.journaliser) source.journaliser({ etablissement: etat.etablissement, annee: etat.annee, action: 'telechargement_' + format, tableau: indices.join(','), empreinte: r.empreinte });
      } catch (e) { alert('Erreur pendant l\'exportation : ' + e.message); }
    }

    // ------------------------------------------------------------- validation
    function valider() {
      if (!peut('valider')) return;
      var c = L.verifier(L.preparer(etat.jeu, etat.parametres));
      if (!c.validable) { etat.onglet = 'controles'; rendre(); alert('Validation impossible : ' + c.bilan.bloquant + ' anomalie(s) bloquante(s) à corriger dans ORIENT 360.'); return; }
      var obs = prompt('Validation des données LYCAM par l\'Inspecteur d\'Orientation.\n' +
        (c.bilan.avertissement ? c.bilan.avertissement + ' avertissement(s) restent signalés.\n' : '') +
        'Observations (facultatif) :', '');
      if (obs === null) return;
      source.valider({ etablissement: etat.etablissement, annee: etat.annee, empreinte: L.empreinte(L.preparer(etat.jeu, etat.parametres)), observations: obs })
        .then(function () { return generer('Données validées. Les rapports peuvent être générés en version définitive.'); }).catch(echec);
    }

    // ------------------------------------------------------------------ rendu
    function rendre() {
      racine.innerHTML = '';
      racine.classList.add('lycam');
      if (source.demonstration) racine.appendChild(h('div', { class: 'bandeau-demo' }, 'MODE DÉMONSTRATION — données fictives générées pour prévisualiser l\'interface. En production, le module lit exclusivement la base ORIENT 360.'));
      racine.appendChild(h('div', { class: 'fil' }, ['LYCAM', h('span', {}, ' → '), 'RAPPORTS STATISTIQUES']));
      racine.appendChild(h('h1', {}, 'Rapports et tableaux statistiques LYCAM'));
      if (etat.erreur) racine.appendChild(h('div', { class: 'alerte erreur' }, etat.erreur));
      if (!etat.contexte) { racine.appendChild(h('p', { class: 'chargement' }, 'Chargement…')); return; }
      if (!peut('consulter')) return;
      racine.appendChild(barreFiltres());
      if (!etat.rapport) { racine.appendChild(h('p', { class: 'chargement' }, etat.chargement ? 'Chargement des données ORIENT 360…' : 'Sélectionnez un établissement et une année scolaire.')); return; }
      racine.appendChild(barreValidation());
      if (etat.message) { racine.appendChild(h('div', { class: 'alerte ok' }, etat.message)); etat.message = null; }
      racine.appendChild(onglets());
      var o = ONGLETS.filter(function (x) { return x.id === etat.onglet; })[0];
      if (o.index !== undefined) racine.appendChild(panneauTableau(o));
      else if (o.id === 'controles') racine.appendChild(panneauControles());
      else racine.appendChild(panneauParametres());
    }

    function select(libelle, valeur, options, onchange) {
      return h('label', { class: 'champ' }, [h('span', {}, libelle), h('select', { onchange: function (e) { onchange(e.target.value); } },
        options.map(function (o) { return h('option', { value: o.v, selected: String(o.v) === String(valeur) }, o.l); }))]);
    }

    function barreFiltres() {
      var c = etat.contexte;
      var classes = (etat.jeu && etat.jeu.classes || []).filter(function (x) { return x.concernee_lycam !== false; });
      return h('div', { class: 'filtres' }, [
        select('Établissement', etat.etablissement, c.etablissements.map(function (e) { return { v: e.id, l: e.nom }; }), function (v) { etat.etablissement = v; etat.classe = ''; generer(); }),
        select('Année scolaire', etat.annee, c.annees.map(function (a) { return { v: a, l: a }; }), function (v) { etat.annee = v; etat.classe = ''; generer(); }),
        select('Classe', etat.classe, [{ v: '', l: 'Toutes les classes' }].concat(classes.map(function (x) { return { v: x.id, l: x.nom }; })), function (v) { etat.classe = v; recalculer(); }),
        h('div', { class: 'espace' }),
        peut('telecharger') ? h('div', { class: 'complet' }, [
          h('button', { class: 'btn principal', disabled: !etat.rapport || etat.chargement, onclick: function () { telecharger(peut('registre_nominatif') ? [0, 1, 2, 3] : [0, 1, 2], 'pdf', 'Rapport_complet'); } }, 'TÉLÉCHARGER LE RAPPORT LYCAM COMPLET'),
          h('button', { class: 'btn lien', disabled: !etat.rapport, onclick: function () { telecharger(peut('registre_nominatif') ? [0, 1, 2, 3] : [0, 1, 2], 'xlsx', 'Rapport_complet'); } }, 'Version Excel (4 feuilles)')
        ]) : null
      ]);
    }

    function barreValidation() {
      var c = etat.rapport.controles;
      var libelles = { brouillon: 'Non validé', valide: 'Validé', a_revalider: 'À revalider (données modifiées)' };
      var v = etat.validation;
      return h('div', { class: 'validation ' + etat.statut }, [
        h('span', { class: 'pastille ' + etat.statut }, libelles[etat.statut]),
        h('span', { class: 'detail' }, etat.statut === 'valide' && v ? 'par ' + (v.valide_par || '—') + ' le ' + dateFr(v.valide_le) : 'Les exports seront marqués « PROVISOIRE » jusqu\'à la validation par l\'Inspecteur d\'Orientation.'),
        h('a', { class: 'bilan', href: '#', onclick: function (e) { e.preventDefault(); etat.onglet = 'controles'; rendre(); } }, [
          h('b', { class: c.bilan.bloquant ? 'rouge' : 'vert' }, c.bilan.bloquant + ' bloquante(s)'), ' · ', c.bilan.avertissement + ' avertissement(s) · ', c.bilan.info + ' information(s)']),
        peut('valider') && etat.statut !== 'valide' ? h('button', { class: 'btn valider', disabled: !c.validable, title: c.validable ? '' : 'Corrigez d\'abord les anomalies bloquantes', onclick: valider }, 'Valider les données') : null
      ]);
    }

    function onglets() {
      return h('nav', { class: 'onglets' }, ONGLETS.filter(function (o) { return !o.droit || peut(o.droit); }).map(function (o) {
        var badge = o.id === 'controles' && etat.rapport.controles.bilan.bloquant ? h('span', { class: 'badge' }, etat.rapport.controles.bilan.bloquant) : null;
        return h('button', { class: 'onglet' + (etat.onglet === o.id ? ' actif' : ''), onclick: function () { etat.onglet = o.id; rendre(); } }, [o.index !== undefined ? h('small', {}, 'Tableau ' + (o.index + 1)) : null, o.court, badge]);
      }));
    }

    function enteteTableau(o, t) {
      var nbEleves = o.index === 3 ? ' · ' + t.nb_eleves + ' élève(s)' : '';
      return h('div', { class: 'entete-panneau' }, [
        h('div', {}, [h('h2', {}, o.index === 3 ? 'Tableau 4 : ' + t.titre : t.titre),
          h('div', { class: 'meta' }, [t.nb_classes + ' classe(s) concernée(s)' + nbEleves, ' · Généré le ' + dateFr(etat.rapport.date_generation)])]),
        h('div', { class: 'actions' }, [
          peut('generer') ? h('button', { class: 'btn', disabled: etat.chargement, onclick: function () { generer('Tableaux régénérés à partir des données actuelles d\'ORIENT 360.'); } }, etat.chargement ? 'Génération…' : 'Générer') : null,
          peut('telecharger') ? h('button', { class: 'btn pdf', onclick: function () { telecharger([o.index], 'pdf', 'Tableau' + (o.index + 1)); } }, 'Télécharger PDF') : null,
          peut('telecharger') ? h('button', { class: 'btn xls', onclick: function () { telecharger([o.index], 'xlsx', 'Tableau' + (o.index + 1)); } }, 'Télécharger Excel') : null
        ])
      ]);
    }

    function tableHtml(o, t) {
      var s = X.structure(t, o.index);
      var thead = h('thead', {}, s.entetes.map(function (ligne) {
        return h('tr', {}, ligne.map(function (c) { return typeof c === 'object' ? h('th', { colspan: c.colSpan, rowspan: c.rowSpan }, c.content) : h('th', {}, c); }));
      }));
      var tbody = h('tbody', {}, t.lignes.length ? t.lignes.map(function (l, i) {
        return h('tr', {}, s.corps[i].map(function (val, j) {
          if (o.index === 0 && j === 10) return h('td', { class: 'texte' + (l.motifs ? '' : ' manquant') }, l.motifs || 'Non renseigné');
          var cls = j === 0 && o.index < 3 ? 'classe' : '';
          if (o.index === 3) {
            if (j === 2 || j === 3) cls = 'texte';
            if (j === 17) cls = 'risque r-' + (l.risque_code || (l.present === false ? 'absent' : 'nc'));
            if (j >= 8 && j <= 16 && !l.depouille) return h('td', { class: 'na' }, '');
            if (j === 7 && l.red === '') return h('td', {}, ''); // non redoublant : vide normal, pas une donnée manquante
          }
          return cell(val === '' ? null : val, cls);
        }));
      }) : [h('tr', {}, h('td', { colspan: 40, class: 'aucun' }, 'Aucune donnée pour cette sélection.'))]);
      var tfoot = s.total ? h('tfoot', {}, h('tr', {}, s.total.map(function (v2) { return h('td', {}, v2 === '' ? '' : String(v2)); }))) : null;
      return h('div', { class: 'defile' }, h('table', { class: 'tab t' + (o.index + 1) }, [thead, tbody, tfoot]));
    }

    function panneauTableau(o) {
      var t = etat.rapport.tableaux[o.index];
      var p = h('section', { class: 'panneau' }, [enteteTableau(o, t)]);
      if (o.index === 3) {
        if (!peut('registre_nominatif')) { p.appendChild(h('div', { class: 'alerte' }, 'Le registre individuel contient des données nominatives protégées : il est accessible uniquement aux profils habilités.')); return p; }
        var f = etat.filtreRegistre;
        function maj(k, val) { f[k] = val; recalculer(); }
        p.appendChild(h('div', { class: 'filtres-registre' }, [
          select('Genre', f.genre, [{ v: '', l: 'Tous' }, { v: 'F', l: 'Filles (F)' }, { v: 'G', l: 'Garçons (G)' }], function (v2) { maj('genre', v2); }),
          select('Risque', f.risque, [{ v: '', l: 'Tous' }, { v: 'ELEVE', l: 'Élevé' }, { v: 'MODERE', l: 'Modéré' }, { v: 'AUCUN', l: 'Aucun' }, { v: 'NON_CLASSE', l: 'Non classés (absents / non dépouillés)' }], function (v2) { maj('risque', v2); }),
          h('label', { class: 'champ' }, [h('span', {}, 'Matricule'), h('input', { type: 'search', value: f.matricule, placeholder: 'Rechercher…', onchange: function (e) { maj('matricule', e.target.value); } })]),
          h('label', { class: 'case' }, [h('input', { type: 'checkbox', checked: f.inclure_absents, onchange: function (e) { maj('inclure_absents', e.target.checked); } }), ' Inclure les absents']),
          (f.genre || f.risque || f.matricule) ? h('span', { class: 'note' }, 'Filtre actif : l\'export reprend la sélection affichée.') : null
        ]));
        if (!etat.parametres.criteres_dimensions || !L.DIMENSIONS.every(function (d) { return etat.parametres.criteres_dimensions[d] != null; }))
          p.appendChild(h('div', { class: 'note' }, '« Nombre de dimensions à suivre » : valeur enregistrée par le module LYCAM. Tant que les critères officiels ne sont pas paramétrés, la cellule reste vide si ORIENT 360 ne la fournit pas.'));
      }
      if (o.index === 2) p.appendChild(h('div', { class: 'note' }, 'Seuils appliqués : risque élevé si score > ' + etat.parametres.seuils.eleve_strictement_superieur_a + ' ; modéré de ' + etat.parametres.seuils.modere_a_partir_de + ' à ' + etat.parametres.seuils.eleve_strictement_superieur_a + ' ; inférieur à ' + etat.parametres.seuils.modere_a_partir_de + '. Les élèves absents ou dont le test n\'est pas dépouillé ne sont pas classés' + (t.total.non_classes ? ' (' + t.total.non_classes + ' présent(s) non classé(s)).' : '.')));
      p.appendChild(tableHtml(o, t));
      return p;
    }

    function panneauControles() {
      var c = etat.rapport.controles;
      var lib = { bloquant: 'Bloquant', avertissement: 'Avertissement', info: 'Information' };
      var ordre = { bloquant: 0, avertissement: 1, info: 2 };
      var liste = c.anomalies.slice().sort(function (a, b) { return ordre[a.niveau] - ordre[b.niveau]; });
      var p = h('section', { class: 'panneau' }, [
        h('div', { class: 'entete-panneau' }, [h('div', {}, [h('h2', {}, 'Vérification automatique des données'),
          h('div', { class: 'meta' }, 'Données manquantes et incohérences détectées avant validation. Les corrections se font dans ORIENT 360 (dépouillement LYCAM, fiches élèves) ; les tableaux sont ensuite régénérés.')]),
          h('div', { class: 'actions' }, peut('generer') ? h('button', { class: 'btn', onclick: function () { generer('Contrôles relancés.'); } }, 'Relancer les contrôles') : null)])
      ]);
      if (etat.rapport.erreurs_totaux.length) p.appendChild(h('div', { class: 'alerte erreur' }, etat.rapport.erreurs_totaux.join(' ; ')));
      if (!liste.length) { p.appendChild(h('div', { class: 'alerte ok' }, 'Aucune anomalie détectée.')); return p; }
      p.appendChild(h('div', { class: 'defile' }, h('table', { class: 'tab controles' }, [
        h('thead', {}, h('tr', {}, [h('th', {}, 'Niveau'), h('th', {}, 'Contrôle'), h('th', {}, 'Détail')])),
        h('tbody', {}, liste.map(function (a) { return h('tr', { class: a.niveau }, [h('td', {}, h('span', { class: 'niv ' + a.niveau }, lib[a.niveau])), h('td', { class: 'code' }, a.code), h('td', { class: 'texte' }, a.message)]); }))
      ])));
      return p;
    }

    function panneauParametres() {
      var p0 = etat.parametres;
      var form = { e: p0.seuils.eleve_strictement_superieur_a, m: p0.seuils.modere_a_partir_de, formule: p0.formule_total, crit: Object.assign({}, p0.criteres_dimensions) };
      function nb(v) { return v === '' || v === null ? null : Number(String(v).replace(',', '.')); }
      var p = h('section', { class: 'panneau parametres' }, [
        h('div', { class: 'entete-panneau' }, [h('div', {}, [h('h2', {}, 'Paramétrage des seuils — année ' + etat.annee),
          h('div', { class: 'meta' }, 'Réservé à l\'administrateur. Les résultats déjà validés conservent leur classification historique ; les nouveaux seuils s\'appliquent aux résultats non encore validés.')])]),
        h('fieldset', {}, [h('legend', {}, 'Seuils du risque de décrochage (score total)'),
          h('label', { class: 'champ' }, [h('span', {}, 'Risque élevé : score strictement supérieur à'), h('input', { type: 'number', step: 'any', value: form.e, oninput: function (e) { form.e = nb(e.target.value); } })]),
          h('label', { class: 'champ' }, [h('span', {}, 'Risque modéré : score à partir de'), h('input', { type: 'number', step: 'any', value: form.m, oninput: function (e) { form.m = nb(e.target.value); } })]),
          h('div', { class: 'note' }, 'Document de référence : élevé > 18 ; modéré entre 10 et 18 ; inférieur < 10.'),
          h('button', { class: 'btn lien', onclick: function () { form.e = 18; form.m = 10; enregistrer(); } }, 'Rétablir les seuils de référence')]),
        h('fieldset', {}, [h('legend', {}, 'Total LYCAM'),
          select('Origine du total', form.formule, [{ v: 'somme', l: 'Total enregistré par ORIENT 360, sinon somme des 7 dimensions' }, { v: 'stocke', l: 'Uniquement le total enregistré par ORIENT 360' }], function (v) { form.formule = v; })]),
        h('fieldset', {}, [h('legend', {}, 'Critères officiels « dimension à suivre (+) »'),
          h('div', { class: 'note' }, 'Score à partir duquel une dimension est à suivre. Laisser vide tant que le critère officiel n\'est pas confirmé : la valeur enregistrée par le module LYCAM est alors reprise.'),
          h('div', { class: 'grille-dim' }, L.DIMENSIONS.map(function (d) {
            return h('label', { class: 'champ court' }, [h('span', {}, d), h('input', { type: 'number', step: 'any', value: form.crit[d] == null ? '' : form.crit[d], oninput: function (e) { form.crit[d] = nb(e.target.value); } })]);
          }))]),
        h('button', { class: 'btn principal', onclick: function () { enregistrer(); } }, 'Enregistrer les paramètres')
      ]);
      function enregistrer() {
        var params = { seuils: { eleve_strictement_superieur_a: form.e, modere_a_partir_de: form.m }, formule_total: form.formule, criteres_dimensions: form.crit };
        var err = L.validerSeuils(params.seuils);
        if (err.length) { alert(err.join('\n')); return; }
        source.enregistrerParametres({ annee: etat.annee, parametres: params }).then(function () { return generer('Paramètres enregistrés ; tableaux régénérés.'); }).catch(echec);
      }
      return p;
    }

    // ------------------------------------------- actualisation automatique
    if (source.abonner) source.abonner(function () { generer('Données LYCAM modifiées dans ORIENT 360 : tableaux actualisés.'); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && etat.rapport && !etat.chargement) generer(); });

    chargerContexte();
    return { actualiser: function () { return generer('Tableaux actualisés.'); }, etat: etat };
  }

  root.LycamRapports = { monter: monter };
})(typeof self !== 'undefined' ? self : this);
