/*
 * ORIENT 360 — Rapports LYCAM : connexion aux données.
 *
 * Le module lit les données déjà présentes dans ORIENT 360 (aucune double
 * saisie). Toute source doit exposer les méthodes ci-dessous ; la source REST
 * est celle à utiliser en production, branchée sur les vues SQL fournies dans
 * sql/lycam_rapports.sql (ou sur l'API existante d'ORIENT 360).
 *
 *   contexte()                          → { utilisateur:{id,nom,role,autorisations}, etablissements:[{id,nom}], annees:['2026-2027',…] }
 *   donnees({etablissement, annee})     → jeu de données (voir LycamCore.preparer)
 *   parametres({annee})                 → { seuils, formule_total, criteres_dimensions, version, date_effet }
 *   enregistrerParametres({annee, parametres})      (administrateur)
 *   validation({etablissement, annee})  → { empreinte, valide_par, valide_le, observations } | null
 *   valider({etablissement, annee, empreinte, observations})
 *   journaliser({etablissement, annee, action, tableau, empreinte})   (facultatif)
 *   abonner(callback)                   (facultatif) : appelé quand les données LYCAM changent
 */
(function (root) {
  'use strict';

  function RestSource(config) {
    config = config || {};
    var base = (config.base || '/api/lycam-rapports').replace(/\/$/, '');
    var entetes = Object.assign({ 'Accept': 'application/json' }, config.entetes || {});
    function q(o) { return Object.keys(o).filter(function (k) { return o[k] != null && o[k] !== ''; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&'); }
    function appel(methode, chemin, params, corps) {
      var url = base + chemin + (params ? '?' + q(params) : '');
      var init = { method: methode, headers: Object.assign({}, entetes), credentials: config.credentials || 'same-origin' };
      if (corps !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(corps); }
      return fetch(url, init).then(function (r) {
        if (r.status === 204) return null;
        if (!r.ok) return r.text().then(function (t) { var e = new Error('ORIENT 360 a répondu ' + r.status + ' sur ' + chemin + (t ? ' : ' + t.slice(0, 200) : '')); e.status = r.status; throw e; });
        return r.json();
      });
    }
    this.contexte = function () { return appel('GET', '/contexte'); };
    this.donnees = function (f) { return appel('GET', '/donnees', { etablissement: f.etablissement, annee: f.annee }); };
    this.parametres = function (f) { return appel('GET', '/parametres', { annee: f.annee }); };
    this.enregistrerParametres = function (f) { return appel('PUT', '/parametres', { annee: f.annee }, f.parametres); };
    this.validation = function (f) { return appel('GET', '/validation', { etablissement: f.etablissement, annee: f.annee }); };
    this.valider = function (f) { return appel('POST', '/validation', null, f); };
    this.journaliser = function (f) { return appel('POST', '/journal', null, f).catch(function () { /* journal facultatif */ }); };
    if (config.evenements) {
      // Server-Sent Events émis par ORIENT 360 après modification ou validation LYCAM
      this.abonner = function (cb) {
        if (typeof EventSource === 'undefined') return;
        var es = new EventSource(base + '/evenements', { withCredentials: true });
        es.addEventListener('lycam-modifie', function () { cb(); });
        return function () { es.close(); };
      };
    }
  }

  /**
   * Source de DÉMONSTRATION — uniquement pour prévisualiser l'interface.
   * Les données sont fictives et l'interface l'affiche en permanence.
   * Ne jamais l'utiliser en production.
   */
  function DemoSource() {
    var graine = 42;
    function alea() { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; }
    var noms = ['KOUASSI', 'KONAN', 'YAO', 'KOFFI', 'TRAORÉ', 'OUATTARA', 'COULIBALY', 'BAMBA', 'N\'GUESSAN', 'DIABATÉ', 'KONÉ', 'SORO', 'TOURÉ', 'AKA', 'ASSI', 'GBAGBO', 'DIALLO', 'FOFANA'];
    var pf = ['Aya Marie', 'Adjoua', 'Mariam', 'Fatou', 'Awa', 'Affoué Grâce', 'Akissi', 'Salimata', 'Amenan', 'Aminata'];
    var pg = ['Kouadio Jean', 'Yao Serge', 'Moussa', 'Ibrahim', 'Konan Paul', 'Seydou', 'Kouamé', 'Drissa', 'Aboubakar', 'Junior'];
    var classes = [
      { id: 'c1', nom: '2nde A1', ordre: 1, motif_choix: 'Classe à effectif pléthorique ; taux d\'échec élevé au 1er trimestre.' },
      { id: 'c2', nom: '2nde A2', ordre: 2, motif_choix: 'Signalements de l\'équipe pédagogique (absentéisme).' },
      { id: 'c3', nom: '2nde C', ordre: 3, motif_choix: null },
      { id: 'c4', nom: '1ère A', ordre: 4, motif_choix: 'Forte proportion de redoublants.' }
    ];
    var eleves = [], resultats = [], id = 1;
    classes.forEach(function (c, ci) {
      var n = 18 + Math.floor(alea() * 10);
      for (var i = 0; i < n; i++) {
        var f = alea() < 0.5;
        var present = alea() > 0.1;
        var e = {
          id: id, matricule: (20000000 + id * 37) + String.fromCharCode(65 + (id % 26)),
          nom: noms[Math.floor(alea() * noms.length)], prenoms: (f ? pf : pg)[Math.floor(alea() * 10)],
          genre: f ? 'F' : 'G', date_naissance: (2008 + ci % 2 + Math.floor(alea() * 3)) + '-0' + (1 + Math.floor(alea() * 9)) + '-1' + Math.floor(alea() * 9),
          classe_id: c.id, redoublant: alea() < 0.18, present_test: present,
          moyenne_t1: alea() < 0.95 ? Math.round((5 + alea() * 11) * 100) / 100 : null
        };
        eleves.push(e);
        if (present && alea() > 0.04) {
          var profil = alea(); // répartition fictive couvrant les trois niveaux de risque
          var s = {}; ['AF', 'PS', 'RS', 'CS', 'AB', 'BS', 'IE'].forEach(function (d) { s[d] = Math.min(5, Math.floor(alea() * (profil > 0.8 ? 6 : profil > 0.45 ? 4 : 2.6))); });
          resultats.push({ eleve_id: id, depouille: true, scores: s, date_test: '2026-11-10' });
        } else if (present) resultats.push({ eleve_id: id, depouille: false });
        id++;
      }
    });
    var jeu = {
      demonstration: true,
      etablissement: { id: 'demo', nom: 'LYCÉE DE DÉMONSTRATION (données fictives)', entete_lignes: ['ORIENT 360 — Espace de démonstration', 'Données fictives : ne pas diffuser'] },
      annee_scolaire: '2026-2027', classes: classes, eleves: eleves, resultats: resultats
    };
    var params = null, validation = null;
    var role = (typeof location !== 'undefined' && /role=inspecteur/.test(location.search)) ? 'inspecteur' : 'administrateur';
    this.demonstration = true;
    this.contexte = function () { return Promise.resolve({ utilisateur: { id: 0, nom: 'Utilisateur démo', role: role }, etablissements: [{ id: 'demo', nom: jeu.etablissement.nom }], annees: ['2026-2027'] }); };
    this.donnees = function () { return Promise.resolve(JSON.parse(JSON.stringify(jeu))); };
    this.parametres = function () { return Promise.resolve(params); };
    this.enregistrerParametres = function (f) { params = f.parametres; return Promise.resolve(params); };
    this.validation = function () { return Promise.resolve(validation); };
    this.valider = function (f) { validation = { empreinte: f.empreinte, valide_par: 'Utilisateur démo', valide_le: new Date().toISOString(), observations: f.observations }; return Promise.resolve(validation); };
    this.journaliser = function () { return Promise.resolve(); };
  }

  root.LycamSource = { RestSource: RestSource, DemoSource: DemoSource };
})(typeof self !== 'undefined' ? self : this);
