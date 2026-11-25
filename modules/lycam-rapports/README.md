# ORIENT 360 — Rapports et tableaux statistiques LYCAM

Rubrique **LYCAM → RAPPORTS STATISTIQUES**. Elle génère automatiquement, à partir des données déjà enregistrées dans ORIENT 360, les quatre tableaux du rapport de dépouillement du test LYCAM, avec export PDF et Excel. Le module produit aussi le rapport complet en un seul document.

> **Principe fondamental :** les tableaux sont une représentation automatique, fidèle et vérifiable des données LYCAM enregistrées dans ORIENT 360. Le module n'invente aucune donnée et ne modifie jamais les données sources. Un champ non renseigné reste vide et il est signalé.

## Contenu

| Fichier | Rôle |
|---|---|
| `src/lycam-core.js` | Calcul des 4 tableaux, seuils, contrôles qualité, empreinte de validation, droits. Sans dépendance, testé. |
| `src/lycam-exports.js` | Export PDF (A4, en-tête, pagination, totaux, paysage pour les tableaux larges) et Excel. |
| `src/lycam-source.js` | Connexion aux données : `RestSource` (production) et `DemoSource` (démonstration, données fictives). |
| `src/lycam-app.js` + `src/lycam-rapports.css` | Interface : filtres, onglets, aperçus, boutons Générer / PDF / Excel, validation, paramètres. |
| `sql/lycam_rapports.sql` | Tables du module (seuils versionnés, validations, journal) et fonction de lecture des données existantes. |
| `vendor/` | Bibliothèques d'export embarquées : SheetJS, jsPDF, jsPDF-AutoTable. Elles fonctionnent hors connexion. |
| `tests/core.test.js` | Tests des calculs : `node --test tests/*.test.js` |

**Démonstration :** ouvrir `index.html?demo=1` (profil administrateur) ou `index.html?demo=1&role=inspecteur`. Un bandeau signale en permanence que les données sont fictives.

## Les quatre tableaux

1. **Motifs des choix des classes.** Pour chaque classe : inscrits, redoublants et présents (F / G / T), puis le motif du choix. Une ligne TOTAL termine le tableau. Un motif absent est affiché « Non renseigné ».
2. **Effectifs par genre.** Inscrits, redoublants, Élevé, Modéré, Aucun et présents (F / G / T), avec une ligne TOTAL.
3. **Résultats par risque de décrochage.** Effectif total, effectif présent, puis risque élevé (> 18), modéré (10 à 18) et inférieur (< 10).
4. **Registre individuel de dépouillement et de suivi LYCAM.** Il reprend exactement les 19 colonnes demandées. On peut le filtrer par classe, genre, matricule et niveau de risque. Il s'exporte en paysage.

### Règles appliquées

- **Inscrits, redoublants et présents** sont comptés séparément. Un élève absent reste compté parmi les inscrits mais n'entre jamais dans les résultats.
- **Élève non classé :** un élève dont le test n'est pas dépouillé n'est jamais classé. Il apparaît « Non dépouillé » dans le registre et il est signalé dans les contrôles.
- **Genre non renseigné :** l'élève est compté dans T mais ni dans F ni dans G. L'anomalie est signalée.
- **Seuils :** le document de référence fixe un risque élevé au-dessus de 18 et un risque modéré entre 10 et 18 inclus. L'administrateur peut modifier ces seuils pour chaque année scolaire. **Un résultat déjà validé conserve sa classification historique** ; les nouveaux seuils ne s'appliquent qu'aux résultats non validés.
- **Total :** le module reprend le total calculé par ORIENT 360. S'il manque, il fait la somme des 7 dimensions. Un écart entre le total enregistré et cette somme est une anomalie bloquante.
- **Nombre de dimensions à suivre :** le module reprend la valeur enregistrée par le module LYCAM. Il ne la calcule lui-même que si l'administrateur a saisi les critères officiels dans les paramètres. Les acronymes AF, PS, RS, CS, AB, BS et IE sont conservés tels quels.
- **Âge :** il est calculé à la date du test à partir de la date de naissance, sauf si ORIENT 360 fournit déjà l'âge.

## Validation et fiabilité

