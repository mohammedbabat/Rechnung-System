// ============================================================
// Ein-Facher Rechnungen – Wächter (läuft automatisch in GitHub Actions)
//
// 1. Holt Zahlungseingänge über den Gehalt-Monitor (Enable Banking) und bucht
//    passende Rechnungen als "Bezahlt" (Rechnungsnummer + Betrag) – wie die App.
// 2. Schickt eine E-Mail, wenn eine Rechnung überfällig oder bezahlt ist.
//    Jede Meldung nur einmal; gemerkt wird das in EF_Einstellungen ("waechter").
//
// Secrets (GitHub → Settings → Secrets and variables → Actions):
//   EF_CLIENT_SECRET              Geheimer Schlüssel der App-Registrierung (Pflicht)
//   SB_EMAIL, SB_PASSWORD         Gehalt-Monitor-Login (optional, für die Bankprüfung)
// Tenant, Client-ID und SharePoint-Site kommen aus js/config.js.
// Supabase-Adresse/Key, Empfänger und Schalter kommen aus EF_Einstellungen.
//
// Das Repository ist öffentlich: Das Protokoll enthält deshalb nur Zahlen,
// keine Namen, Beträge oder Rechnungsnummern.
// ============================================================
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TROCKEN = process.argv.includes("--trocken");          // nichts schreiben, nichts senden
const log = (...a) => console.log("•", ...a);

// ---------- Konfiguration aus js/config.js + js/zahlungen.js (gleiche Zuordnung wie in der App) ----------
const ctx = { window: { location: { origin: "", pathname: "" } }, console, TextDecoder };
ctx.window.window = ctx.window;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js/config.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "js/zahlungen.js"), "utf8"), ctx);
const C = ctx.window.EF_CONFIG, Z = ctx.window.EFZahlungen;
const SECRET = process.env.EF_CLIENT_SECRET;
if (!SECRET) { console.error("Secret EF_CLIENT_SECRET fehlt (GitHub → Settings → Secrets → Actions)."); process.exit(1); }

