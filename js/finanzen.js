// ============================================================
// Ein-Facher Rechnungen – Private Finanzen & Steuerübersicht (nur Administrator)
// Zusammenveranlagung (Splitting), Kinderfreibetrag-Günstigerprüfung, Soli, Kirchensteuer,
// Gewerbesteuer mit § 35-Anrechnung, Erstattung/Nachzahlung, Rücklage fürs Unternehmen.
// Daten liegen NICHT in SharePoint, sondern im eigenen OneDrive des angemeldeten Benutzers.
// Alle Ergebnisse sind Schätzungen – keine Steuerberatung.
// ============================================================
(function (root) {
  "use strict";

  // ---------- Steuerparameter je Jahr ----------
  // Tarif nach § 32a EStG: Zone 1 bis gfb = 0; Zone 2 bis z2: (a2*y+1400)*y; Zone 3 bis z3: (a3*z+2397)*z+c3;
  // Zone 4 bis 277.825: 0,42x - c4; Zone 5: 0,45x - c5
  const PARAM = {
    2025: { gfb: 12096, z2: 17443, a2: 932.30, z3: 68480, a3: 176.64, c3: 1015.13, c4: 10911.92, c5: 19246.67,
            kfb: 9600, kg: 255, soliFG: 19950, bbgRV: 96600, bbgKV: 66150 },
    2026: { gfb: 12348, z2: 17799, a2: 914.51, z3: 69878, a3: 173.10, c3: 1034.87, c4: 11135.63, c5: 19470.38,
            kfb: 9756, kg: 259, soliFG: 20350, bbgRV: 101400, bbgKV: 69750 }
  };
  const JAHRE_MIT_WERTEN = Object.keys(PARAM).map(Number);
  function paramFor(jahr) {
    const y = Number(jahr);
    if (PARAM[y]) return { p: PARAM[y], basisJahr: y, exakt: true };
    const basis = y < Math.min(...JAHRE_MIT_WERTEN) ? Math.min(...JAHRE_MIT_WERTEN) : Math.max(...JAHRE_MIT_WERTEN);
    return { p: PARAM[basis], basisJahr: basis, exakt: false };
  }

  const ANP = 1230;            // Arbeitnehmer-Pauschbetrag
  const SAP = 36;              // Sonderausgaben-Pauschbetrag je Person
  const GEW_FREIBETRAG = 24500;
  const GEW_MESSZAHL = 0.035;
  const ANRECHNUNG_35 = 4.0;

  const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const leer = v => v === "" || v === null || v === undefined;
  const r2 = n => Math.round(n * 100) / 100;

  // ---------- Tarif ----------
  function tarif(x, p) {
    x = Math.floor(Math.max(0, x));
    let e;
    if (x <= p.gfb) e = 0;
    else if (x <= p.z2) { const y = (x - p.gfb) / 10000; e = (p.a2 * y + 1400) * y; }
    else if (x <= p.z3) { const z = (x - p.z2) / 10000; e = (p.a3 * z + 2397) * z + p.c3; }
    else if (x <= 277825) e = 0.42 * x - p.c4;
    else e = 0.45 * x - p.c5;
    return Math.floor(e);
  }
  const splitting = (x, p) => 2 * tarif(Math.floor(Math.max(0, x) / 2), p);

  function soli(est, freigrenze) {
    if (est <= freigrenze) return 0;
    return Math.floor(Math.min(est * 0.055, (est - freigrenze) * 0.119) * 100) / 100;
  }

  // Sozialversicherung Arbeitnehmeranteil (Schätzung) und davon als Vorsorgeaufwand abziehbar
  function svSchaetzung(brutto, p, kinderlos) {
    const rvBasis = Math.min(brutto, p.bbgRV), kvBasis = Math.min(brutto, p.bbgKV);
    const rv = 0.093 * rvBasis, av = 0.013 * rvBasis;
    const kv = (0.073 + 0.0145) * kvBasis;              // allg. Beitrag + ½ durchschnittl. Zusatzbeitrag
    const pv = (kinderlos ? 0.024 : 0.018) * kvBasis;
    return { gesamt: rv + av + kv + pv, abziehbar: rv + kv * 0.96 + pv };
  }

  function person(pi, p, kinderlos) {
    const brutto = Math.max(0, num(pi.brutto));
    const wk = brutto > 0 ? Math.min(brutto, Math.max(ANP, num(pi.wk))) : 0;
    const s = svSchaetzung(brutto, p, kinderlos);
    const svGeschaetzt = leer(pi.sv);
    const svGes = svGeschaetzt ? s.gesamt : Math.max(0, num(pi.sv));
    const svAbz = s.gesamt > 0 ? svGes * (s.abziehbar / s.gesamt) : 0;
    return { name: pi.name, brutto, wk, wkPauschal: wk === Math.min(brutto, ANP), einkuenfte: brutto - wk,
             svGes, svAbz, svGeschaetzt, lst: Math.max(0, num(pi.lst)) };
  }

  // Festsetzung inkl. Günstigerprüfung Kindergeld/Kinderfreibetrag, § 35-Anrechnung, Soli, KiSt
  function festsetzung({ zvE, kfb, kgJahr, tarifFn, messbetrag, gewst, soliFG, kistSatz, kistFaktor }) {
    const estOhne = tarifFn(zvE);
    const estMit = tarifFn(Math.max(0, zvE - kfb));
    const kfbGuenstiger = kfb > 0 && (estOhne - estMit) > kgJahr;
    const tariflich = kfbGuenstiger ? estMit : estOhne;
    const anr = Math.min(ANRECHNUNG_35 * messbetrag, gewst, tariflich);
    const hinzu = kfbGuenstiger ? kgJahr : 0;
    const est = Math.max(0, tariflich - anr) + hinzu;
    const zuschlagBasis = Math.max(0, estMit - Math.min(anr, estMit));   // Soli/KiSt immer mit Kinderfreibetrag
    const sz = soli(zuschlagBasis, soliFG);
    const kist = r2(zuschlagBasis * kistSatz / 100 * kistFaktor);
    return { zvE, estOhne, estMit, kfbGuenstiger, tariflich, anr, hinzu, est, zuschlagBasis, soli: sz, kist,
             summe: r2(est + sz + kist) };
  }

  function gewerbe(gewinn, hebesatz) {
    const g100 = Math.floor(Math.max(0, gewinn) / 100) * 100;
    const messbetrag = r2(Math.max(0, g100 - GEW_FREIBETRAG) * GEW_MESSZAHL);
    return { messbetrag, gewst: r2(messbetrag * num(hebesatz) / 100) };
  }

  const KIST_FAKTOR = { keine: 0, eine: 0.5, beide: 1 };

  // ---------- Hauptberechnung ----------
  function berechne(i, einnahmenAuto) {
    const { p, basisJahr, exakt } = paramFor(i.jahr);
    const kinder = Math.max(0, Math.floor(num(i.kinder)));
    const kinderlos = kinder === 0;
    const p1 = person({ name: i.p1_name, brutto: i.p1_brutto, wk: i.p1_wk, sv: i.p1_sv, lst: i.p1_lst }, p, kinderlos);
    const p2 = person({ name: i.p2_name, brutto: i.p2_brutto, wk: i.p2_wk, sv: i.p2_sv, lst: i.p2_lst }, p, kinderlos);
    const inhaber = i.inhaber === "2" ? 2 : 1;

    const einnahmen = r2((i.quelle === "manuell" ? 0 : num(einnahmenAuto)) + num(i.einnahmenManuell));
    const ausgaben = Math.max(0, num(i.ausgaben));
    const gewinn = r2(einnahmen - ausgaben);
    const gw = gewerbe(gewinn, i.hebesatz);
    const kistSatz = num(i.kistSatz) || 9;
    const kistFaktor = KIST_FAKTOR[i.kist] ?? 0;
    const weitere = Math.max(0, num(i.weitereAbzuege));
    const kgJahr = kinder * p.kg * 12;

    // Zusammenveranlagung
    const gde = p1.einkuenfte + p2.einkuenfte + gewinn;
    const vorsorge = p1.svAbz + p2.svAbz;
    const zvE = Math.max(0, Math.floor(gde - vorsorge - 2 * SAP - weitere));
    const zus = festsetzung({ zvE, kfb: kinder * p.kfb, kgJahr, tarifFn: x => splitting(x, p),
      messbetrag: gw.messbetrag, gewst: gw.gewst, soliFG: 2 * p.soliFG, kistSatz, kistFaktor });

    // Zum Vergleich: ohne Unternehmen (Steuerlast, die auf das Unternehmen entfällt)
    const zvEOhne = Math.max(0, Math.floor(p1.einkuenfte + p2.einkuenfte - vorsorge - 2 * SAP - weitere));
    const ohneU = festsetzung({ zvE: zvEOhne, kfb: kinder * p.kfb, kgJahr, tarifFn: x => splitting(x, p),
      messbetrag: 0, gewst: 0, soliFG: 2 * p.soliFG, kistSatz, kistFaktor });
    const steuerUnternehmen = r2(zus.summe + gw.gewst - ohneU.summe);

    // Zum Vergleich: Einzelveranlagung beider Partner
    const einzeln = [p1, p2].map((pp, idx) => {
      const g = inhaber === idx + 1 ? gewinn : 0;
      const gwi = inhaber === idx + 1 ? gw : { messbetrag: 0, gewst: 0 };
      const z = Math.max(0, Math.floor(pp.einkuenfte + g - pp.svAbz - SAP - weitere / 2));
      return festsetzung({ zvE: z, kfb: kinder * p.kfb / 2, kgJahr: kgJahr / 2, tarifFn: x => tarif(x, p),
        messbetrag: gwi.messbetrag, gewst: gwi.gewst, soliFG: p.soliFG, kistSatz, kistFaktor });
    });
    const summeEinzeln = r2(einzeln[0].summe + einzeln[1].summe);

    const gezahlt = r2(p1.lst + p2.lst + Math.max(0, num(i.vorauszahlungen)));
    const ergebnis = r2(zus.summe - gezahlt);         // > 0 Nachzahlung, < 0 Erstattung
    const bruttoGesamt = p1.brutto + p2.brutto + gewinn;
    const netto = r2(bruttoGesamt - p1.svGes - p2.svGes - zus.summe - gw.gewst + kgJahr);
    const grenz = zvE > 0 ? (splitting(zvE + 200, p) - splitting(zvE, p)) / 200 : 0;
    const durchschnitt = gde > 0 ? zus.summe / gde : 0;

    return { p, basisJahr, exakt, kinder, kgJahr, p1, p2, inhaber, einnahmen, ausgaben, gewinn, gw, gde, vorsorge,
             zvE, zus, ohneU, steuerUnternehmen, einzeln, summeEinzeln, splittingVorteil: r2(summeEinzeln - zus.summe),
             gezahlt, ergebnis, bruttoGesamt, netto, grenz, durchschnitt, weitere, kistFaktor, kistSatz };
  }

  // ---------- Oberfläche ----------
  const DEFAULT = {
    kinder: 1, kist: "keine", kistSatz: 9,
    p1_name: "Mohammed", p1_brutto: "", p1_wk: "", p1_sv: "", p1_lst: "",
    p2_name: "Ehefrau", p2_brutto: "", p2_wk: "", p2_sv: "", p2_lst: "",
    inhaber: "1", quelle: "ef", einnahmenManuell: "", ausgaben: "", hebesatz: 500,
    vorauszahlungen: "", weitereAbzuege: ""
  };
  const LOCAL_KEY = "ef_finanzen_lokal";
  let STORE = null, LOADED = false, LOAD_ERR = null, CUR = null, DIRTY = false, API = null;

  const lokalLesen = () => { try { return JSON.parse(window.localStorage.getItem(LOCAL_KEY) || "null"); } catch (_) { return null; } };
  const lokalSchreiben = s => { try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(s)); return true; } catch (_) { return false; } };

  async function laden(api) {
    try {
      STORE = (await api.G.privatLaden()) || { version: 1, jahre: {} };
      LOAD_ERR = null;
    } catch (e) {
      LOAD_ERR = e.message;
      STORE = lokalLesen() || { version: 1, jahre: {} };
    }
    if (!STORE.jahre) STORE.jahre = {};
    LOADED = true;
  }

  function einnahmenAusApp(api, quelle, jahr) {
    if (!quelle || quelle === "manuell") return { summe: 0, anzahl: 0 };
    const liste = api.S.belege.filter(b => b.Firma === quelle && b.Typ === "Rechnung" && b.Status === "Bezahlt" &&
      String(b.BezahltAm || "").startsWith(String(jahr)));
    return { summe: r2(liste.reduce((a, b) => a + api.P.totals(b).netto, 0)), anzahl: liste.length };
  }

  const pct = n => (Math.round(n * 1000) / 10).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";

  function feld(k, label, opts = {}) {
    const v = CUR[k] ?? "";
    if (opts.options) {
      return `<label class="${opts.wide ? "wide" : ""}">${label}<select data-k="${k}">${opts.options.map(([val, txt]) =>
        `<option value="${API.esc(val)}" ${String(val) === String(v) ? "selected" : ""}>${API.esc(txt)}</option>`).join("")}</select></label>`;
    }
    const type = opts.text ? "text" : "number";
    return `<label class="${opts.wide ? "wide" : ""}">${label}<input data-k="${k}" type="${type}" ${type === "number" ? 'step="0.01" inputmode="decimal"' : ""}
      value="${API.esc(v)}" placeholder="${API.esc(opts.ph || "")}"></label>`;
  }

  function render(api, sub) {
    API = api;
    if (!api.can("finanzen")) { location.hash = "#/dashboard"; return; }
    api.setNav("finanzen");
    if (!LOADED) {
      api.view(`<div class="card">Lade private Daten aus deinem OneDrive …</div>`);
      api.busy(async () => { await laden(api); render(api, sub); });
      return;
    }
    const heute = api.today().slice(0, 4);
    const jahr = sub && /^\d{4}$/.test(sub) ? sub : (CUR && CUR.jahr) || heute;
    CUR = Object.assign({}, DEFAULT, STORE.jahre[jahr] || {}, { jahr });
    const jahre = [];
    for (let y = Math.min(2025, Number(heute) - 1); y <= Number(heute) + 1; y++) jahre.push(String(y));
    Object.keys(STORE.jahre).forEach(y => { if (!jahre.includes(y)) jahre.push(y); });
    jahre.sort();
    const firmen = api.S.firmen.map(f => [f.key, "Bezahlte Rechnungen „" + f.d.Firma + "“"]);

    api.view(`
      <div class="head"><h1>Finanzen <span class="muted">· privat</span></h1><span class="grow"></span>
        <select id="fiJahr">${jahre.map(y => `<option ${y === jahr ? "selected" : ""}>${y}</option>`).join("")}</select>
        <button class="btn primary" id="fiSave" type="button">Speichern</button></div>
      ${LOAD_ERR ? `<div class="card warnbox"><strong>OneDrive nicht erreichbar:</strong> ${api.esc(LOAD_ERR)}<br>
        Die Daten werden vorerst nur in diesem Browser gespeichert. Bitte in Entra die delegierte Berechtigung <strong>Files.ReadWrite</strong> hinzufügen und Administratorzustimmung erteilen.</div>` : ""}
      <p class="small muted">Nur für dich sichtbar: Die Angaben liegen in deinem eigenen OneDrive (<code>Ein-Facher-Privat/finanzen.json</code>), nicht in SharePoint.
        Alle Werte sind <strong>Schätzungen</strong> nach vereinfachter Berechnung – keine Steuerberatung.</p>

      <div class="card"><h3>Haushalt</h3><div class="grid g4">
        ${feld("kinder", "Kinder (mit Kindergeld)")}
        ${feld("kist", "Kirchensteuer", { options: [["keine", "keine"], ["eine", "eine Person (≈ hälftig)"], ["beide", "beide"]] })}
        ${feld("kistSatz", "Kirchensteuersatz % (NRW 9)")}
        ${feld("weitereAbzuege", "Weitere Abzüge € (Spenden, außergew. Belastungen …)")}
      </div></div>

      <div class="grid fi2">
        ${[1, 2].map(n => `<div class="card"><h3>${n === 1 ? "Person 1" : "Person 2 (Ehepartner)"}</h3><div class="grid">
          ${feld(`p${n}_name`, "Name", { text: true, wide: true })}
          ${feld(`p${n}_brutto`, "Bruttoarbeitslohn im Jahr €", { ph: "0" })}
          ${feld(`p${n}_wk`, "Werbungskosten € (leer = Pauschale 1.230)", { ph: "1230" })}
          ${feld(`p${n}_sv`, "Sozialversicherung AN-Anteil € (leer = Schätzung)", { ph: "automatisch" })}
          ${feld(`p${n}_lst`, "Einbehaltene Lohnsteuer + Soli + KiSt €", { ph: "0" })}
        </div><p class="small muted">Werte stehen auf der Lohnsteuerbescheinigung (Zeile 3, 4–6, 22–27). Minijobs mit Pauschalsteuer hier nicht eintragen.</p></div>`).join("")}
      </div>

      <div class="card"><h3>Einzelunternehmen</h3><div class="grid g4">
        ${feld("inhaber", "Inhaber", { options: [["1", "Person 1"], ["2", "Person 2"]] })}
        ${feld("quelle", "Einnahmen aus der App", { options: firmen.concat([["manuell", "nicht übernehmen (nur manuell)"]]) })}
        <label>Einnahmen aus der App €<input id="fiAuto" disabled></label>
        ${feld("einnahmenManuell", "Weitere Einnahmen € (manuell)")}
        ${feld("ausgaben", "Betriebsausgaben € (Hardware, Software, Fahrten …)")}
        ${feld("hebesatz", "Gewerbesteuer-Hebesatz % (Bergheim 500)")}
        ${feld("vorauszahlungen", "ESt-Vorauszahlungen ans Finanzamt €")}
      </div><p class="small muted" id="fiAutoInfo"></p></div>

      <div id="fiRes"></div>`);

    const onChange = e => {
      const k = e.target.dataset.k;
      if (!k) return;
      CUR[k] = e.target.value;
      STORE.jahre[jahr] = Object.assign({}, CUR);
      DIRTY = true;
      $("#fiSave").textContent = "Speichern *";
      renderRes();
    };
    document.querySelectorAll("[data-k]").forEach(el => { el.oninput = onChange; el.onchange = onChange; });
    $("#fiJahr").onchange = e => { location.hash = "#/finanzen/" + e.target.value; };
    $("#fiSave").onclick = speichern;
    renderRes();
  }

  const $ = s => document.querySelector(s);

  function speichern() {
    STORE.jahre[CUR.jahr] = Object.assign({}, CUR);
    STORE.geaendert = new Date().toISOString();
    API.busy(async () => {
      try {
        await API.G.privatSpeichern(STORE);
        LOAD_ERR = null;
        DIRTY = false;
        $("#fiSave").textContent = "Speichern";
        API.toast("In OneDrive gespeichert (Ein-Facher-Privat/finanzen.json)");
      } catch (e) {
        lokalSchreiben(STORE);
        API.toast("OneDrive-Fehler – nur in diesem Browser gespeichert: " + e.message, "err");
      }
    });
  }

  function renderRes() {
    const api = API, eur = api.eur, esc = api.esc;
    const auto = einnahmenAusApp(api, CUR.quelle, CUR.jahr);
    $("#fiAuto").value = CUR.quelle === "manuell" ? "–" : eur(auto.summe);
    $("#fiAutoInfo").textContent = CUR.quelle === "manuell" ? "" :
      `${auto.anzahl} bezahlte Rechnung(en) mit Zahlungsdatum in ${CUR.jahr} (Netto, nach Zuflussprinzip).`;
    const r = berechne(CUR, auto.summe);
    const z = r.zus;
    const vz = r.ergebnis > 0 ? "Nachzahlung" : "Erstattung";
    const zeile = (l, v, cls = "", hint = "") => `<tr class="${cls}"><td>${l}${hint ? `<div class="small muted">${hint}</div>` : ""}</td><td class="r">${v}</td></tr>`;
    const n1 = esc(r.p1.name || "Person 1"), n2 = esc(r.p2.name || "Person 2");

    $("#fiRes").innerHTML = `
      ${r.exakt ? "" : `<div class="card warnbox">Für ${esc(CUR.jahr)} sind noch keine Steuerwerte hinterlegt – gerechnet wird mit den Werten von ${r.basisJahr}.</div>`}
      <div class="kpis">
        <div class="kpi"><div class="l">Brutto Haushalt</div><div class="v">${eur(r.bruttoGesamt)}</div><div class="s">Löhne + Gewinn</div></div>
        <div class="kpi"><div class="l">Steuern gesamt</div><div class="v">${eur(z.summe + r.gw.gewst)}</div><div class="s">ESt + Soli + KiSt + GewSt</div></div>
        <div class="kpi ${r.ergebnis > 0 ? "warn" : "ok"}"><div class="l">Voraussichtl. ${vz}</div><div class="v">${eur(Math.abs(r.ergebnis))}</div><div class="s">${r.gezahlt ? "nach bereits gezahlten " + eur(r.gezahlt) : "Lohnsteuer noch nicht eingetragen"}</div></div>
        <div class="kpi"><div class="l">Netto Haushalt</div><div class="v">${eur(r.netto)}</div><div class="s">${eur(r.netto / 12)} pro Monat</div></div>
      </div>

      <div class="grid fi2">
        <div class="card"><h3>Berechnung ${esc(CUR.jahr)} – Zusammenveranlagung</h3><div class="tblwrap"><table class="tbl fitbl"><tbody>
          ${zeile(`Bruttolohn ${n1}`, eur(r.p1.brutto))}
          ${zeile(`− Werbungskosten ${n1}`, eur(r.p1.wk), "", r.p1.wkPauschal ? "Pauschale" : "")}
          ${zeile(`Bruttolohn ${n2}`, eur(r.p2.brutto))}
          ${zeile(`− Werbungskosten ${n2}`, eur(r.p2.wk), "", r.p2.wkPauschal ? "Pauschale" : "")}
          ${zeile("+ Gewinn Einzelunternehmen", eur(r.gewinn), "", `Einnahmen ${eur(r.einnahmen)} − Ausgaben ${eur(r.ausgaben)}`)}
          ${zeile("= Gesamtbetrag der Einkünfte", eur(r.gde), "sum")}
          ${zeile("− Vorsorgeaufwendungen", eur(r.vorsorge), "", (r.p1.svGeschaetzt || r.p2.svGeschaetzt) ? "Renten-, Kranken-, Pflegeversicherung (teilweise geschätzt)" : "Renten-, Kranken-, Pflegeversicherung")}
          ${zeile("− Sonderausgaben-Pauschbetrag", eur(2 * SAP))}
          ${r.weitere ? zeile("− Weitere Abzüge", eur(r.weitere)) : ""}
          ${zeile("= Zu versteuerndes Einkommen", eur(r.zvE), "sum", z.kfbGuenstiger ? `abzgl. Kinderfreibetrag ${eur(r.kinder * r.p.kfb)} → ${eur(Math.max(0, r.zvE - r.kinder * r.p.kfb))}` : "")}
          ${zeile("Einkommensteuer (Splittingtarif)", eur(z.tariflich), "", r.kinder ? (z.kfbGuenstiger ? "Kinderfreibetrag ist günstiger als Kindergeld" : "Kindergeld ist günstiger als Kinderfreibetrag") : "")}
          ${z.anr ? zeile("− Anrechnung Gewerbesteuer (§ 35 EStG)", eur(z.anr)) : ""}
          ${z.hinzu ? zeile("+ Kindergeld (Hinzurechnung)", eur(z.hinzu)) : ""}
          ${zeile("= Festzusetzende Einkommensteuer", eur(z.est), "sum")}
          ${zeile("+ Solidaritätszuschlag", eur(z.soli), "", z.soli ? "" : `Freigrenze ${eur(2 * r.p.soliFG)} nicht überschritten`)}
          ${r.kistFaktor ? zeile(`+ Kirchensteuer (${esc(r.kistSatz)} %)`, eur(z.kist)) : ""}
          ${zeile("= Steuer Finanzamt", eur(z.summe), "sum")}
          ${zeile("− Bereits gezahlt (Lohnsteuer, Vorauszahlungen)", eur(r.gezahlt))}
          ${zeile(`= Voraussichtliche ${vz}`, eur(Math.abs(r.ergebnis)), "sum " + (r.ergebnis > 0 ? "neg" : "pos"))}
        </tbody></table></div></div>

        <div>
          <div class="card"><h3>Einzelunternehmen</h3><div class="tblwrap"><table class="tbl fitbl"><tbody>
            ${zeile("Gewinn", eur(r.gewinn))}
            ${zeile("Gewerbesteuer", eur(r.gw.gewst), "", r.gw.gewst ? `Messbetrag ${eur(r.gw.messbetrag)} × ${esc(CUR.hebesatz)} %` : `Freibetrag ${eur(GEW_FREIBETRAG)} nicht überschritten`)}
            ${zeile("Mehrsteuer durch das Unternehmen", eur(r.steuerUnternehmen), "sum", r.gewinn > 0 ? `${pct(r.steuerUnternehmen / r.gewinn)} vom Gewinn` : "")}
            ${zeile("Empfohlene Rücklage pro Monat", eur(Math.max(0, r.steuerUnternehmen) / 12), "", "für Steuernachzahlung zurücklegen")}
            ${zeile("Umsatz für Kleinunternehmergrenze", eur(r.einnahmen), "", r.einnahmen > 25000 ? "über 25.000 € – Kleinunternehmerregelung entfällt im Folgejahr" : "unter 25.000 €")}
          </tbody></table></div></div>

          <div class="card"><h3>Kennzahlen</h3><div class="tblwrap"><table class="tbl fitbl"><tbody>
            ${zeile("Durchschnittssteuersatz", pct(r.durchschnitt), "", "Steuer Finanzamt ÷ Einkünfte")}
            ${zeile("Grenzsteuersatz", pct(r.grenz), "", "auf jeden weiteren verdienten Euro")}
            ${zeile("Splittingvorteil", eur(r.splittingVorteil), "", `Einzelveranlagung wäre ${eur(r.summeEinzeln)}`)}
            ${zeile(`Kindergeld (${r.kinder} × ${eur(r.p.kg)} × 12)`, eur(r.kgJahr))}
            ${zeile(`Sozialversicherung ${n1}`, eur(r.p1.svGes), "", r.p1.svGeschaetzt ? "geschätzt" : "")}
            ${zeile(`Sozialversicherung ${n2}`, eur(r.p2.svGes), "", r.p2.svGeschaetzt ? "geschätzt" : "")}
          </tbody></table></div></div>
        </div>
      </div>
      <p class="small muted">Vereinfachte Schätzung nach § 32a EStG (${r.basisJahr}): Grundfreibetrag ${eur(r.p.gfb)}, Kinderfreibetrag ${eur(r.p.kfb)} je Kind, Soli-Freigrenze ${eur(2 * r.p.soliFG)} (zusammen).
        Nicht berücksichtigt u. a.: Riester, Unterhalt, Handwerkerleistungen, Progressionsvorbehalt (Elterngeld, Krankengeld, ALG), genaue Höchstbeträge der Vorsorgeaufwendungen.
        Als Einzelunternehmer mit Gewinn über 410 € seid ihr zur Abgabe der Steuererklärung verpflichtet. Für verbindliche Zahlen: Steuerberater oder Lohnsteuerhilfeverein.</p>`;
  }

  root.EFFinanzen = { render, berechne, tarif, splitting, soli, PARAM };
})(typeof window !== "undefined" ? window : globalThis);
