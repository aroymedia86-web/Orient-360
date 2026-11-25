/*
 * ORIENT 360 — Rapports LYCAM : exports PDF (jsPDF + AutoTable) et Excel (SheetJS).
 * Les exports lisent les tableaux générés par LycamCore et ne modifient jamais
 * les données sources.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./lycam-core.js'));
  else root.LycamExports = factory(root.LycamCore);
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  var NON_RENSEIGNE = 'Non renseigné';

  function v(x) { return x === null || x === undefined ? '' : x; }
  function num(x) { return x === null || x === undefined ? '' : (typeof x === 'number' ? Math.round(x * 100) / 100 : x); }
  function dateFr(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' à ' +
      d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  function fgt(c) { return [c.F, c.G, c.T]; }

  // --------------------------------------------- structure commune des tableaux
  /** Retourne { entetes: [[cellule…]…], corps: [[…]…], total: […] | null, paysage } */
  function structure(t, index) {
    var FGT = ['F', 'G', 'T'];
    function groupe(libelle) { return { content: libelle, colSpan: 3 }; }
    function vertical(libelle) { return { content: libelle, rowSpan: 2 }; }
    if (index === 0) {
      return {
        entetes: [[vertical('Classe'), groupe('Inscrits'), groupe('Redoublants'), groupe('Présents'), vertical('Motifs du choix des classes')], FGT.concat(FGT, FGT)],
        corps: t.lignes.map(function (l) { return [l.classe].concat(fgt(l.inscrits), fgt(l.redoublants), fgt(l.presents), [l.motifs || NON_RENSEIGNE]); }),
        total: ['TOTAL'].concat(fgt(t.total.inscrits), fgt(t.total.redoublants), fgt(t.total.presents), ['']),
        paysage: false, largeurs: { 0: 24, 10: 'auto' }
      };
    }
    if (index === 1) {
      var g = ['inscrits', 'redoublants', 'eleve', 'modere', 'aucun', 'presents'];
      var lib = ['Inscrits', 'Redoublants', 'Élevé', 'Modéré', 'Aucun', 'Présents'];
      var ligne2 = []; g.forEach(function () { ligne2 = ligne2.concat(FGT); });
      return {
        entetes: [[vertical('Classe')].concat(lib.map(groupe)), ligne2],
        corps: t.lignes.map(function (l) { var r = [l.classe]; g.forEach(function (k) { r = r.concat(fgt(l[k])); }); return r; }),
        total: (function () { var r = ['TOTAL']; g.forEach(function (k) { r = r.concat(fgt(t.total[k])); }); return r; })(),
        paysage: true, largeurs: { 0: 30 }
      };
    }
    if (index === 2) {
      return {
        entetes: [['Classe', 'Effectif total', 'Effectif présent', t.entetes.eleve, t.entetes.modere, t.entetes.aucun]],
        corps: t.lignes.map(function (l) { return [l.classe, l.effectif_total, l.effectif_present, l.eleve, l.modere, l.aucun]; }),
        total: ['TOTAL', t.total.effectif_total, t.total.effectif_present, t.total.eleve, t.total.modere, t.total.aucun],
        paysage: false, largeurs: { 0: 28 }
      };
    }
    return {
      entetes: [t.colonnes.slice()],
      corps: t.lignes.map(function (l) {
        return [l.n, v(l.matricule), v(l.nom), v(l.prenoms), v(l.genre), v(l.age), v(l.classe), v(l.red)]
          .concat(L.DIMENSIONS.map(function (d) { return num(l[d]); }), [num(l.total), num(l.nb_dimensions_suivre), v(l.risque), num(l.moyenne_t1)]);
      }),
      total: null, paysage: true,
      largeurs: { 0: 8, 1: 20, 2: 26, 3: 34, 4: 11, 5: 9, 6: 16, 7: 8, 15: 11, 16: 19, 17: 20, 18: 18 }
    };
  }

  function numeroTableau(index) { return index + 1; }

  // ------------------------------------------------------------------- EXCEL
  function feuilleExcel(XLSX, rapport, index, contexte) {
    var t = rapport.tableaux[index];
    var s = structure(t, index);
    var aoa = [], merges = [];
    var entete = (contexte.etablissement && contexte.etablissement.entete_lignes) || [];
    entete.forEach(function (ligne) { aoa.push([ligne]); });
    aoa.push([contexte.etablissement ? contexte.etablissement.nom : '']);
    aoa.push(['Année scolaire : ' + (contexte.annee_scolaire || '')]);
    aoa.push([t.titre]);
    if (contexte.statut !== 'valide') aoa.push(['DOCUMENT PROVISOIRE — données non validées par l\'Inspecteur d\'Orientation']);
    aoa.push([]);
    var debut = aoa.length;
    // en-têtes (développement des colSpan/rowSpan)
    var largeurTotale = s.entetes[s.entetes.length - 1].length + (s.entetes.length > 1 ? s.entetes[0].filter(function (c) { return c && c.rowSpan; }).length : 0);
    var grille = s.entetes.map(function () { return new Array(largeurTotale).fill(null); });
    s.entetes.forEach(function (ligne, r) {
      var c = 0;
      ligne.forEach(function (cell) {
        while (grille[r][c] !== null) c++;
        var contenu = typeof cell === 'object' ? cell.content : cell;
        var cs = (cell && cell.colSpan) || 1, rs = (cell && cell.rowSpan) || 1;
        for (var i = 0; i < rs; i++) for (var j = 0; j < cs; j++) grille[r + i][c + j] = (i === 0 && j === 0) ? contenu : '';
        if (cs > 1 || rs > 1) merges.push({ s: { r: debut + r, c: c }, e: { r: debut + r + rs - 1, c: c + cs - 1 } });
        c += cs;
      });
    });
    grille.forEach(function (l) { aoa.push(l); });
    s.corps.forEach(function (l) { aoa.push(l); });
    if (s.total) aoa.push(s.total);
    aoa.push([]);
    aoa.push(['Date de génération : ' + dateFr(rapport.date_generation)]);
    if (contexte.validation && contexte.statut === 'valide') aoa.push(['Validé par : ' + (contexte.validation.valide_par || '') + ' le ' + dateFr(contexte.validation.valide_le)]);
    aoa.push(['Source : ORIENT 360 — module LYCAM (empreinte des données ' + rapport.empreinte + ')']);

    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = merges;
    var cols = [];
    for (var k = 0; k < largeurTotale; k++) cols.push({ wch: 7 });
    if (index === 0) { cols[0] = { wch: 16 }; cols[10] = { wch: 60 }; }
    if (index === 1) cols[0] = { wch: 16 };
    if (index === 2) cols = [{ wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 34 }, { wch: 34 }, { wch: 38 }];
    if (index === 3) cols = [6, 14, 18, 26, 7, 6, 12, 6, 6, 6, 6, 6, 6, 6, 6, 8, 16, 18, 12].map(function (w) { return { wch: w }; });
    ws['!cols'] = cols;
    ws['!freeze'] = { xSplit: 0, ySplit: debut + s.entetes.length };
    return ws;
  }

  var NOMS_FEUILLES = ['T1 Motifs choix classes', 'T2 Effectifs par genre', 'T3 Risque décrochage', 'T4 Registre individuel'];

  function excel(rapport, indices, contexte, nomFichier) {
    var XLSX = contexte.XLSX || (typeof window !== 'undefined' && window.XLSX);
    var wb = XLSX.utils.book_new();
    wb.Props = { Title: 'Rapport LYCAM', Author: 'ORIENT 360', CreatedDate: new Date(rapport.date_generation) };
    indices.forEach(function (i) { XLSX.utils.book_append_sheet(wb, feuilleExcel(XLSX, rapport, i, contexte), NOMS_FEUILLES[i]); });
    if (contexte.retourner) return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    XLSX.writeFile(wb, nomFichier);
  }

  // --------------------------------------------------------------------- PDF
  var BLEU = [31, 56, 100], GRIS = [242, 244, 247];

  function enTete(doc, contexte, rapport, titreTableau) {
    var w = doc.internal.pageSize.getWidth();
    var y = 12;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(40);
    var lignes = (contexte.etablissement && contexte.etablissement.entete_lignes) || [];
    lignes.forEach(function (l) { doc.text(String(l), 14, y); y += 4; });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(contexte.etablissement ? String(contexte.etablissement.nom || '') : '', 14, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('Année scolaire : ' + (contexte.annee_scolaire || ''), 14, y);
    doc.text('Rapport de dépouillement du test LYCAM', w - 14, 12, { align: 'right' });
    y += 3;
    doc.setDrawColor.apply(doc, BLEU); doc.setLineWidth(0.4); doc.line(14, y, w - 14, y); y += 7;
    if (titreTableau) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor.apply(doc, BLEU);
      doc.text(titreTableau, w / 2, y, { align: 'center' }); doc.setTextColor(0); y += 5;
    }
    return y;
  }

  function filigrane(doc) {
    var w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    doc.saveGraphicsState && doc.saveGraphicsState();
    if (doc.GState) doc.setGState(new doc.GState({ opacity: 0.12 }));
    doc.setFont('helvetica', 'bold'); doc.setFontSize(60); doc.setTextColor(180, 30, 30);
    doc.text('PROVISOIRE', w / 2, h / 2, { align: 'center', angle: 30 });
    doc.restoreGraphicsState && doc.restoreGraphicsState();
    doc.setTextColor(0);
  }

  function piedsDePage(doc, rapport, contexte) {
    var n = doc.internal.getNumberOfPages();
    for (var i = 1; i <= n; i++) {
      doc.setPage(i);
      var w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
      if (contexte.statut !== 'valide') filigrane(doc);
      doc.setDrawColor(200); doc.setLineWidth(0.2); doc.line(14, h - 11, w - 14, h - 11);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90);
      doc.text('ORIENT 360 — Généré le ' + dateFr(rapport.date_generation) +
        (contexte.statut === 'valide' && contexte.validation ? ' — Validé par ' + (contexte.validation.valide_par || '') : ' — Document provisoire (non validé)'), 14, h - 7);
      doc.text('Page ' + i + ' / ' + n, w - 14, h - 7, { align: 'right' });
      doc.setTextColor(0);
    }
  }

  function dessinerTableau(doc, rapport, index, contexte, nouvellePage) {
    var t = rapport.tableaux[index];
    var s = structure(t, index);
    var orient = s.paysage ? 'landscape' : 'portrait';
    if (nouvellePage) doc.addPage('a4', orient);
    var titre = index === 3 ? 'Tableau 4 : ' + t.titre : t.titre;
    var y = enTete(doc, contexte, rapport, titre);
    if (index === 3) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      doc.text(t.nb_eleves + ' élève(s) — ' + t.nb_classes + ' classe(s)', doc.internal.pageSize.getWidth() / 2, y, { align: 'center' }); y += 3;
    }
    var corps = s.corps.slice();
    var colonnesCentrees = {};
    var nbCols = s.entetes[s.entetes.length - 1].length + (s.entetes.length > 1 ? 1 : 0);
    for (var c = 0; c < nbCols + 1; c++) colonnesCentrees[c] = { halign: 'center' };
    var styleCols = {};
    Object.keys(colonnesCentrees).forEach(function (k) { styleCols[k] = { halign: 'center' }; });
    Object.keys(s.largeurs || {}).forEach(function (k) { styleCols[k] = Object.assign({}, styleCols[k] || {}, { cellWidth: s.largeurs[k] }); });
    if (index === 0) { for (var k1 = 1; k1 <= 9; k1++) styleCols[k1] = { halign: 'center', cellWidth: 10 }; styleCols[10] = { halign: 'left', cellWidth: 'auto' }; }
    if (index === 1) { for (var k2 = 1; k2 <= 18; k2++) styleCols[k2] = { halign: 'center', cellWidth: 12.5 }; }
    if (index === 3) { styleCols[2] = Object.assign(styleCols[2], { halign: 'left' }); styleCols[3] = Object.assign(styleCols[3], { halign: 'left' }); }
    styleCols[0] = Object.assign(styleCols[0] || {}, { halign: index === 3 ? 'center' : 'left', fontStyle: index === 3 ? 'normal' : 'bold' });

    doc.autoTable({
      startY: y + 2,
      head: s.entetes,
      body: corps,
      foot: s.total ? [s.total] : undefined,
      showFoot: 'lastPage',
      theme: 'grid',
      margin: { left: 14, right: 14, top: 34, bottom: 15 },
      styles: { font: 'helvetica', fontSize: index === 3 ? 7 : 8.5, cellPadding: index === 3 ? 1.2 : 1.8, lineColor: [150, 150, 150], lineWidth: 0.15, valign: 'middle', overflow: 'linebreak' },
      headStyles: { fillColor: BLEU, textColor: 255, fontStyle: 'bold', halign: 'center', fontSize: index === 3 ? 6.8 : 8.5 },
      footStyles: { fillColor: [220, 226, 236], textColor: 0, fontStyle: 'bold', halign: 'center' },
      alternateRowStyles: { fillColor: GRIS },
      columnStyles: styleCols,
      didParseCell: function (d) {
        if (index === 0 && d.section === 'body' && d.column.index === 10 && d.cell.raw === NON_RENSEIGNE) { d.cell.styles.textColor = [150, 150, 150]; d.cell.styles.fontStyle = 'italic'; }
        if (index === 3 && d.section === 'body' && d.column.index === 17) {
          if (d.cell.raw === 'Élevé') { d.cell.styles.textColor = [170, 20, 20]; d.cell.styles.fontStyle = 'bold'; }
          else if (d.cell.raw === 'Modéré') d.cell.styles.textColor = [170, 100, 0];
          else if (d.cell.raw === 'Absent' || d.cell.raw === 'Non dépouillé') { d.cell.styles.textColor = [120, 120, 120]; d.cell.styles.fontStyle = 'italic'; }
        }
      },
      didDrawPage: function (d) { if (d.pageNumber > 1 && d.cursor) enTete(doc, contexte, rapport, null); }
    });
  }

  function pdf(rapport, indices, contexte, nomFichier) {
    var jsPDF = (contexte.jsPDF) || (typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF);
    var premiere = structure(rapport.tableaux[indices[0]], indices[0]);
    var doc = new jsPDF({ orientation: premiere.paysage ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
    doc.setProperties({ title: indices.length > 1 ? 'Rapport LYCAM complet' : rapport.tableaux[indices[0]].titre, creator: 'ORIENT 360' });
    if (indices.length > 1) {
      // Page de titre du rapport complet
      var w = doc.internal.pageSize.getWidth();
      var y = enTete(doc, contexte, rapport, null) + 30;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor.apply(doc, BLEU);
      doc.text('RAPPORT DE DÉPOUILLEMENT DU TEST LYCAM', w / 2, y, { align: 'center' }); y += 10;
      doc.setFontSize(12); doc.setTextColor(0); doc.setFont('helvetica', 'normal');
      doc.text('Année scolaire ' + (contexte.annee_scolaire || ''), w / 2, y, { align: 'center' }); y += 18;
      doc.setFontSize(10.5); doc.setFont('helvetica', 'bold'); doc.text('Sommaire', 30, y); y += 7; doc.setFont('helvetica', 'normal');
      indices.forEach(function (i) { doc.text((i === 3 ? 'Tableau 4 : ' : '') + rapport.tableaux[i].titre, 34, y); y += 6.5; });
      y += 8;
      doc.setFontSize(9.5);
      var t3 = rapport.tableaux[2];
      doc.text('Classes concernées : ' + t3.nb_classes + '   —   Inscrits : ' + t3.total.effectif_total + '   —   Présents : ' + t3.total.effectif_present, 30, y); y += 6;
      doc.text('Date de génération : ' + dateFr(rapport.date_generation), 30, y); y += 6;
      if (contexte.statut === 'valide' && contexte.validation) doc.text('Validé par : ' + (contexte.validation.valide_par || '') + ', le ' + dateFr(contexte.validation.valide_le), 30, y);
      else { doc.setTextColor(170, 20, 20); doc.text('Document provisoire : données non encore validées par l\'Inspecteur d\'Orientation.', 30, y); doc.setTextColor(0); }
      indices.forEach(function (i) { dessinerTableau(doc, rapport, i, contexte, true); });
    } else {
      dessinerTableau(doc, rapport, indices[0], contexte, false);
    }
    piedsDePage(doc, rapport, contexte);
    if (contexte.retourner) return doc.output('arraybuffer');
    doc.save(nomFichier);
  }

  return { structure: structure, excel: excel, pdf: pdf, NOMS_FEUILLES: NOMS_FEUILLES, numeroTableau: numeroTableau };
});
