// ============================================================
// Ein-Facher Rechnungen – Anmeldung (MSAL) und Microsoft Graph
// ============================================================
(function () {
  "use strict";
  const C = window.EF_CONFIG;
  const SCOPES = ["User.Read", "Sites.Manage.All", "Mail.Send", "Mail.Send.Shared"];
  const GRAPH = "https://graph.microsoft.com/v1.0";

  // Datenmodell der SharePoint-Listen (Title-Spalte existiert immer)
  const SCHEMA = {
    Kunden: [["Kundennummer", "text"], ["Ansprechpartner", "text"], ["Strasse", "text"], ["PLZ", "text"], ["Ort", "text"],
             ["Land", "text"], ["Email", "text"], ["Telefon", "text"], ["Notiz", "note"]],
    Artikel: [["Artikelnummer", "text"], ["Beschreibung", "note"], ["Einheit", "text"], ["Preis", "number"]],
    Belege: [["Typ", "text"], ["Status", "text"], ["KundeId", "number"], ["KundeJson", "note"], ["Datum", "text"],
             ["Faellig", "text"], ["Leistungsdatum", "text"], ["Positionen", "note"], ["Summe", "number"], ["Notiz", "note"],
             ["BezugNr", "text"], ["BezahltAm", "text"], ["PdfUrl", "text"], ["Versendet", "text"]],
    Einstellungen: [["Wert", "note"]]
  };

  let msalApp = null, account = null, siteId = null;

  function app() {
    if (!msalApp) {
      msalApp = new msal.PublicClientApplication({
        auth: { clientId: C.clientId, authority: "https://login.microsoftonline.com/" + C.tenantId, redirectUri: C.redirectUri },
        cache: { cacheLocation: "sessionStorage" }
      });
    }
    return msalApp;
  }

  async function init() {
    const res = await app().handleRedirectPromise();
    if (res && res.account) account = res.account;
    if (!account) { const all = app().getAllAccounts(); if (all.length) account = all[0]; }
    return account;
  }
  const login = () => app().loginRedirect({ scopes: SCOPES });
  const logout = () => app().logoutRedirect({ account });

  async function token() {
    try {
      const r = await app().acquireTokenSilent({ scopes: SCOPES, account });
      return r.accessToken;
    } catch (e) {
      await app().acquireTokenRedirect({ scopes: SCOPES, account });
      throw new Error("Anmeldung wird erneuert …");
    }
  }

  async function g(path, opts = {}) {
    const t = await token();
    const url = path.startsWith("https://") ? path : GRAPH + path;
    const headers = Object.assign({ Authorization: "Bearer " + t }, opts.headers || {});
    let body = opts.body;
    if (body && !(body instanceof Blob) && typeof body === "object") {
      body = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(url, { method: opts.method || "GET", headers, body });
    if (!res.ok) {
      let msg = res.status + " " + res.statusText;
      try { const j = await res.json(); if (j.error) msg = j.error.code + ": " + j.error.message; } catch (_) { /* leer */ }
      throw new Error("Graph-Fehler – " + msg);
    }
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }

  async function site() {
    if (siteId) return siteId;
    const s = await g(`/sites/${C.siteHostname}:${C.sitePath}`);
    siteId = s.id;
    return siteId;
  }

  const L = name => encodeURIComponent(C.listPrefix + name);
  const flat = i => Object.assign({}, i.fields, { id: String(i.id) });

  async function items(list) {
    const sid = await site();
    let url = `/sites/${sid}/lists/${L(list)}/items?expand=fields&$top=500`;
    const out = [];
    while (url) {
      const r = await g(url);
      r.value.forEach(i => out.push(flat(i)));
      url = r["@odata.nextLink"];
    }
    return out;
  }
  async function create(list, fields) {
    const sid = await site();
    return flat(await g(`/sites/${sid}/lists/${L(list)}/items`, { method: "POST", body: { fields } }));
  }
  async function update(list, id, fields) {
    const sid = await site();
    return g(`/sites/${sid}/lists/${L(list)}/items/${id}/fields`, { method: "PATCH", body: fields });
  }
  async function remove(list, id) {
    const sid = await site();
    return g(`/sites/${sid}/lists/${L(list)}/items/${id}`, { method: "DELETE" });
  }

  function colDef([name, type]) {
    if (type === "number") return { name, number: {} };
    if (type === "note") return { name, text: { allowMultipleLines: true, textType: "plain" } };
    return { name, text: {} };
  }

  // Legt fehlende Listen und Spalten an (beliebig oft ausführbar)
  async function ensureLists(log) {
    const sid = await site();
    log("Site gefunden: " + C.siteHostname + C.sitePath);
    const existing = (await g(`/sites/${sid}/lists?$select=displayName`)).value.map(l => l.displayName);
    for (const [name, cols] of Object.entries(SCHEMA)) {
      const dn = C.listPrefix + name;
      if (existing.includes(dn)) {
        const have = (await g(`/sites/${sid}/lists/${L(name)}/columns`)).value.map(c => c.name);
        for (const c of cols) {
          if (!have.includes(c[0])) {
            await g(`/sites/${sid}/lists/${L(name)}/columns`, { method: "POST", body: colDef(c) });
            log(`+ Spalte ${c[0]} in ${dn} ergänzt`);
          }
        }
        log(`✓ ${dn} vorhanden`);
        continue;
      }
      await g(`/sites/${sid}/lists`, { method: "POST", body: { displayName: dn, columns: cols.map(colDef), list: { template: "genericList" } } });
      log(`+ ${dn} angelegt`);
    }
    log("Fertig.");
  }

  async function uploadPdf(folder, fileName, blob) {
    const sid = await site();
    const p = [C.pdfFolder, folder, fileName].filter(Boolean).map(s => encodeURIComponent(s)).join("/");
    return g(`/sites/${sid}/drive/root:/${p}:/content`, { method: "PUT", body: blob, headers: { "Content-Type": "application/pdf" } });
  }

  async function sendMail({ to, subject, html, attachments }) {
    const path = C.mailFrom ? `/users/${encodeURIComponent(C.mailFrom)}/sendMail` : "/me/sendMail";
    const toRecipients = to.split(/[;,]/).map(a => a.trim()).filter(Boolean).map(address => ({ emailAddress: { address } }));
    return g(path, {
      method: "POST",
      body: {
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients,
          attachments: (attachments || []).map(a => ({
            "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: a.type, contentBytes: a.base64
          }))
        },
        saveToSentItems: true
      }
    });
  }

  window.EFGraph = { init, login, logout, account: () => account, items, create, update, remove, ensureLists, uploadPdf, sendMail };
})();
