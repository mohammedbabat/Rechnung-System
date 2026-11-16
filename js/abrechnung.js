// ============================================================
// Ein-Facher Rechnungen – Gehaltsabrechnung (PDF) im Browser auslesen
// Das PDF wird ausschließlich lokal im Browser gelesen (pdf.js) und nirgendwohin hochgeladen.
// Erkennt: monatliche Verdienstabrechnungen (u. a. Lohnarten-Kürzel BSL/LST/KGS/PGS/RGS/AGS, DATEV-ähnliche
// Bezeichnungen) und den Ausdruck der elektronischen Lohnsteuerbescheinigung (Jahreswerte).
// ============================================================
(function (root) {
  "use strict";

  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const MONATE = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
  const KLASSEN = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI" };

  // ---------- PDF -> Textzeilen ----------
  let ladeVersprechen = null;
  function ladePdfJs() {
    if (root.pdfjsLib) return Promise.resolve(root.pdfjsLib);
    if (!ladeVersprechen) {
      ladeVersprechen = new Promise((ok, fehler) => {
        const s = document.createElement("script");
        s.src = PDFJS;
        s.onload = () => { root.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; ok(root.pdfjsLib); };
        s.onerror = () => { ladeVersprechen = null; fehler(new Error("PDF-Leser konnte nicht geladen werden (Internetverbindung?)")); };
        document.head.appendChild(s);
      });
    }
    return ladeVersprechen;
  }

  // Textbausteine einer Seite zu Zeilen gruppieren (gleiche Höhe = gleiche Zeile)
  function zuZeilen(items) {
    const rows = [];
    items.forEach(it => {
      const s = String(it.str || "").trim();
      if (!s) return;
      const y = Math.round(it.transform[5]);
      let r = rows.find(r => Math.abs(r.y - y) <= 2);
      if (!r) rows.push(r = { y, teile: [] });
      r.teile.push({ x: it.transform[4], s });
    });
    return rows.sort((a, b) => b.y - a.y).map(r => r.teile.sort((a, b) => a.x - b.x).map(t => t.s).join("  "));
  }

  async function pdfZeilen(datei, pdfjs) {
    const lib = pdfjs || await ladePdfJs();
    const daten = new Uint8Array(datei instanceof ArrayBuffer ? datei : await datei.arrayBuffer());
    const doc = await lib.getDocument({ data: daten }).promise;
    const zeilen = [];
    for (let n = 1; n <= Math.min(doc.numPages, 6); n++) {
      const seite = await doc.getPage(n);
      zuZeilen((await seite.getTextContent()).items).forEach(z => zeilen.push(z));
    }
    return zeilen;
  }

  // ---------- Hilfen ----------
  // Beträge im deutschen Format (4.170,00 / -571,75); Prozentangaben werden vorher entfernt
  function betraege(zeile) {
    const ohneProzent = zeile.replace(/\d+(?:,\d+)?\s*%/g, " ");
    const m = ohneProzent.match(/-?\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)|-?\d+,\d{2}(?!\d)/g) || [];
    return m.map(s => Math.abs(Number(s.replace(/\./g, "").replace(",", "."))));
  }
  // Monatsbetrag = erste Zahl, Jahreswert = letzte Zahl (wenn mind. zwei Zahlen und Jahreswert ≥ Monat)
  function monatJahr(zeile) {
    const z = betraege(zeile);
    if (!z.length) return null;
    const m = z[0], j = z.length >= 2 && z[z.length - 1] >= m ? z[z.length - 1] : null;
    return { m, j };
  }
  function summe(treffer) {
    if (!treffer.length) return null;
    const m = treffer.reduce((a, t) => a + t.m, 0);
    const alleJahr = treffer.every(t => t.j != null);
    return { m: r2(m), j: alleJahr ? r2(treffer.reduce((a, t) => a + t.j, 0)) : null };
  }
  const r2 = n => Math.round(n * 100) / 100;
  const finde = (zeilen, muster, ausschluss) => zeilen.filter(z => muster.test(z) && !(ausschluss && ausschluss.test(z)));

  // ---------- Monatliche Verdienstabrechnung ----------
  function parseMonat(zeilen, text) {
    const out = { typ: "monat", erkannt: [], fehlt: [] };

    // Abrechnungsmonat
    let mm = /abrechnungs(?:monat|zeitraum)[^\n]*?(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+(\d{4})/i.exec(text)
      || /(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+(\d{4})/i.exec(text);
    if (mm) { out.monat = MONATE.indexOf(mm[1].toLowerCase().replace("maerz", "märz")) + 1; out.jahr = Number(mm[2]); }
    else {
      const mz = /(?:abrechnungs(?:monat|zeitraum)|monat|zeitraum)\s*:?\s*(\d{1,2})[./](\d{4})/i.exec(text);
      if (mz) { out.monat = Number(mz[1]); out.jahr = Number(mz[2]); }
    }

    // Steuerklasse, Kinderfreibeträge, Kirchensteuer
    const sk = /steuerklasse\s*:?\s*([1-6])\b/i.exec(text) || /st(?:euer)?kl(?:asse)?\.?\s*:?\s*([1-6])\b/i.exec(text);
    const skr = sk ? null : /steuerklasse\s*:?\s*(VI|IV|V|III|II|I)\b/.exec(text);
    if (sk) out.stkl = KLASSEN[sk[1]]; else if (skr) out.stkl = skr[1];
    const kf = /kinderfreibetr[\wäöüß]*\s*:?\s*(\d+(?:,\d+)?)/i.exec(text);
    if (kf) out.kinderfreibetrag = Number(kf[1].replace(",", "."));
    if (/nicht\s+kirchensteuerpflichtig|konfession\s*:?\s*(--|-|keine|ohne|vd)(?=\s|$)/im.test(text)) out.kist = "keine";

    // Steuerbrutto (laufend + Einmalbezüge)
    const sb = finde(zeilen, /^BS[LE]\b|steuer-?\s?brutto|steuerpflichtige?r?\s+brutto|steuerpfl\.\s*brutto/i, /kranken|renten|pflege|arbeitslos|sv-|frei/i).map(monatJahr).filter(Boolean);
    const brutto = summe(sb);
    if (brutto) { out.bm = brutto.m; out.bj = brutto.j; }

    // Lohnsteuer inkl. Soli und Kirchensteuer
    const sumSt = finde(zeilen, /^LGS\b|summe\s+steuer|steuerabzüge\s+gesamt|steuerrechtliche\s+abzüge|summe\s+steuern/i).map(monatJahr).filter(Boolean);
    let st = sumSt.length ? summe(sumSt.slice(0, 1)) : null;
    if (!st) {
      const einzel = finde(zeilen, /^(LST|SOL|KIS|KST)\b|lohnsteuer|solidarit|kirchensteuer/i,
        /brutto|frei|klasse|pflichtig|elstam|merkmal|tabelle|tage/i).map(monatJahr).filter(Boolean);
      st = summe(einzel);
    }
    if (st) { out.lm = st.m; out.lj = st.j; }

    // Sozialversicherung Arbeitnehmeranteil
    const sumSv = finde(zeilen, /summe\s+(kranken|pflege|renten|arbeitslosen)\w*\s+an\b|^(KGS|PGS|RGS|AGS)\b/i).map(monatJahr).filter(Boolean);
    let sv = sumSv.length ? summe(sumSv) : null;
    if (!sv) {
      const ges = finde(zeilen, /sv-?\s?abzüge\s+gesamt|summe\s+sozialversicherung|sozialversicherungsbeitr\w*\s+(an|gesamt)|gesetzliche\s+abzüge\s+sv/i).map(monatJahr).filter(Boolean);
      if (ges.length) sv = summe(ges.slice(0, 1));
    }
    if (!sv) {
      const einzel = finde(zeilen, /^(KAN|KZA|PAN|RAN|AAN|KV|RV|AV|PV)\b|kranken\s?vers|pflege\s?vers|renten\s?vers|arbeitslosen\s?vers|kv-beitrag|rv-beitrag|av-beitrag|pv-beitrag/i,
        /brutto|kasse\s*:|elterneigenschaft|kinderlos|gruppe|tage|ag-anteil|arbeitgeber|umlage|zuschuss/i).map(monatJahr).filter(Boolean);
      sv = summe(einzel);
    }
    if (sv) { out.sm = sv.m; out.sj = sv.j; }

    // Fehlende Jahreswerte: aus Monatsbetrag × Monat schätzen (mit Hinweis)
    const monat = out.monat || null;
    [["bm", "bj", "Steuerbrutto"], ["lm", "lj", "Lohnsteuer"], ["sm", "sj", "Sozialversicherung"]].forEach(([m, j, name]) => {
      if (out[m] == null) out.fehlt.push(name);
      else if (out[j] == null && monat) { out[j] = r2(out[m] * monat); out.fehlt.push(`${name}: Jahreswert fehlt – geschätzt als Monatsbetrag × ${monat}`); }
    });
    if (!out.monat) out.fehlt.push("Abrechnungsmonat");
    if (!out.stkl) out.fehlt.push("Steuerklasse");
    return out;
  }

  // ---------- Ausdruck der elektronischen Lohnsteuerbescheinigung ----------
  function parseJahr(zeilen, text) {
    const out = { typ: "jahr", monat: 12, erkannt: [], fehlt: [] };
    const jahr = /lohnsteuerbescheinigung\s+(?:für\s+)?(\d{4})/i.exec(text) || /(\d{4})\s*$/m.exec(text);
    if (jahr) out.jahr = Number(jahr[1]);
    const letzte = muster => { const z = finde(zeilen, muster); for (const l of z) { const b = betraege(l); if (b.length) return b[b.length - 1]; } return null; };
    const sk = /steuerklasse\s*:?\s*([1-6])\b/i.exec(text);
    if (sk) out.stkl = KLASSEN[sk[1]];
    const brutto = letzte(/^\s*3\.?\s|bruttoarbeitslohn/i);
    const lst = letzte(/^\s*4\.?\s|einbehaltene\s+lohnsteuer/i) || 0;
    const soli = letzte(/^\s*5\.?\s|einbehaltener\s+solidarit/i) || 0;
    const kist = letzte(/^\s*6\.?\s|einbehaltene\s+kirchensteuer\s+des\s+arbeitnehmers/i) || 0;
    const rv = letzte(/^\s*23\s?a\)?|arbeitnehmeranteil\s+zur\s+gesetzlichen\s+rentenvers|arbeitnehmeranteil.*rentenvers/i) || 0;
    const kv = letzte(/^\s*25\.?\s|arbeitnehmerbeiträge\s+zur\s+gesetzlichen\s+krankenvers/i) || 0;
    const pv = letzte(/^\s*26\.?\s|arbeitnehmerbeiträge\s+zur\s+sozialen\s+pflegevers/i) || 0;
    const av = letzte(/^\s*27\.?\s|arbeitnehmerbeiträge\s+zur\s+arbeitslosenvers/i) || 0;
    if (brutto != null) { out.bj = brutto; out.bm = 0; } else out.fehlt.push("Bruttoarbeitslohn (Zeile 3)");
    out.lj = r2(lst + soli + kist); out.lm = 0;
    if (!lst) out.fehlt.push("Lohnsteuer (Zeile 4)");
    out.sj = r2(rv + kv + pv + av); out.sm = 0;
    if (!(rv + kv + pv + av)) out.fehlt.push("Sozialversicherung (Zeilen 23–27)");
    return out;
  }

  function parse(zeilen) {
    const text = zeilen.join("\n");
    const res = /lohnsteuerbescheinigung/i.test(text) && /bruttoarbeitslohn/i.test(text) ? parseJahr(zeilen, text) : parseMonat(zeilen, text);
    res.textGefunden = text.replace(/\s/g, "").length > 50;
    return res;
  }

  async function lese(datei, pdfjs) {
    const zeilen = await pdfZeilen(datei, pdfjs);
    return parse(zeilen);
  }

  root.EFAbrechnung = { lese, parse, pdfZeilen, zuZeilen, betraege, MONATE };
})(typeof window !== "undefined" ? window : globalThis);
