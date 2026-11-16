// ============================================================
// Ein-Facher Rechnungen – Oberfläche und Geschäftslogik
// Mehrere Firmen (z. B. Ein-Facher und STL) mit getrennten Nummernkreisen
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
  const sumOf = list => list.reduce((a, b) => a + (Number(b.Summe) || 0), 0);
  const nettoOf = list => list.reduce((a, b) => a + P.totals(b).netto, 0);
  const byTitle = (a, b) => String(a.Title || "").localeCompare(String(b.Title || ""), "de");
  const byNr = (a, b) => (!a.Artikelnummer - !b.Artikelnummer) ||
    String(a.Artikelnummer || "").localeCompare(String(b.Artikelnummer || ""), "de", { numeric: true }) || byTitle(a, b);
  const byDateDesc = (a, b) => String(b.Datum || "").localeCompare(String(a.Datum || "")) || String(b.Title || "").localeCompare(String(a.Title || ""));
  const clone = o => JSON.parse(JSON.stringify(o));
  const enc = encodeURIComponent;
  const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const store = {
    get: k => { try { return window.localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { window.localStorage.setItem(k, v); } catch (_) { /* egal */ } }
  };

  // ---------- Firmen ----------
  const STEUER_KU = "Kleinunternehmer (§ 19 UStG)", STEUER_REG = "Regelbesteuert (mit USt)";
  const FIRMA_DEFAULT = {
    Firma: "Ein-Facher", Inhaber: "", Strasse: "", PLZ: "", Ort: "", Telefon: "", Email: "rechnung@ein-facher.de", Web: "www.ein-facher.de",
    Steuernummer: "", UstId: "", Bank: "", IBAN: "", BIC: "",
    Steuer: STEUER_KU, UstSatz: 19, Nummernpraefix: "",
    MailFrom: C.mailFrom || "", PdfOrdner: C.pdfFolder || "Rechnungen",
    Zahlungsziel: 14, AngebotGueltig: 30, Umsatzgrenze: 25000, Farbe: "#0F766E",
    Hinweis19: "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.",
    MailBetreff: "{typ} {nr} – {firma}",
    MailText: "Guten Tag,\n\nanbei erhalten Sie {dokument} vom {datum} über {summe}.\n{hinweis}\n\nBei Fragen melden Sie sich gerne.\n\nMit freundlichen Grüßen\n{inhaber}\n{firma}"
  };
  // Vorschlag beim Anlegen der Firma STL (Daten aus der Gewerbeanmeldung)
  const STL_VORSCHLAG = { key: "stl", Firma: "STL", Inhaber: "Aiman Masoud", Strasse: "Mendener Straße 40", PLZ: "53840", Ort: "Troisdorf" };
  const istKU = f => f.Steuer !== STEUER_REG;
  const ustOf = f => (istKU(f) ? 0 : (Number(f.UstSatz) || 0));
  const itemTitle = key => (key === "ef" ? "firma" : "firma:" + key);

  // ---------- Kategorien ----------
  const KATEGORIEN_DEFAULT = [
    "Support & Beratung", "Microsoft 365 & Cloud", "Automatisierung & Power Platform", "Entwicklung & WebApps",
    "On-Premises (AD, DHCP, Server)", "Arbeitsplatz & Netzwerk", "Migration & Backup"
  ];
  const OHNE_KAT = "Ohne Kategorie";

  // ---------- Status-Unterordner ----------
  const RE_STATI = [["alle", "Alle"], ["unbezahlt", "Unbezahlt"], ["entwurf", "Entwurf"], ["offen", "Offen"], ["versendet", "Versendet"],
    ["ueberfaellig", "Überfällig"], ["bezahlt", "Bezahlt"], ["storniert", "Storniert"]];
  const AN_STATI = [["alle", "Alle"], ["entwurf", "Entwurf"], ["offen", "Offen"], ["versendet", "Versendet"],
    ["angenommen", "Angenommen"], ["abgelehnt", "Abgelehnt"]];

  // ---------- Rollen ----------
  const RECHTE = [
    ["ansehen", "Alles ansehen, PDF öffnen"],
    ["bearbeiten", "Kunden, Artikel, Entwürfe anlegen und bearbeiten"],
    ["festschreiben", "Angebote/Rechnungen festschreiben"],
    ["senden", "Per E-Mail senden"],
    ["bezahlt", "Zahlungseingang buchen"],
    ["storno", "Rechnungen stornieren"],
    ["loeschen", "Kunden und Artikel löschen"],
    ["einstellungen", "Einstellungen und Firmendaten"],
    ["benutzer", "Benutzer und Berechtigungen verwalten"]
  ];
  const ROLLEN = {
    Administrator: RECHTE.map(r => r[0]),
    Mitarbeiter: ["ansehen", "bearbeiten", "festschreiben", "senden", "bezahlt"],
    Lesen: ["ansehen"]
  };

  const S = { kunden: [], artikel: [], belege: [], benutzer: [], firmen: [], fk: "ef", editFk: null,
    setupNeeded: false, schemaMissing: [], me: null, entraUsers: null, nav: { sec: "dashboard", sub: "" } };
  const can = p => !!S.me && (ROLLEN[S.me.Rolle] || []).includes(p);
  const firmaEntry = key => S.firmen.find(x => x.key === key) || S.firmen[0];
  const firmaOf = key => (firmaEntry(key) || { d: FIRMA_DEFAULT }).d;
  const cur = () => firmaOf(S.fk);

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

  function fieldsHtml(fields, values, readonly) {
    const dis = readonly ? "disabled" : "";
    return fields.map(f => {
      let input;
      if (f.type === "textarea") input = `<textarea name="${f.k}" rows="${f.rows || 3}" ${dis}>${esc(values[f.k])}</textarea>`;
      else if (f.options) input = `<select name="${f.k}" ${dis}>${f.options.map(o => `<option ${String(o) === String(values[f.k]) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      else {
        const list = f.dl ? `list="dl-${f.k}"` : "";
        input = `<input name="${f.k}" type="${f.type || "text"}" ${f.step ? `step="${f.step}"` : ""} ${f.pattern ? `pattern="${f.pattern}"` : ""} value="${esc(values[f.k])}" ${f.req ? "required" : ""} ${list} ${dis}>`;
        if (f.dl) input += `<datalist id="dl-${f.k}">${f.dl.map(o => `<option value="${esc(o)}">`).join("")}</datalist>`;
      }
      return `<label class="${f.wide ? "wide" : ""}">${esc(f.label)}${f.req ? " *" : ""}${input}</label>`;
    }).join("");
  }
  function readFields(form, fields) {
    const d = {};
    fields.forEach(f => {
      const v = form.elements[f.k].value.trim();
      d[f.k] = f.type === "number" ? (v === "" ? null : Number(v)) : v;
    });
    return d;
  }
  function formModal({ title, fields, values = {}, onSave, onDelete, readonly }) {
    modal(`<h2>${esc(title)}</h2><form id="mf" class="grid">${fieldsHtml(fields, values, readonly)}
      <div class="actions wide">${onDelete && !readonly ? `<button type="button" class="btn danger" id="mfDel">Löschen</button>` : ""}<span class="grow"></span>
        <button type="button" class="btn ghost" id="mfCancel">${readonly ? "Schließen" : "Abbrechen"}</button>
        ${readonly ? "" : `<button class="btn primary">Speichern</button>`}</div></form>`);
    $("#mfCancel").onclick = closeModal;
    if (onDelete && !readonly) $("#mfDel").onclick = onDelete;
    $("#mf").onsubmit = e => { e.preventDefault(); if (!readonly) onSave(readFields(e.target, fields)); };
  }

  // ---------- Status ----------
  function effStatus(b) {
    if (b.Typ === "Storno") return "Storno";
    if (b.Typ === "Rechnung" && ["Offen", "Versendet"].includes(b.Status) && b.Faellig && b.Faellig < today()) return "Überfällig";
    return b.Status;
  }
  function statusBadge(b) {
    const s = effStatus(b);
    const cls = s.toLowerCase().replace(/ü/g, "ue").replace(/ä/g, "ae").replace(/ö/g, "oe");
    return `<span class="badge b-${cls}">${esc(s)}</span>`;
  }
  const RE_FILTER = {
    alle: () => true,
    unbezahlt: b => b.Typ === "Rechnung" && ["Offen", "Versendet"].includes(b.Status),
    entwurf: b => b.Status === "Entwurf",
    offen: b => effStatus(b) === "Offen",
    versendet: b => effStatus(b) === "Versendet",
    ueberfaellig: b => effStatus(b) === "Überfällig",
    bezahlt: b => b.Status === "Bezahlt",
    storniert: b => b.Status === "Storniert" || b.Typ === "Storno"
  };
  const AN_FILTER = {
    alle: () => true,
    entwurf: b => b.Status === "Entwurf",
    offen: b => b.Status === "Offen",
    versendet: b => b.Status === "Versendet",
    angenommen: b => b.Status === "Angenommen",
    abgelehnt: b => b.Status === "Abgelehnt"
  };
  // Nur Belege der aktiven Firma
  const belege = () => S.belege.filter(b => b.Firma === S.fk);
  const rechnungen = () => belege().filter(b => b.Typ !== "Angebot");
  const angebote = () => belege().filter(b => b.Typ === "Angebot");

  // ---------- Kategorien ----------
  function katListe() {
    const used = [...new Set(S.artikel.map(a => String(a.Kategorie || "").trim()).filter(Boolean))];
    const pos = k => { const i = KATEGORIEN_DEFAULT.indexOf(k); return i < 0 ? 99 : i; };
    return used.sort((a, b) => pos(a) - pos(b) || a.localeCompare(b, "de"));
  }
  const katVorschlaege = () => [...new Set(KATEGORIEN_DEFAULT.concat(katListe()))];
  const katOf = a => String(a.Kategorie || "").trim() || OHNE_KAT;
  function artikelGruppen() {
    const out = katListe().map(k => [k, S.artikel.filter(a => katOf(a) === k).sort(byNr)]);
    const ohne = S.artikel.filter(a => katOf(a) === OHNE_KAT).sort(byNr);
    if (ohne.length) out.push([OHNE_KAT, ohne]);
    return out;
  }

  // ---------- Navigation mit Firmenwechsler und Unterordnern ----------
  function renderNav() {
    const { sec, sub } = S.nav;
    const link = (key, label) =>
      `<a href="#/${key}" class="${sec === key ? (sub ? "open" : "active") : ""}">${esc(label)}</a>`;
    const subLink = (base, key, label, n, warn) =>
      `<a class="sub ${sec === base && (sub || "alle") === key ? "active" : ""}" href="#/${base}/${key}">${esc(label)}<span class="cnt ${warn && n ? "warn" : ""}">${n}</span></a>`;

    let h = "";
    if (S.firmen.length > 1) {
      h += `<label class="firmasel">Firma<select id="firmaSel">${S.firmen.map(f =>
        `<option value="${esc(f.key)}" ${f.key === S.fk ? "selected" : ""}>${esc(f.d.Firma)}</option>`).join("")}</select></label>`;
    }
    h += link("dashboard", "Übersicht");

    const re = rechnungen();
    h += link("rechnungen", "Rechnungen");
    if (sec === "rechnungen") {
      h += `<div class="subnav">${RE_STATI.map(([k, l]) => subLink("rechnungen", k, l, re.filter(RE_FILTER[k]).length, k === "ueberfaellig")).join("")}</div>`;
    }

    const an = angebote();
    h += link("angebote", "Angebote");
    if (sec === "angebote") {
      h += `<div class="subnav">${AN_STATI.map(([k, l]) => subLink("angebote", k, l, an.filter(AN_FILTER[k]).length)).join("")}</div>`;
    }

    h += link("kunden", "Kunden");

    h += link("artikel", "Artikel");
    if (sec === "artikel") {
      let s = subLink("artikel", "alle", "Alle", S.artikel.length);
      artikelGruppen().forEach(([k, list]) => { s += subLink("artikel", k === OHNE_KAT ? "ohne" : enc(k), k, list.length); });
      h += `<div class="subnav">${s}</div>`;
    }

    if (can("einstellungen") || can("benutzer")) h += link("einstellungen", "Einstellungen");
    $("#nav").innerHTML = h;
    const sel = $("#firmaSel");
    if (sel) sel.onchange = e => wechsleFirma(e.target.value, true);
    const brandSmall = document.querySelector(".sidebar .brand small");
    if (brandSmall) brandSmall.textContent = cur().Firma || "Rechnungen";
  }
  function setNav(sec, sub) { S.nav = { sec, sub: sub || "" }; renderNav(); }

  function wechsleFirma(key, navigieren) {
    if (!S.firmen.some(f => f.key === key)) return;
    S.fk = key;
    store.set("ef_firma", key);
    if (!navigieren) return;
    if (location.hash.startsWith("#/beleg/")) location.hash = "#/" + (S.nav.sec || "rechnungen");
    else route();
    toast("Firma: " + cur().Firma);
  }

  // ---------- Daten ----------
  const parseBeleg = i => Object.assign({}, i, {
    Positionen: safeJson(i.Positionen, []), Kunde: safeJson(i.KundeJson, {}), Summe: Number(i.Summe) || 0,
    Firma: i.Firma || "ef", UstSatz: Number(i.UstSatz) || 0
  });

  function parseFirmen(einst) {
    const out = [];
    einst.forEach(x => {
      const t = String(x.Title || "");
      if (t === "firma") out.push({ key: "ef", itemId: x.id, d: Object.assign({}, FIRMA_DEFAULT, safeJson(x.Wert, {})) });
      else if (t.startsWith("firma:")) out.push({ key: t.slice(6), itemId: x.id, d: Object.assign({}, FIRMA_DEFAULT, { Hinweis19: FIRMA_DEFAULT.Hinweis19 }, safeJson(x.Wert, {})) });
    });
    if (!out.some(f => f.key === "ef")) out.unshift({ key: "ef", itemId: null, d: Object.assign({}, FIRMA_DEFAULT) });
    out.sort((a, b) => (a.key === "ef" ? -1 : b.key === "ef" ? 1 : String(a.d.Firma).localeCompare(String(b.d.Firma), "de")));
    return out;
  }

  async function loadAll() {
    try {
      const [k, a, b, e, u, missing] = await Promise.all([G.items("Kunden"), G.items("Artikel"), G.items("Belege"),
        G.items("Einstellungen"), G.items("Benutzer"), G.checkSchema()]);
      S.kunden = k; S.artikel = a; S.belege = b.map(parseBeleg); S.benutzer = u;
      S.firmen = parseFirmen(e);
      const gemerkt = store.get("ef_firma");
      S.fk = S.firmen.some(f => f.key === gemerkt) ? gemerkt : (S.firmen.some(f => f.key === S.fk) ? S.fk : "ef");
      S.schemaMissing = missing || [];
      S.setupNeeded = false;
    } catch (err) {
      if (/itemNotFound|not found|does not exist/i.test(err.message)) {
        S.setupNeeded = true;
        if (!S.firmen.length) S.firmen = parseFirmen([]);
      } else throw err;
    }
  }
  async function reloadBelege() { S.belege = (await G.items("Belege")).map(parseBeleg); }

  // Eigene Rolle bestimmen; erster Benutzer wird automatisch Administrator
  async function resolveMe() {
    const acc = G.account();
    const oid = acc.localAccountId || (acc.idTokenClaims && acc.idTokenClaims.oid) || "";
    const upn = String(acc.username || "").toLowerCase();
    if (S.setupNeeded) { S.me = { Rolle: "Administrator", Name: acc.name || upn, bootstrap: true }; return true; }
    if (!S.benutzer.length) {
      const item = await G.create("Benutzer", { Title: upn, Name: acc.name || upn, EntraId: oid, Rolle: "Administrator", Aktiv: "Ja" });
      S.benutzer.push(item);
      S.me = item;
      toast("Du wurdest als erster Administrator eingetragen");
      return true;
    }
    S.me = S.benutzer.find(b => (b.EntraId && b.EntraId === oid) || String(b.Title || "").toLowerCase() === upn) || null;
    if (!S.me || S.me.Aktiv === "Nein") { S.me = null; return false; }
    return true;
  }
  function showUser() {
    $("#userName").textContent = (S.me && S.me.Name) || (G.account() && G.account().name) || "";
    $("#userRole").textContent = S.me ? S.me.Rolle : "";
  }
  function noAccess() {
    $("#nav").innerHTML = "";
    view(`<div class="card noaccess"><h2>Kein Zugriff</h2>
      <p>Dein Konto <strong>${esc(G.account().username)}</strong> ist für die Rechnungs-App nicht freigeschaltet.</p>
      <p class="muted">Bitte einen Administrator, dich unter <em>Einstellungen → Benutzer &amp; Berechtigungen</em> hinzuzufügen.</p></div>`);
  }
  function updateNoetig() {
    $("#nav").innerHTML = "";
    view(`<div class="card noaccess"><h2>Update ausstehend</h2>
      <p>Die App wurde aktualisiert. Ein Administrator muss einmal unter <em>Einstellungen</em> auf „Listen einrichten / prüfen" klicken.</p></div>`);
  }

  // Nummernkreis je Firma: Präfix "" -> RE-2026-0001, Präfix "STL" -> STL-RE-2026-0001
  function nextNr(art, year, firmaKey) {
    const pfx = String(firmaOf(firmaKey).Nummernpraefix || "").trim();
    const base = (pfx ? pfx + "-" : "") + art;
    const re = new RegExp(`^${reEsc(base)}-${year}-(\\d+)$`);
    let max = 0;
    S.belege.forEach(b => { const m = re.exec(b.Title || ""); if (m) max = Math.max(max, Number(m[1])); });
    return `${base}-${year}-${String(max + 1).padStart(4, "0")}`;
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
      Summe: P.totals(d).brutto, Notiz: d.Notiz || "", BezugNr: d.BezugNr || "", BezahltAm: d.BezahltAm || "",
      PdfUrl: d.PdfUrl || "", Versendet: d.Versendet || "", Firma: d.Firma || "ef", UstSatz: Number(d.UstSatz) || 0
    };
  }
  function upsertLocal(d) {
    const c = clone(d);
    c.Summe = P.totals(c).brutto;
    const i = S.belege.findIndex(b => b.id === d.id);
    if (i >= 0) S.belege[i] = c; else S.belege.push(c);
  }

  // ---------- Übersicht ----------
  function kpi(label, value, sub, cls = "", href = "") {
    const inner = `<div class="l">${esc(label)}</div><div class="v">${esc(value)}</div><div class="s">${esc(sub)}</div>`;
    return href ? `<a class="kpi ${cls}" href="${href}">${inner}</a>` : `<div class="kpi ${cls}">${inner}</div>`;
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
    const f = cur(), y = today().slice(0, 4);
    const offen = rechnungen().filter(RE_FILTER.unbezahlt);
    const ueber = rechnungen().filter(RE_FILTER.ueberfaellig);
    const umsatzNetto = nettoOf(belege().filter(b => (b.Typ === "Rechnung" || b.Typ === "Storno") && b.Status !== "Entwurf" && String(b.Datum || "").startsWith(y)));
    const eingang = sumOf(belege().filter(b => b.Typ === "Rechnung" && b.Status === "Bezahlt" && String(b.BezahltAm || "").startsWith(y)));
    const angOffen = angebote().filter(b => ["Offen", "Versendet"].includes(b.Status));
    const grenze = Number(f.Umsatzgrenze) || 25000;
    const pct = Math.max(0, Math.min(100, umsatzNetto / grenze * 100));
    const umsatzCard = istKU(f)
      ? `<div class="card">
          <div class="row between"><h3>Umsatz ${y} – Kleinunternehmergrenze</h3><strong>${eur(umsatzNetto)} / ${eur(grenze)}</strong></div>
          <div class="bar"><span style="width:${pct}%" class="${pct >= 90 ? "warn" : ""}"></span></div>
          <p class="small muted">Liegt der Gesamtumsatz des Inhabers über ${eur(grenze)}, entfällt die Kleinunternehmerregelung ab dem Folgejahr; wird im laufenden Jahr 100.000 € überschritten, sofort. Es zählt der Umsatz aller Tätigkeiten des Inhabers, nicht nur dieser App. Bitte mit Steuerberater abstimmen.</p>
        </div>`
      : `<div class="card"><div class="row between"><h3>Umsatz ${y} (netto)</h3><strong>${eur(umsatzNetto)}</strong></div>
          <p class="small muted">Regelbesteuert: Umsatzsteuer wird mit ${esc(f.UstSatz)} % ausgewiesen und ist an das Finanzamt abzuführen.</p></div>`;
    view(`
      <div class="head"><h1>Übersicht <span class="muted">· ${esc(f.Firma)}</span></h1><span class="grow"></span>
        ${can("bearbeiten") ? `<a class="btn ghost" href="#/beleg/neu-Angebot">+ Angebot</a><a class="btn primary" href="#/beleg/neu-Rechnung">+ Rechnung</a>` : ""}</div>
      <div class="kpis">
        ${kpi("Unbezahlte Rechnungen", eur(sumOf(offen)), offen.length + " Stück", "", "#/rechnungen/unbezahlt")}
        ${kpi("Überfällig", eur(sumOf(ueber)), ueber.length + " Stück", ueber.length ? "warn" : "", "#/rechnungen/ueberfaellig")}
        ${kpi("Zahlungseingang " + y, eur(eingang), "als bezahlt markiert", "", "#/rechnungen/bezahlt")}
        ${kpi("Offene Angebote", eur(sumOf(angOffen)), angOffen.length + " Stück", "", "#/angebote/versendet")}
      </div>
      ${umsatzCard}
      <div class="card"><h3>Neueste Belege</h3>${belegTable(belege().sort(byDateDesc).slice(0, 8), true)}</div>`);
    setNav("dashboard");
  }

  // ---------- Belegliste mit Status-Unterordnern ----------
  function belegListe(typ, sub) {
    const isA = typ === "Angebot";
    const defs = isA ? AN_STATI : RE_STATI, F = isA ? AN_FILTER : RE_FILTER, base = isA ? "angebote" : "rechnungen";
    if (!F[sub]) sub = "alle";
    const label = defs.find(d => d[0] === sub)[1];
    view(`<div class="head"><h1>${isA ? "Angebote" : "Rechnungen"}${sub !== "alle" ? ` <span class="muted">· ${esc(label)}</span>` : ""}</h1><span class="grow"></span>
      <input id="q" class="search" placeholder="Nummer oder Kunde …">
      ${can("bearbeiten") ? `<a class="btn primary" href="#/beleg/neu-${typ}">+ ${isA ? "Angebot" : "Rechnung"}</a>` : ""}</div>
      <div class="tabs">${defs.map(([k, l]) => `<a href="#/${base}/${k}" class="${k === sub ? "active" : ""}">${esc(l)}</a>`).join("")}</div>
      <div class="card" id="lst"></div><div class="small muted sumline" id="sumline"></div>`);
    const draw = () => {
      const q = $("#q").value.toLowerCase();
      const list = belege().filter(b => (isA ? b.Typ === "Angebot" : b.Typ !== "Angebot")).filter(F[sub])
        .filter(b => !q || ((b.Title || "") + " " + ((b.Kunde && b.Kunde.Title) || "")).toLowerCase().includes(q))
        .sort(byDateDesc);
      $("#lst").innerHTML = belegTable(list, !isA);
      $("#sumline").textContent = list.length ? `${list.length} ${list.length === 1 ? "Beleg" : "Belege"} · Summe ${eur(sumOf(list))}` : "";
    };
    $("#q").oninput = draw; draw();
    setNav(base, sub === "alle" ? "" : sub);
  }

  // ---------- Kunden (für alle Firmen gemeinsam) ----------
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
      title: isNew ? "Neuer Kunde" : (can("bearbeiten") ? "Kunde bearbeiten" : "Kunde"), fields: KUNDE_FIELDS, values: k || { Land: "Deutschland" },
      readonly: !can("bearbeiten"),
      onSave: d => busy(async () => {
        if (!d.Kundennummer) d.Kundennummer = (k && k.Kundennummer) || nextKundenNr();
        let saved;
        if (isNew) { saved = await G.create("Kunden", d); S.kunden.push(saved); }
        else { await G.update("Kunden", k.id, d); Object.assign(k, d); saved = k; }
        closeModal(); toast("Kunde gespeichert");
        if (after) after(saved); else route();
      }),
      onDelete: isNew || !can("loeschen") ? null : () => {
        if (S.belege.some(b => String(b.KundeId) === String(k.id))) return toast("Der Kunde hat Belege und kann nicht gelöscht werden.", "err");
        if (!confirm(`Kunde „${k.Title}" wirklich löschen?`)) return;
        busy(async () => { await G.remove("Kunden", k.id); S.kunden = S.kunden.filter(x => x !== k); closeModal(); route(); });
      }
    });
  }
  function kundenView() {
    view(`<div class="head"><h1>Kunden</h1><span class="grow"></span><input id="q" class="search" placeholder="Suchen …">
      ${can("bearbeiten") ? `<button class="btn primary" id="neu">+ Neuer Kunde</button>` : ""}</div>
      <div class="card tblwrap"><table class="tbl"><thead><tr><th>Nr.</th><th>Name</th><th>Ort</th><th>E-Mail</th><th class="r">Umsatz ${esc(cur().Firma)}</th></tr></thead><tbody id="tb"></tbody></table></div>
      <p class="small muted">Kunden und Artikel gelten für alle Firmen gemeinsam.</p>`);
    const draw = () => {
      const q = $("#q").value.toLowerCase();
      $("#tb").innerHTML = S.kunden.filter(k => !q || [k.Title, k.Ort, k.Email, k.Kundennummer].join(" ").toLowerCase().includes(q)).sort(byTitle)
        .map(k => {
          const ums = sumOf(belege().filter(b => String(b.KundeId) === String(k.id) && b.Typ !== "Angebot" && b.Status !== "Entwurf"));
          return `<tr data-id="${k.id}"><td>${esc(k.Kundennummer)}</td><td><strong>${esc(k.Title)}</strong>${k.Ansprechpartner ? `<div class="small muted">${esc(k.Ansprechpartner)}</div>` : ""}</td>
            <td>${esc([k.PLZ, k.Ort].filter(Boolean).join(" "))}</td><td>${esc(k.Email)}</td><td class="r">${eur(ums)}</td></tr>`;
        }).join("") || `<tr><td colspan="5" class="empty">Noch keine Kunden.</td></tr>`;
    };
    $("#q").oninput = draw; draw();
    $("#tb").onclick = e => { const tr = e.target.closest("tr[data-id]"); if (tr) kundeModal(S.kunden.find(k => k.id === tr.dataset.id)); };
    if ($("#neu")) $("#neu").onclick = () => kundeModal(null);
    setNav("kunden");
  }

  // ---------- Artikel mit Kategorien ----------
  const artikelFields = () => [
    { k: "Title", label: "Bezeichnung", req: true, wide: true }, { k: "Artikelnummer", label: "Artikelnummer" },
    { k: "Kategorie", label: "Kategorie (Auswahl oder neu eintippen)", dl: katVorschlaege() },
    { k: "Einheit", label: "Einheit (Stk., Std., pausch., Monat)" }, { k: "Preis", label: "Preis (€, netto)", type: "number", step: "0.01", req: true },
    { k: "Beschreibung", label: "Beschreibung (erscheint auf dem Beleg)", type: "textarea", wide: true }
  ];
  function artikelModal(a, defaultKat) {
    const isNew = !a;
    formModal({
      title: isNew ? "Neuer Artikel" : (can("bearbeiten") ? "Artikel bearbeiten" : "Artikel"), fields: artikelFields(),
      values: a || { Einheit: "Stk.", Kategorie: defaultKat || "" }, readonly: !can("bearbeiten"),
      onSave: d => busy(async () => {
        if (isNew) S.artikel.push(await G.create("Artikel", d));
        else { await G.update("Artikel", a.id, d); Object.assign(a, d); }
        closeModal(); toast("Artikel gespeichert"); route();
      }),
      onDelete: isNew || !can("loeschen") ? null : () => {
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
      const iNr = col(["artikelnummer", "art.-nr.", "nr"]), iTi = col(["bezeichnung", "title", "name"]), iKa = col(["kategorie", "category"]),
            iEh = col(["einheit"]), iPr = col(["preis", "preis (€)", "price"]), iBe = col(["beschreibung", "description"]);
      if (iTi < 0 || iPr < 0) return toast("CSV braucht mindestens die Spalten Bezeichnung und Preis.", "err");
      const daten = rows.slice(1).map(c => {
        const d = {
          Artikelnummer: iNr >= 0 ? (c[iNr] || "").trim() : "",
          Title: (c[iTi] || "").trim(),
          Einheit: iEh >= 0 ? (c[iEh] || "").trim() || "Stk." : "Stk.",
          Preis: parsePreis(c[iPr]),
          Beschreibung: iBe >= 0 ? (c[iBe] || "").trim() : ""
        };
        if (iKa >= 0) d.Kategorie = (c[iKa] || "").trim();
        return d;
      }).filter(d => d.Title);
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
    const lines = [["Artikelnummer", "Kategorie", "Bezeichnung", "Einheit", "Preis", "Beschreibung"].join(";")]
      .concat(S.artikel.slice().sort(byNr)
        .map(a => [a.Artikelnummer, a.Kategorie, a.Title, a.Einheit, String(Number(a.Preis) || 0).replace(".", ","), a.Beschreibung].map(csvCell).join(";")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Artikel_${today()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function artikelView(sub) {
    const kats = katListe();
    let kat = null, subKey = "";
    if (sub === "ohne") { kat = OHNE_KAT; subKey = "ohne"; }
    else if (sub && sub !== "alle" && kats.includes(sub)) { kat = sub; subKey = enc(sub); }
    view(`<div class="head"><h1>Artikel${kat ? ` <span class="muted">· ${esc(kat)}</span>` : " &amp; Leistungen"}</h1><span class="grow"></span>
      <input id="q" class="search" placeholder="Suchen …">
      ${can("bearbeiten") ? `<button class="btn ghost" id="imp">CSV importieren</button>` : ""}
      <button class="btn ghost" id="exp">CSV exportieren</button>
      ${can("bearbeiten") ? `<button class="btn primary" id="neu">+ Neuer Artikel</button><input type="file" id="impFile" accept=".csv,text/csv" class="hidden">` : ""}</div>
      <div class="tabs"><a href="#/artikel" class="${kat ? "" : "active"}">Alle</a>${artikelGruppen().map(([k]) =>
        `<a href="#/artikel/${k === OHNE_KAT ? "ohne" : enc(k)}" class="${k === kat ? "active" : ""}">${esc(k)}</a>`).join("")}</div>
      <div class="card tblwrap"><table class="tbl"><thead><tr><th>Art.-Nr.</th><th>Bezeichnung</th>${kat ? "" : "<th>Kategorie</th>"}<th>Einheit</th><th class="r">Preis netto</th></tr></thead><tbody id="tb"></tbody></table></div>
      ${can("bearbeiten") ? `<p class="small muted">CSV-Spalten: Artikelnummer; Kategorie; Bezeichnung; Einheit; Preis; Beschreibung – gleiche Artikelnummer wird aktualisiert, neue werden angelegt. Preise sind Nettopreise; bei Kleinunternehmern ist netto = Endpreis.</p>` : ""}`);
    const draw = () => {
      const q = $("#q").value.toLowerCase();
      $("#tb").innerHTML = S.artikel.filter(a => !kat || katOf(a) === kat)
        .filter(a => !q || [a.Title, a.Artikelnummer, a.Beschreibung, a.Kategorie].join(" ").toLowerCase().includes(q))
        .sort(byNr)
        .map(a => `<tr data-id="${a.id}"><td>${esc(a.Artikelnummer)}</td><td><strong>${esc(a.Title)}</strong>${a.Beschreibung ? `<div class="small muted pre">${esc(a.Beschreibung)}</div>` : ""}</td>
          ${kat ? "" : `<td class="small">${esc(a.Kategorie || "–")}</td>`}<td>${esc(a.Einheit)}</td><td class="r">${eur(a.Preis)}</td></tr>`).join("")
        || `<tr><td colspan="${kat ? 4 : 5}" class="empty">Keine Artikel.</td></tr>`;
    };
    $("#q").oninput = draw; draw();
    $("#tb").onclick = e => { const tr = e.target.closest("tr[data-id]"); if (tr) artikelModal(S.artikel.find(a => a.id === tr.dataset.id)); };
    if ($("#neu")) {
      $("#neu").onclick = () => artikelModal(null, kat && kat !== OHNE_KAT ? kat : "");
      $("#imp").onclick = () => $("#impFile").click();
      $("#impFile").onchange = e => { const f = e.target.files[0]; if (f) importArtikel(f); e.target.value = ""; };
    }
    $("#exp").onclick = exportArtikel;
    setNav("artikel", subKey);
  }

  // ---------- Beleg-Editor ----------
  let D = null;
  const newPos = () => ({ Bezeichnung: "", Beschreibung: "", Menge: 1, Einheit: "Stk.", Preis: 0 });
  const listHash = () => (D && D.Typ === "Angebot" ? "#/angebote" : "#/rechnungen");
  const FD = () => firmaOf(D.Firma);

  function belegEditor(param) {
    if (param && param.startsWith("neu-")) {
      if (!can("bearbeiten")) { location.hash = "#/dashboard"; return; }
      const typ = param.slice(4) === "Angebot" ? "Angebot" : "Rechnung";
      const f = cur();
      D = { id: null, Firma: S.fk, UstSatz: ustOf(f), Typ: typ, Status: "Entwurf", Title: "", KundeId: "", Kunde: {}, Datum: today(),
        Faellig: addDays(today(), typ === "Angebot" ? f.AngebotGueltig : f.Zahlungsziel),
        Leistungsdatum: typ === "Angebot" ? "" : deDate(today()), Positionen: [newPos()], Notiz: "", BezugNr: "" };
    } else {
      const b = S.belege.find(x => x.id === param);
      if (!b) { view(`<div class="card">Beleg nicht gefunden. <a href="#/rechnungen">Zur Liste</a></div>`); return; }
      D = clone(b);
      if (D.Firma !== S.fk) wechsleFirma(D.Firma, false);
      if (D.Status === "Entwurf") D.UstSatz = ustOf(FD());
    }
    renderEditor();
  }

  function renderEditor() {
    const ro = D.Status !== "Entwurf" || !can("bearbeiten");
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
        <h1>${esc(P.titel(D))} ${D.Title ? esc(D.Title) : '<span class="muted">(Entwurf)</span>'}</h1>${statusBadge(D)}
        <span class="badge firma-badge">${esc(FD().Firma)}</span></div>
      <div class="card"><div class="grid g4">
        <label class="span2">Kunde *${kundeSel}</label>
        <label>${isA ? "Angebotsdatum" : "Rechnungsdatum"}<input type="date" id="fDatum" value="${esc(D.Datum)}" ${dis}></label>
        <label>${isA ? "Gültig bis" : D.Typ === "Storno" ? "Fällig am (optional)" : "Fällig am"}<input type="date" id="fFaellig" value="${esc(D.Faellig)}" ${dis}></label>
        ${isA ? "" : `<label class="span2">Leistungsdatum / -zeitraum *<input id="fLeist" value="${esc(D.Leistungsdatum)}" ${dis} placeholder="z. B. 24.10.2026 oder 01.–15.10.2026"></label>`}
        ${D.BezugNr ? `<label class="span2">Bezug<input value="${esc(D.BezugNr)}" disabled></label>` : ""}
      </div></div>
      <div class="card"><h3>Positionen</h3>
        <div class="tblwrap"><table class="tbl pos"><thead><tr><th>#</th><th>Bezeichnung</th><th class="r">Menge</th><th>Einheit</th>
          <th class="r">Einzelpreis${D.UstSatz ? " netto" : ""}</th><th class="r">Gesamt${D.UstSatz ? " netto" : ""}</th><th></th></tr></thead><tbody id="posBody"></tbody></table></div>
        ${ro ? "" : `<button class="btn ghost" id="posAdd" type="button">+ Position</button>`}
        <div id="totals"></div>
      </div>
      <div class="card"><label>Anmerkung (erscheint auf dem PDF)<textarea id="fNotiz" rows="3" ${dis}>${esc(D.Notiz)}</textarea></label></div>
      <div class="card actions" id="acts"></div>
      ${meta ? `<p class="small muted">${meta}</p>` : ""}`);

    renderPos();
    renderActions();
    setNav(isA ? "angebote" : "rechnungen", "");
    if (ro) return;

    $("#fDatum").onchange = e => { $("#fFaellig").value = addDays(e.target.value, isA ? FD().AngebotGueltig : FD().Zahlungsziel); };
    $("#kNeu").onclick = () => kundeModal(null, k => { readHead(); D.KundeId = k.id; D.Kunde = snap(k); renderEditor(); });
    $("#posAdd").onclick = () => { D.Positionen.push(newPos()); renderPos(); };
    const pb = $("#posBody");
    pb.oninput = e => {
      const tr = e.target.closest("tr[data-i]"), k = e.target.dataset.k;
      if (!tr || !k) return;
      const p = D.Positionen[Number(tr.dataset.i)];
      p[k] = (k === "Menge" || k === "Preis") ? (parseFloat(e.target.value) || 0) : e.target.value;
      tr.querySelector(".lt").textContent = eur(P.lineTotal(p));
      renderTotals();
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

  function renderTotals() {
    const t = P.totals(D);
    $("#totals").innerHTML = t.satz
      ? `<div class="total sub"><span>Nettobetrag</span><span id="tNetto">${eur(t.netto)}</span></div>
         <div class="total sub"><span>zzgl. ${esc(String(t.satz).replace(".", ","))} % USt</span><span id="tUst">${eur(t.ust)}</span></div>
         <div class="total"><span>Gesamtbetrag</span><strong id="total">${eur(t.brutto)}</strong></div>`
      : `<div class="total"><span>Gesamtbetrag</span><strong id="total">${eur(t.brutto)}</strong></div>
         <div class="small muted">${esc(FD().Hinweis19)}</div>`;
  }

  function renderPos() {
    const ro = D.Status !== "Entwurf" || !can("bearbeiten");
    const aOpts = `<option value="">Artikel übernehmen …</option>` + artikelGruppen().map(([k, list]) =>
      `<optgroup label="${esc(k)}">${list.map(a => `<option value="${a.id}">${a.Artikelnummer ? esc(a.Artikelnummer) + " · " : ""}${esc(a.Title)} (${eur(a.Preis)})</option>`).join("")}</optgroup>`).join("");
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
    renderTotals();
  }

  function renderActions() {
    const a = [], s = D.Status, t = D.Typ;
    if (s === "Entwurf") {
      if (can("bearbeiten")) {
        if (D.id) a.push(btn("del", "Entwurf löschen", "danger"));
        a.push('<span class="grow"></span>', btn("save", "Entwurf speichern", "ghost"), btn("preview", "PDF-Vorschau", "ghost"));
        if (can("festschreiben")) a.push(btn("final", t === "Angebot" ? "Angebot festschreiben" : "Rechnung festschreiben", "primary"));
      } else {
        a.push(btn("preview", "PDF-Vorschau", "ghost"));
      }
    } else {
      a.push(btn("pdf", "PDF ansehen", "ghost"));
      if (can("bearbeiten")) a.push(btn("store", "In SharePoint ablegen", "ghost"));
      if (can("senden")) a.push(btn("send", "Per E-Mail senden", "primary"));
      if (t === "Rechnung" && ["Offen", "Versendet"].includes(s) && can("bezahlt")) a.push(btn("paid", "Als bezahlt markieren", "ok"));
      if (t === "Angebot" && ["Offen", "Versendet"].includes(s) && can("bearbeiten")) a.push(btn("accept", "Angenommen → Rechnung erstellen", "ok"), btn("reject", "Abgelehnt", "danger"));
      a.push('<span class="grow"></span>');
      if (t === "Rechnung" && s !== "Storniert" && can("storno")) a.push(btn("storno", "Stornieren", "danger"));
    }
    $("#acts").innerHTML = a.join("");
    $("#acts").onclick = e => { const b = e.target.closest("[data-act]"); if (b && ACT[b.dataset.act]) ACT[b.dataset.act](); };
  }

  function readHead() {
    if (D.Status !== "Entwurf" || !can("bearbeiten")) return;
    D.KundeId = $("#fKunde").value;
    D.Datum = $("#fDatum").value;
    D.Faellig = $("#fFaellig").value;
    const l = $("#fLeist"); if (l) D.Leistungsdatum = l.value.trim();
    D.Notiz = $("#fNotiz").value;
    D.UstSatz = ustOf(FD());
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
    const f = FD();
    if (!D.KundeId) return "Bitte einen Kunden wählen.";
    if (!D.Datum) return "Bitte ein Datum angeben.";
    if (!D.Positionen.length || D.Positionen.some(p => !String(p.Bezeichnung || "").trim())) return "Jede Position braucht eine Bezeichnung.";
    if (D.Typ !== "Angebot" && !D.Leistungsdatum) return "Das Leistungsdatum ist Pflichtangabe auf Rechnungen.";
    if (!f.Strasse || !f.Ort) return `Bitte zuerst die Anschrift von „${f.Firma}" unter Einstellungen hinterlegen.`;
    return null;
  }

  async function festschreiben() {
    readHead();
    const err = validate();
    if (err) return toast(err, "err");
    const f = FD();
    if (D.Typ !== "Angebot" && !f.Steuernummer && !f.UstId &&
      !confirm(`Achtung: Für „${f.Firma}" fehlt die Steuernummer bzw. USt-IdNr. – sie ist Pflichtangabe auf Rechnungen (§ 14 UStG). Trotzdem festschreiben?`)) return;
    if (!confirm(`${P.titel(D)} für „${f.Firma}" jetzt festschreiben? Der Beleg erhält eine fortlaufende Nummer und kann danach nicht mehr geändert werden.`)) return;
    busy(async () => {
      await reloadBelege();
      D.Title = nextNr(D.Typ === "Angebot" ? "AN" : "RE", D.Datum.slice(0, 4), D.Firma);
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
    const f = FD();
    const blob = await P.blob(D, f);
    const item = await G.uploadPdf(f.PdfOrdner || C.pdfFolder, safeName(D.Kunde.Title), pdfName(D), blob);
    D.PdfUrl = item.webUrl;
    await G.update("Belege", D.id, { PdfUrl: D.PdfUrl });
    upsertLocal(D);
    return blob;
  }

  function fill(tpl) {
    const f = FD();
    const dokument = { Angebot: "unser Angebot", Rechnung: "unsere Rechnung", Storno: "unsere Stornorechnung" }[D.Typ] + " " + D.Title;
    const hinweis = D.Typ === "Rechnung" ? `Bitte überweisen Sie den Betrag bis zum ${deDate(D.Faellig)} unter Angabe der Rechnungsnummer.`
      : D.Typ === "Angebot" ? `Das Angebot ist gültig bis zum ${deDate(D.Faellig)}.` : "";
    const map = { nr: D.Title, typ: P.titel(D), dokument, hinweis, summe: eur(P.totals(D).brutto), faellig: deDate(D.Faellig),
      datum: deDate(D.Datum), kunde: D.Kunde.Title || "", firma: f.Firma || "", inhaber: f.Inhaber || "" };
    return String(tpl || "").replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m)).replace(/\n{3,}/g, "\n\n");
  }

  function sendDialog() {
    const f = FD(), from = f.MailFrom || C.mailFrom || "";
    modal(`<h2>${esc(P.titel(D))} ${esc(D.Title)} senden</h2><form id="sf" class="grid">
      <label class="wide">An<input name="to" value="${esc(D.Kunde.Email)}" required placeholder="kunde@beispiel.de"></label>
      <label class="wide">Betreff<input name="sub" value="${esc(fill(f.MailBetreff))}" required></label>
      <label class="wide">Nachricht<textarea name="txt" rows="10">${esc(fill(f.MailText))}</textarea></label>
      <p class="wide small muted">Absender: <strong>${esc(from || "dein Postfach")}</strong> (${esc(f.Firma)}) · Anhang: ${esc(pdfName(D))} · Das PDF wird zusätzlich in SharePoint abgelegt.</p>
      <div class="actions wide"><span class="grow"></span><button type="button" class="btn ghost" id="sfC">Abbrechen</button><button class="btn primary">Jetzt senden</button></div></form>`);
    $("#sfC").onclick = closeModal;
    $("#sf").onsubmit = e => {
      e.preventDefault();
      const el = e.target.elements, to = el.to.value, subject = el.sub.value, txt = el.txt.value;
      busy(async () => {
        const blob = await storePdf();
        await G.sendMail({ from, to, subject, html: esc(txt).replace(/\n/g, "<br>"), attachments: [{ name: pdfName(D), type: "application/pdf", base64: await blobToB64(blob) }] });
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
      const st = { Firma: orig.Firma, UstSatz: orig.UstSatz, Typ: "Storno", Status: "Offen", Title: nextNr("RE", today().slice(0, 4), orig.Firma),
        KundeId: orig.KundeId, Kunde: orig.Kunde, Datum: today(), Faellig: "", Leistungsdatum: orig.Leistungsdatum,
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
      const an = D, f = FD();
      const re = { Firma: an.Firma, UstSatz: ustOf(f), Typ: "Rechnung", Status: "Entwurf", Title: "", KundeId: an.KundeId, Kunde: an.Kunde, Datum: today(),
        Faellig: addDays(today(), f.Zahlungsziel), Leistungsdatum: deDate(today()), Positionen: clone(an.Positionen),
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
    preview: () => { readHead(); P.open(D, FD()); },
    pdf: () => P.open(D, FD()),
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

  // ---------- Benutzer & Berechtigungen ----------
  const aktiveAdmins = () => S.benutzer.filter(b => b.Rolle === "Administrator" && b.Aktiv !== "Nein");
  const istIch = b => S.me && b.id === S.me.id;

  function benutzerHtml() {
    const rows = S.benutzer.slice().sort((a, b) => String(a.Name || "").localeCompare(String(b.Name || ""), "de")).map(b => `
      <tr data-u="${b.id}">
        <td><strong>${esc(b.Name)}</strong>${istIch(b) ? ' <span class="badge">du</span>' : ""}</td>
        <td class="small">${esc(b.Title)}</td>
        <td><select data-f="Rolle">${Object.keys(ROLLEN).map(r => `<option ${r === b.Rolle ? "selected" : ""}>${r}</option>`).join("")}</select></td>
        <td><select data-f="Aktiv"><option ${b.Aktiv !== "Nein" ? "selected" : ""}>Ja</option><option ${b.Aktiv === "Nein" ? "selected" : ""}>Nein</option></select></td>
        <td class="r">${istIch(b) ? "" : `<button type="button" class="icon" data-del title="Benutzer entfernen">✕</button>`}</td>
      </tr>`).join("");
    const matrix = `<table class="tbl matrix"><thead><tr><th>Recht</th>${Object.keys(ROLLEN).map(r => `<th>${r}</th>`).join("")}</tr></thead><tbody>
      ${RECHTE.map(([k, l]) => `<tr><td>${esc(l)}</td>${Object.keys(ROLLEN).map(r => `<td>${ROLLEN[r].includes(k) ? "✓" : "–"}</td>`).join("")}</tr>`).join("")}
      </tbody></table>`;
    const absender = [...new Set(S.firmen.map(f => f.d.MailFrom || C.mailFrom).filter(Boolean))];
    return `<div class="card" id="benutzerCard">
      <div class="row between"><h3>Benutzer &amp; Berechtigungen</h3><button class="btn primary" id="uAdd" type="button">+ Benutzer aus Entra ID</button></div>
      <div class="tblwrap"><table class="tbl"><thead><tr><th>Name</th><th>Konto</th><th>Rolle</th><th>Aktiv</th><th></th></tr></thead>
        <tbody id="uTb">${rows || `<tr><td colspan="5" class="empty">Keine Benutzer.</td></tr>`}</tbody></table></div>
      <h3 style="margin-top:18px">Was darf welche Rolle?</h3>
      <div class="tblwrap">${matrix}</div>
      <p class="small muted">Beim Hinzufügen wird der Benutzer Mitglied der Microsoft-365-Gruppe der SharePoint-Site und bekommt damit Zugriff auf die Daten.
        Die Rollen steuern, was die App anzeigt und erlaubt – in SharePoint selbst können Gruppenmitglieder die Listen bearbeiten.<br>
        Wer <strong>per E-Mail senden</strong> soll, braucht zusätzlich „Senden als“ auf dem Absender-Postfach der jeweiligen Firma:</p>
      ${absender.map(a => `<p class="small"><code>Add-RecipientPermission -Identity ${esc(a)} -Trustee &lt;benutzer@ein-facher.de&gt; -AccessRights SendAs -Confirm:$false</code></p>`).join("")}
    </div>`;
  }

  function bindBenutzer() {
    const card = $("#benutzerCard");
    if (!card) return;
    $("#uAdd").onclick = benutzerDialog;
    $("#uTb").onchange = e => {
      const tr = e.target.closest("tr[data-u]"), f = e.target.dataset.f;
      if (!tr || !f) return;
      const b = S.benutzer.find(x => x.id === tr.dataset.u), val = e.target.value;
      const wirdKeinAdmin = (f === "Rolle" && val !== "Administrator") || (f === "Aktiv" && val === "Nein");
      if (b.Rolle === "Administrator" && b.Aktiv !== "Nein" && wirdKeinAdmin && aktiveAdmins().length <= 1) {
        toast("Es muss mindestens ein aktiver Administrator bleiben.", "err");
        e.target.value = b[f] || (f === "Aktiv" ? "Ja" : b.Rolle);
        return;
      }
      busy(async () => {
        await G.update("Benutzer", b.id, { [f]: val });
        b[f] = val;
        if (f === "Aktiv" && b.EntraId && !istIch(b)) {
          try { if (val === "Nein") await G.removeSiteMember(b.EntraId); else await G.addSiteMember(b.EntraId); }
          catch (err) { toast("Gespeichert, aber SharePoint-Zugriff nicht angepasst: " + err.message, "err"); return; }
        }
        toast(`${b.Name}: ${f} = ${val}`);
        if (istIch(b)) { showUser(); route(); }
      });
    };
    $("#uTb").onclick = e => {
      if (!e.target.matches("[data-del]")) return;
      const b = S.benutzer.find(x => x.id === e.target.closest("tr").dataset.u);
      if (b.Rolle === "Administrator" && aktiveAdmins().length <= 1) return toast("Der letzte Administrator kann nicht entfernt werden.", "err");
      if (!confirm(`${b.Name} aus der Rechnungs-App entfernen? Der Zugriff auf die SharePoint-Site wird ebenfalls entzogen.`)) return;
      busy(async () => {
        await G.remove("Benutzer", b.id);
        S.benutzer = S.benutzer.filter(x => x !== b);
        let hinweis = "";
        if (b.EntraId) { try { await G.removeSiteMember(b.EntraId); } catch (err) { hinweis = " – SharePoint-Zugriff bitte manuell entfernen: " + err.message; } }
        toast(`${b.Name} entfernt${hinweis}`, hinweis ? "err" : "ok");
        einstellungen();
      });
    };
  }

  function benutzerDialog() {
    modal(`<h2>Benutzer aus Entra ID hinzufügen</h2>
      <div class="grid"><label class="wide">Suchen<input id="uq" placeholder="Name oder E-Mail …" autocomplete="off"></label>
      <label class="wide">Rolle für den neuen Benutzer<select id="uRolle">${Object.keys(ROLLEN).map(r => `<option ${r === "Mitarbeiter" ? "selected" : ""}>${r}</option>`).join("")}</select></label></div>
      <div class="ulist" id="uRes"><p class="empty">Lade Benutzer aus Entra ID …</p></div>
      <div class="actions"><span class="grow"></span><button type="button" class="btn ghost" id="uC">Schließen</button></div>`);
    $("#uC").onclick = closeModal;
    const draw = () => {
      const q = $("#uq").value.toLowerCase();
      const vorhanden = new Set(S.benutzer.map(b => b.EntraId));
      const list = (S.entraUsers || []).filter(u => !vorhanden.has(u.id))
        .filter(u => !q || [u.displayName, u.mail, u.userPrincipalName].join(" ").toLowerCase().includes(q));
      $("#uRes").innerHTML = list.slice(0, 100).map(u =>
        `<button type="button" data-id="${u.id}"><strong>${esc(u.displayName)}</strong><div class="small muted">${esc(u.mail || u.userPrincipalName)}</div></button>`).join("")
        || `<p class="empty">Keine weiteren Benutzer gefunden.</p>`;
    };
    $("#uq").oninput = draw;
    $("#uRes").onclick = e => {
      const b = e.target.closest("button[data-id]");
      if (!b) return;
      const u = S.entraUsers.find(x => x.id === b.dataset.id), rolle = $("#uRolle").value;
      busy(async () => {
        const item = await G.create("Benutzer", { Title: String(u.userPrincipalName || "").toLowerCase(), Name: u.displayName || u.userPrincipalName,
          EntraId: u.id, Rolle: rolle, Aktiv: "Ja" });
        S.benutzer.push(item);
        let msg = `${u.displayName} als ${rolle} hinzugefügt`, kind = "ok";
        try { await G.addSiteMember(u.id); msg += " – SharePoint-Zugriff erteilt"; }
        catch (err) { msg += ". SharePoint-Zugriff bitte manuell erteilen: " + err.message; kind = "err"; }
        closeModal(); toast(msg, kind); einstellungen();
      });
    };
    if (S.entraUsers) { draw(); return; }
    busy(async () => {
      try { S.entraUsers = await G.users(); }
      catch (err) {
        $("#uRes").innerHTML = `<p class="empty err-text">Benutzer konnten nicht geladen werden: ${esc(err.message)}<br>
          Bitte in Entra die delegierte Berechtigung <strong>User.ReadBasic.All</strong> hinzufügen und Administratorzustimmung erteilen.</p>`;
        return;
      }
      if ($("#uq")) draw();
    });
  }

  // ---------- Firmen verwalten ----------
  const FIRMA_FIELDS = [
    { k: "Firma", label: "Firmenname (erscheint groß auf dem PDF)", req: true }, { k: "Inhaber", label: "Inhaber" },
    { k: "Strasse", label: "Straße und Hausnummer", wide: true }, { k: "PLZ", label: "PLZ" }, { k: "Ort", label: "Ort" },
    { k: "Telefon", label: "Telefon" }, { k: "Email", label: "E-Mail (auf dem PDF)" }, { k: "Web", label: "Website" },
    { k: "Steuer", label: "Umsatzsteuer", options: [STEUER_KU, STEUER_REG] }, { k: "UstSatz", label: "USt-Satz in % (nur bei Regelbesteuerung)", type: "number", step: "0.1" },
    { k: "Steuernummer", label: "Steuernummer" }, { k: "UstId", label: "USt-IdNr. (falls vorhanden)" },
    { k: "Bank", label: "Bank" }, { k: "IBAN", label: "IBAN" }, { k: "BIC", label: "BIC" },
    { k: "Nummernpraefix", label: "Nummern-Präfix (leer = RE-2026-0001, „STL“ = STL-RE-2026-0001)" },
    { k: "MailFrom", label: "Absender-Postfach für E-Mails" }, { k: "PdfOrdner", label: "PDF-Ordner in SharePoint" },
    { k: "Zahlungsziel", label: "Zahlungsziel (Tage)", type: "number" }, { k: "AngebotGueltig", label: "Angebote gültig (Tage)", type: "number" },
    { k: "Umsatzgrenze", label: "Kleinunternehmer-Grenze (€)", type: "number" }, { k: "Farbe", label: "Akzentfarbe im PDF", type: "color" },
    { k: "Hinweis19", label: "Hinweis Kleinunternehmer (nur bei § 19)", wide: true },
    { k: "MailBetreff", label: "E-Mail-Betreff", wide: true },
    { k: "MailText", label: "E-Mail-Text – Platzhalter: {dokument} {nr} {typ} {datum} {summe} {faellig} {hinweis} {kunde} {firma} {inhaber}", type: "textarea", rows: 9, wide: true }
  ];

  function firmaDialog() {
    const vorschlag = S.firmen.some(f => f.key === "stl") ? { key: "", Firma: "", Inhaber: "", Strasse: "", PLZ: "", Ort: "" } : STL_VORSCHLAG;
    const fields = [
      { k: "key", label: "Kürzel (klein, ohne Leerzeichen, z. B. stl)", req: true, pattern: "[a-z0-9]{2,12}" },
      { k: "Firma", label: "Firmenname", req: true }, { k: "Inhaber", label: "Inhaber", req: true },
      { k: "Strasse", label: "Straße und Hausnummer", wide: true }, { k: "PLZ", label: "PLZ" }, { k: "Ort", label: "Ort" },
      { k: "Steuer", label: "Umsatzsteuer", options: [STEUER_KU, STEUER_REG] }
    ];
    formModal({
      title: "Neue Firma anlegen", fields, values: Object.assign({ Steuer: STEUER_KU }, vorschlag),
      onSave: d => {
        const key = String(d.key || "").toLowerCase();
        if (!/^[a-z0-9]{2,12}$/.test(key) || key === "ef") return toast("Kürzel: 2–12 Kleinbuchstaben/Ziffern, nicht „ef“.", "err");
        if (S.firmen.some(f => f.key === key)) return toast("Dieses Kürzel gibt es schon.", "err");
        delete d.key;
        const data = Object.assign({}, FIRMA_DEFAULT, {
          Email: "", Web: "", MailFrom: "", Farbe: "#1D4ED8",
          Nummernpraefix: key.toUpperCase(), PdfOrdner: (C.pdfFolder || "Rechnungen") + "-" + key.toUpperCase()
        }, d);
        busy(async () => {
          const item = await G.create("Einstellungen", { Title: itemTitle(key), Wert: JSON.stringify(data) });
          S.firmen.push({ key, itemId: item.id, d: data });
          S.editFk = key;
          closeModal();
          toast(`Firma „${data.Firma}" angelegt – bitte Steuernummer, Bank und Absender ergänzen`);
          einstellungen();
        });
      }
    });
  }

  function firmenHtml() {
    const fk = S.editFk && S.firmen.some(f => f.key === S.editFk) ? S.editFk : S.fk;
    S.editFk = fk;
    const e = firmaEntry(fk);
    const hatBelege = S.belege.some(b => b.Firma === fk);
    return `<div class="card" id="firmenCard">
      <div class="row between"><h3>Firmendaten &amp; Vorlagen</h3><button class="btn ghost" id="fNeu" type="button">+ Firma hinzufügen</button></div>
      <div class="firmtabs">${S.firmen.map(f => `<button type="button" data-fk="${esc(f.key)}" class="${f.key === fk ? "active" : ""}">${esc(f.d.Firma)}</button>`).join("")}</div>
      <form id="ff" class="grid">${fieldsHtml(FIRMA_FIELDS, e.d)}
        <div class="actions wide">${fk !== "ef" && !hatBelege ? `<button type="button" class="btn danger" id="fDel">Firma entfernen</button>` : ""}<span class="grow"></span>
          <button class="btn primary" ${S.setupNeeded ? "disabled" : ""}>„${esc(e.d.Firma)}" speichern</button></div></form></div>`;
  }

  function bindFirmen() {
    if (!$("#firmenCard")) return;
    $("#fNeu").onclick = firmaDialog;
    document.querySelectorAll("[data-fk]").forEach(b => { b.onclick = () => { S.editFk = b.dataset.fk; einstellungen(true); }; });
    if ($("#fDel")) $("#fDel").onclick = () => {
      const e = firmaEntry(S.editFk);
      if (!confirm(`Firma „${e.d.Firma}" entfernen?`)) return;
      busy(async () => {
        if (e.itemId) await G.remove("Einstellungen", e.itemId);
        S.firmen = S.firmen.filter(f => f !== e);
        if (S.fk === e.key) wechsleFirma("ef", false);
        S.editFk = S.fk;
        toast("Firma entfernt"); einstellungen();
      });
    };
    $("#ff").onsubmit = ev => {
      ev.preventDefault();
      const e = firmaEntry(S.editFk);
      const d = Object.assign({}, e.d, readFields(ev.target, FIRMA_FIELDS));
      if (d.Steuer === STEUER_REG && !(Number(d.UstSatz) > 0)) return toast("Bitte einen USt-Satz angeben (z. B. 19).", "err");
      busy(async () => {
        const fields = { Title: itemTitle(e.key), Wert: JSON.stringify(d) };
        if (e.itemId) await G.update("Einstellungen", e.itemId, fields);
        else e.itemId = (await G.create("Einstellungen", fields)).id;
        e.d = d;
        toast(`„${d.Firma}" gespeichert`);
        renderNav();
        einstellungen(true);
      });
    };
  }

  // ---------- Einstellungen ----------
  function einstellungen(behalteScroll) {
    if (!can("einstellungen") && !can("benutzer")) { location.hash = "#/dashboard"; return; }
    const y = window.scrollY;
    const fehlt = S.setupNeeded || S.schemaMissing.length;
    view(`<div class="head"><h1>Einstellungen</h1></div>
      ${fehlt ? `<div class="card" style="border-color:#F5C26B;background:#FFFBEB"><strong>Einrichtung nötig:</strong> In SharePoint fehlen Listen oder Spalten (z. B. nach einem Update)${S.schemaMissing.length ? ": " + esc(S.schemaMissing.join(", ")) : ""}. Klicke unten auf „Listen einrichten / prüfen".</div>` : ""}
      ${can("einstellungen") ? `<div class="card"><h3>SharePoint-Verbindung</h3>
        <p class="small muted">Site: <strong>${esc(C.siteHostname + C.sitePath)}</strong> · Listen: ${["Kunden", "Artikel", "Belege", "Einstellungen", "Benutzer"].map(n => esc(C.listPrefix + n)).join(", ")}</p>
        <button class="btn ghost" id="setup">Listen einrichten / prüfen</button>
        <div class="log" id="log" style="margin-top:12px">Bereit.</div></div>` : ""}
      ${can("einstellungen") && !S.setupNeeded ? firmenHtml() : ""}
      ${!S.setupNeeded && can("benutzer") ? benutzerHtml() : ""}`);
    if (behalteScroll) window.scrollTo(0, y);
    setNav("einstellungen");
    bindBenutzer();
    bindFirmen();
    if (!can("einstellungen")) return;
    $("#setup").onclick = () => {
      const log = $("#log"); log.textContent = "";
      const w = m => { log.textContent += m + "\n"; };
      busy(async () => {
        try { await G.ensureLists(w); }
        catch (e) { w("FEHLER: " + e.message); throw e; }
        await loadAll();
        await resolveMe();
        showUser();
        toast("SharePoint-Listen sind bereit");
        einstellungen();
        $("#log").textContent = "Listen und Spalten sind vollständig.";
      });
    };
  }

  // ---------- Router ----------
  const R = { dashboard, rechnungen: s => belegListe("Rechnung", s), angebote: s => belegListe("Angebot", s),
    kunden: kundenView, artikel: artikelView, einstellungen: () => einstellungen(), beleg: belegEditor };

  function route() {
    if (!S.me) { noAccess(); return; }
    const parts = (location.hash || "#/dashboard").replace(/^#\/?/, "").split("/").map(p => { try { return decodeURIComponent(p); } catch (_) { return p; } });
    const fehlt = S.setupNeeded || S.schemaMissing.length;
    if (fehlt && parts[0] !== "einstellungen") {
      if (can("einstellungen")) { location.hash = "#/einstellungen"; return; }
      updateNoetig(); return;
    }
    const r = R[parts[0]] ? parts[0] : "dashboard";
    closeModal();
    R[r](parts[1]);
  }

  // Ganze Tabellenzeile anklickbar
  document.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-href]");
    if (tr && !e.target.closest("a,button,input,select,textarea")) location.hash = tr.dataset.href;
  });

  // Falls eine ältere index.html geladen ist: fehlende Elemente nachrüsten
  function ensureShell() {
    const side = document.querySelector(".sidebar");
    if (!side) return;
    let nav = side.querySelector("nav");
    if (!nav) { nav = document.createElement("nav"); side.insertBefore(nav, side.querySelector(".user")); }
    nav.id = "nav";
    const user = side.querySelector(".user");
    if (user && !$("#userRole")) {
      const r = document.createElement("span");
      r.id = "userRole"; r.className = "role";
      user.insertBefore(r, $("#logoutBtn"));
    }
  }

  async function start() {
    ensureShell();
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
      await busy(resolveMe);
      showUser();
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
