// ============================================================
// Ein-Facher Rechnungen – PDF-Erzeugung (pdfmake)
// ============================================================
(function (root) {
  "use strict";
  const eurF = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  const numF = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 });
  const eur = n => eurF.format(Number(n) || 0);
  const num = n => numF.format(Number(n) || 0);
  const dat = s => (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) ? s.split("-").reverse().join(".") : (s || "");
  const lineTotal = p => Math.round((Number(p.Menge) || 0) * (Number(p.Preis) || 0) * 100) / 100;
  const titel = b => ({ Angebot: "Angebot", Storno: "Stornorechnung" })[b.Typ] || "Rechnung";

  function build(b, f) {
    f = f || {};
    const k = b.Kunde || {};
    const pos = b.Positionen || [];
    const accent = f.Farbe || "#0F766E";
    const total = Math.round(pos.reduce((a, p) => a + lineTotal(p), 0) * 100) / 100;
    const nr = b.Title || "ENTWURF";
    const ort = [f.PLZ, f.Ort].filter(Boolean).join(" ");
    const absender = [f.Firma, f.Strasse, ort].filter(Boolean).join(" · ");
    const empf = [k.Title, k.Ansprechpartner, k.Strasse, [k.PLZ, k.Ort].filter(Boolean).join(" "),
      (k.Land && !/^deutschland$/i.test(k.Land)) ? k.Land.toUpperCase() : ""].filter(Boolean);

    const info = [["Nummer", nr], [b.Typ === "Angebot" ? "Angebotsdatum" : "Rechnungsdatum", dat(b.Datum)]];
    if (b.Typ !== "Angebot" && b.Leistungsdatum) info.push(["Leistungsdatum", dat(b.Leistungsdatum)]);
    if (k.Kundennummer) info.push(["Kundennummer", k.Kundennummer]);
    if (b.Typ === "Angebot" && b.Faellig) info.push(["Gültig bis", dat(b.Faellig)]);
    if (b.Typ === "Rechnung" && b.Faellig) info.push(["Fällig am", dat(b.Faellig)]);
    if (b.BezugNr) info.push([b.Typ === "Storno" ? "Storno zu" : "Bezug", b.BezugNr]);

    const head = [
      { text: "Pos.", style: "th" }, { text: "Beschreibung", style: "th" },
      { text: "Menge", style: "th", alignment: "right" }, { text: "Einzelpreis", style: "th", alignment: "right" },
      { text: "Gesamt", style: "th", alignment: "right" }
    ];
    const rows = pos.map((p, i) => [
      { text: String(i + 1), color: "#666" },
      { stack: [{ text: p.Bezeichnung || "", bold: true }].concat(p.Beschreibung ? [{ text: p.Beschreibung, color: "#555", fontSize: 8.5, margin: [0, 2, 0, 0] }] : []) },
      { text: (num(p.Menge) + " " + (p.Einheit || "")).trim(), alignment: "right", noWrap: true },
      { text: eur(p.Preis), alignment: "right", noWrap: true },
      { text: eur(lineTotal(p)), alignment: "right", noWrap: true }
    ]);

    const intro = b.Typ === "Angebot" ? "vielen Dank für Ihre Anfrage. Gerne unterbreiten wir Ihnen folgendes Angebot:"
      : b.Typ === "Storno" ? `hiermit stornieren wir die Rechnung ${b.BezugNr || ""} wie folgt:`
      : "vielen Dank für Ihren Auftrag. Wir berechnen Ihnen folgende Leistungen:";
    let zahl = "";
    if (b.Typ === "Rechnung") zahl = `Bitte überweisen Sie den Gesamtbetrag ${b.Faellig ? "bis zum " + dat(b.Faellig) + " " : ""}ohne Abzug unter Angabe der Rechnungsnummer ${nr}${f.IBAN ? " auf das unten genannte Konto" : ""}.`;
    if (b.Typ === "Angebot" && b.Faellig) zahl = `Dieses Angebot ist gültig bis zum ${dat(b.Faellig)}. Wir freuen uns auf Ihren Auftrag.`;
    if (b.Typ === "Storno") zahl = "Bereits gezahlte Beträge werden erstattet bzw. verrechnet.";

    const footer = (cur, cnt) => ({
      margin: [50, 12, 50, 0],
      stack: [
        { canvas: [{ type: "line", x1: 0, y1: 0, x2: 495, y2: 0, lineWidth: 0.5, lineColor: "#cccccc" }] },
        {
          columns: [
            { width: "*", text: [f.Firma, f.Inhaber ? "Inh. " + f.Inhaber : "", f.Strasse, ort].filter(Boolean).join("\n") },
            { width: "*", text: [f.Telefon ? "Tel. " + f.Telefon : "", f.Email, f.Web].filter(Boolean).join("\n") },
            { width: "*", text: [f.Bank, f.IBAN ? "IBAN " + f.IBAN : "", f.BIC ? "BIC " + f.BIC : ""].filter(Boolean).join("\n") },
            { width: "*", text: [f.Steuernummer ? "St.-Nr. " + f.Steuernummer : "", f.UstId ? "USt-IdNr. " + f.UstId : "", `Seite ${cur} von ${cnt}`].filter(Boolean).join("\n") }
          ],
          columnGap: 10, fontSize: 7, color: "#666666", margin: [0, 6, 0, 0]
        }
      ]
    });

    const content = [
      {
        columns: [
          { text: f.Firma || "", fontSize: 22, bold: true, color: accent },
          { text: [f.Email, f.Web].filter(Boolean).join("\n"), alignment: "right", fontSize: 8, color: "#555555", margin: [0, 4, 0, 0] }
        ]
      },
      { canvas: [{ type: "rect", x: 0, y: 8, w: 495, h: 2, color: accent }], margin: [0, 0, 0, 34] },
      {
        columns: [
          { width: "*", stack: [
            { text: absender, fontSize: 7, color: "#888888", decoration: "underline", margin: [0, 0, 0, 6] },
            { text: empf.join("\n"), fontSize: 10, lineHeight: 1.2 }
          ] },
          { width: "auto", table: { widths: ["auto", "auto"], body: info.map(([a, v]) => [{ text: a, color: "#666666" }, { text: v || "", bold: true, alignment: "right" }]) },
            layout: { defaultBorder: false, paddingTop: () => 1.5, paddingBottom: () => 1.5 }, fontSize: 9 }
        ]
      },
      { text: `${titel(b)} ${nr}`, fontSize: 16, bold: true, margin: [0, 36, 0, 12] },
      { text: "Sehr geehrte Damen und Herren,", margin: [0, 0, 0, 4] },
      { text: intro, margin: [0, 0, 0, 12] },
      {
        table: { headerRows: 1, widths: [24, "*", 62, 70, 72], body: [head].concat(rows) },
        layout: {
          hLineWidth: i => (i === 0 ? 0 : i === 1 ? 1 : 0.5),
          vLineWidth: () => 0,
          hLineColor: i => (i === 1 ? accent : "#e5e5e5"),
          fillColor: row => (row === 0 ? "#f3f6f6" : null),
          paddingTop: () => 5, paddingBottom: () => 5
        }
      },
      {
        columns: [
          { width: "*", text: "" },
          { width: 230, table: { widths: ["*", "auto"], body: [[
              { text: "Gesamtbetrag", bold: true, fontSize: 11 },
              { text: eur(total), bold: true, fontSize: 11, alignment: "right" }]] },
            layout: { hLineWidth: i => (i === 0 ? 1.5 : 0), vLineWidth: () => 0, hLineColor: () => accent, paddingTop: () => 6 } }
        ],
        margin: [0, 8, 0, 0]
      }
    ];
    if (f.Hinweis19) content.push({ text: f.Hinweis19, margin: [0, 14, 0, 0] });
    if (b.Notiz) content.push({ text: b.Notiz, margin: [0, 10, 0, 0] });
    if (zahl) content.push({ text: zahl, margin: [0, 10, 0, 0] });
    content.push({ text: "Mit freundlichen Grüßen", margin: [0, 18, 0, 0] });
    content.push({ text: f.Inhaber || f.Firma || "", margin: [0, 4, 0, 0] });

    const doc = {
      pageSize: "A4",
      pageMargins: [50, 45, 50, 80],
      info: { title: `${titel(b)} ${nr}`, author: f.Firma || "" },
      content, footer,
      defaultStyle: { fontSize: 9.5, lineHeight: 1.15 },
      styles: { th: { bold: true, fontSize: 8.5, color: "#333333" } }
    };
    if (b.Status === "Entwurf") doc.watermark = { text: "ENTWURF", color: "#999999", opacity: 0.12, bold: true };
    return doc;
  }

  const mk = (b, f) => root.pdfMake.createPdf(build(b, f));
  const blob = (b, f) => new Promise(r => mk(b, f).getBlob(r));
  const open = (b, f) => mk(b, f).open();

  root.EFPdf = { build, blob, open, titel, eur, dat, lineTotal };
})(typeof window !== "undefined" ? window : globalThis);
