// ============================================================
// Ein-Facher Rechnungen – Anmeldung (MSAL) und Microsoft Graph
// ============================================================
(function () {
  "use strict";
  const C = window.EF_CONFIG;
  const SCOPES = ["User.Read", "User.ReadBasic.All", "Sites.Manage.All", "Mail.Send", "Mail.Send.Shared", "GroupMember.ReadWrite.All"];
  const GRAPH = "https://graph.microsoft.com/v1.0";

  // Datenmodell der SharePoint-Listen (Title-Spalte existiert immer)
  const SCHEMA = {
    Kunden: [["Kundennummer", "text"], ["Ansprechpartner", "text"], ["Strasse", "text"], ["PLZ", "text"], ["Ort", "text"],
             ["Land", "text"], ["Email", "text"], ["Telefon", "text"], ["Notiz", "note"]],
    Artikel: [["Artikelnummer", "text"], ["Kategorie", "text"], ["Beschreibung", "note"], ["Einheit", "text"], ["Preis", "number"]],
    Belege: [["Typ", "text"], ["Status", "text"], ["KundeId", "number"], ["KundeJson", "note"], ["Datum", "text"],
             ["Faellig", "text"], ["Leistungsdatum", "text"], ["Positionen", "note"], ["Summe", "number"], ["Notiz", "note"],
             ["BezugNr", "text"], ["BezahltAm", "text"], ["PdfUrl", "text"], ["Versendet", "text"],
             ["Firma", "text"], ["UstSatz", "number"]],
    Einstellungen: [["Wert", "note"]],
    Benutzer: [["Name", "text"], ["EntraId", "text"], ["Rolle", "text"], ["Aktiv", "text"]]
  };

  let msalApp = null, account = null, siteId = null, groupId = C.groupId || null;

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
      if (!existing.includes(dn)) {
        await g(`/sites/${sid}/lists`, { method: "POST", body: { displayName: dn, columns: cols.map(colDef), list: { template: "genericList" } } });
        log(`+ ${dn} angelegt`);
      }
      // Spalten immer prüfen – auch direkt nach dem Anlegen
      const have = (await g(`/sites/${sid}/lists/${L(name)}/columns`)).value.map(c => c.name);
      for (const c of cols) {
        if (!have.includes(c[0])) {
          await g(`/sites/${sid}/lists/${L(name)}/columns`, { method: "POST", body: colDef(c) });
          log(`+ Spalte ${c[0]} in ${dn} ergänzt`);
        }
      }
      log(`✓ ${dn} vorhanden`);
    }
    log("Fertig.");
  }

  // Liefert fehlende Spalten bestehender Listen, z. B. ["EF_Belege: Firma"] (fehlende Listen werfen itemNotFound)
  async function checkSchema() {
    const sid = await site();
    const out = [];
    for (const [name, cols] of Object.entries(SCHEMA)) {
      const have = (await g(`/sites/${sid}/lists/${L(name)}/columns?$select=name`)).value.map(c => c.name);
      cols.forEach(c => { if (!have.includes(c[0])) out.push(`${C.listPrefix}${name}: ${c[0]}`); });
    }
    return out;
  }

  async function uploadPdf(baseFolder, folder, fileName, blob) {
    const sid = await site();
    const p = [baseFolder || C.pdfFolder, folder, fileName].filter(Boolean).map(s => encodeURIComponent(s)).join("/");
    return g(`/sites/${sid}/drive/root:/${p}:/content`, { method: "PUT", body: blob, headers: { "Content-Type": "application/pdf" } });
  }

  async function sendMail({ from, to, subject, html, attachments }) {
    const sender = from || C.mailFrom;
    const path = sender ? `/users/${encodeURIComponent(sender)}/sendMail` : "/me/sendMail";
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

  // ---------- Entra ID: Benutzer und Site-Gruppe ----------
  async function users() {
    let url = "/users?$select=id,displayName,mail,userPrincipalName&$top=999";
    const out = [];
    while (url) {
      const r = await g(url);
      r.value.forEach(u => out.push(u));
      url = r["@odata.nextLink"];
    }
    return out.sort((a, b) => String(a.displayName || "").localeCompare(String(b.displayName || ""), "de"));
  }

  // Microsoft-365-Gruppe hinter der SharePoint-Site (mailNickname = letzter Teil des Site-Pfads)
  async function siteGroup() {
    if (groupId) return groupId;
    const nick = C.sitePath.split("/").filter(Boolean).pop();
    const r = await g(`/groups?$filter=mailNickname eq '${nick.replace(/'/g, "''")}'&$select=id,displayName`);
    if (!r.value.length) throw new Error(`Keine Microsoft-365-Gruppe „${nick}" gefunden`);
    groupId = r.value[0].id;
    return groupId;
  }
  async function addSiteMember(userId) {
    const gid = await siteGroup();
    try {
      await g(`/groups/${gid}/members/$ref`, { method: "POST", body: { "@odata.id": `${GRAPH}/directoryObjects/${userId}` } });
    } catch (e) {
      if (!/already exist/i.test(e.message)) throw e;
    }
  }
  async function removeSiteMember(userId) {
    const gid = await siteGroup();
    try {
      await g(`/groups/${gid}/members/${userId}/$ref`, { method: "DELETE" });
    } catch (e) {
      if (!/404|does not exist|not found/i.test(e.message)) throw e;
    }
  }

  window.EFGraph = {
    init, login, logout, account: () => account, items, create, update, remove, ensureLists, checkSchema, uploadPdf, sendMail,
    users, addSiteMember, removeSiteMember
  };
})();
