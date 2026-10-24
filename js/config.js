// ============================================================
// Ein-Facher Rechnungen – Konfiguration
// Diese Datei enthält KEINE Geheimnisse (Client-ID und Tenant-ID
// sind öffentlich unkritisch). Persönliche Daten wie Anschrift,
// IBAN, Steuernummer gehören NICHT hierher, sondern werden in der
// App unter "Einstellungen" gepflegt und in SharePoint gespeichert.
// ============================================================
window.EF_CONFIG = {
  // Aus der Entra-App-Registrierung (setup/Setup-AppRegistration.ps1 gibt beide Werte aus)
  clientId: "00000000-0000-0000-0000-000000000000",
  tenantId: "00000000-0000-0000-0000-000000000000",

  // Muss exakt als SPA-Redirect-URI in der App-Registrierung eingetragen sein
  redirectUri: window.location.origin + window.location.pathname,

  // SharePoint-Site, in der Listen und PDFs liegen
  siteHostname: "DEINTENANT.sharepoint.com",   // z. B. einfacher.sharepoint.com
  sitePath: "/sites/Rechnungen",               // z. B. /sites/Rechnungen oder /sites/IT-Daten

  // Ordner in der Dokumentbibliothek der Site: /Rechnungen/<Kunde>/<Datei>.pdf
  pdfFolder: "Rechnungen",

  // Absender-Postfach (freigegebenes Postfach mit SendAs-Recht). Leer = eigenes Postfach.
  mailFrom: "rechnung@ein-facher.de",

  // Präfix der SharePoint-Listen (EF_Kunden, EF_Artikel, EF_Belege, EF_Einstellungen)
  listPrefix: "EF_"
};
