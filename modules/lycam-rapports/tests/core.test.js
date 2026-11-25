// Tests du noyau de calcul — exécuter : node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/lycam-core.js');

const sc = (a) => ({ AF: a[0], PS: a[1], RS: a[2], CS: a[3], AB: a[4], BS: a[5], IE: a[6] });

function jeu() {
  return {
    etablissement: { id: 1, nom: 'Lycée Test' }, annee_scolaire: '2026-2027', date_reference: '2026-11-25',
    classes: [
      { id: 'c1', nom: '2nde A1', ordre: 1, motif_choix: 'Classe à effectif élevé' },
      { id: 'c2', nom: '2nde C1', ordre: 2, motif_choix: null },
      { id: 'c3', nom: '1ère D', ordre: 3, concernee_lycam: false }
    ],
    eleves: [
      { id: 1, matricule: 'M1', nom: 'A', prenoms: 'a', genre: 'F', date_naissance: '2010-12-01', classe_id: 'c1', redoublant: true, present_test: true, moyenne_t1: 12.5 },
      { id: 2, matricule: 'M2', nom: 'B', prenoms: 'b', genre: 'M', age: 16, classe_id: 'c1', redoublant: false, present_test: true, moyenne_t1: 9 },
      { id: 3, matricule: 'M3', nom: 'C', prenoms: 'c', genre: 'Garçon', classe_id: 'c1', redoublant: false, present_test: true },
      { id: 4, matricule: 'M4', nom: 'D', prenoms: 'd', genre: 'F', classe_id: 'c1', redoublant: 'Oui', present_test: false },
      { id: 5, matricule: 'M5', nom: 'E', prenoms: 'e', genre: 'F', classe_id: 'c2', redoublant: false, present_test: true },
      { id: 6, matricule: 'M6', nom: 'F', prenoms: 'f', genre: null, classe_id: 'c2', redoublant: false, present_test: true },
      { id: 7, matricule: 'M7', nom: 'G', prenoms: 'g', genre: 'G', classe_id: 'c2', redoublant: false, present_test: true },
      { id: 8, matricule: 'M8', nom: 'H', prenoms: 'h', genre: 'G', classe_id: 'c3', redoublant: false, present_test: true }
    ],
    resultats: [
      { eleve_id: 1, depouille: true, scores: sc([3, 3, 3, 3, 3, 3, 1]) },             // 19 → élevé
      { eleve_id: 2, depouille: true, scores: sc([3, 3, 3, 3, 3, 3, 0]) },             // 18 → modéré (borne)
      { eleve_id: 3, depouille: true, scores: sc([2, 2, 2, 2, 1, 1, 0]) },             // 10 → modéré (borne)
      { eleve_id: 5, depouille: true, scores: sc([1, 1, 1, 1, 1, 1, 3]) },             // 9  → aucun
      { eleve_id: 6, depouille: false },                                               // non dépouillé
      { eleve_id: 7, depouille: true, valide: true, niveau_risque: 'Élevé', scores: sc([1, 1, 1, 1, 1, 1, 1]) } // historique validé
    ]
  };
}

test('seuils du document de référence', () => {
  const s = L.SEUILS_REFERENCE;
  assert.equal(L.classerScore(19, s), 'ELEVE');
  assert.equal(L.classerScore(18, s), 'MODERE');
  assert.equal(L.classerScore(10, s), 'MODERE');
  assert.equal(L.classerScore(9.5, s), 'AUCUN');
  assert.equal(L.classerScore(null, s), null);
});

test('tableau 1 : inscrits, redoublants et présents distincts, classe non concernée exclue', () => {
  const p = L.preparer(jeu());
  const t = L.tableau1(p);
  assert.equal(t.lignes.length, 2);
  const a1 = t.lignes[0];
  assert.deepEqual(a1.inscrits, { F: 2, G: 2, T: 4 });
  assert.deepEqual(a1.redoublants, { F: 2, G: 0, T: 2 });
  assert.deepEqual(a1.presents, { F: 1, G: 2, T: 3 });
  assert.equal(a1.motifs, 'Classe à effectif élevé');
  assert.equal(t.lignes[1].motifs, null);
  assert.deepEqual(t.total.inscrits, { F: 3, G: 3, T: 7 }); // élève 6 sans genre : T seulement
  assert.deepEqual(L.verifierTotaux(t), []);
});

test('tableau 2 : absents et non dépouillés jamais classés ; classification validée conservée', () => {
  const t = L.tableau2(L.preparer(jeu()));
  const [a1, c1] = t.lignes;
  assert.deepEqual(a1.eleve, { F: 1, G: 0, T: 1 });
  assert.deepEqual(a1.modere, { F: 0, G: 2, T: 2 });
  assert.deepEqual(a1.aucun, { F: 0, G: 0, T: 0 });
  assert.deepEqual(c1.aucun, { F: 1, G: 0, T: 1 });
  assert.deepEqual(c1.eleve, { F: 0, G: 1, T: 1 }); // élève 7 : « Élevé » validé, score 7 non reclassé
  assert.deepEqual(L.verifierTotaux(t), []);
});