- **Contrôles automatiques :** 26 contrôles portent sur les matricules en double ou manquants, le genre, la présence, les résultats attachés à des absents, les scores manquants, l'incohérence des totaux, la répartition par risque, les moyennes hors de 0 à 20, etc. Ils ont trois niveaux : *bloquant*, *avertissement* et *information*.
- **Validation par l'Inspecteur d'Orientation :** elle n'est possible que s'il ne reste aucune anomalie bloquante. Le module enregistre alors une **empreinte** des données. Si les données changent ensuite, le rapport repasse automatiquement au statut « À revalider ».
- **Documents provisoires :** tant que les données ne sont pas validées, les exports portent un filigrane « PROVISOIRE » et le suffixe `_PROVISOIRE` dans le nom du fichier.
- **Totaux :** les totaux sont revérifiés avant chaque export. En cas d'écart, l'export est bloqué.
- **Actualisation :** les tableaux se mettent à jour quand ORIENT 360 envoie un événement `lycam-modifie`, quand l'onglet redevient visible, ou par un appel à `window.lycam.actualiser()`.

## Droits d'accès

| Profil | Droits |
|---|---|
| Administrateur | Tous les droits, y compris le paramétrage des seuils et la gestion des droits. |
| Inspecteur d'Orientation | Consultation, génération, validation, téléchargement et accès au registre nominatif. |
| Autres profils | Uniquement les autorisations accordées : `consulter`, `telecharger`, `registre_nominatif`… |

Le registre nominatif est masqué, et retiré du rapport complet, pour les profils non habilités. **Ces droits doivent aussi être appliqués côté serveur**, dans l'API et par la RLS de la base.

## Branchement dans ORIENT 360

1. Exécuter `sql/lycam_rapports.sql` après avoir remplacé les noms de tables marqués **« À ADAPTER »** par ceux d'ORIENT 360.
2. Exposer les routes suivantes, toutes en JSON, avec contrôle des droits côté serveur :

   | Méthode | Route | Renvoie / reçoit |
   |---|---|---|
   | GET | `/api/lycam-rapports/contexte` | `{ utilisateur: {id, nom, role, autorisations}, etablissements: [{id, nom}], annees: [...] }` |
   | GET | `/api/lycam-rapports/donnees?etablissement=&annee=` | résultat de `lycam_jeu_donnees(...)` |
   | GET | `/api/lycam-rapports/parametres?annee=` | résultat de `lycam_parametres_actuels(...)` |
   | PUT | `/api/lycam-rapports/parametres?annee=` | insère une nouvelle ligne dans `lycam_parametres` (administrateur uniquement) |
   | GET | `/api/lycam-rapports/validation?etablissement=&annee=` | dernière ligne de `lycam_validations` |
   | POST | `/api/lycam-rapports/validation` | insère une validation (Inspecteur ou administrateur) |
   | POST | `/api/lycam-rapports/journal` | facultatif |
   | GET | `/api/lycam-rapports/evenements` | facultatif : flux SSE qui émet `lycam-modifie` |

3. Ajouter l'entrée de menu **LYCAM → Rapports statistiques**, qui charge les scripts dans l'ordre d'`index.html` puis appelle :

   ```js
   window.lycam = LycamRapports.monter(document.getElementById('lycam-rapports'), {
     source: new LycamSource.RestSource({ base: '/api/lycam-rapports', evenements: true })
   });
   ```

   Pour React, Vue ou Angular, monter le module dans un `div` du composant de page. Il n'a aucune dépendance de framework, et ses styles sont préfixés `.lycam`.
4. Après chaque validation ou modification du dépouillement LYCAM, appeler `window.lycam.actualiser()`, ou émettre l'événement SSE.

### Format attendu des données (`/donnees`)

```json
{
  "etablissement": { "id": "…", "nom": "…", "entete_lignes": ["MINISTÈRE …", "DRENA …", "CIO …"] },
  "annee_scolaire": "2026-2027",
  "classes":   [{ "id": "c1", "nom": "2nde A1", "ordre": 1, "concernee_lycam": true, "motif_choix": "…" }],
  "eleves":    [{ "id": 1, "matricule": "…", "nom": "…", "prenoms": "…", "genre": "F", "date_naissance": "2010-03-14",
                  "classe_id": "c1", "redoublant": false, "present_test": true, "moyenne_t1": 11.25 }],
  "resultats": [{ "eleve_id": 1, "depouille": true, "scores": { "AF": 2, "PS": 1, "RS": 0, "CS": 3, "AB": 1, "BS": 2, "IE": 0 },
                  "total": 9, "nb_dimensions_suivre": 1, "niveau_risque": "Aucun", "valide": true, "date_test": "2026-11-10" }]
}
```
