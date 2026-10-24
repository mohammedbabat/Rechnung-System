// ============================================================
// Ein-Facher Rechnungen – Konfiguration
// Enthält KEINE Geheimnisse. Anschrift, IBAN, Steuernummer werden
// in der App unter "Einstellungen" gepflegt und in SharePoint gespeichert.
// ============================================================
window.EF_CONFIG = {
  clientId: "4c131eb5-395e-4cbc-8c6d-66667e2f03b1",
  tenantId: "69a7d3e4-6d53-43dd-a016-dc755b1f684b",
  redirectUri: window.location.origin + window.location.pathname,
  siteHostname: "6zxkpr.sharepoint.com",
  sitePath: "/sites/ein-facher-Rechnung-system",
  pdfFolder: "Rechnungen",
  mailFrom: "rechnung@ein-facher.de",
  listPrefix: "EF_"
};