test('tableau 3 : effectifs et non classés', () => {
  const t = L.tableau3(L.preparer(jeu()));
  assert.deepEqual(t.total, { effectif_total: 7, effectif_present: 6, eleve: 2, modere: 2, aucun: 1, non_classes: 1 });
  assert.match(t.entetes.eleve, /\+ de 18/);
});

test('seuils paramétrés : ne modifient pas les résultats déjà validés', () => {
  const t = L.tableau3(L.preparer(jeu(), { seuils: { eleve_strictement_superieur_a: 15, modere_a_partir_de: 8 } }));
  // 19, 18 → élevé ; 10, 9 → modéré ; élève 7 validé « Élevé » reste élevé
  assert.equal(t.total.eleve, 3);
  assert.equal(t.total.modere, 2);
  assert.equal(t.total.aucun, 0);
});

test('tableau 4 : colonnes exactes, total, âge, filtres', () => {
  const p = L.preparer(jeu());
  const t = L.tableau4(p);
  assert.equal(t.colonnes.length, 19);
  assert.deepEqual(t.colonnes.slice(8, 15), ['AF', 'PS', 'RS', 'CS', 'AB', 'BS', 'IE']);
  assert.equal(t.lignes.length, 6); // présents uniquement par défaut
  const a = t.lignes.find(l => l.matricule === 'M1');
  assert.equal(a.total, 19); assert.equal(a.risque, 'Élevé'); assert.equal(a.red, 'R'); assert.equal(a.age, 15);
  assert.equal(t.lignes.find(l => l.matricule === 'M6').risque, 'Non dépouillé');
  assert.equal(t.lignes.find(l => l.matricule === 'M6').total, null);
  assert.equal(t.lignes.find(l => l.matricule === 'M3').nb_dimensions_suivre, null); // critère non configuré : vide
  assert.equal(L.tableau4(p, { inclure_absents: true }).lignes.find(l => l.matricule === 'M4').risque, 'Absent');
  assert.equal(L.tableau4(p, { genre: 'G' }).lignes.length, 3);
  assert.equal(L.tableau4(p, { risque: 'MODERE' }).lignes.length, 2);
  assert.equal(L.tableau4(p, { matricule: 'm5' }).lignes.length, 1);
  assert.equal(L.tableau4(p, { classes: ['c2'] }).lignes.length, 3);
});

test('dimensions à suivre : calculées seulement si les critères officiels sont configurés', () => {
  const crit = { AF: 3, PS: 3, RS: 3, CS: 3, AB: 3, BS: 3, IE: 3 };
  const t = L.tableau4(L.preparer(jeu(), { criteres_dimensions: crit }));
  assert.equal(t.lignes.find(l => l.matricule === 'M1').nb_dimensions_suivre, 6);
  assert.equal(t.lignes.find(l => l.matricule === 'M5').nb_dimensions_suivre, 1);
});

test('contrôles : anomalies signalées, données non modifiées', () => {
  const j = jeu();
  const avant = JSON.stringify(j);
  j.resultats.push({ eleve_id: 4, depouille: true, total: 12 });   // résultat pour un absent
  j.resultats[0].total = 20;                                        // total ≠ somme (19)
  const avant2 = JSON.stringify(j);
  const c = L.verifier(L.preparer(j));
  const codes = c.anomalies.map(x => x.code);
  assert.ok(codes.includes('RESULTAT_ABSENT'));
  assert.ok(codes.includes('TOTAL_INCOHERENT'));
  assert.ok(codes.includes('GENRE_MANQUANT'));
  assert.ok(codes.includes('NON_DEPOUILLE'));
  assert.ok(codes.includes('CLASSE_INCONNUE')); // élève 8 dans une classe non concernée
  assert.ok(codes.includes('RISQUE_HISTORIQUE'));
  assert.equal(c.validable, false);
  assert.equal(JSON.stringify(j), avant2);
  assert.notEqual(avant, avant2);
});

test('validation : empreinte change si les données changent', () => {
  const j = jeu();
  const e1 = L.empreinte(L.preparer(j));
  assert.equal(L.statutValidation(L.preparer(j), { empreinte: e1 }), 'valide');
  j.resultats[2].scores.AF = 5;
  assert.equal(L.statutValidation(L.preparer(j), { empreinte: e1 }), 'a_revalider');
  assert.equal(L.statutValidation(L.preparer(j), null), 'brouillon');
});

test('droits d\'accès', () => {
  assert.ok(L.peut({ role: 'inspecteur' }, 'valider'));
  assert.ok(!L.peut({ role: 'inspecteur' }, 'parametrer_seuils'));
  assert.ok(L.peut({ role: 'administrateur' }, 'parametrer_seuils'));
  assert.ok(!L.peut({ role: 'enseignant' }, 'registre_nominatif'));
  assert.ok(L.peut({ role: 'enseignant', autorisations: ['consulter'] }, 'consulter'));
});

test('seuils invalides refusés', () => {
  assert.equal(L.validerSeuils({ eleve_strictement_superieur_a: 10, modere_a_partir_de: 18 }).length, 1);
  assert.equal(L.validerSeuils(L.SEUILS_REFERENCE).length, 0);
});
