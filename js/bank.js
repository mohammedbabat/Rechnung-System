// ============================================================
// Ein-Facher Rechnungen – Bankanbindung über den Gehalt-Monitor
//
// Die Bank (z. B. Sparkasse) ist im Gehalt-Monitor über Enable Banking verbunden.
// Dessen Supabase-Funktion "bank" holt die Umsätze und speichert sie in bank_umsaetze.
// Diese App meldet sich mit demselben Gehalt-Monitor-Konto an, stößt den Abruf an und
// liest nur die Zahlungseingänge (Betrag > 0), um bezahlte Rechnungen zu erkennen.
//
// Im Browser gespeichert wird nur das Anmelde-Token (kein Passwort).
// Supabase-Adresse und Publishable Key sind öffentlich (RLS schützt die Daten).
// ============================================================
(function (root) {
  "use strict";

  const TOKEN_KEY = "ef_bank_token";
  let CFG = { url: "", key: "" };

  const lies = () => { try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || "null"); } catch (_) { return null; } };
  const schreib = t => { try { if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); else localStorage.removeItem(TOKEN_KEY); } catch (_) { /* egal */ } };

  function konfigurieren(c) {
    CFG = { url: String((c && c.url) || "").trim().replace(/\/+$/, ""), key: String((c && c.key) || "").trim() };
  }
  const konfiguriert = () => /^https:\/\/[\w.-]+\.supabase\.co$/.test(CFG.url) && CFG.key.length > 20;
  const angemeldet = () => !!(lies() || {}).refresh_token;
  const email = () => (lies() || {}).email || "";

  async function authCall(grant, body) {
    const res = await fetch(`${CFG.url}/auth/v1/token?grant_type=${grant}`, {
      method: "POST", headers: { apikey: CFG.key, "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error_description || j.msg || j.message || `Anmeldung fehlgeschlagen (${res.status})`);
    const t = { access_token: j.access_token, refresh_token: j.refresh_token, ablauf: Date.now() + (j.expires_in || 3600) * 1000 - 60000,
      email: (j.user && j.user.email) || (lies() || {}).email || "" };
    schreib(t);
    return t;
  }
  async function anmelden(mail, passwort) {
    if (!konfiguriert()) throw new Error("Supabase-Adresse oder Key fehlt");
    return authCall("password", { email: mail, password: passwort });
  }
  function abmelden() { schreib(null); }

  async function token() {
    const t = lies();
    if (!t || !t.refresh_token) throw Object.assign(new Error("Nicht mit dem Gehalt-Monitor angemeldet"), { code: "login" });
    if (t.access_token && t.ablauf > Date.now()) return t.access_token;
    try { return (await authCall("refresh_token", { refresh_token: t.refresh_token })).access_token; }
    catch (e) { schreib(null); throw Object.assign(new Error("Anmeldung abgelaufen – bitte in den Einstellungen neu anmelden"), { code: "login" }); }
  }

  async function funktion(action, extra = {}) {
    const res = await fetch(`${CFG.url}/functions/v1/bank`, {
      method: "POST",
      headers: { apikey: CFG.key, Authorization: "Bearer " + await token(), "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action }, extra))
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Bank-Funktion ${res.status}`);
    return j;
  }
  const status = () => funktion("status");
  const sync = (force = false) => funktion("sync", { force });

  // Zahlungseingänge ab Datum (YYYY-MM-DD) – nur positive Beträge
  async function eingaenge(ab) {
    const q = new URLSearchParams({ select: "datum,betrag,gegenpartei,verwendungszweck,referenz,bank", order: "datum.desc", limit: "1000" });
    q.append("betrag", "gt.0");
    if (ab) q.append("datum", "gte." + ab);
    const res = await fetch(`${CFG.url}/rest/v1/bank_umsaetze?${q}`, { headers: { apikey: CFG.key, Authorization: "Bearer " + await token() } });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error((j && (j.message || j.hint)) || `Umsätze konnten nicht gelesen werden (${res.status})`);
    return (j || []).map(u => ({ datum: u.datum, betrag: Math.round(Number(u.betrag) * 100) / 100, name: u.gegenpartei || "",
      zweck: u.verwendungszweck || "", text: "", referenz: u.referenz, bank: u.bank || "" }));
  }

  root.EFBank = { konfigurieren, konfiguriert, angemeldet, email, anmelden, abmelden, status, sync, eingaenge };
})(window);
