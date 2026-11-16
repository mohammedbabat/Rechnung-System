// ============================================================
// Ein-Facher Rechnungen – Steuererklärung: Ausgaben & Belege
// Kategorien wie in einer Steuer-App (Werbungskosten, Sonderausgaben, außergewöhnliche
// Belastungen, haushaltsnahe Dienstleistungen/Handwerker) und ihre Berechnung.
// Reine Rechenlogik ohne Oberfläche – genutzt von js/finanzen.js.
// Alle Werte sind Schätzungen nach vereinfachter Berechnung – keine Steuerberatung.
// ============================================================
(function (root) {
  "use strict";

  const num = v => { const n = Number(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : 0; };
  const r2 = n => Math.round(n * 100) / 100;

  // Sofort absetzbar bis 800 € netto (Arbeitnehmer: 952 € brutto inkl. 19 % USt);
  // Kleinunternehmer ohne Vorsteuerabzug: 800 € inkl. USt
  const GWG_PRIVAT = 952, GWG_FIRMA = 800;

  // Gruppen in der Reihenfolge der Anzeige
  const GRUPPEN = [
    { key: "wk", titel: "Arbeit & Beruf", sub: "Werbungskosten – Anlage N", icon: "💼", person: true },
    { key: "sa", titel: "Vorsorge & Spenden", sub: "Sonderausgaben – Anlage Sonderausgaben / Vorsorgeaufwand", icon: "🛡️" },
    { key: "agb", titel: "Gesundheit & Belastungen", sub: "Außergewöhnliche Belastungen – Anlage Außergewöhnliche Belastungen", icon: "🩺" },
    { key: "hh", titel: "Wohnung & Haushalt", sub: "Haushaltsnahe Dienstleistungen & Handwerker – Anlage Haushaltsnahe Aufwendungen", icon: "🏠" }
  ];

  // typ: "betrag" (nur Betrag), "geraet" (Kaufpreis, Datum, beruflicher Anteil, Abschreibung), "monat" (Betrag pro Monat × Monate)
  // fuer: "person" = Person 1/2 oder Firma, "haus" = gemeinsam
  const KATS = [
    { key: "arbeitsmittel", gruppe: "wk", typ: "geraet", fuer: "person", titel: "Arbeitsmittel & Geräte",
      hilfe: "Laptop, PC, Monitor, Drucker, Handy, Software, Bürostuhl, Schreibtisch, Papier & Büromaterial, Fachbücher. Computer und Software sind sofort voll absetzbar (Nutzungsdauer 1 Jahr). Andere Geräte bis 952 € brutto sofort, teurere über mehrere Jahre. Nur den beruflichen Anteil.",
      presets: [["💻 Laptop", "Laptop", "computer"], ["🖥️ Monitor", "Monitor", "computer"], ["🖨️ Drucker", "Drucker", "computer"], ["📱 Handy", "Smartphone", "normal", 5],
        ["⌨️ Maus/Tastatur/Headset", "Maus, Tastatur, Headset", "computer"], ["💿 Software", "Software/Abo", "computer"], ["📄 Papier & Büromaterial", "Papier, Druckerpatronen, Büromaterial", "normal"],
        ["📚 Fachbücher", "Fachbücher", "normal"], ["🪑 Bürostuhl", "Bürostuhl", "normal", 13], ["🗄️ Schreibtisch", "Schreibtisch", "normal", 13], ["🎒 Laptoptasche", "Laptoptasche/Rucksack", "normal"]] },
    { key: "telefon", gruppe: "wk", typ: "monat", fuer: "person", titel: "Handy- & Internetkosten",
      hilfe: "Monatliche Kosten für Handyvertrag, Festnetz und Internet. Ohne Nachweis: pauschal 20 % der Rechnung, höchstens 20 € im Monat. Mit Einzelnachweis (z. B. 3 Monate Verbindungsnachweis) dein echter beruflicher Anteil.",
      presets: [["📱 Handyvertrag", "Handyvertrag"], ["🌐 Internet/DSL", "Internet/DSL"], ["☎️ Festnetz", "Festnetz"]] },
    { key: "fortbildung", gruppe: "wk", typ: "betrag", fuer: "person", titel: "Fortbildung & Zertifikate",
      hilfe: "Kurse, Seminare, Online-Kurse, Prüfungsgebühren (z. B. Microsoft-Zertifizierung), Fahrten und Übernachtung dafür – wenn der Arbeitgeber es nicht bezahlt.",
      presets: [["🎓 Microsoft-Zertifizierung", "Microsoft-Prüfung"], ["🧑‍🏫 Kurs/Seminar", "Kurs/Seminar"], ["🖥️ Online-Kurs", "Online-Kurs (Udemy, LinkedIn …)"], ["🚗 Fahrt zur Fortbildung", "Fahrt zur Fortbildung (0,30 €/km)"]] },
    { key: "reise", gruppe: "wk", typ: "betrag", fuer: "person", titel: "Dienstreisen & Auswärtstätigkeit",
      hilfe: "Nur was der Arbeitgeber nicht erstattet: Fahrtkosten (0,30 €/km), Verpflegungspauschale (14 € ab 8 Std., 28 € ganzer Tag), Übernachtung, Parken. Erstattungen abziehen.",
      presets: [["🚗 Fahrten Dienstreise", "Dienstreise Fahrtkosten"], ["🥪 Verpflegung", "Verpflegungspauschale"], ["🏨 Hotel", "Übernachtung"], ["🅿️ Parken", "Parkgebühren"]] },
    { key: "bewerbung", gruppe: "wk", typ: "betrag", fuer: "person", titel: "Bewerbungskosten",
      hilfe: "Bewerbungsfotos, Mappen, Porto, Übersetzungen/Beglaubigungen, Fahrten zum Vorstellungsgespräch – auch wenn die Bewerbung nicht erfolgreich war.",
      presets: [["📸 Bewerbungsfotos", "Bewerbungsfotos"], ["🌍 Übersetzung/Beglaubigung", "Übersetzung/Beglaubigung"], ["🚗 Fahrt Vorstellungsgespräch", "Fahrt zum Vorstellungsgespräch"]] },
    { key: "kontofuehrung", gruppe: "wk", typ: "betrag", fuer: "person", titel: "Kontoführungsgebühren",
      hilfe: "Pauschal 16 € pro Person – ohne Nachweis.", presets: [["🏦 Pauschale 16 €", "Kontoführungspauschale", null, null, 16]] },
    { key: "kleidung", gruppe: "wk", typ: "betrag", fuer: "person", titel: "Arbeitskleidung",
      hilfe: "Nur typische Berufskleidung (z. B. Sicherheitsschuhe, Kittel, Uniform mit Logo) und deren Reinigung – normale Kleidung zählt nicht.",
      presets: [["🦺 Berufskleidung", "Berufskleidung"], ["🧺 Reinigung", "Reinigung Berufskleidung"]] },
    { key: "verband", gruppe: "wk", typ: "betrag", fuer: "person", titel: "Gewerkschaft & Berufsverband",
      hilfe: "Mitgliedsbeiträge für Gewerkschaft oder Berufsverband.", presets: [["🤝 Gewerkschaft", "Gewerkschaftsbeitrag"]] },
    { key: "steuerberatung", gruppe: "wk", typ: "betrag", fuer: "person", titel: "Steuerberatung & Steuer-Software",
      hilfe: "Lohnsteuerhilfeverein, Steuerberater (Anteil für den Lohn) oder Steuer-Software. Den Anteil für das Unternehmen unter „Firma“ eintragen.",
      presets: [["🧾 Steuer-Software", "Steuer-Software"], ["👔 Lohnsteuerhilfeverein", "Lohnsteuerhilfeverein"]] },
    { key: "umzug", gruppe: "wk", typ: "betrag", fuer: "person", titel: "Beruflicher Umzug",
      hilfe: "Wenn der Umzug wegen der Arbeit war (z. B. neuer Job, Arbeitsweg spürbar kürzer): Umzugsfirma, Transporter, Fahrten, Maklerkosten für die Mietwohnung.",
      presets: [["🚚 Umzugskosten", "Umzug"]] },
    { key: "sonstigeWK", gruppe: "wk", typ: "betrag", fuer: "person", titel: "Sonstige berufliche Kosten",
      hilfe: "Alles andere, was du nur wegen der Arbeit bezahlst (z. B. Arbeitsessen mit Kollegen auf eigene Kosten, Fachzeitschriften).",
      presets: [] },

    { key: "versicherung", gruppe: "sa", typ: "betrag", fuer: "haus", titel: "Versicherungen",
      hilfe: "Haftpflicht, Unfall, Berufsunfähigkeit, Risikolebensversicherung, Kfz-Haftpflicht (nur Haftpflichtanteil). Hinweis: Bei Angestellten ist der Höchstbetrag (1.900 € je Person) meist schon durch die Krankenversicherung ausgeschöpft – trotzdem in der Erklärung angeben.",
      presets: [["🛡️ Haftpflicht", "Privathaftpflicht"], ["🚗 Kfz-Haftpflicht", "Kfz-Haftpflicht"], ["🩹 Unfallversicherung", "Unfallversicherung"], ["💼 Berufsunfähigkeit", "Berufsunfähigkeitsversicherung"], ["❤️ Risikoleben", "Risikolebensversicherung"]] },
    { key: "spenden", gruppe: "sa", typ: "betrag", fuer: "haus", titel: "Spenden & Mitgliedsbeiträge",
      hilfe: "An gemeinnützige Vereine, Moscheegemeinden, Hilfsorganisationen. Bis 300 € reicht der Kontoauszug, darüber Zuwendungsbestätigung. Bis 20 % der Einkünfte absetzbar.",
      presets: [["🤲 Spende", "Spende"], ["🕌 Gemeinde/Verein", "Mitgliedsbeitrag Verein/Gemeinde"]] },
    { key: "schulgeld", gruppe: "sa", typ: "betrag", fuer: "haus", titel: "Schulgeld (Privatschule)",
      hilfe: "30 % des Schulgelds, höchstens 5.000 € je Kind. Ohne Kosten für Essen und Unterbringung.",
      presets: [["🏫 Schulgeld", "Schulgeld"]] },

    { key: "krankheit", gruppe: "agb", typ: "betrag", fuer: "haus", titel: "Krankheitskosten",
      hilfe: "Zuzahlungen, Medikamente auf Rezept, Brille/Kontaktlinsen, Zahnersatz, Physiotherapie, Fahrten zum Arzt – was die Krankenkasse nicht bezahlt hat. Absetzbar ist nur der Teil über der „zumutbaren Belastung“ (wird automatisch berechnet).",
      presets: [["💊 Zuzahlungen/Medikamente", "Zuzahlungen/Medikamente"], ["👓 Brille/Kontaktlinsen", "Brille"], ["🦷 Zahnarzt/Zahnersatz", "Zahnarzt Eigenanteil"], ["🏥 Physiotherapie", "Physiotherapie Zuzahlung"]] },
    { key: "sonstigeAgb", gruppe: "agb", typ: "betrag", fuer: "haus", titel: "Sonstige außergewöhnliche Belastungen",
      hilfe: "Z. B. Beerdigungskosten (soweit nicht durch Erbe gedeckt), Kosten durch Unwetterschäden. Gilt ebenfalls nur über der zumutbaren Belastung.",
      presets: [] },

    { key: "haushaltsnah", gruppe: "hh", typ: "betrag", fuer: "haus", titel: "Haushaltsnahe Dienstleistungen",
      hilfe: "Aus der Nebenkostenabrechnung: Treppenhausreinigung, Hausmeister, Gartenpflege, Winterdienst (Müllabfuhr und Wasser zählen nicht). Außerdem eine Putzhilfe mit Rechnung und Überweisung. 20 % davon gehen direkt von der Steuer ab (max. 4.000 €).",
      presets: [["🧹 Treppenhausreinigung", "Treppenhausreinigung (Nebenkosten)"], ["🔧 Hausmeister", "Hausmeister (Nebenkosten)"], ["🌳 Gartenpflege", "Gartenpflege (Nebenkosten)"], ["❄️ Winterdienst", "Winterdienst (Nebenkosten)"], ["🧽 Putzhilfe", "Reinigungskraft"]] },
    { key: "handwerker", gruppe: "hh", typ: "betrag", fuer: "haus", titel: "Handwerkerleistungen",
      hilfe: "Nur Arbeits- und Fahrtkosten laut Rechnung (ohne Material), bezahlt per Überweisung: Reparaturen, Maler, Wartung Heizung, Schornsteinfeger, Hausmeister-Reparaturen aus der Nebenkostenabrechnung. 20 % davon gehen direkt von der Steuer ab (max. 1.200 €).",
      presets: [["🔥 Schornsteinfeger", "Schornsteinfeger"], ["🛠️ Wartung Heizung/Therme", "Wartung Heizung"], ["🎨 Maler", "Malerarbeiten (Arbeitskosten)"], ["🔩 Reparatur", "Reparatur (Arbeitskosten)"]] }
  ];
  const KAT = Object.fromEntries(KATS.map(k => [k.key, k]));

  // Abschreibung eines Geräts im Jahr `jahr`
  function geraetImJahr(x, jahr) {
    const preis = Math.max(0, num(x.betrag)), anteil = Math.min(100, Math.max(0, x.anteil === "" || x.anteil == null ? 100 : num(x.anteil))) / 100;
    if (!preis || !anteil) return { wert: 0, info: "" };
    const d = /^(\d{4})-(\d{2})/.exec(String(x.datum || "")) || [null, String(jahr), "01"];
    const kj = Number(d[1]), km = Math.min(12, Math.max(1, Number(d[2])));
    const basis = preis * anteil, grenze = x.fuer === "firma" ? GWG_FIRMA : GWG_PRIVAT;
    if (x.art === "computer" || preis <= grenze) {
      return { wert: kj === Number(jahr) ? r2(basis) : 0, info: x.art === "computer" ? "Computer/Software: sofort" : `bis ${grenze} €: sofort`, sofort: true, kj };
    }
    const nd = Math.max(1, Math.floor(num(x.nd) || 3)), gesamt = nd * 12;
    const monateBis = y => Math.min(gesamt, Math.max(0, (y - kj) * 12 + (13 - km)));
    const wert = r2(basis * (monateBis(Number(jahr)) - monateBis(Number(jahr) - 1)) / gesamt);
    return { wert, info: `über ${nd} Jahre, ${r2(basis / nd)} €/Jahr`, sofort: false, kj, rest: r2(basis * (gesamt - monateBis(Number(jahr))) / gesamt) };
  }

  // Wert eines einzelnen Postens im Jahr
  function wert(x, jahr) {
    const k = KAT[x.kat];
    if (!k) return { wert: 0, info: "" };
    if (k.typ === "geraet") return geraetImJahr(x, jahr);
    if (k.typ === "monat") {
      const m = Math.max(0, num(x.betrag)), mon = Math.min(12, Math.max(0, x.monate === "" || x.monate == null ? 12 : num(x.monate)));
      if (x.modus === "anteil") {
        const a = Math.min(100, Math.max(0, num(x.anteil))) / 100;
        return { wert: r2(m * a * mon), info: `${Math.round(a * 100)} % × ${mon} Monate` };
      }
      const proMonat = Math.min(20, m * 0.2);
      return { wert: r2(proMonat * mon), info: `Pauschal 20 %${m * 0.2 > 20 ? ", max. 20 €" : ""} × ${mon} Monate` };
    }
    return { wert: r2(Math.max(0, num(x.betrag))), info: "" };
  }

  // Zumutbare Belastung (§ 33 Abs. 3 EStG, stufenweise) – Ehepaar zusammen veranlagt
  function zumutbar(gde, kinder) {
    const saetze = kinder >= 3 ? [0.01, 0.01, 0.02] : kinder >= 1 ? [0.02, 0.03, 0.04] : [0.04, 0.05, 0.06];
    const g = Math.max(0, gde);
    return r2(Math.min(g, 15340) * saetze[0] + Math.max(0, Math.min(g, 51130) - 15340) * saetze[1] + Math.max(0, g - 51130) * saetze[2]);
  }

  // Alle Posten eines Jahres zusammenfassen
  function summen(posten, jahr) {
    const s = { wk: { 1: 0, 2: 0 }, wkKat: { 1: {}, 2: {} }, firma: 0, firmaKat: {}, kat: {}, anzahl: 0 };
    (posten || []).forEach(x => {
      const k = KAT[x.kat];
      if (!k) return;
      const w = wert(x, jahr).wert;
      if (!w) return;
      s.anzahl++;
      s.kat[x.kat] = r2((s.kat[x.kat] || 0) + w);
      if (k.fuer === "person") {
        if (x.fuer === "firma") { s.firma = r2(s.firma + w); s.firmaKat[x.kat] = r2((s.firmaKat[x.kat] || 0) + w); }
        else { const n = x.fuer === "2" ? 2 : 1; s.wk[n] = r2(s.wk[n] + w); s.wkKat[n][x.kat] = r2((s.wkKat[n][x.kat] || 0) + w); }
      }
    });
    return s;
  }

  // Abzüge nach den Höchstbeträgen (braucht Gesamtbetrag der Einkünfte, Kinder, Vorsorge)
  // kvpv: Basis-Kranken-/Pflegeversicherung beider Partner, av: Arbeitslosenversicherung beider
  function abzuege(s, { gde, kinder, kvpv, av }) {
    const k = key => s.kat[key] || 0;
    const spenden = r2(Math.min(k("spenden"), Math.max(0, gde) * 0.2));
    const schulgeld = r2(Math.min(k("schulgeld") * 0.3, 5000 * Math.max(0, kinder)));
    // § 10 Abs. 4 EStG: sonstige Vorsorge (inkl. Basis-KV/PV, AV) max. 1.900 € je Arbeitnehmer; Basis-KV/PV immer voll
    const versicherungZusatz = r2(Math.max(0, Math.min(3800, kvpv + av + k("versicherung")) - kvpv));
    const agbSumme = r2(k("krankheit") + k("sonstigeAgb"));
    const zumutbareBelastung = agbSumme > 0 ? zumutbar(gde, kinder) : 0;
    const agb = r2(Math.max(0, agbSumme - zumutbareBelastung));
    const haushaltsnah = r2(Math.min(k("haushaltsnah") * 0.2, 4000));
    const handwerker = r2(Math.min(k("handwerker") * 0.2, 1200));
    return { spenden, schulgeld, versicherung: k("versicherung"), versicherungZusatz, agbSumme, zumutbareBelastung, agb,
             haushaltsnah, handwerker, ermaessigung: r2(haushaltsnah + handwerker),
             sonderausgaben: r2(spenden + schulgeld + versicherungZusatz) };
  }

  root.EFPosten = { GRUPPEN, KATS, KAT, wert, summen, abzuege, zumutbar, geraetImJahr, GWG_PRIVAT, GWG_FIRMA };
})(window);