const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());   // YYYY-MM-DD
const eur = n => Number(n || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const deDate = d => (d ? String(d).slice(0, 10).split("-").reverse().join(".") : "");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const json = (s, f) => { try { return JSON.parse(s); } catch (_) { return f; } };

// ---------- Microsoft Graph (App-Anmeldung) ----------
let gToken = null;
async function graphToken() {
  if (gToken) return gToken;
  const res = await fetch(`https://login.microsoftonline.com/${C.tenantId}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: C.clientId, client_secret: SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" })
  });
  const j = await res.json();
  if (!res.ok) throw new Error("Microsoft-Anmeldung fehlgeschlagen: " + (j.error_description || j.error || res.status).toString().split("\n")[0]);
  return (gToken = j.access_token);
}
async function g(url, opt = {}) {
  const res = await fetch(url.startsWith("http") ? url : "https://graph.microsoft.com/v1.0" + url, {
    method: opt.method || "GET",
    headers: Object.assign({ Authorization: "Bearer " + await graphToken(), "Content-Type": "application/json" }, opt.headers || {}),
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  if (res.status === 202 || res.status === 204) return {};
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(`Graph ${res.status}: ${(j.error && (j.error.code + " – " + j.error.message)) || res.statusText}`); e.status = res.status; throw e; }
  return j;
}
async function alle(url) {
  const out = [];
  for (let next = url; next;) { const j = await g(next); out.push(...(j.value || [])); next = j["@odata.nextLink"]; }
  return out;
}

// ---------- Supabase (Gehalt-Monitor) ----------
async function bankEingaenge(cfg, ab) {
  const mail = process.env.SB_EMAIL, pw = process.env.SB_PASSWORD;
  if (!cfg || !cfg.url || !cfg.key) { log("Bank: in der App nicht eingerichtet – übersprungen"); return null; }
  if (!mail || !pw) { log("Bank: Secrets SB_EMAIL/SB_PASSWORD fehlen – übersprungen"); return null; }
  const h = { apikey: cfg.key, "Content-Type": "application/json" };
  const login = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: h, body: JSON.stringify({ email: mail, password: pw }) });
  const lj = await login.json().catch(() => ({}));
  if (!login.ok) throw new Error("Gehalt-Monitor-Anmeldung fehlgeschlagen (SB_EMAIL/SB_PASSWORD prüfen)");
  const auth = { apikey: cfg.key, Authorization: "Bearer " + lj.access_token };
  const s = await fetch(`${cfg.url}/functions/v1/bank`, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify({ action: "sync" }) });
  const sj = await s.json().catch(() => ({}));
  const fehler = Object.keys(sj.fehler || {});
  log(`Bank: Abruf ${s.ok ? "ok" : "fehlgeschlagen (" + s.status + ")"}${fehler.length ? ", Hinweis bei " + fehler.length + " Bank(en)" : ""}`);
  const q = new URLSearchParams({ select: "datum,betrag,gegenpartei,verwendungszweck", order: "datum.desc", limit: "1000" });
  q.append("betrag", "gt.0"); q.append("datum", "gte." + ab);
  const r = await fetch(`${cfg.url}/rest/v1/bank_umsaetze?${q}`, { headers: auth });
  const rows = await r.json().catch(() => []);
  if (!r.ok) throw new Error("Bank-Umsätze konnten nicht gelesen werden (" + r.status + ")");
  return rows.map(u => ({ datum: u.datum, betrag: Math.round(Number(u.betrag) * 100) / 100, name: u.gegenpartei || "", zweck: u.verwendungszweck || "", text: "" }));
}

// ---------- Hauptablauf ----------
async function main() {
  const site = await g(`/sites/${C.siteHostname}:${C.sitePath}`);
  const L = n => `/sites/${site.id}/lists/${C.listPrefix}${n}`;
  const einst = await alle(`${L("Einstellungen")}/items?$expand=fields&$top=200`);
  const wert = t => { const x = einst.find(i => i.fields.Title === t); return x ? { id: x.id, d: json(x.fields.Wert, {}) } : { id: null, d: {} }; };
  const firmen = {};
  einst.forEach(i => { const t = i.fields.Title || ""; if (t === "firma" || t.startsWith("firma:")) firmen[t === "firma" ? "ef" : t.slice(6)] = json(i.fields.Wert, {}); });
  const bankCfg = wert("bank").d, cfgItem = wert("benachrichtigung"), stateItem = wert("waechter");
  const cfg = Object.assign({ an: "", cc: "", ueberfaellig: true, bezahlt: true, aktiv: true }, cfgItem.d);
  const state = Object.assign({ gemeldet: {}, start: null }, stateItem.d);
  const ersterLauf = !state.start;

  const belege = (await alle(`${L("Belege")}/items?$expand=fields&$top=500`)).map(i => {
    const f = i.fields;
    return { id: i.id, nr: f.Title || "", typ: f.Typ, status: f.Status, datum: f.Datum, faellig: f.Faellig, bezahltAm: f.BezahltAm,
      betrag: Math.round(Number(f.Summe || 0) * 100) / 100, kunde: (json(f.KundeJson, {}) || {}).Title || "", firma: f.Firma || "ef" };
  });
  const rech = belege.filter(b => b.typ === "Rechnung" && b.nr);
  log(`Rechnungen gelesen: ${rech.length}`);

  // 1) Bank prüfen und sichere Treffer buchen
  const offen = rech.filter(b => ["Offen", "Versendet"].includes(b.status));
  let gebucht = 0;
  if (offen.length && bankCfg.auto !== false) {
    const frueh = offen.map(b => b.datum || heute).sort()[0];
    const ab = new Date(new Date(frueh).getTime() - 7 * 86400000).toISOString().slice(0, 10);
    let eing = null;
    try { eing = await bankEingaenge(bankCfg, ab); } catch (e) { log("Bank: " + e.message); }
    if (eing) {
      const off = offen.map(b => ({ id: b.id, nr: b.nr, betrag: b.betrag, kunde: b.kunde, b }));
      const bez = rech.filter(b => b.status === "Bezahlt").map(b => ({ id: b.id, nr: b.nr, b }));
      for (const v of Z.zuordnen(eing, off, bez)) {
        if (v.art !== "sicher") continue;
        const b = v.beleg.b;
        const doppelt = off.filter(o => o.b !== b && Z.nrGefunden(o.nr, `${v.z.zweck} ${v.z.name}`) && Math.abs(o.betrag - v.z.betrag) < 0.005).length;
        const frueher = b.datum && v.z.datum < new Date(new Date(b.datum).getTime() - 3 * 86400000).toISOString().slice(0, 10);
        if (doppelt || frueher) continue;
        if (!TROCKEN) await g(`${L("Belege")}/items/${b.id}/fields`, { method: "PATCH", body: { Status: "Bezahlt", BezahltAm: v.z.datum } });
        b.status = "Bezahlt"; b.bezahltAm = v.z.datum; b.vonBank = true; gebucht++;
      }
      log(`Bank: ${eing.length} Zahlungseingänge geprüft, ${gebucht} Rechnung(en) als bezahlt gebucht`);
    }
  }

  // 2) Ereignisse sammeln
  const ereignisse = [];
  for (const b of rech) {
    const m = state.gemeldet[b.id] || {};
    if (cfg.bezahlt && b.status === "Bezahlt" && !m.bezahlt) {
      if (ersterLauf && !b.vonBank) { state.gemeldet[b.id] = Object.assign(m, { bezahlt: "vorher" }); continue; }   // Altbestand nicht melden
      ereignisse.push({ art: "bezahlt", b });
    }
    if (cfg.ueberfaellig && ["Offen", "Versendet"].includes(b.status) && b.faellig && b.faellig < heute && !m.ueberfaellig)
      ereignisse.push({ art: "ueberfaellig", b });
  }
  log(`Neue Meldungen: ${ereignisse.filter(e => e.art === "bezahlt").length} bezahlt, ${ereignisse.filter(e => e.art === "ueberfaellig").length} überfällig`);

  // 3) E-Mail senden
  const an = String(cfg.an || "").split(/[;,\s]+/).filter(Boolean), cc = String(cfg.cc || "").split(/[;,\s]+/).filter(Boolean);
  if (ereignisse.length && cfg.aktiv !== false) {
    if (!an.length) log("Keine Empfänger eingetragen (App → Einstellungen → Benachrichtigungen) – keine E-Mail");
    else {
      const absender = cfg.von || C.mailFrom;
      const bz = ereignisse.filter(e => e.art === "bezahlt"), ue = ereignisse.filter(e => e.art === "ueberfaellig");
      const firmaName = b => (firmen[b.firma] || {}).Firma || (b.firma === "ef" ? "Ein-Facher" : b.firma);
      const betreff = ereignisse.length === 1
        ? `${firmaName(ereignisse[0].b)}: Rechnung ${ereignisse[0].b.nr} ${ereignisse[0].art === "bezahlt" ? "bezahlt" : "überfällig"} (${eur(ereignisse[0].b.betrag)})`
        : `Rechnungen: ${[bz.length ? `${bz.length} bezahlt` : "", ue.length ? `${ue.length} überfällig` : ""].filter(Boolean).join(", ")}`;
      const tage = d => Math.round((new Date(heute) - new Date(d)) / 86400000);
      const zeile = (e) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${esc(e.b.nr)}</b><br><span style="color:#777;font-size:12px">${esc(firmaName(e.b))}</span></td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(e.b.kunde)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${eur(e.b.betrag)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap">${e.art === "bezahlt"
          ? `✅ bezahlt am ${deDate(e.b.bezahltAm)}${e.b.vonBank ? "<br><span style='color:#777;font-size:12px'>automatisch über die Bank erkannt</span>" : ""}`
          : `⚠️ fällig seit ${deDate(e.b.faellig)} (${tage(e.b.faellig)} Tag${tage(e.b.faellig) === 1 ? "" : "e"})`}</td></tr>`;
      const block = (titel, liste) => liste.length ? `<h3 style="margin:18px 0 6px;font-size:15px">${titel}</h3>
        <table style="border-collapse:collapse;width:100%;font-size:14px">${liste.map(zeile).join("")}</table>` : "";
      const app = "https://rechnung.ein-facher.de/";
      const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#1a0a2e;max-width:640px">
        <p style="font-size:14px">Hallo,</p><p style="font-size:14px">es gibt Neuigkeiten zu deinen Rechnungen:</p>
        ${block("Bezahlt", bz)}${block("Überfällig – Kunde erinnern?", ue)}
        <p style="margin-top:20px"><a href="${app}#/rechnungen/${ue.length && !bz.length ? "ueberfaellig" : "alle"}" style="background:#7B2FBE;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-size:14px">In der Rechnungs-App öffnen</a></p>
        <p style="color:#888;font-size:12px;margin-top:24px">Automatische Nachricht der Ein-Facher Rechnungs-App (Stand ${deDate(heute)}). Einstellungen: App → Einstellungen → Benachrichtigungen.</p></div>`;
      if (TROCKEN) log("Trockenlauf: E-Mail würde gesendet");
      else {
        await g(`/users/${encodeURIComponent(absender)}/sendMail`, { method: "POST", body: { message: {
          subject: betreff, body: { contentType: "HTML", content: html },
          toRecipients: an.map(a => ({ emailAddress: { address: a } })), ccRecipients: cc.map(a => ({ emailAddress: { address: a } }))
        }, saveToSentItems: true } });
        log(`E-Mail gesendet an ${an.length} Empfänger${cc.length ? ` + ${cc.length} CC` : ""}`);
      }
      for (const e of ereignisse) state.gemeldet[e.b.id] = Object.assign(state.gemeldet[e.b.id] || {}, { [e.art]: heute });
    }
  }

  // 4) Zustand speichern (alte Einträge gelöschter Belege entfernen)
  const ids = new Set(rech.map(b => b.id));
  Object.keys(state.gemeldet).forEach(id => { if (!ids.has(id)) delete state.gemeldet[id]; });
  state.start = state.start || new Date().toISOString();
  state.letzterLauf = new Date().toISOString();
  state.letzterStand = { gebucht, gemeldet: ereignisse.length, bank: !!(process.env.SB_EMAIL && bankCfg.url) };
  if (!TROCKEN) {
    const fields = { Title: "waechter", Wert: JSON.stringify(state) };
    if (stateItem.id) await g(`${L("Einstellungen")}/items/${stateItem.id}/fields`, { method: "PATCH", body: fields });
    else await g(`${L("Einstellungen")}/items`, { method: "POST", body: { fields } });
  }
  log(ersterLauf ? "Erster Lauf: bereits bezahlte Rechnungen wurden als bekannt gespeichert (keine E-Mail dafür)" : "Fertig");
}

main().catch(e => {
  console.error("FEHLER:", e.message);
  if (/sendMail|ErrorAccessDenied|403/.test(e.message)) console.error("→ Der App fehlt die Anwendungsberechtigung Mail.Send (siehe README, Abschnitt Benachrichtigungen).");
  process.exit(1);
});
