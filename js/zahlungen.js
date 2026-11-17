// ============================================================
// Ein-Facher Rechnungen – Zahlungen
// 1) GiroCode (EPC-QR) für Überweisungen – Kunde scannt mit der Banking-App
// 2) Kontoauszug-CSV einlesen und Zahlungseingänge den offenen Rechnungen zuordnen
// Die CSV wird nur im Browser gelesen und nirgends gespeichert.
// ============================================================
(function (root) {
  "use strict";

  // ---------- GiroCode / EPC-QR (EPC069-12, Version 002, UTF-8) ----------
  const ibanNorm = s => String(s || "").replace(/\s+/g, "").toUpperCase();
  function ibanGueltig(iban) {
    const s = ibanNorm(iban);
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
    let m = 0;
    for (const ch of r) m = (m * 10 + Number(ch)) % 97;
    return m === 1;
  }
  function epcPayload({ name, iban, bic, betrag, zweck }) {
    const b = Math.round(Number(betrag || 0) * 100) / 100;
    if (!ibanGueltig(iban) || !(b > 0) || b > 999999999.99) return null;
    const clean = (s, n) => String(s || "").replace(/[\r\n]+/g, " ").trim().slice(0, n);
    return ["BCD", "002", "1", "SCT", clean(bic, 11).replace(/\s/g, ""), clean(name, 70), ibanNorm(iban),
      "EUR" + b.toFixed(2), "", "", clean(zweck, 140)].join("\n");
  }
  const ibanSchoen = iban => ibanNorm(iban).replace(/(.{4})/g, "$1 ").trim();

  // ---------- CSV lesen ----------
  function dekodieren(buffer) {
    const u8 = new Uint8Array(buffer);
    let txt = new TextDecoder("utf-8").decode(u8);
    if (txt.includes("�")) txt = new TextDecoder("windows-1252").decode(u8);
    return txt.replace(/^﻿/, "");
  }

  function csvZeilen(txt) {
    const kopf = txt.split(/\r?\n/).slice(0, 40).join("\n");
    const zaehl = c => (kopf.match(new RegExp(c === "\t" ? "\\t" : "\\" + c, "g")) || []).length;
    const sep = [";", "\t", ","].sort((a, b) => zaehl(b) - zaehl(a))[0];
    const rows = []; let row = [], feld = "", inQ = false;
    for (let i = 0; i < txt.length; i++) {
      const c = txt[i];
      if (inQ) {
        if (c === '"') { if (txt[i + 1] === '"') { feld += '"'; i++; } else inQ = false; }
        else feld += c;
      } else if (c === '"') inQ = true;
      else if (c === sep) { row.push(feld); feld = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && txt[i + 1] === "\n") i++;
        row.push(feld); rows.push(row); row = []; feld = "";
      } else feld += c;
    }
    if (feld !== "" || row.length) { row.push(feld); rows.push(row); }
    return rows.map(r => r.map(x => x.trim())).filter(r => r.some(x => x !== ""));
  }

  function betragLesen(s) {
    let t = String(s || "").replace(/[€\s]|EUR/gi, "").replace(/−/g, "-");
    if (!t) return null;
    let neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    if (t.endsWith("-")) { neg = true; t = t.slice(0, -1); }
    if (t.startsWith("+")) t = t.slice(1);
    if (t.startsWith("-")) { neg = !neg; t = t.slice(1); }
    const k = t.lastIndexOf(","), p = t.lastIndexOf(".");
    if (k > -1 && p > -1) t = k > p ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
    else if (k > -1) t = t.replace(/\./g, "").replace(",", ".");
    else if (p > -1 && /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");   // 1.923 = Tausenderpunkt
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    return neg ? -n : n;
  }

  function datumLesen(s) {
    const t = String(s || "").trim();
    let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(t);
    if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
    m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
    if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return null;
  }

  const KOPF = {
    datum: [/^buchungstag$/i, /^buchungsdatum$/i, /^buchung$/i, /^datum$/i, /^booking date$/i, /^date$/i, /^valuta(datum)?$/i, /^wertstellung$/i, /^wertstellungsdatum$/i, /datum/i],
    betrag: [/^betrag( ?\((€|eur)\))?$/i, /^betrag/i, /^umsatz( in eur)?$/i, /^amount/i, /betrag/i],
    haben: [/^haben$/i, /^gutschrift/i, /^eingang/i],
    soll: [/^soll$/i, /^belastung/i, /^ausgang/i],
    sh: [/^soll\/haben$/i, /^s\/h$/i, /^kennung$/i],
    name: [/zahlungspflichtige|auftraggeber|beg(ü|ue)nstigter|empf(ä|ae)nger|^name|partner|payee|zahler|gegenkonto.*name/i],
    zweck: [/verwendungszweck|buchungstext|beschreibung|zweck|reference|referenz|vorgang|details|mitteilung/i]
  };
  const spalte = (kopf, liste, ausser = []) => {
    for (const re of liste) { const i = kopf.findIndex((h, j) => re.test(h) && !ausser.includes(j) && !/saldo|kontostand|balance/i.test(h)); if (i > -1) return i; }
    return -1;
  };

  // Liefert Zahlungseingänge: [{ datum, betrag, name, text }]
  function umsaetze(txt) {
    const rows = csvZeilen(txt);
    let k = -1, map = null;
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const h = rows[i];
      const d = spalte(h, KOPF.datum), b = spalte(h, KOPF.betrag), ha = spalte(h, KOPF.haben);
      if (d > -1 && (b > -1 || ha > -1)) {
        k = i;
        map = { d, b, ha, so: spalte(h, KOPF.soll, [b, ha]), sh: spalte(h, KOPF.sh), n: spalte(h, KOPF.name), z: spalte(h, KOPF.zweck) };
        break;
      }
    }
    if (k < 0) throw new Error("In der Datei wurde keine Kopfzeile mit Datum und Betrag gefunden. Bitte den Umsatz-Export als CSV aus dem Online-Banking verwenden.");
    const out = [];
    rows.slice(k + 1).forEach(r => {
      const datum = datumLesen(r[map.d]);
      if (!datum) return;
      let betrag = null;
      if (map.b > -1 && r[map.b] !== "") betrag = betragLesen(r[map.b]);
      if ((betrag === null || betrag === 0) && map.ha > -1) {
        const h = betragLesen(r[map.ha]), s = map.so > -1 ? betragLesen(r[map.so]) : null;
        betrag = h ? Math.abs(h) : s ? -Math.abs(s) : null;
      }
      if (betrag === null) return;
      if (map.sh > -1 && /^s$/i.test(r[map.sh] || "")) betrag = -Math.abs(betrag);
      if (map.sh > -1 && /^h$/i.test(r[map.sh] || "")) betrag = Math.abs(betrag);
      if (!(betrag > 0)) return;
      out.push({ datum, betrag: Math.round(betrag * 100) / 100, name: map.n > -1 ? r[map.n] : "",
        zweck: map.z > -1 ? r[map.z] : "", text: r.join(" ") });
    });
    return out;
  }

  // ---------- Zuordnen ----------
  const alnum = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  function nrGefunden(nr, text) {
    const t = alnum(text), n = alnum(nr);
    if (n.length < 5) return false;
    const varianten = [n];
    const m = /^(\D*?)(\d{4})(\d+)$/.exec(n);              // RE-2026-0001 auch als RE-2026-1 erkennen
    if (m) varianten.push(m[1] + m[2] + String(Number(m[3])));
    return varianten.some(v => new RegExp("(^|[^0-9])" + v + "(?![0-9])").test(t) || new RegExp(v + "(?![0-9])").test(t) && /^\D/.test(v));
  }
  const woerter = s => String(s || "").toUpperCase().split(/[^A-ZÄÖÜ0-9]+/).filter(w => w.length >= 4 && !/^(GMBH|MBH|TREUHAND|SERVICE|GESELLSCHAFT|HANDEL)$/.test(w));

  // offene: [{ id, nr, betrag, kunde }], bezahlt: [{ nr }] → Vorschläge
  function zuordnen(eingaenge, offene, bezahlt = []) {
    const vergeben = new Set(), ergebnis = [];
    const gleich = (a, b) => Math.abs(a - b) < 0.005;
    eingaenge.forEach((z, idx) => {
      const text = `${z.zweck} ${z.name} ${z.text}`;
      let treffer = offene.filter(o => !vergeben.has(o.id) && nrGefunden(o.nr, text));
      if (treffer.length) {
        const passt = treffer.find(o => gleich(o.betrag, z.betrag)) || treffer[0];
        vergeben.add(passt.id);
        ergebnis.push({ idx, z, beleg: passt, art: gleich(passt.betrag, z.betrag) ? "sicher" : "abweichend", diff: Math.round((z.betrag - passt.betrag) * 100) / 100 });
        return;
      }
      const schon = bezahlt.find(o => nrGefunden(o.nr, text));
      if (schon) { ergebnis.push({ idx, z, beleg: schon, art: "schonBezahlt" }); return; }
      const gleicherBetrag = offene.filter(o => !vergeben.has(o.id) && gleich(o.betrag, z.betrag));
      const mitName = gleicherBetrag.filter(o => woerter(o.kunde).some(w => alnum(text).includes(alnum(w))));
      const kandidat = mitName.length === 1 ? mitName[0] : null;
      if (kandidat) { vergeben.add(kandidat.id); ergebnis.push({ idx, z, beleg: kandidat, art: "vorschlag" }); }
    });
    return ergebnis;
  }

  root.EFZahlungen = { epcPayload, ibanGueltig, ibanSchoen, dekodieren, csvZeilen, umsaetze, betragLesen, datumLesen, zuordnen, nrGefunden };
})(window);
