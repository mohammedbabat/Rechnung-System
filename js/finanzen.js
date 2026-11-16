// ============================================================
// Ein-Facher Rechnungen – Private Finanzen & Steuerübersicht (nur Administrator)
// Zusammenveranlagung (Splitting), Kinderfreibetrag-Günstigerprüfung, Soli, Kirchensteuer,
// Gewerbesteuer mit § 35-Anrechnung, Erstattung/Nachzahlung, Rücklage fürs Unternehmen,
// Lohnsteuer nach Steuerklasse (PAP 2026), Steuerklassen-Vergleich, Grafiken, Empfehlungen.
// Daten liegen in SharePoint in der Bibliothek EF_Privat (eigene Berechtigungen, nur Inhaber + Ehepartner).
// Alle Ergebnisse sind Schätzungen – keine Steuerberatung.
// ============================================================
(function (root) {
  "use strict";

  // ---------- Steuerparameter je Jahr ----------
  // Tarif nach § 32a EStG: Zone 1 bis gfb = 0; Zone 2 bis z2: (a2*y+1400)*y; Zone 3 bis z3: (a3*z+2397)*z+c3;
  // Zone 4 bis 277.825: 0,42x - c4; Zone 5: 0,45x - c5
  // w1–w3: Grenzbeträge Lohnsteuer Steuerklasse V/VI (§ 39b Abs. 2 Satz 7 EStG, PAP)
  const PARAM = {
    2025: { gfb: 12096, z2: 17443, a2: 932.30, z3: 68480, a3: 176.64, c3: 1015.13, c4: 10911.92, c5: 19246.67,
            kfb: 9600, kg: 255, soliFG: 19950, bbgRV: 96600, bbgKV: 66150, w1: 13785, w2: 34240, w3: 222260 },
    2026: { gfb: 12348, z2: 17799, a2: 914.51, z3: 69878, a3: 173.10, c3: 1034.87, c4: 11135.63, c5: 19470.38,
            kfb: 9756, kg: 259, soliFG: 20350, bbgRV: 101400, bbgKV: 69750, w1: 14071, w2: 34939, w3: 222260 }
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
  const ENTLASTUNG_II = 4260;  // Entlastungsbetrag Alleinerziehende (Steuerklasse II)
  const GEW_FREIBETRAG = 24500;
  const GEW_MESSZAHL = 0.035;
  const ANRECHNUNG_35 = 4.0;
  const KU_VORJAHR = 25000;    // § 19 UStG: Umsatz Vorjahr
  const KU_LAUFEND = 100000;   // § 19 UStG: Umsatz laufendes Jahr
  const VORAUSZAHLUNG_AB = 400; // § 37 Abs. 5 EStG
  const PFLICHT_NEBENEINK = 410; // § 46 Abs. 2 Nr. 1 EStG
  const STKL = ["I", "II", "III", "IV", "V", "VI"];

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

  // ---------- Lohnsteuer nach Steuerklasse (Jahresbetrag, vereinfacht nach PAP) ----------
  function up56(zx, p) {
    const diff = (tarif(zx * 1.25, p) - tarif(zx * 0.75, p)) * 2;
    return Math.max(diff, Math.floor(zx * 0.14));
  }
  function mst56(x, p) {
    if (x > p.w2) {
      let st = up56(p.w2, p);
      if (x > p.w3) { st = Math.floor(st + (p.w3 - p.w2) * 0.42); st = Math.floor(st + (x - p.w3) * 0.45); }
      else st = Math.floor(st + (x - p.w2) * 0.42);
      return st;
    }
    let st = up56(x, p);
    if (x > p.w1) st = Math.min(st, Math.floor(up56(p.w1, p) + (x - p.w1) * 0.42));
    return st;
  }
  function lohnsteuer(brutto, kl, p, vorsorge) {
    if (brutto <= 0) return 0;
    const anp = kl === "VI" ? 0 : ANP, sap = kl === "VI" ? 0 : SAP;
    const x = Math.floor(Math.max(0, brutto - anp - sap - vorsorge - (kl === "II" ? ENTLASTUNG_II : 0)));
    if (kl === "III") return splitting(x, p);
    if (kl === "V" || kl === "VI") return mst56(x, p);
    return tarif(x, p);
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
    const b1 = Math.max(0, num(pi.brutto)), b2 = Math.max(0, num(pi.brutto2));
    const brutto = b1 + b2;
    const kl = STKL.includes(pi.stkl) ? pi.stkl : "IV";
    const wk = brutto > 0 ? Math.min(brutto, Math.max(ANP, num(pi.wk))) : 0;
    const s = svSchaetzung(brutto, p, kinderlos);
    const svGeschaetzt = leer(pi.sv);
    const svGes = svGeschaetzt ? s.gesamt : Math.max(0, num(pi.sv));
    const svAbz = s.gesamt > 0 ? svGes * (s.abziehbar / s.gesamt) : 0;
    const vors1 = svSchaetzung(b1, p, kinderlos).abziehbar, vors2 = svSchaetzung(b2, p, kinderlos).abziehbar;
    const lst1Geschaetzt = leer(pi.lst) && b1 > 0;
    const lst1 = leer(pi.lst) ? lohnsteuer(b1, kl, p, vors1) : Math.max(0, num(pi.lst));
    const lst2Geschaetzt = leer(pi.lst2) && b2 > 0;
    const lst2 = b2 <= 0 ? 0 : (leer(pi.lst2) ? lohnsteuer(b2, "VI", p, vors2) : Math.max(0, num(pi.lst2)));
    return { name: pi.name, kl, b1, b2, brutto, wk, wkPauschal: wk === Math.min(brutto, ANP), einkuenfte: brutto - wk,
             svGes, svAbz, svGeschaetzt, vors1, lst1, lst2, lst: lst1 + lst2, lstGeschaetzt: lst1Geschaetzt || lst2Geschaetzt };
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
    const pp = n => person({ name: i[`p${n}_name`], stkl: i[`p${n}_stkl`], brutto: i[`p${n}_brutto`], wk: i[`p${n}_wk`], sv: i[`p${n}_sv`],
      lst: i[`p${n}_lst`], brutto2: i[`p${n}_brutto2`], lst2: i[`p${n}_lst2`] }, p, kinderlos);
    const p1 = pp(1), p2 = pp(2);
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
    const estUnternehmen = r2(zus.summe - ohneU.summe);
    const steuerUnternehmen = r2(estUnternehmen + gw.gewst);

    // Zum Vergleich: Einzelveranlagung beider Partner
    const einzeln = [p1, p2].map((pr, idx) => {
      const g = inhaber === idx + 1 ? gewinn : 0;
      const gwi = inhaber === idx + 1 ? gw : { messbetrag: 0, gewst: 0 };
      const z = Math.max(0, Math.floor(pr.einkuenfte + g - pr.svAbz - SAP - weitere / 2));
      return festsetzung({ zvE: z, kfb: kinder * p.kfb / 2, kgJahr: kgJahr / 2, tarifFn: x => tarif(x, p),
        messbetrag: gwi.messbetrag, gewst: gwi.gewst, soliFG: p.soliFG, kistSatz, kistFaktor });
    });
    const summeEinzeln = r2(einzeln[0].summe + einzeln[1].summe);

    // Steuerklassen-Vergleich (Hauptarbeitsverhältnis; Nebenjob bleibt Klasse VI)
    const kombis = [["IV", "IV"], ["III", "V"], ["V", "III"]].map(([a, b]) => {
      const l = lohnsteuer(p1.b1, a, p, p1.vors1) + p1.lst2 + lohnsteuer(p2.b1, b, p, p2.vors1) + p2.lst2;
      return { kl: a + "/" + b, lst: l, aktuell: p1.kl === a && p2.kl === b };
    });
    const lstIV = lohnsteuer(p1.b1, "IV", p, p1.vors1) + lohnsteuer(p2.b1, "IV", p, p2.vors1);
    const faktor = lstIV > 0 ? Math.min(0.999, Math.floor(ohneU.tariflich / lstIV * 1000) / 1000) : 0;

    const gezahlt = r2(p1.lst + p2.lst + Math.max(0, num(i.vorauszahlungen)));
    const ergebnis = r2(zus.summe - gezahlt);         // > 0 Nachzahlung, < 0 Erstattung
    const bruttoGesamt = p1.brutto + p2.brutto + gewinn;
    const netto = r2(bruttoGesamt - p1.svGes - p2.svGes - zus.summe - gw.gewst + kgJahr);
    const grenz = zvE > 0 ? (splitting(zvE + 200, p) - splitting(zvE, p)) / 200 : 0;
    const durchschnitt = gde > 0 ? zus.summe / gde : 0;

    return { p, basisJahr, exakt, kinder, kgJahr, p1, p2, inhaber, einnahmen, ausgaben, gewinn, gw, gde, vorsorge,
             zvE, zus, ohneU, estUnternehmen, steuerUnternehmen, einzeln, summeEinzeln, splittingVorteil: r2(summeEinzeln - zus.summe),
             kombis, faktor, gezahlt, ergebnis, bruttoGesamt, netto, grenz, durchschnitt, weitere, kistFaktor, kistSatz };
  }

  // Berechnung mit einem anderen Gewinn (für Grafik und Schwellen)
  const mitGewinn = (i, g) => berechne(Object.assign({}, i, { quelle: "manuell", einnahmenManuell: g + Math.max(0, num(i.ausgaben)) }), 0);

  // Kleinster Gewinn, ab dem test(r) zutrifft (monoton steigend), sonst null
  function abGewinn(i, test, max = 400000) {
    if (!test(mitGewinn(i, max))) return null;
    let lo = 0, hi = max;
    if (test(mitGewinn(i, 0))) return 0;
    while (hi - lo > 50) { const mid = Math.floor((lo + hi) / 2); if (test(mitGewinn(i, mid))) hi = mid; else lo = mid; }
    return Math.ceil(hi / 100) * 100;
  }

  // ---------- Oberfläche ----------
  const DEFAULT = {
    kinder: 1, kist: "keine", kistSatz: 9,
    p1_name: "Mohammed", p1_stkl: "IV", p1_brutto: "", p1_wk: "", p1_sv: "", p1_lst: "", p1_brutto2: "", p1_lst2: "",
    p2_name: "Ehefrau", p2_stkl: "IV", p2_brutto: "", p2_wk: "", p2_sv: "", p2_lst: "", p2_brutto2: "", p2_lst2: "",
    inhaber: "1", quelle: "ef", einnahmenManuell: "", ausgaben: "", hebesatz: 500,
    vorauszahlungen: "", weitereAbzuege: ""
  };
  const LOCAL_KEY = "ef_finanzen_lokal";
  const FARBE = { netto: "#7B2FBE", sv: "#A898C8", est: "#F97316", gewst: "#DB2777", grenze: "#DC2626", hilf: "#94A3B8" };
  let STORE = null, LOADED = false, LOAD_ERR = null, CUR = null, API = null;
  // Speicherort: SharePoint-Bibliothek EF_Privat (eigene Berechtigungen, nur Inhaber + Ehepartner)
  let ZUGRIFF = null, KEIN_ZUGRIFF = false;
  const istAdmin = api => !!api.S.me && api.S.me.Rolle === "Administrator";

  const $ = s => document.querySelector(s);
  const lokalLesen = () => { try { return JSON.parse(window.localStorage.getItem(LOCAL_KEY) || "null"); } catch (_) { return null; } };
  const lokalSchreiben = s => { try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(s)); return true; } catch (_) { return false; } };

  async function laden(api) {
    KEIN_ZUGRIFF = false; ZUGRIFF = null;
    try {
      const r = await api.G.privatLaden(istAdmin(api));     // Administrator legt die Bibliothek bei Bedarf an
      if (!r.bibliothek) KEIN_ZUGRIFF = true;
      STORE = r.daten;
      try { ZUGRIFF = await api.G.privatZugriff(); } catch (_) { ZUGRIFF = null; }
      LOAD_ERR = null;
    } catch (e) {
      if (/403|accessDenied|404|itemNotFound/i.test(e.message)) KEIN_ZUGRIFF = true;
      else LOAD_ERR = e.message;
      STORE = lokalLesen();
    }
    STORE = STORE || { version: 1, jahre: {} };
    if (!STORE.jahre) STORE.jahre = {};
    LOADED = true;
  }

  function einnahmenAusApp(api, quelle, jahr) {
    const monate = new Array(12).fill(0);
    if (!quelle || quelle === "manuell") return { summe: 0, anzahl: 0, monate };
    const liste = api.S.belege.filter(b => b.Firma === quelle && b.Typ === "Rechnung" && b.Status === "Bezahlt" &&
      String(b.BezahltAm || "").startsWith(String(jahr)));
    liste.forEach(b => { const m = Number(String(b.BezahltAm).slice(5, 7)) - 1; if (m >= 0 && m < 12) monate[m] += api.P.totals(b).netto; });
    return { summe: r2(liste.reduce((a, b) => a + api.P.totals(b).netto, 0)), anzahl: liste.length, monate: monate.map(r2) };
  }

  const pct = n => (Math.round(n * 1000) / 10).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";
  const kEur = v => Math.abs(v) >= 1000 ? (v / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " T€" : Math.round(v) + " €";

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
      api.view(`<div class="card">Lade Finanzdaten aus SharePoint …</div>`);
      api.busy(async () => { await laden(api); render(api, sub); });
      return;
    }
    if (KEIN_ZUGRIFF) {
      api.view(`<div class="head"><h1>Finanzen <span class="muted">· privat</span></h1></div>
        <div class="card noaccess"><h2>Kein Zugriff auf die Finanzdaten</h2>
        <p>Die Finanzdaten liegen in SharePoint in der geschützten Bibliothek <strong>${api.esc(api.G.privatBibliothek())}</strong>.</p>
        <p class="muted">Ein Administrator muss dein Konto <strong>${api.esc((api.S.me && api.S.me.Title) || "")}</strong> dort berechtigen
          (Finanzen-Seite → „Zugriff &amp; Schutz“).</p></div>`);
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
    const stklOpts = STKL.map(k => [k, "Klasse " + k]);

    api.view(`
      <div class="head"><h1>Finanzen <span class="muted">· privat</span></h1><span class="grow"></span>
        <select id="fiJahr">${jahre.map(y => `<option ${y === jahr ? "selected" : ""}>${y}</option>`).join("")}</select>
        <button class="btn primary" id="fiSave" type="button">Speichern</button></div>
      ${LOAD_ERR ? `<div class="card warnbox"><strong>SharePoint nicht erreichbar:</strong> ${api.esc(LOAD_ERR)}<br>
        Die Daten werden vorerst nur in diesem Browser gespeichert.</div>` : ""}
      ${statusHtml(api)}
      <div class="card"><h3>Haushalt</h3><div class="grid g4">
        ${feld("kinder", "Kinder (mit Kindergeld)")}
        ${feld("kist", "Kirchensteuer", { options: [["keine", "keine"], ["eine", "eine Person (≈ hälftig)"], ["beide", "beide"]] })}
        ${feld("kistSatz", "Kirchensteuersatz % (NRW 9)")}
        ${feld("weitereAbzuege", "Weitere Abzüge € (Spenden, außergew. Belastungen …)")}
      </div></div>

      <div class="grid fi2">
        ${[1, 2].map(n => `<div class="card"><div class="row between"><h3>${n === 1 ? "Person 1" : "Person 2 (Ehepartner)"}</h3>
          <button class="btn ghost small" type="button" data-hoch="${n}">📄 Gehaltsabrechnung hochladen</button></div><div class="grid">
          ${feld(`p${n}_name`, "Name", { text: true })}
          ${feld(`p${n}_stkl`, "Steuerklasse", { options: stklOpts })}
          ${feld(`p${n}_brutto`, "Bruttoarbeitslohn im Jahr € (Hauptjob)", { ph: "0" })}
          ${feld(`p${n}_lst`, "Lohnsteuer + Soli + KiSt im Jahr € (leer = Schätzung)", { ph: "automatisch" })}
          ${feld(`p${n}_sv`, "Sozialversicherung AN-Anteil € (leer = Schätzung)", { ph: "automatisch" })}
          ${feld(`p${n}_wk`, "Werbungskosten € (leer = Pauschale 1.230)", { ph: "1230" })}
          ${feld(`p${n}_brutto2`, "Brutto 2. Arbeitgeber € (z. B. früherer Job)", { ph: "0" })}
          ${feld(`p${n}_lst2`, "Lohnsteuer 2. Arbeitgeber € (leer = Klasse VI geschätzt)", { ph: "automatisch" })}
        </div><p class="small muted">Werte stehen auf der Lohnsteuerbescheinigung bzw. in den Jahreswerten der Gehaltsabrechnung. Minijobs mit Pauschalsteuer nicht eintragen.</p></div>`).join("")}
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

      <div id="fiRes"></div>
      ${istAdmin(api) ? zugriffHtml(api) : ""}`);

    const onChange = e => {
      const k = e.target.dataset.k;
      if (!k) return;
      CUR[k] = e.target.value;
      STORE.jahre[jahr] = Object.assign({}, CUR);
      $("#fiSave").textContent = "Speichern *";
      renderRes();
    };
    document.querySelectorAll("[data-k]").forEach(el => { el.oninput = onChange; el.onchange = onChange; });
    document.querySelectorAll("[data-hoch]").forEach(b => { b.onclick = () => hochrechnenDialog(Number(b.dataset.hoch)); });
    $("#fiJahr").onchange = e => { location.hash = "#/finanzen/" + e.target.value; };
    $("#fiSave").onclick = speichern;
    renderRes();
  }

  function speichern() {
    STORE.jahre[CUR.jahr] = Object.assign({}, CUR);
    STORE.geaendert = new Date().toISOString();
    API.busy(async () => {
      try {
        await API.G.privatSpeichern(STORE);
        const neu = !ZUGRIFF;
        if (neu) { try { ZUGRIFF = await API.G.privatZugriff(); } catch (_) { /* egal */ } }
        LOAD_ERR = null;
        $("#fiSave").textContent = "Speichern";
        API.toast("In SharePoint gespeichert (" + API.G.privatBibliothek() + ")");
        if (neu) render(API, CUR.jahr);
      } catch (e) {
        lokalSchreiben(STORE);
        API.toast("SharePoint-Fehler – nur in diesem Browser gespeichert: " + e.message, "err");
      }
    });
  }

  // ---------- Zugriff & Schutz der Bibliothek EF_Privat ----------
  function statusHtml(api) {
    const bib = api.esc(api.G.privatBibliothek());
    if (!ZUGRIFF) return `<p class="small muted">Gespeichert wird in SharePoint in der Bibliothek <strong>${bib}</strong> (wird beim ersten Speichern angelegt).
      Alle Werte sind <strong>Schätzungen</strong> nach vereinfachter Berechnung – keine Steuerberatung.</p>`;
    const namen = ZUGRIFF.personen.map(p => p.name).join(", ");
    if (ZUGRIFF.offen.length && istAdmin(api)) return `<div class="card warnbox">⚠️ <strong>Noch nicht geschützt:</strong> Die Bibliothek ${bib} ist noch für
      <strong>${api.esc(ZUGRIFF.offen.map(g => g.name).join(", "))}</strong> sichtbar – also für alle Benutzer der Site. Schritte siehe unten bei „Zugriff &amp; Schutz“.</div>`;
    return `<p class="small muted">🔒 Gespeichert in SharePoint, Bibliothek <strong>${bib}</strong>${namen ? " – Zugriff: <strong>" + api.esc(namen) + "</strong>" : ""}.
      Alle Werte sind <strong>Schätzungen</strong> nach vereinfachter Berechnung – keine Steuerberatung.</p>`;
  }

  function zugriffHtml(api) {
    const bib = api.esc(api.G.privatBibliothek());
    const z = ZUGRIFF;
    const berechtigte = api.S.benutzer.filter(b => b.Aktiv !== "Nein" && (b.Rolle === "Administrator" || b.Finanzen === "Ja"));
    const hat = email => z && z.personen.some(p => p.email && p.email === String(email || "").toLowerCase());
    return `<div class="card" id="fgCard"><h3>🔒 Zugriff &amp; Schutz</h3>
      ${!z ? `<p class="small muted">Die Bibliothek ${bib} wird beim ersten Speichern angelegt. Danach erscheinen hier die Schritte zum Schützen.</p>` : `
      <div class="tblwrap"><table class="tbl fitbl"><thead><tr><th>Wer</th><th>Zugriff auf ${bib}</th></tr></thead><tbody>
        ${z.offen.map(g => `<tr><td>${api.esc(g.name)} <span class="small muted">(Gruppe)</span></td><td class="neg">offen – entfernen</td></tr>`).join("")}
        ${berechtigte.map(b => `<tr><td>${api.esc(b.Name)} <span class="small muted">${api.esc(b.Title)}</span></td>
          <td class="${hat(b.Title) || z.offen.length ? "pos" : "neg"}">${hat(b.Title) ? "✓ direkt berechtigt" : z.offen.length ? "über Gruppe" : "fehlt – hinzufügen"}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="small"><strong>Einmalig in SharePoint einrichten</strong> (Seite → Zahnrad → <em>Websiteinhalte</em> → ${bib} → Zahnrad → <em>Bibliothekseinstellungen</em> → <em>Berechtigungen für diese Dokumentbibliothek</em>):</p>
      <ol class="small steps">
        <li><em>Berechtigungsvererbung beenden</em> → OK</li>
        <li><em>Berechtigungen erteilen</em> → dich und deine Frau eintragen → Berechtigungsstufe <strong>Bearbeiten</strong> → Einladung abwählen → Freigeben</li>
        <li>Die Gruppen <strong>Mitglieder</strong> und <strong>Besucher</strong> anhaken → <em>Benutzerberechtigungen entfernen</em></li>
        <li>Diese Seite neu laden – oben muss dann „🔒 Gespeichert in SharePoint“ stehen.</li>
      </ol>
      <p class="small muted">Die Person braucht außerdem unter Einstellungen → Benutzer <strong>Finanzen = Ja</strong>, damit die Seite in der App erscheint.
        Besitzer der Site (Website-Administratoren) behalten technisch immer Zugriff.</p>`}
    </div>`;
  }

  // ---------- Gehaltsabrechnung hochladen / Hochrechnung aufs Jahr ----------
  const MONATSNAMEN = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

  function hochrechnenDialog(n, datei) {
    const esc = API.esc, eur = API.eur, mon = Math.max(1, Number(API.today().slice(5, 7)) - 1);
    const name = CUR[`p${n}_name`] || ("Person " + n);
    let erkannt = {};   // Steuerklasse, Kinder, Kirchensteuer aus dem PDF
    $("#modalBox").innerHTML = `<h2>Gehaltsabrechnung – ${esc(name)}</h2>
      <div class="dropzone" id="hfDrop">
        <div><strong>PDF hier hineinziehen</strong> oder <label class="link">Datei auswählen<input type="file" id="hfFile" accept="application/pdf,.pdf" hidden></label></div>
        <div class="small muted">Monatsabrechnung oder Lohnsteuerbescheinigung. Die Datei wird nur in deinem Browser gelesen – sie wird nicht hochgeladen oder gespeichert.</div>
      </div>
      <div id="hfInfo"></div>
      <p class="small muted">Oder Werte von Hand eintragen: „Jahreswert“ = Spalte rechts (bisher im Jahr), „Monat“ = Betrag des Abrechnungsmonats.
        Gerechnet wird: Jahreswert bisher + Monatsbetrag × restliche Monate.</p>
      <form id="hf" class="grid">
        <label class="wide">Abrechnungsmonat<select name="m">${MONATSNAMEN
          .map((t, i) => `<option value="${i + 1}" ${i + 1 === mon ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label>Steuerbrutto Jahreswert bisher €<input name="bj" type="number" step="0.01" required></label>
        <label>Steuerbrutto Monat €<input name="bm" type="number" step="0.01" required></label>
        <label>Lohnsteuer (+ Soli + KiSt) Jahreswert bisher €<input name="lj" type="number" step="0.01"></label>
        <label>Lohnsteuer (+ Soli + KiSt) Monat €<input name="lm" type="number" step="0.01"></label>
        <label>SV Jahreswerte bisher (KV + PV + RV + AV) €<input name="sj" type="number" step="0.01"></label>
        <label>SV Monat (KV + PV + RV + AV) €<input name="sm" type="number" step="0.01"></label>
        <p class="wide small" id="hfVor"></p>
        <div class="actions wide"><span class="grow"></span><button type="button" class="btn ghost" id="hfC">Abbrechen</button><button class="btn primary">Übernehmen</button></div>
      </form>`;
    $("#modal").classList.remove("hidden");
    const close = () => { $("#modal").classList.add("hidden"); $("#modalBox").innerHTML = ""; };
    const f = $("#hf");
    const calc = () => {
      const m = Number(f.elements.m.value), rest = 12 - m, v = k => Math.abs(num(f.elements[k].value));
      return { brutto: r2(v("bj") + v("bm") * rest), lst: f.elements.lj.value === "" ? "" : r2(v("lj") + v("lm") * rest),
               sv: f.elements.sj.value === "" ? "" : r2(v("sj") + v("sm") * rest) };
    };
    const vorschau = () => {
      const c = calc();
      $("#hfVor").innerHTML = f.elements.bj.value === "" ? "" : `<strong>Ergebnis fürs ganze Jahr:</strong> Brutto ${eur(c.brutto)}${c.lst !== "" ? " · Lohnsteuer " + eur(c.lst) : ""}${c.sv !== "" ? " · Sozialversicherung " + eur(c.sv) : ""}`;
    };
    f.oninput = vorschau;

    async function verarbeite(file) {
      if (!file) return;
      if (!root.EFAbrechnung) { API.toast("PDF-Leser fehlt (js/abrechnung.js)", "err"); return; }
      $("#hfInfo").innerHTML = `<p class="small muted">Lese ${esc(file.name)} …</p>`;
      let r;
      try { r = await root.EFAbrechnung.lese(file); }
      catch (e) { $("#hfInfo").innerHTML = `<div class="hfbox warn">PDF konnte nicht gelesen werden: ${esc(e.message)}</div>`; return; }
      if (!r.textGefunden) { $("#hfInfo").innerHTML = `<div class="hfbox warn">In diesem PDF ist kein Text enthalten (eingescannt/Foto). Bitte die Werte unten von Hand eintragen.</div>`; return; }
      const setze = (k, v) => { if (v != null && f.elements[k]) f.elements[k].value = v; };
      setze("m", r.monat); setze("bj", r.bj); setze("bm", r.bm); setze("lj", r.lj); setze("lm", r.lm); setze("sj", r.sj); setze("sm", r.sm);
      erkannt = {};
      if (r.stkl) erkannt.stkl = r.stkl;
      if (r.kinderfreibetrag != null) erkannt.kinder = Math.ceil(r.kinderfreibetrag);
      if (r.kist) erkannt.kist = r.kist;
      const ok = [];
      if (r.typ === "jahr") ok.push(`Lohnsteuerbescheinigung ${r.jahr || ""}`.trim());
      else if (r.monat) ok.push(`Abrechnung ${MONATSNAMEN[r.monat - 1]} ${r.jahr || ""}`.trim());
      if (r.stkl) ok.push("Steuerklasse " + r.stkl);
      if (r.kinderfreibetrag != null) ok.push("Kinderfreibetrag " + String(r.kinderfreibetrag).replace(".", ","));
      if (r.kist === "keine") ok.push("keine Kirchensteuer");
      if (r.bj != null) ok.push(`Steuerbrutto ${r.bm ? eur(r.bm) + " / " : ""}${eur(r.bj)}`);
      if (r.lj != null) ok.push(`Lohnsteuer ${r.lm ? eur(r.lm) + " / " : ""}${eur(r.lj)}`);
      if (r.sj != null) ok.push(`Sozialversicherung ${r.sm ? eur(r.sm) + " / " : ""}${eur(r.sj)}`);
      const warn = r.fehlt.slice();
      if (r.jahr && String(r.jahr) !== String(CUR.jahr)) warn.unshift(`Die Abrechnung ist aus ${r.jahr}, angezeigt wird ${CUR.jahr}.`);
      $("#hfInfo").innerHTML = `<div class="hfbox ok"><strong>Erkannt:</strong> ${ok.map(esc).join(" · ") || "–"}</div>
        ${warn.length ? `<div class="hfbox warn"><strong>Bitte prüfen:</strong> ${warn.map(esc).join(" · ")}</div>` : ""}
        <p class="small muted">Die Felder unten sind ausgefüllt – kurz vergleichen, dann „Übernehmen“.</p>`;
      vorschau();
    }
    $("#hfFile").onchange = e => verarbeite(e.target.files[0]);
    const drop = $("#hfDrop");
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); verarbeite(e.dataTransfer.files[0]); };
    if (datei) verarbeite(datei);

    $("#hfC").onclick = close;
    f.onsubmit = e => {
      e.preventDefault();
      const c = calc();
      CUR[`p${n}_brutto`] = c.brutto;
      if (c.lst !== "") CUR[`p${n}_lst`] = c.lst;
      if (c.sv !== "") CUR[`p${n}_sv`] = c.sv;
      if (erkannt.stkl) CUR[`p${n}_stkl`] = erkannt.stkl;
      if (erkannt.kinder != null && n === 1) CUR.kinder = erkannt.kinder;
      if (erkannt.kist === "keine" && CUR.kist === "beide") CUR.kist = "eine";
      STORE.jahre[CUR.jahr] = Object.assign({}, CUR);
      close();
      render(API, CUR.jahr);
      $("#fiSave").textContent = "Speichern *";
      API.toast("Werte übernommen – bitte speichern");
    };
  }

  // ---------- Grafiken (SVG) ----------
  function svgVerteilung(r) {
    const teile = [
      ["Netto (ohne Kindergeld)", Math.max(0, r.netto - r.kgJahr), FARBE.netto],
      ["Sozialversicherung", r.p1.svGes + r.p2.svGes, FARBE.sv],
      ["Einkommensteuer + Soli + KiSt", r.zus.summe, FARBE.est],
      ["Gewerbesteuer", r.gw.gewst, FARBE.gewst]
    ].filter(t => t[1] > 0);
    const total = teile.reduce((a, t) => a + t[1], 0);
    if (!total) return `<p class="empty">Noch keine Einkommen eingetragen.</p>`;
    let x = 0;
    const rects = teile.map(([l, v, c]) => {
      const w = v / total * 600, s = `<rect x="${x}" y="0" width="${Math.max(0, w - 1)}" height="34" rx="4" fill="${c}"><title>${l}: ${API.eur(v)}</title></rect>
        ${w > 46 ? `<text x="${x + w / 2}" y="22" text-anchor="middle" fill="#fff" font-size="12" font-weight="600">${pct(v / total)}</text>` : ""}`;
      x += w; return s;
    }).join("");
    return `<svg viewBox="0 0 600 34" class="chart" role="img" aria-label="Aufteilung des Bruttoeinkommens">${rects}</svg>
      <div class="legend">${teile.map(([l, v, c]) => `<span><i style="background:${c}"></i>${l}: <strong>${API.eur(v)}</strong></span>`).join("")}</div>`;
  }

  function svgGewinnKurve(r) {
    const i = CUR, akt = Math.max(0, r.gewinn), aus = Math.max(0, num(i.ausgaben));
    const xMax = Math.min(200000, Math.max(30000, Math.ceil(Math.max(akt * 1.6, KU_VORJAHR - aus + 5000, GEW_FREIBETRAG + 5000) / 5000) * 5000));
    const N = 40, pts = [];
    for (let k = 0; k <= N; k++) { const g = xMax * k / N, rr = mitGewinn(i, g); pts.push({ g, steuer: rr.steuerUnternehmen, bleibt: g - rr.steuerUnternehmen }); }
    const W = 960, H = 280, L = 60, R = 16, T = 30, B = 34, pw = W - L - R, ph = H - T - B;
    const yMax = Math.max(1000, Math.ceil(Math.max(...pts.map(p => p.bleibt)) / 5000) * 5000);
    const X = g => L + g / xMax * pw, Y = v => T + ph - v / yMax * ph;
    const linie = (key, c) => `<polyline fill="none" stroke="${c}" stroke-width="2.5" points="${pts.map(p => X(p.g).toFixed(1) + "," + Y(p[key]).toFixed(1)).join(" ")}"/>`;
    let grid = "";
    for (let k = 0; k <= 4; k++) {
      const v = yMax * k / 4, y = Y(v);
      grid += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#E5E7EB"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6B7780">${kEur(v)}</text>`;
      const gx = xMax * k / 4;
      grid += `<text x="${X(gx)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#6B7780">${kEur(gx)}</text>`;
    }
    const vline = (g, txt, c, ty, anchor) => g > 0 && g < xMax ? `<line x1="${X(g)}" x2="${X(g)}" y1="${T - 4}" y2="${T + ph}" stroke="${c}" stroke-dasharray="4 4"/>
      <text x="${X(g) + (anchor === "end" ? -5 : 5)}" y="${ty}" text-anchor="${anchor}" font-size="11" fill="${c}">${txt}</text>` : "";
    const kuG = KU_VORJAHR - aus, links = kuG < GEW_FREIBETRAG;
    const rAkt = mitGewinn(i, akt);
    const punkt = `<circle cx="${X(akt)}" cy="${Y(akt - rAkt.steuerUnternehmen)}" r="5" fill="${FARBE.netto}" stroke="#fff" stroke-width="2"><title>Dein Stand: Gewinn ${API.eur(akt)}</title></circle>`;
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Was vom Gewinn bleibt">
      ${grid}${vline(kuG, "Umsatz 25.000 €", FARBE.grenze, T - 14, links ? "end" : "start")}${vline(GEW_FREIBETRAG, "Gewerbesteuer-Freibetrag", FARBE.gewst, T - 14, links ? "start" : "end")}
      ${linie("bleibt", FARBE.netto)}${linie("steuer", FARBE.est)}${punkt}
      <text x="${W - R}" y="${H - 1}" text-anchor="end" font-size="10.5" fill="#6B7780">Gewinn im Jahr →</text></svg>
      <div class="legend"><span><i style="background:${FARBE.netto}"></i>Bleibt dir nach Steuern</span><span><i style="background:${FARBE.est}"></i>Steuer auf den Gewinn</span>
        <span><i class="ring"></i>Dein Stand</span></div>`;
  }

  function svgMonate(monate, vorjahr) {
    const W = 600, H = 220, L = 50, R = 54, T = 14, B = 28, pw = W - L - R, ph = H - T - B;
    const kum = []; monate.reduce((a, v, k) => (kum[k] = a + v), 0);
    const mMax = Math.max(500, ...monate) * 1.15, kMax = Math.max(KU_VORJAHR * 1.1, kum[11] * 1.05);
    const bw = pw / 12;
    const Yl = v => T + ph - v / mMax * ph, Yr = v => T + ph - v / kMax * ph;
    const bars = monate.map((v, k) => `<rect x="${L + k * bw + 4}" y="${Yl(v)}" width="${bw - 8}" height="${T + ph - Yl(v)}" rx="3" fill="${FARBE.netto}" opacity=".85"><title>${API.eur(v)}</title></rect>
      <text x="${L + k * bw + bw / 2}" y="${H - 10}" text-anchor="middle" font-size="10.5" fill="#6B7780">${"JFMAMJJASOND"[k]}</text>`).join("");
    const linie = `<polyline fill="none" stroke="${FARBE.est}" stroke-width="2.5" points="${kum.map((v, k) => (L + k * bw + bw / 2).toFixed(1) + "," + Yr(v).toFixed(1)).join(" ")}"/>`;
    const g = Yr(KU_VORJAHR);
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Umsatz pro Monat">
      <line x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}" stroke="#E5E7EB"/>
      <text x="${L - 6}" y="${T + 10}" text-anchor="end" font-size="10.5" fill="#6B7780">${kEur(mMax)}</text>
      ${bars}<line x1="${L}" x2="${W - R}" y1="${g}" y2="${g}" stroke="${FARBE.grenze}" stroke-dasharray="5 4"/>
      <text x="${W - R + 6}" y="${g + 4}" font-size="10.5" fill="${FARBE.grenze}">25 T€</text>${linie}</svg>
      <div class="legend"><span><i style="background:${FARBE.netto}"></i>Umsatz im Monat (linke Skala)</span><span><i style="background:${FARBE.est}"></i>Summe seit Januar (rechte Skala)</span>
        <span><i style="background:${FARBE.grenze}"></i>Kleinunternehmergrenze</span>${vorjahr != null ? `<span>Vorjahr gesamt: <strong>${API.eur(vorjahr)}</strong></span>` : ""}</div>`;
  }

  // ---------- Empfehlungen ----------
  function empfehlungen(r, auto, vorjahrUmsatz) {
    const eur = API.eur, out = [], add = (lvl, titel, text) => out.push({ lvl, titel, text });
    const i = CUR, jahr = Number(i.jahr), heute = API.today(), istAktuell = String(jahr) === heute.slice(0, 4);
    const monat = istAktuell ? Number(heute.slice(5, 7)) : 12;
    const firma = (API.S.firmen.find(f => f.key === i.quelle) || {}).d;
    const istKU = !firma || firma.Steuer !== "Regelbesteuert (mit USt)";
    const U = r.einnahmen;

    // 1. Kleinunternehmergrenze
    if (istKU) {
      const rest = KU_VORJAHR - U;
      const prognose = istAktuell && monat > 0 ? U / monat * 12 : U;
      if (U > KU_LAUFEND) add("crit", "Über 100.000 € Umsatz", "Die Kleinunternehmerregelung entfällt sofort ab dem Umsatz, mit dem die Grenze überschritten wird. Ab dann Rechnungen mit Umsatzsteuer stellen – bitte Steuerberater einbeziehen.");
      else if (rest < 0) add("warn", `Kleinunternehmergrenze überschritten (+${eur(-rest)})`,
        `Mit ${eur(U)} Umsatz in ${jahr} bist du ab ${jahr + 1} regelbesteuert: Rechnungen mit 19 % USt, monatliche/vierteljährliche Umsatzsteuer-Voranmeldung. Plane Preise so, dass die 19 % nicht von deiner Marge abgehen.`);
      else {
        let txt = `Du kannst in ${jahr} noch <strong>${eur(rest)}</strong> Umsatz machen und bleibst ${jahr + 1} Kleinunternehmer (ohne Umsatzsteuer).`;
        if (istAktuell && prognose > KU_VORJAHR && U > 0) {
          const mon = Math.ceil(KU_VORJAHR / (U / monat));
          txt += ` Beim aktuellen Tempo (${eur(U / monat)} pro Monat) wäre die Grenze etwa im ${["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"][Math.min(11, mon - 1)]} erreicht.`;
        }
        txt += " Es zählt das Geld, das im Jahr tatsächlich eingeht: Eine Zahlung, die erst im Januar ankommt, zählt zum neuen Jahr – Rechnungen aber immer mit dem echten Datum ausstellen.";
        add(rest < 3000 ? "warn" : "ok", rest < 3000 ? "Kleinunternehmergrenze fast erreicht" : "Kleinunternehmergrenze", txt);
      }
      if (vorjahrUmsatz != null && vorjahrUmsatz > KU_VORJAHR) add("warn", `Vorjahr über 25.000 € (${eur(vorjahrUmsatz)})`, `Damit bist du in ${jahr} nicht mehr Kleinunternehmer – Rechnungen müssen Umsatzsteuer ausweisen.`);
    }

    // 2. Gewerbesteuer
    if (r.gewinn > 0) {
      if (r.gewinn <= GEW_FREIBETRAG) add("ok", "Keine Gewerbesteuer", `Bis ${eur(GEW_FREIBETRAG)} Gewinn fällt keine Gewerbesteuer an – du hast noch <strong>${eur(GEW_FREIBETRAG - r.gewinn)}</strong> Luft.`);
      else add("info", "Gewerbesteuer fällig", `${eur(r.gw.gewst)} Gewerbesteuer an die Stadt. Davon werden ${eur(r.zus.anr)} auf die Einkommensteuer angerechnet – bei Hebesatz ${num(i.hebesatz)} % kostet sie dich effektiv nur ${eur(Math.max(0, r.gw.gewst - r.zus.anr))}.`);
    }

    // 3. Grenzsteuersatz – was bleibt vom nächsten Euro
    if (r.zvE > 0) {
      const bleibt = Math.round(100 * (1 - r.grenz * (1 + (r.zus.soli > 0 ? 0.055 : 0) + r.kistSatz / 100 * r.kistFaktor)));
      const spitze = abGewinn(i, x => x.grenz >= 0.42);
      add("info", `Von jedem weiteren 100 € Gewinn bleiben ca. ${bleibt} €`,
        `Dein Grenzsteuersatz liegt bei ${pct(r.grenz)}.${spitze != null && spitze > r.gewinn ? ` Den Spitzensteuersatz von 42 % erreicht ihr erst ab ca. ${eur(spitze)} Gewinn.` : ""} Mehr arbeiten lohnt sich also immer – es gibt keine Stufe, ab der weniger übrig bleibt.`);
    }

    // 4. Soli
    const soliAb = abGewinn(i, x => x.zus.soli > 0);
    if (r.zus.soli === 0 && soliAb != null && soliAb > r.gewinn) add("ok", "Kein Solidaritätszuschlag", `Der Soli fällt bei euch erst ab ca. ${eur(soliAb)} Gewinn an (Freigrenze ${eur(2 * r.p.soliFG)} Einkommensteuer).`);

    // 5. Rücklage + Vorauszahlungen
    if (r.steuerUnternehmen > 0) {
      add("info", `Rücklage: ${eur(r.steuerUnternehmen / 12)} pro Monat`,
        `Das Unternehmen erhöht eure Steuer um ca. ${eur(r.steuerUnternehmen)} (${pct(r.gewinn > 0 ? r.steuerUnternehmen / r.gewinn : 0)} vom Gewinn). Lege diesen Anteil von jeder Zahlung auf ein Tagesgeldkonto.`);
      if (r.estUnternehmen >= VORAUSZAHLUNG_AB) add("warn", "Vorauszahlungen wahrscheinlich",
        `Ab ${eur(VORAUSZAHLUNG_AB)} Einkommensteuer im Jahr auf Nebeneinkünfte setzt das Finanzamt nach der ersten Erklärung meist vierteljährliche Vorauszahlungen fest (10.03., 10.06., 10.09., 10.12.). Rechne mit ca. ${eur(r.estUnternehmen / 4)} pro Quartal.`);
    }

    // 6. Erstattung / Nachzahlung
    if (r.ergebnis > 1000) add("warn", `Nachzahlung von ca. ${eur(r.ergebnis)} erwartet`, "Rücklage bilden. Alternativ kann ein Steuerklassenwechsel oder das Faktorverfahren die monatliche Lohnsteuer besser anpassen (siehe Vergleich unten).");
    else if (r.ergebnis < -300) add("ok", `Erstattung von ca. ${eur(-r.ergebnis)} erwartet`, "Die Steuererklärung lohnt sich für euch.");

    // 7. Betriebsausgaben vor Jahresende
    if (istAktuell && monat >= 10 && r.gewinn > 0) add("info", "Anschaffungen vor dem 31.12.",
      `Was du für das Unternehmen sowieso brauchst (z. B. Laptop, Software, Fachbücher), mindert den Gewinn noch in ${jahr}. Geräte bis 800 € netto kannst du sofort voll absetzen. Ersparnis ca. ${pct(r.grenz)} des Betrags – kaufe aber nichts nur wegen der Steuer.`);

    // 8. Pflicht zur Steuererklärung
    if (r.gewinn > PFLICHT_NEBENEINK || r.p1.kl === "III" || r.p1.kl === "V" || r.p2.kl === "III" || r.p2.kl === "V" || r.p1.b2 > 0 || r.p2.b2 > 0) {
      const gruende = [];
      if (r.gewinn > PFLICHT_NEBENEINK) gruende.push(`Gewinn über ${PFLICHT_NEBENEINK} €`);
      if ([r.p1.kl, r.p2.kl].some(k => k === "III" || k === "V")) gruende.push("Steuerklasse III/V");
      if (r.p1.b2 > 0 || r.p2.b2 > 0) gruende.push("mehrere Arbeitgeber");
      add("info", "Steuererklärung ist Pflicht", `Grund: ${gruende.join(", ")}. Abgabe für ${jahr} bis 31.07.${jahr + 1} (mit Steuerberater/Lohnsteuerhilfeverein später).`);
    }
    return out;
  }

  // ---------- Ergebnisse ----------
  function renderRes() {
    const api = API, eur = api.eur, esc = api.esc;
    const auto = einnahmenAusApp(api, CUR.quelle, CUR.jahr);
    $("#fiAuto").value = CUR.quelle === "manuell" ? "–" : eur(auto.summe);
    $("#fiAutoInfo").textContent = CUR.quelle === "manuell" ? "" :
      `${auto.anzahl} bezahlte Rechnung(en) mit Zahlungsdatum in ${CUR.jahr} (Netto, nach Zuflussprinzip).`;
    const r = berechne(CUR, auto.summe);
    const z = r.zus;
    const vj = String(Number(CUR.jahr) - 1);
    const vorjahrUmsatz = CUR.quelle === "manuell" && !STORE.jahre[vj] ? null
      : r2(einnahmenAusApp(api, CUR.quelle, vj).summe + num((STORE.jahre[vj] || {}).einnahmenManuell));
    const vz = r.ergebnis > 0 ? "Nachzahlung" : "Erstattung";
    const zeile = (l, v, cls = "", hint = "") => `<tr class="${cls}"><td>${l}${hint ? `<div class="small muted">${hint}</div>` : ""}</td><td class="r">${v}</td></tr>`;
    const n1 = esc(r.p1.name || "Person 1"), n2 = esc(r.p2.name || "Person 2");
    const tipps = empfehlungen(r, auto, vorjahrUmsatz);
    const ICON = { ok: "✓", warn: "!", crit: "!", info: "i" };
    const aktKombi = r.kombis.find(k => k.aktuell);

    $("#fiRes").innerHTML = `
      ${r.exakt ? "" : `<div class="card warnbox">Für ${esc(CUR.jahr)} sind noch keine Steuerwerte hinterlegt – gerechnet wird mit den Werten von ${r.basisJahr}.</div>`}
      <div class="kpis">
        <div class="kpi"><div class="l">Brutto Haushalt</div><div class="v">${eur(r.bruttoGesamt)}</div><div class="s">Löhne + Gewinn</div></div>
        <div class="kpi"><div class="l">Steuern gesamt</div><div class="v">${eur(z.summe + r.gw.gewst)}</div><div class="s">ESt + Soli + KiSt + GewSt</div></div>
        <div class="kpi ${r.ergebnis > 0 ? "warn" : "ok"}"><div class="l">Voraussichtl. ${vz}</div><div class="v">${eur(Math.abs(r.ergebnis))}</div><div class="s">${r.p1.lstGeschaetzt || r.p2.lstGeschaetzt ? "Lohnsteuer teilweise geschätzt" : "nach gezahlten " + eur(r.gezahlt)}</div></div>
        <div class="kpi"><div class="l">Netto Haushalt</div><div class="v">${eur(r.netto)}</div><div class="s">${eur(r.netto / 12)} pro Monat inkl. Kindergeld</div></div>
      </div>

      <div class="card"><h3>Empfehlungen für ${esc(CUR.jahr)}</h3>
        <ul class="tipps">${tipps.map(t => `<li class="t-${t.lvl}"><span class="ti">${ICON[t.lvl]}</span><div><strong>${t.titel}</strong><div class="small">${t.text}</div></div></li>`).join("")}</ul>
      </div>

      <div class="grid fi2">
        <div class="card"><h3>Wohin geht euer Bruttoeinkommen?</h3>${svgVerteilung(r)}</div>
        <div class="card"><h3>Umsatz ${esc(CUR.jahr)} nach Monaten</h3>${CUR.quelle === "manuell" ? `<p class="empty">Einnahmen werden nicht aus der App übernommen.</p>` : svgMonate(auto.monate, vorjahrUmsatz)}</div>
      </div>
      <div class="card"><h3>Was bleibt vom Gewinn?</h3>
        <p class="small muted">Steuer und Nettobetrag, wenn der Gewinn des Unternehmens steigt – bei euren Löhnen. Die gestrichelten Linien zeigen die wichtigen Grenzen.</p>${svgGewinnKurve(r)}</div>

      <div class="grid fi2">
        <div class="card"><h3>Steuerklassen-Vergleich</h3><div class="tblwrap"><table class="tbl fitbl">
          <thead><tr><th>Klassen</th><th class="r">Lohnsteuer/Jahr</th><th class="r">Netto/Monat</th><th class="r">Erklärung</th></tr></thead><tbody>
          ${r.kombis.map(k => {
            const diff = aktKombi ? (aktKombi.lst - k.lst) / 12 : 0;
            const erg = r2(z.summe - k.lst - Math.max(0, num(CUR.vorauszahlungen)));
            return `<tr class="${k.aktuell ? "akt" : ""}"><td>${k.kl}${k.aktuell ? ' <span class="badge">jetzt</span>' : ""}</td><td class="r">${eur(k.lst)}</td>
              <td class="r">${k.aktuell || !aktKombi ? "–" : (diff >= 0 ? "+" : "") + eur(diff)}</td><td class="r ${erg > 0 ? "neg" : "pos"}">${erg > 0 ? "Nachz. " : "Erst. "}${eur(Math.abs(erg))}</td></tr>`;
          }).join("")}
        </tbody></table></div>
        <p class="small muted">Reihenfolge: ${n1} / ${n2}. Die Jahressteuer ist bei jeder Kombination gleich – die Steuerklasse verteilt nur, wie viel monatlich einbehalten wird. Lohnsteuer hier geschätzt.
          ${r.faktor > 0 ? `Faktorverfahren IV/IV mit Faktor <strong>${r.faktor.toLocaleString("de-DE", { minimumFractionDigits: 3 })}</strong> würde die Lohnsteuer recht genau an die Jahressteuer anpassen (Antrag beim Finanzamt).` : ""}</p></div>

        <div class="card"><h3>Grenzen im Überblick</h3><div class="tblwrap"><table class="tbl fitbl"><thead><tr><th>Grenze</th><th class="r">Dein Stand</th><th class="r">Noch Platz</th></tr></thead><tbody>
          ${(() => {
            const soliAb = abGewinn(CUR, x => x.zus.soli > 0), spitze = abGewinn(CUR, x => x.grenz >= 0.42);
            const vor = abGewinn(CUR, x => x.estUnternehmen >= VORAUSZAHLUNG_AB);
            const row = (l, stand, grenze, einheit) => `<tr><td>${l}<div class="small muted">ab ${grenze == null ? "–" : eur(grenze)} ${einheit}</div></td><td class="r">${eur(stand)}</td>
              <td class="r ${grenze != null && stand > grenze ? "neg" : "pos"}">${grenze == null ? "–" : stand > grenze ? "überschritten" : eur(grenze - stand)}</td></tr>`;
            return row("Kleinunternehmer im nächsten Jahr", r.einnahmen, KU_VORJAHR, "Umsatz") +
              row("Kleinunternehmer sofort weg", r.einnahmen, KU_LAUFEND, "Umsatz") +
              row("Gewerbesteuer", r.gewinn, GEW_FREIBETRAG, "Gewinn") +
              row("Vorauszahlungen Finanzamt", r.gewinn, vor, "Gewinn") +
              row("Solidaritätszuschlag", r.gewinn, soliAb, "Gewinn") +
              row("Spitzensteuersatz 42 %", r.gewinn, spitze, "Gewinn");
          })()}
        </tbody></table></div></div>
      </div>

      <div class="grid fi2">
        <div class="card"><h3>Berechnung ${esc(CUR.jahr)} – Zusammenveranlagung</h3><div class="tblwrap"><table class="tbl fitbl"><tbody>
          ${zeile(`Bruttolohn ${n1}`, eur(r.p1.brutto), "", r.p1.b2 ? `davon 2. Arbeitgeber ${eur(r.p1.b2)}` : "")}
          ${zeile(`− Werbungskosten ${n1}`, eur(r.p1.wk), "", r.p1.wkPauschal ? "Pauschale" : "")}
          ${zeile(`Bruttolohn ${n2}`, eur(r.p2.brutto), "", r.p2.b2 ? `davon 2. Arbeitgeber ${eur(r.p2.b2)}` : "")}
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
          ${zeile(`− Lohnsteuer ${n1}`, eur(r.p1.lst), "", r.p1.lstGeschaetzt ? `geschätzt (Klasse ${r.p1.kl}${r.p1.b2 ? " + VI" : ""})` : "")}
          ${zeile(`− Lohnsteuer ${n2}`, eur(r.p2.lst), "", r.p2.lstGeschaetzt ? `geschätzt (Klasse ${r.p2.kl}${r.p2.b2 ? " + VI" : ""})` : "")}
          ${num(CUR.vorauszahlungen) ? zeile("− Vorauszahlungen", eur(num(CUR.vorauszahlungen))) : ""}
          ${zeile(`= Voraussichtliche ${vz}`, eur(Math.abs(r.ergebnis)), "sum " + (r.ergebnis > 0 ? "neg" : "pos"))}
        </tbody></table></div></div>

        <div>
          <div class="card"><h3>Einzelunternehmen</h3><div class="tblwrap"><table class="tbl fitbl"><tbody>
            ${zeile("Gewinn", eur(r.gewinn))}
            ${zeile("Gewerbesteuer", eur(r.gw.gewst), "", r.gw.gewst ? `Messbetrag ${eur(r.gw.messbetrag)} × ${esc(CUR.hebesatz)} %` : `Freibetrag ${eur(GEW_FREIBETRAG)} nicht überschritten`)}
            ${zeile("Mehrsteuer durch das Unternehmen", eur(r.steuerUnternehmen), "sum", r.gewinn > 0 ? `${pct(r.steuerUnternehmen / r.gewinn)} vom Gewinn` : "")}
            ${zeile("Empfohlene Rücklage pro Monat", eur(Math.max(0, r.steuerUnternehmen) / 12), "", "für Steuernachzahlung zurücklegen")}
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
        Lohnsteuer-Schätzung vereinfacht nach Programmablaufplan (Vorsorgepauschale geschätzt). Nicht berücksichtigt u. a.: Riester, Unterhalt, Handwerkerleistungen,
        Progressionsvorbehalt (Elterngeld, Krankengeld, ALG), genaue Höchstbeträge der Vorsorgeaufwendungen. Für verbindliche Zahlen: Steuerberater oder Lohnsteuerhilfeverein.</p>`;
  }

  root.EFFinanzen = { render, berechne, tarif, splitting, soli, lohnsteuer, abGewinn, PARAM };
})(typeof window !== "undefined" ? window : globalThis);
