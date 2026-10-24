// ============================================================
// Ein-Facher Rechnungen – Oberfläche und Geschäftslogik
// ============================================================
(function () {
  "use strict";
  const G = window.EFGraph, P = window.EFPdf, C = window.EF_CONFIG;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const eur = P.eur, deDate = P.dat;
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + (Number(n) || 0)); return d.toISOString().slice(0, 10); };
  const safeJson = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (_) { return d; } };
  const sum = pos => Math.round(pos.reduce((a, p) => a + P.lineTotal(p), 0) * 100) / 100;
  const sumOf = list => list.reduce((a, b) => a + (Number(b.Summe) || 0), 0);
  const byTitle = (a, b) => String(a.Title || "").localeCompare(String(b.Title || ""), "de");
  const byDateDesc = (a, b) => String(b.Datum || "").localeCompare(String(a.Datum || "")) || String(b.Title || "").localeCompare(String(a.Title || ""));
  const clone = o => JSON.parse(JSON.stringify(o));

  const FIRMA_DEFAULT = {
    Firma: "Ein-Facher", Inhaber: "", Strasse: "", PLZ: "", Ort: "", Telefon: "", Email: "rechnung@ein-facher.de", Web: "www.ein-facher.de",
    Steuernummer: "", UstId: "", Bank: "", IBAN: "", BIC: "",
    Zahlungsziel: 14, AngebotGueltig: 30, Umsatzgrenze: 25000, Farbe: "#0F766E",
    Hinweis19: "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
    MailBetreff: "{typ} {nr} – {firma}",
    MailText: "Guten Tag,\n\nanbei erhalten Sie {dokument} vom {datum} über {summe}.\n{hinweis}\n\nBei Fragen melden Sie sich gerne.\n\nMit freundlichen Grüßen\n{inhaber}\n{firma}"
  };

  const S = { kunden: [], artikel: [], belege: [], firma: Object.assign({}, FIRMA_DEFAULT), firmaItemId: null, setupNeeded: false };

  // ---------- UI-Helfer ----------
  const view = html => { $("#view").innerHTML = html; window.scrollTo(0, 0); };
  let toastT;
  function toast(msg, kind = "ok") {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show " + kind;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.className = "toast"; }, kind === "err" ? 8000 : 3000);
  }
  async function busy(fn) {
    document.body.classList.add("busy");
    try { return await fn(); }
    catch (e) { console.error(e); toast(e.message || String(e), "err"); return undefined; }
    finally { document.body.classList.remove("busy"); }
  }
  function modal(html) { $("#modalBox").innerHTML = html; $("#modal").classList.remove("hidden"); }
  function closeModal() { $("#modal").classList.add("hidden"); $("#modalBox").innerHTML = ""; }
  const btn = (act, label, kind) => `<button type="button" class="btn ${kind}" data-act="${act}">${esc(label)}</button>`;

  function fieldsHtml(fields, values) {
    return fields.map(f => `
      <label class="${f.wide ? "wide" : ""}">${esc(f.label)}${f.req ? " *" : ""}
        ${f.type === "textarea"
          ? `<textarea name="${f.k}" rows="${f.rows || 3}">${esc(values[f.k])}</textarea>`
          : `<input name="${f.k}" type="${f.type || "text"}" ${f.step ? `step="${f.step}"` : ""} value="${esc(values[f.k])}" ${f.req ? "required" : ""}>`}
      </label>`).join("");
  }
  function readFields(form, fields) {
    const d = {};
    fields.forEach(f => {
      const v = form.elements[f.k].value.trim();
      d[f.k] = f.type === "number" ? (v === "" ? null : Number(v)) : v;
    });
    return d;
  }
  function formModal({ title, fields, values = {}, onSave, onDelete }) {
    modal(`<h2>${esc(title)}</h2><form id="mf" class="grid">${fieldsHtml(fields, values)}
      <div class="actions wide">${onDelete ? `<button type="button" class="btn danger" id="mfDel">Löschen</button>` : ""}<span class="grow"></span>
        <button type="button" class="btn ghost" id="mfCancel">Abbrechen</button><button class="btn primary">Speichern</button></div></form>`);
    $("#mfCancel").onclick = closeModal;
    if (onDelete) $("#mfDel").onclick = onDelete;
    $("#mf").onsubmit = e => { e.preventDefault(); onSave(readFields(e.target, fields)); };
  }

  function effStatus(b) {
    if (b.Typ === "Rechnung" && ["Offen", "Versendet"].includes(b.Status) && b.Faellig && b.Faellig < today()) return "Überfällig";
    return b.Status;
  }
  function statusBadge(b) {
    const s = effStatus(b);
    return `<span class="badge b-${s.toLowerCase().replace("ü", "ue")}">${esc(s)}</span>`;
  }

  // ---------- Daten ----------
  const parseBeleg = i => Object.assign({}, i, { Positionen: safeJson(i.Positionen, []), Kunde: safeJson(i.KundeJson, {}), Summe: Number(i.Summe) || 0 });

  async function loadAll() {
    try {
      const [k, a, b, e] = await Promise.all([G.items("Kunden"), G.items("Artikel"), G.items("Belege"), G.items("Einstellungen")]);
      S.kunden = k; S.artikel = a; S.belege = b.map(parseBeleg);
      const fi = e.find(x => x.Title === "firma");
      S.firmaItemId = fi ? fi.id : null;
      S.firma = Object.assign({}, FIRMA_DEFAULT, fi ? safeJson(fi.Wert, {}) : {});
      S.setupNeeded = false;
    } catch (err) {
      if (/itemNotFound|not found|does not exist/i.test(err.message)) S.setupNeeded = true;
      else throw err;
    }
  }
  async function reloadBelege() { S.belege = (await G.items("Belege")).map(parseBeleg); }

  function nextNr(prefix, year) {
    const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
    let max = 0;
    S.belege.forEach(b => { const m = re.exec(b.Title || ""); if (m) max = Math.max(max, Number(m[1])); });
    return `${prefix}-${year}-${String(max + 1).padStart(4, "0")}`;
  }
  function nextKundenNr() {
    let max = 0;
    S.kunden.forEach(k => { const m = /^K-(\d+)$/.exec(k.Kundennummer || ""); if (m) max = Math.max(max, Number(m[1])); });
    return "K-" + String(max + 1).padStart(4, "0");
  }
  const snap = k => ({ Title: k.Title, Kundennummer: k.Kundennummer || "", Ansprechpartner: k.Ansprechpartner || "", Strasse: k.Strasse || "",
    PLZ: k.PLZ || "", Ort: k.Ort || "", Land: k.Land || "", Email: k.Email || "" });

  function belegFields(d) {
    return {
      Title: d.Title || "Entwurf", Typ: d.Typ, Status: d.Status, KundeId: Number(d.KundeId) || 0, KundeJson: JSON.stringify(d.Kunde || {}),
      Datum: d.Datum || "", Faellig: d.Faellig || "", Leistungsdatum: d.Leistungsdatum || "", Positionen: JSON.stringify(d.Positionen || []),
      Summe: sum(d.Positionen || []), Notiz: d.Notiz || "", BezugNr: d.BezugNr || "", BezahltAm: d.BezahltAm || "",
      PdfUrl: d.PdfUrl || "", Versendet: d.Versendet || ""
    };
  }
  function upsertLocal(d) {
    const c = clone(d);
    c.Summe = sum(c.Positionen || []);
    const i = S.belege.findIndex(b => b.id === d.id);
    if (i >= 0) S.belege[i] = c; else S.belege.push(c);
  }

  // ---------- Übersicht ----------
  function kpi(label, value, sub, cls = "") {
    return `<div class="kpi ${cls}"><div class="l">${esc(label)}</div><div class="v">${esc(value)}</div><div class="s">${esc(sub)}</div></div>`;
  }
  function belegTable(list, showTyp) {
    if (!list.length) return `<p class="empty">Keine Einträge.</p>`;
    return `<div class="tblwrap"><table class="tbl"><thead><tr><th>Nummer</th>${showTyp ? "<th>Art</th>" : ""}<th>Datum</th><th>Kunde</th>
      <th class="r">Betrag</th><th>Fällig / gültig</th><th>Status</th></tr></thead><tbody>
      ${list.map(b => `<tr data-href="#/beleg/${b.id}"><td><a href="#/beleg/${b.id}">${esc(b.Title || "Entwurf")}</a></td>
        ${showTyp ? `<td>${esc(P.titel(b))}</td>` : ""}<td>${deDate(b.Datum)}</td><td>${esc((b.Kunde && b.Kunde.Title) || "–")}</td>
        <td class="r">${eur(b.Summe)}</td><td>${deDate(b.Faellig)}</td><td>${statusBadge(b)}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  function dashboard() {
    const y = today().slice(0, 4);
    const offen = S.belege.filter(b => b.Typ === "Rechnung" && ["Offen", "Versendet"].includes(b.Status));
    const ueber = offen.filter(b => effStatus(b) === "Überfällig");
    const umsatz = sumOf(S.belege.filter(b => (b.Typ === "Rechnung" || b.Typ === "Storno") && b.Status !== "Entwurf" && String(b.Datum || "").startsWith(y)));
    const eingang = sumOf(S.belege.filter(b => b.Typ === "Rechnung" && b.Status === "Bezahlt" && String(b.BezahltAm || "").startsWith(y)));
    const angOffen = S.belege.filter(b => b.Typ === "Angebot" && ["Offen", "Versendet"].includes(b.Status));
    const grenze = Number(S.firma.Umsatzgrenze) || 25000;
    const pct = Math.max(0, Math.min(100, umsatz / grenze * 100));
    view(`
      <div class="head"><h1>Übersicht</h1><span class="grow"></span>
        <a class="btn ghost" href="#/beleg/neu-Angebot">+ Angebot</a><a class="btn primary" href="#/beleg/neu-Rechnung">+ Rechnung</a></div>
      <div class="kpis">
        ${kpi("Offene Rechnungen", eur(sumOf(offen)), offen.length + " Stück")}
        ${kpi("Überfällig", eur(sumOf(ueber)), ueber.length + " Stück", ueber.length ? "warn" : "")}
        ${kpi("Zahlungseingang " + y, eur(eingang), "als bezahlt markiert")}
        ${kpi("Offene Angebote", eur(sumOf(angOffen)), angOffen.length + " Stück")}
      </div>
      <div class="card">
        <div class="row between"><h3>Umsatz ${y} – Kleinunternehmergrenze</h3><strong>${eur(umsatz)} / ${eur(grenze)}</strong></div>
        <div class="bar"><span style="width:${pct}%" class="${pct >= 90 ? "warn" : ""}"></span></div>
        <p class="small muted">Liegt der Gesamtumsatz eines Jahres über ${eur(grenze)}, entfällt die Kleinunternehmerregelung ab dem Folgejahr; wird im laufenden Jahr 100.000 € überschritten, sofort. Bitte mit Steuerberater abstimmen.</p>
      </div>
      <div class="card"><h3>Neueste Belege</h3>${belegTable(S.belege.slice().sort(byDateDesc).slice(0, 8), true)}</div>`);
  }

  // ---------- Belegliste ----------
  function belegListe(typ) {
    const isA = typ === "Angebot";
    const stati = isA ? ["Entwurf", "Offen", "Versendet", "Angenommen", "Abgelehnt"] : ["Entwurf", "Offen", "Versendet", "Überfällig", "Bezahlt", "Storniert"];
    view(`<div class="head"><h1>${isA ? "Angebote" : "Rechnungen"}</h1><span class="grow"></span>
      <input id="q" class="search" placeholder="Nummer oder Kunde …">
      <select id="fs"><option value="">Alle Status</option>${stati.map(s => `<option>${s}</option>`).join("")}</select>
      <a class="btn primary" href="#/beleg/neu-${typ}">+ ${isA ? "Angebot" : "Rechnung"}</a></div><div class="card" id="lst"></div>`);
    const draw = () => {
      const q = $("#q").value.toLowerCase(), fs = $("#fs").value;
      const list = S.belege.filter(b => (isA ? b.Typ === "Angebot" : b.Typ !== "Angebot"))
        .filter(b => !q || ((b.Title || "") + " " + ((b.Kunde && b.Kunde.Title) || "")).toLowerCase().includes(q))
        .filter(b => !fs || effStatus(b) === fs)
        .sort(byDateDesc);
      $("#lst").innerHTML = belegTable(list, !isA);
    };
    $("#q").oninput = draw; $("#fs").onchange = draw; draw();
  }

  // ---------- Kunden ----------
  const KUNDE_FIELDS = [
    { k: "Title", label: "Name / Firma", req: true, wide: true }, { k: "Kundennummer", label: "Kundennummer (leer = automatisch)" },
    { k: "Ansprechpartner", label: "Ansprechpartner" }, { k: "Strasse", label: "Straße und Hausnummer", wide: true },
    { k: "PLZ", label: "PLZ" }, { k: "Ort", label: "Ort" }, { k: "Land", label: "Land" },
    { k: "Email", label: "E-Mail (mehrere mit ; trennen)" }, { k: "Telefon", label: "Telefon" },
    { k: "Notiz", label: "Notiz (intern)", type: "textarea", wide: true }
  ];
  function kundeModal(k, after) {
    const isNew = !k;
    formModal({
      title: isNew ? "Neuer Kunde" : "Kunde bearbeiten", fields: KUNDE_FIELDS, values: k || { Land: "Deutschland" },
      onSave: d => busy(async () => {
        if (!d.Kundennummer) d.Kundennummer = (k && k.Kundennummer) || nextKundenNr();
        let saved;
        if (isNew) { saved = await G.create("Kunden", d); S.kunden.push(saved); }
        else { await G.update("Kunden", k.id, d); Object.assign(k, d); saved = k; }
        closeModal(); toast("Kunde gespeichert");
        if (after) after(saved); else route();
      }),
      onDelete: isNew ? null : () => {
        if (S.belege.some(b => String(b.KundeId) === String(k.id))) return toast("Der Kunde hat Belege und kann nicht gelöscht werden.", "err");
        if (!confirm(`Kunde „${k.Title}" wirklich löschen?`)) return;
        busy(async () => { await G.remove("Kunden", k.id); S.kunden = S.kunden.filter(x => x !== k); closeModal(); route(); });
      }
    });
  }
  function kundenView() {
    view(`<div class="head"><h1>Kunden</h1><span class="grow"></span><input id="q" class="search" placeholder="Suchen …">
      <button class="btn primary" id="neu">+ Neuer Kunde</button></div>
      <div class="card tblwrap"><table class="tbl"><thead><tr><th>Nr.</th><th>Name</th><th>Ort</th><th>E-Mail</th><th class="r">Umsatz</th></tr></thead><tbody id="tb"></tbody></table></div>`);
    const draw = () => {
      const q = $("#q").value.toLowerCase();
      $("#tb").innerHTML = S.kunden.filter(k => !q || [k.Title, k.Ort, k.Email, k.Kundennummer].join(" ").toLowerCase().includes(q)).sort(byTitle)
        .map(k => {
          const ums = sumOf(S.belege.filter(b => String(b.KundeId) === String(k.id) && b.Typ !== "Angebot" && b.Status !== "Entwurf"));
          return `<tr data-id="${k.id}"><td>${esc(k.Kundennummer)}</td><td><strong>${esc(k.Title)}</strong>${k.Ansprechpartner ? `<div class="small muted">${esc(k.Ansprechpartner)}</div>` : ""}</td>
            <td>${esc([k.PLZ, k.Ort].filter(Boolean).join(" "))}</td><td>${esc(k.Email)}</td><td class="r">${eur(ums)}</td></tr>`;
        }).join("") || `<tr><td colspan="5" class="empty">Noch keine Kunden.</td></tr>`;
    };
    $("#q").oninput = draw; draw();
    $("#tb").onclick = e => { const tr = e.target.closest("tr[data-id]"); if (tr) kundeModal(S.kunden.find(k => k.id === tr.dataset.id)); };
    $("#neu").onclick = () => kundeModal(null);
  }

  // ---------- Artikel ----------
  const ARTIKEL_FIELDS = [
    { k: "Title", label: "Bezeichnung", req: true, wide: true }, { k: "Artikelnummer", label: "Artikelnummer" },
    { k: "Einheit", label: "Einheit (Stk., Std., pausch.)" }, { k: "Preis", label: "Preis (€)", type: "number", step: "0.01", req: true },
    { k: "Beschreibung", label: "Beschreibung (erscheint auf dem Beleg)", type: "textarea", wide: true }
  ];
  function artikelModal(a) {
    const isNew = !a;
    formModal({
      title: isNew ? "Neuer Artikel" : "Artikel bearbeiten", fields: ARTIKEL_FIELDS, values: a || { Einheit: "Stk." },
      onSave: d => busy(async () => {
        if (isNew) S.artikel.push(await G.create("Artikel", d));
        else { await G.update("Artikel", a.id, d); Object.assign(a, d); }
        closeModal(); toast("Artikel gespeichert"); route();
      }),
      onDelete: isNew ? null : () => {
        if (!confirm(`Artikel „${a.Title}" löschen? Bestehende Belege bleiben unverändert.`)) return;
        busy(async () => { await G.remove("Artikel", a.id); S.artikel = S.artikel.filter(x => x !== a); closeModal(); route(); });
      }
    });
  }
  // CSV: Trennzeichen ; oder , automatisch, Anführungszeichen, UTF-8 mit/ohne BOM
  function parseCsv(text) {
    text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    const first = text.split("\n")[0];
    const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ";" : ",";
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
        else if (c === '"') q = false;
        else f += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(f); f = ""; }
      else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
      else f += c;
    }
    if (f !== "" || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim() !== ""));
  }
  const parsePreis = v => {
    let s = String(v || "").replace(/[€\s]/g, "");
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    return Math.round((parseFloat(s) || 0) * 100) / 100;
  };
  const csvCell = v => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

  function importArtikel(file) {
    const r = new FileReader();
    r.onload = () => {
      const rows = parseCsv(String(r.result));
      if (rows.length < 2) return toast("CSV ist leer.", "err");
      const head = rows[0].map(h => h.trim().toLowerCase());
      const col = names => head.findIndex(h => names.includes(h));
      const iNr = col(["artikelnummer", "art.-nr.", "nr"]), iTi = col(["bezeichnung", "title", "name"]),
            iEh = col(["einheit"]), iPr = col(["preis", "preis (€)", "price"]), iBe = col(["beschreibung", "description"]);
      if (iTi < 0 || iPr < 0) return toast("CSV braucht mindestens die Spalten Bezeichnung und Preis.", "err");
      const daten = rows.slice(1).map(c => ({
        Artikelnummer: iNr >= 0 ? (c[iNr] || "").trim() : "",
        Title: (c[iTi] || "").trim(),
        Einheit: iEh >= 0 ? (c[iEh] || "").trim() || "Stk." : "Stk.",
        Preis: parsePreis(c[iPr]),
        Beschreibung: iBe >= 0 ? (c[iBe] || "").trim() : ""
      })).filter(d => d.Title);
      const findEx = d => S.artikel.find(a => (d.Artikelnummer && a.Artikelnummer === d.Artikelnummer) || (!d.Artikelnummer && a.Title === d.Title));
      const neu = daten.filter(d => !findEx(d)).length;
      if (!confirm(`${daten.length} Artikel importieren?\n${neu} neu, ${daten.length - neu} werden aktualisiert (gleiche Artikelnummer).`)) return;
      busy(async () => {
        let n = 0;
        for (const d of daten) {
          const ex = findEx(d);
          if (ex) { await G.update("Artikel", ex.id, d); Object.assign(ex, d); }
          else S.artikel.push(await G.create("Artikel", d));
          n++;
          if (n % 5 === 0) toast(`Import … ${n}/${daten.length}`);
        }
        toast(`${n} Artikel importiert`); route();
      });
    };
    r.readAsText(file, "utf-8");
  }

  function exportArtikel() {
    const lines = [["Artikelnummer", "Bezeichnung", "Einheit", "Preis", "Beschreibung"].join(";")]
      .concat(S.artikel.slice().sort((a, b) => String(a.Artikelnummer || "").localeCompare(String(b.Artikelnummer || ""), "de", { numeric: true }))
        .map(a => [a.Artikelnummer, a.Title, a.Einheit, String(Number(a.Preis) || 0).replace(".", ","), a.Beschreibung].map(csvCell).join(";")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Artikel_${today()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function artikelView() {
    view(`<div class="head"><h1>Artikel &amp; Leistungen</h1><span class="grow"></span><input id="q" class="search" placeholder="Suchen …">
      <button class="btn ghost" id="imp">CSV importieren</button><button class="btn ghost" id="exp">CSV exportieren</button>
      <button class="btn primary" id="neu">+ Neuer Artikel</button><input type="file" id="impFile" accept=".csv,text/csv" class="hidden"></div>
      <div class="card tblwrap"><table class="tbl"><thead><tr><th>Art.-Nr.</th><th>Bezeichnung</th><th>Einheit</th><th class="r">Preis</th></tr></thead><tbody id="tb"></tbody></table></div>
      <p class="small muted">CSV-Spalten: Artikelnummer; Bezeichnung; Einheit; Preis; Beschreibung – gleiche Artikelnummer wird aktualisiert, neue werden angelegt.</p>`);
    const draw = () => {
      const q = $("#q").value.toLowerCase();
      $("#tb").innerHTML = S.artikel.filter(a => !q || [a.Title, a.Artikelnummer, a.Beschreibung].join(" ").toLowerCase().includes(q))
        .sort((a, b) => (!a.Artikelnummer - !b.Artikelnummer) || String(a.Artikelnummer || "").localeCompare(String(b.Artikelnummer || ""), "de", { numeric: true }) || byTitle(a, b))
        .map(a => `<tr data-id="${a.id}"><td>${esc(a.Artikelnummer)}</td><td><strong>${esc(a.Title)}</strong>${a.Beschreibung ? `<div class="small muted pre">${esc(a.Beschreibung)}</div>` : ""}</td>
          <td>${esc(a.Einheit)}</td><td class="r">${eur(a.Preis)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">Noch keine Artikel.</td></tr>`;
    };
    $("#q").oninput = draw; draw();
    $("#tb").onclick = e => { const tr = e.target.closest("tr[data-id]"); if (tr) artikelModal(S.artikel.find(a => a.id === tr.dataset.id)); };
    $("#neu").onclick = () => artikelModal(null);
    $("#imp").onclick = () => $("#impFile").click();
    $("#impFile").onchange = e => { const f = e.target.files[0]; if (f) importArtikel(f); e.target.value = ""; };
    $("#exp").onclick = exportArtikel;
  }

  // ---------- Beleg-Editor ----------
  let D = null;
  const newPos = () => ({ Bezeichnung: "", Beschreibung: "", Menge: 1, Einheit: "Stk.", Preis: 0 });
  const listHash = () => (D && D.Typ === "Angebot" ? "#/angebote" : "#/rechnungen");

  function belegEditor(param) {
    if (param && param.startsWith("neu-")) {
      const typ = param.slice(4) === "Angebot" ? "Angebot" : "Rechnung";
      D = { id: null, Typ: typ, Status: "Entwurf", Title: "", KundeId: "", Kunde: {}, Datum: today(),
        Faellig: addDays(today(), typ === "Angebot" ? S.firma.AngebotGueltig : S.firma.Zahlungsziel),
        Leistungsdatum: typ === "Angebot" ? "" : deDate(today()), Positionen: [newPos()], Notiz: "", BezugNr: "" };
    } else {
      const b = S.belege.find(x => x.id === param);
      if (!b) { view(`<div class="card">Beleg nicht gefunden. <a href="#/rechnungen">Zur Liste</a></div>`); return; }
      D = clone(b);
    }
    renderEditor();
  }

  function renderEditor() {
    const ro = D.Status !== "Entwurf";
    const dis = ro ? "disabled" : "";
    const isA = D.Typ === "Angebot";
    const kOpts = `<option value="">– Kunde wählen –</option>` + S.kunden.slice().sort(byTitle).map(k =>
      `<option value="${k.id}" ${String(k.id) === String(D.KundeId) ? "selected" : ""}>${esc(k.Title)}${k.Ort ? " – " + esc(k.Ort) : ""}</option>`).join("");
    const kundeSel = ro
      ? `<input value="${esc(D.Kunde.Title || "")}" disabled>`
      : `<div class="row"><select id="fKunde">${kOpts}</select><button class="btn ghost" id="kNeu" type="button" title="Neuer Kunde">+</button></div>`;
    const meta = [D.PdfUrl ? `<a href="${esc(D.PdfUrl)}" target="_blank" rel="noopener">PDF in SharePoint öffnen</a>` : "",
      D.Versendet ? "versendet am " + deDate(D.Versendet) : "", D.BezahltAm ? "bezahlt am " + deDate(D.BezahltAm) : ""].filter(Boolean).join(" · ");

    view(`
      <div class="head"><a href="${listHash()}" class="back" title="Zurück">←</a>
        <h1>${esc(P.titel(D))} ${D.Title ? esc(D.Title) : '<span class="muted">(Entwurf)</span>'}</h1>${statusBadge(D)}</div>
      <div class="card"><div class="grid g4">
        <label class="span2">Kunde *${kundeSel}</label>
        <label>${isA ? "Angebotsdatum" : "Rechnungsdatum"}<input type="date" id="fDatum" value="${esc(D.Datum)}" ${dis}></label>
        <label>${isA ? "Gültig bis" : D.Typ === "Storno" ? "Fällig am (optional)" : "Fällig am"}<input type="date" id="fFaellig" value="${esc(D.Faellig)}" ${dis}></label>
        ${isA ? "" : `<label class="span2">Leistungsdatum / -zeitraum *<input id="fLeist" value="${esc(D.Leistungsdatum)}" ${dis} placeholder="z. B. 24.10.2026 oder 01.–15.10.2026"></label>`}
        ${D.BezugNr ? `<label class="span2">Bezug<input value="${esc(D.BezugNr)}" disabled></label>` : ""}
      </div></div>
      <div class="card"><h3>Positionen</h3>
        <div class="tblwrap"><table class="tbl pos"><thead><tr><th>#</th><th>Bezeichnung</th><th class="r">Menge</th><th>Einheit</th>
          <th class="r">Einzelpreis</th><th class="r">Gesamt</th><th></th></tr></thead><tbody id="posBody"></tbody></table></div>
        ${ro ? "" : `<button class="btn ghost" id="posAdd" type="button">+ Position</button>`}
        <div class="total"><span>Gesamtbetrag</span><strong id="total"></strong></div>
        <div class="small muted">${esc(S.firma.Hinweis19)}</div>
      </div>
      <div class="card"><label>Anmerkung (erscheint auf dem PDF)<textarea id="fNotiz" rows="3" ${dis}>${esc(D.Notiz)}</textarea></label></div>
      <div class="card actions" id="acts"></div>
      ${meta ? `<p class="small muted">${meta}</p>` : ""}`);

    renderPos();
    renderActions();
    if (ro) return;

    $("#fDatum").onchange = e => { $("#fFaellig").value = addDays(e.target.value, isA ? S.firma.AngebotGueltig : S.firma.Zahlungsziel); };
    $("#kNeu").onclick = () => kundeModal(null, k => { readHead(); D.KundeId = k.id; D.Kunde = snap(k); renderEditor(); });
    $("#posAdd").onclick = () => { D.Positionen.push(newPos()); renderPos(); };
    const pb = $("#posBody");
    pb.oninput = e => {
      const tr = e.target.closest("tr[data-i]"), k = e.target.dataset.k;
      if (!tr || !k) return;
      const p = D.Positionen[Number(tr.dataset.i)];
      p[k] = (k === "Menge" || k === "Preis") ? (parseFloat(e.target.value) || 0) : e.target.value;
      tr.querySelector(".lt").textContent = eur(P.lineTotal(p));
      $("#total").textContent = eur(sum(D.Positionen));
    };
    pb.onchange = e => {
      if (!e.target.matches("[data-art]")) return;
      const a = S.artikel.find(x => x.id === e.target.value);
      if (!a) return;
      Object.assign(D.Positionen[Number(e.target.closest("tr").dataset.i)],
        { Bezeichnung: a.Title, Beschreibung: a.Beschreibung || "", Einheit: a.Einheit || "Stk.", Preis: Number(a.Preis) || 0 });
      renderPos();
    };
    pb.onclick = e => {
      if (!e.target.matches("[data-del]")) return;
      D.Positionen.splice(Number(e.target.closest("tr").dataset.i), 1);
      if (!D.Positionen.length) D.Positionen.push(newPos());
      renderPos();
    };
  }

  function renderPos() {
    const ro = D.Status !== "Entwurf";
    const aOpts = `<option value="">Artikel übernehmen …</option>` + S.artikel.slice().sort(byTitle)
      .map(a => `<option value="${a.id}">${esc(a.Title)} (${eur(a.Preis)})</option>`).join("");
    $("#posBody").innerHTML = D.Positionen.map((p, i) => ro
      ? `<tr><td>${i + 1}</td><td><strong>${esc(p.Bezeichnung)}</strong>${p.Beschreibung ? `<div class="muted small pre">${esc(p.Beschreibung)}</div>` : ""}</td>
          <td class="r">${esc(String(p.Menge).replace(".", ","))}</td><td>${esc(p.Einheit)}</td><td class="r">${eur(p.Preis)}</td><td class="r">${eur(P.lineTotal(p))}</td><td></td></tr>`
      : `<tr data-i="${i}"><td>${i + 1}</td>
          <td class="desc">${S.artikel.length ? `<select data-art>${aOpts}</select>` : ""}
            <input data-k="Bezeichnung" value="${esc(p.Bezeichnung)}" placeholder="Bezeichnung">
            <textarea data-k="Beschreibung" rows="1" placeholder="Beschreibung (optional)">${esc(p.Beschreibung)}</textarea></td>
          <td><input data-k="Menge" type="number" step="any" class="r num" value="${esc(p.Menge)}"></td>
          <td><input data-k="Einheit" class="unit" value="${esc(p.Einheit)}"></td>
          <td><input data-k="Preis" type="number" step="0.01" class="r num" value="${esc(p.Preis)}"></td>
          <td class="r lt">${eur(P.lineTotal(p))}</td>
          <td><button type="button" class="icon" data-del title="Position entfernen">✕</button></td></tr>`).join("");
    $("#total").textContent = eur(sum(D.Positionen));
  }

  function renderActions() {
    const a = [], s = D.Status, t = D.Typ;
    if (s === "Entwurf") {
      if (D.id) a.push(btn("del", "Entwurf löschen", "danger"));
      a.push('<span class="grow"></span>', btn("save", "Entwurf speichern", "ghost"), btn("preview", "PDF-Vorschau", "ghost"),
        btn("final", t === "Angebot" ? "Angebot festschreiben" : "Rechnung festschreiben", "primary"));
    } else {
      a.push(btn("pdf", "PDF ansehen", "ghost"), btn("store", "In SharePoint ablegen", "ghost"), btn("send", "Per E-Mail senden", "primary"));
      if (t === "Rechnung" && ["Offen", "Versendet"].includes(s)) a.push(btn("paid", "Als bezahlt markieren", "ok"));
      if (t === "Angebot" && ["Offen", "Versendet"].includes(s)) a.push(btn("accept", "Angenommen → Rechnung erstellen", "ok"), btn("reject", "Abgelehnt", "danger"));
      a.push('<span class="grow"></span>');
      if (t === "Rechnung" && s !== "Storniert") a.push(btn("storno", "Stornieren", "danger"));
    }
    $("#acts").innerHTML = a.join("");
    $("#acts").onclick = e => { const b = e.target.closest("[data-act]"); if (b && ACT[b.dataset.act]) ACT[b.dataset.act](); };
  }

  function readHead() {
    if (D.Status !== "Entwurf") return;
    D.KundeId = $("#fKunde").value;
    D.Datum = $("#fDatum").value;
    D.Faellig = $("#fFaellig").value;
    const l = $("#fLeist"); if (l) D.Leistungsdatum = l.value.trim();
    D.Notiz = $("#fNotiz").value;
    const k = S.kunden.find(x => String(x.id) === String(D.KundeId));
    D.Kunde = k ? snap(k) : {};
  }

  async function saveDraft() {
    const f = belegFields(D);
    if (D.id) await G.update("Belege", D.id, f);
    else { const r = await G.create("Belege", f); D.id = r.id; history.replaceState(null, "", "#/beleg/" + r.id); }
    upsertLocal(D);
  }

  function validate() {
    if (!D.KundeId) return "Bitte einen Kunden wählen.";
    if (!D.Datum) return "Bitte ein Datum angeben.";
    if (!D.Positionen.length || D.Positionen.some(p => !String(p.Bezeichnung || "").trim())) return "Jede Position braucht eine Bezeichnung.";
    if (D.Typ !== "Angebot" && !D.Leistungsdatum) return "Das Leistungsdatum ist Pflichtangabe auf Rechnungen.";
    if (!S.firma.Strasse || !S.firma.Ort) return "Bitte zuerst die Firmenanschrift unter Einstellungen hinterlegen.";
    return null;
  }

  async function festschreiben() {
    readHead();
    const err = validate();
    if (err) return toast(err, "err");
    if (D.Typ !== "Angebot" && !S.firma.Steuernummer && !S.firma.UstId &&
      !confirm("Achtung: Steuernummer bzw. USt-IdNr. fehlt in den Einstellungen – sie ist Pflichtangabe auf Rechnungen (§ 14 UStG). Trotzdem festschreiben?")) return;
    if (!confirm("Beleg jetzt festschreiben? Er erhält eine fortlaufende Nummer und kann danach nicht mehr geändert werden.")) return;
    busy(async () => {
      await reloadBelege();
      D.Title = nextNr(D.Typ === "Angebot" ? "AN" : "RE", D.Datum.slice(0, 4));
      D.Status = "Offen";
      await saveDraft();
      toast(`${D.Title} festgeschrieben`);
      renderEditor();
    });
  }

  const safeName = s => String(s || "Ohne Kunde").replace(/[\\/:*?"<>|#%~&{}]/g, "_").replace(/\.+$/, "").trim() || "Ohne Kunde";
  const pdfName = d => `${P.titel(d)}_${d.Title}_${d.Datum}.pdf`;
  const blobToB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });

  async function storePdf() {
    const blob = await P.blob(D, S.firma);
    const item = await G.uploadPdf(safeName(D.Kunde.Title), pdfName(D), blob);
    D.PdfUrl = item.webUrl;
    await G.update("Belege", D.id, { PdfUrl: D.PdfUrl });
    upsertLocal(D);
    return blob;
  }

  function fill(tpl) {
    const dokument = { Angebot: "unser Angebot", Rechnung: "unsere Rechnung", Storno: "unsere Stornorechnung" }[D.Typ] + " " + D.Title;
    const hinweis = D.Typ === "Rechnung" ? `Bitte überweisen Sie den Betrag bis zum ${deDate(D.Faellig)} unter Angabe der Rechnungsnummer.`
      : D.Typ === "Angebot" ? `Das Angebot ist gültig bis zum ${deDate(D.Faellig)}.` : "";
    const map = { nr: D.Title, typ: P.titel(D), dokument, hinweis, summe: eur(sum(D.Positionen)), faellig: deDate(D.Faellig),
      datum: deDate(D.Datum), kunde: D.Kunde.Title || "", firma: S.firma.Firma || "", inhaber: S.firma.Inhaber || "" };
    return String(tpl || "").replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m)).replace(/\n{3,}/g, "\n\n");
  }

  function sendDialog() {
    modal(`<h2>${esc(P.titel(D))} ${esc(D.Title)} senden</h2><form id="sf" class="grid">
      <label class="wide">An<input name="to" value="${esc(D.Kunde.Email)}" required placeholder="kunde@beispiel.de"></label>
      <label class="wide">Betreff<input name="sub" value="${esc(fill(S.firma.MailBetreff))}" required></label>
      <label class="wide">Nachricht<textarea name="txt" rows="10">${esc(fill(S.firma.MailText))}</textarea></label>
      <p class="wide small muted">Absender: ${esc(C.mailFrom || "dein Postfach")} · Anhang: ${esc(pdfName(D))} · Das PDF wird zusätzlich in SharePoint abgelegt.</p>
      <div class="actions wide"><span class="grow"></span><button type="button" class="btn ghost" id="sfC">Abbrechen</button><button class="btn primary">Jetzt senden</button></div></form>`);
    $("#sfC").onclick = closeModal;
    $("#sf").onsubmit = e => {
      e.preventDefault();
      const f = e.target.elements, to = f.to.value, subject = f.sub.value, txt = f.txt.value;
      busy(async () => {
        const blob = await storePdf();
        await G.sendMail({ to, subject, html: esc(txt).replace(/\n/g, "<br>"), attachments: [{ name: pdfName(D), type: "application/pdf", base64: await blobToB64(blob) }] });
        const upd = { Versendet: today() };
        if (D.Status === "Offen") upd.Status = "Versendet";
        await G.update("Belege", D.id, upd);
        Object.assign(D, upd); upsertLocal(D);
        closeModal(); toast("E-Mail gesendet an " + to); renderEditor();
      });
    };
  }

  function paidDialog() {
    modal(`<h2>Zahlungseingang ${esc(D.Title)}</h2><form id="pf" class="grid">
      <label class="wide">Bezahlt am<input type="date" name="d" value="${today()}" required></label>
      <div class="actions wide"><span class="grow"></span><button type="button" class="btn ghost" id="pfC">Abbrechen</button><button class="btn primary">Speichern</button></div></form>`);
    $("#pfC").onclick = closeModal;
    $("#pf").onsubmit = e => {
      e.preventDefault();
      const d = e.target.elements.d.value;
      busy(async () => {
        await G.update("Belege", D.id, { Status: "Bezahlt", BezahltAm: d });
        Object.assign(D, { Status: "Bezahlt", BezahltAm: d }); upsertLocal(D);
        closeModal(); toast("Als bezahlt markiert"); renderEditor();
      });
    };
  }

  async function setStatus(s) { await G.update("Belege", D.id, { Status: s }); D.Status = s; upsertLocal(D); }

  function stornieren() {
    if (!confirm(`Rechnung ${D.Title} stornieren? Es wird eine Stornorechnung mit eigener Nummer erstellt.`)) return;
    busy(async () => {
      await reloadBelege();
      const orig = D;
      const st = { Typ: "Storno", Status: "Offen", Title: nextNr("RE", today().slice(0, 4)), KundeId: orig.KundeId, Kunde: orig.Kunde,
        Datum: today(), Faellig: "", Leistungsdatum: orig.Leistungsdatum,
        Positionen: orig.Positionen.map(p => Object.assign({}, p, { Menge: -Number(p.Menge) })),
        Notiz: `Stornierung der Rechnung ${orig.Title} vom ${deDate(orig.Datum)}.`, BezugNr: orig.Title };
      const r = await G.create("Belege", belegFields(st));
      st.id = r.id; upsertLocal(st);
      await G.update("Belege", orig.id, { Status: "Storniert" });
      orig.Status = "Storniert"; upsertLocal(orig);
      toast(`Stornorechnung ${st.Title} erstellt`);
      location.hash = "#/beleg/" + st.id;
    });
  }

  function angebotAngenommen() {
    busy(async () => {
      const an = D;
      const re = { Typ: "Rechnung", Status: "Entwurf", Title: "", KundeId: an.KundeId, Kunde: an.Kunde, Datum: today(),
        Faellig: addDays(today(), S.firma.Zahlungsziel), Leistungsdatum: deDate(today()), Positionen: clone(an.Positionen),
        Notiz: "", BezugNr: an.Title };
      const r = await G.create("Belege", belegFields(re));
      re.id = r.id; upsertLocal(re);
      await G.update("Belege", an.id, { Status: "Angenommen" });
      an.Status = "Angenommen"; upsertLocal(an);
      toast("Rechnungsentwurf aus Angebot erstellt – bitte prüfen und festschreiben");
      location.hash = "#/beleg/" + re.id;
    });
  }

  const ACT = {
    save: () => busy(async () => { readHead(); await saveDraft(); toast("Entwurf gespeichert"); renderEditor(); }),
    preview: () => { readHead(); P.open(D, S.firma); },
    pdf: () => P.open(D, S.firma),
    del: () => {
      if (!confirm("Entwurf wirklich löschen?")) return;
      busy(async () => { await G.remove("Belege", D.id); S.belege = S.belege.filter(b => b.id !== D.id); location.hash = listHash(); });
    },
    final: festschreiben,
    store: () => busy(async () => { await storePdf(); toast("PDF in SharePoint abgelegt"); renderEditor(); }),
    send: sendDialog,
    paid: paidDialog,
    storno: stornieren,
    accept: angebotAngenommen,
    reject: () => { if (confirm("Angebot als abgelehnt markieren?")) busy(async () => { await setStatus("Abgelehnt"); renderEditor(); }); }
  };

  // ---------- Einstellungen ----------
  const FIRMA_FIELDS = [
    { k: "Firma", label: "Firmenname", req: true }, { k: "Inhaber", label: "Inhaber" },
    { k: "Strasse", label: "Straße und Hausnummer", wide: true }, { k: "PLZ", label: "PLZ" }, { k: "Ort", label: "Ort" },
    { k: "Telefon", label: "Telefon" }, { k: "Email", label: "E-Mail" }, { k: "Web", label: "Website" },
    { k: "Steuernummer", label: "Steuernummer" }, { k: "UstId", label: "USt-IdNr. (falls vorhanden)" },
    { k: "Bank", label: "Bank" }, { k: "IBAN", label: "IBAN" }, { k: "BIC", label: "BIC" },
    { k: "Zahlungsziel", label: "Zahlungsziel (Tage)", type: "number" }, { k: "AngebotGueltig", label: "Angebote gültig (Tage)", type: "number" },
    { k: "Umsatzgrenze", label: "Kleinunternehmer-Grenze Vorjahr (€)", type: "number" }, { k: "Farbe", label: "Akzentfarbe im PDF", type: "color" },
    { k: "Hinweis19", label: "Hinweis Kleinunternehmer (auf jedem Beleg)", wide: true },
    { k: "MailBetreff", label: "E-Mail-Betreff", wide: true },
    { k: "MailText", label: "E-Mail-Text – Platzhalter: {dokument} {nr} {typ} {datum} {summe} {faellig} {hinweis} {kunde} {firma} {inhaber}", type: "textarea", rows: 9, wide: true }
  ];

  function einstellungen() {
    view(`<div class="head"><h1>Einstellungen</h1></div>
      ${S.setupNeeded ? `<div class="card" style="border-color:#F5C26B;background:#FFFBEB"><strong>Erster Start:</strong> Die SharePoint-Listen fehlen noch. Klicke unten auf „Listen einrichten".</div>` : ""}
      <div class="card"><h3>SharePoint-Verbindung</h3>
        <p class="small muted">Site: <strong>${esc(C.siteHostname + C.sitePath)}</strong> · Listen: ${esc(C.listPrefix)}Kunden, ${esc(C.listPrefix)}Artikel, ${esc(C.listPrefix)}Belege, ${esc(C.listPrefix)}Einstellungen · PDF-Ordner: ${esc(C.pdfFolder)}</p>
        <button class="btn ghost" id="setup">Listen einrichten / prüfen</button>
        <div class="log" id="log" style="margin-top:12px">Bereit.</div></div>
      <div class="card"><h3>Firmendaten &amp; Vorlagen</h3>
        <form id="ff" class="grid">${fieldsHtml(FIRMA_FIELDS, S.firma)}
          <div class="actions wide"><span class="grow"></span><button class="btn primary" ${S.setupNeeded ? "disabled" : ""}>Speichern</button></div></form></div>`);
    $("#setup").onclick = () => {
      const log = $("#log"); log.textContent = "";
      const w = m => { log.textContent += m + "\n"; };
      busy(async () => {
        try { await G.ensureLists(w); }
        catch (e) { w("FEHLER: " + e.message); throw e; }
        await loadAll(); toast("SharePoint-Listen sind bereit"); einstellungen();
        $("#log").textContent = "Listen eingerichtet. Jetzt Firmendaten ausfüllen und speichern.";
      });
    };
    $("#ff").onsubmit = e => {
      e.preventDefault();
      const d = Object.assign({}, S.firma, readFields(e.target, FIRMA_FIELDS));
      busy(async () => {
        const fields = { Title: "firma", Wert: JSON.stringify(d) };
        if (S.firmaItemId) await G.update("Einstellungen", S.firmaItemId, fields);
        else S.firmaItemId = (await G.create("Einstellungen", fields)).id;
        S.firma = d; toast("Einstellungen gespeichert");
      });
    };
  }

  // ---------- Router ----------
  const R = { dashboard, rechnungen: () => belegListe("Rechnung"), angebote: () => belegListe("Angebot"),
    kunden: kundenView, artikel: artikelView, einstellungen, beleg: belegEditor };

  function route() {
    if (S.setupNeeded && !location.hash.startsWith("#/einstellungen")) { location.hash = "#/einstellungen"; return; }
    const parts = (location.hash || "#/dashboard").split("/");
    const r = R[parts[1]] ? parts[1] : "dashboard";
    document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === r));
    closeModal();
    R[r](parts[2]);
  }

  // Ganze Tabellenzeile anklickbar
  document.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-href]");
    if (tr && !e.target.closest("a,button,input,select,textarea")) location.hash = tr.dataset.href;
  });

  async function start() {
    if (!C.clientId || /^0{8}-/.test(C.clientId)) {
      $("#login").classList.remove("hidden");
      $("#loginBtn").classList.add("hidden");
      $("#loginMsg").textContent = "Bitte zuerst clientId, tenantId und SharePoint-Site in js/config.js eintragen (siehe README).";
      return;
    }
    try {
      const acc = await G.init();
      if (!acc) {
        $("#login").classList.remove("hidden");
        $("#loginBtn").onclick = () => G.login();
        return;
      }
      $("#shell").classList.remove("hidden");
      $("#userName").textContent = acc.name || acc.username;
      $("#logoutBtn").onclick = () => G.logout();
      $("#modal").onclick = e => { if (e.target.id === "modal") closeModal(); };
      await busy(loadAll);
      window.addEventListener("hashchange", route);
      route();
    } catch (e) {
      console.error(e);
      $("#login").classList.remove("hidden");
      $("#loginBtn").onclick = () => G.login();
      $("#loginMsg").textContent = e.message;
    }
  }

  window.EFApp = { S, route, _test: { nextNr, fill: t => fill(t), setD: d => { D = d; } } };
  start();
})();
