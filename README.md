# Ein-Facher Rechnungen

Eigene Rechnungs-WebApp für **ein-facher.de** – Kleinunternehmer nach § 19 UStG.

```
Browser (GitHub Pages)  ──MSAL-Login──▶  Entra ID
        │
        └──Microsoft Graph API──▶  SharePoint-Listen (Daten)
                                   SharePoint-Bibliothek (PDFs)
                                   Exchange Online (Versand über rechnung@ein-facher.de)
```

Kein eigener Server, keine Datenbank-VM. GitHub hostet nur den Code – **alle Daten bleiben in deinem M365-Tenant**.

## Funktionen

- Kunden (automatische Kundennummer K-0001 …) und Artikel/Leistungen
- Angebote (AN-2026-0001) und Rechnungen (RE-2026-0001) mit **fortlaufender, lückenloser Nummer** – vergeben erst beim Festschreiben
- Festgeschriebene Belege sind gesperrt; Korrektur nur per **Stornorechnung** (eigene RE-Nummer, negative Beträge)
- Angebot → „Angenommen" erzeugt automatisch einen Rechnungsentwurf
- PDF im Ein-Facher-Design mit § 19-Hinweis, Ablage unter `/Rechnungen/<Kunde>/Rechnung_RE-2026-0001_2026-10-24.pdf`
- E-Mail-Versand mit PDF-Anhang über das freigegebene Postfach
- Status: Entwurf · Offen · Versendet · Überfällig · Bezahlt · Storniert · Angenommen · Abgelehnt
- Übersicht mit offenen Posten, Überfälligen und Umsatz gegen die Kleinunternehmergrenze

## Einrichtung

### 1. SharePoint-Site

Neue Team- oder Kommunikationswebsite anlegen, z. B. `https://<tenant>.sharepoint.com/sites/Rechnungen`
(oder eine bestehende wie `/sites/IT-Daten` verwenden).

### 2. App-Registrierung (PowerShell 7, als Global Admin)

```powershell
cd setup
.\Setup-AppRegistration.ps1 -GitHubPagesUrl "https://<github-user>.github.io/ein-facher-rechnung/" -AdminUpn "<dein-admin>@ein-facher.de"
```

Das Skript legt die SPA-App an, erteilt Admin Consent (User.Read, Sites.Manage.All, Mail.Send, Mail.Send.Shared),
beschränkt die Anmeldung auf dich und setzt SendAs auf `rechnung@ein-facher.de`. Am Ende stehen `clientId` und `tenantId` da.

### 3. `js/config.js` ausfüllen

`clientId`, `tenantId`, `siteHostname`, `sitePath` eintragen. **Keine** Anschrift, IBAN oder Steuernummer hier – die kommen in der App unter *Einstellungen* und liegen dann in SharePoint.

### 4. GitHub Pages

```bash
git init && git add . && git commit -m "Ein-Facher Rechnungen"
git branch -M main
git remote add origin https://github.com/<github-user>/ein-facher-rechnung.git
git push -u origin main
```

GitHub → Repository → *Settings* → *Pages* → *Deploy from a branch* → `main` / `/ (root)`.
Pages ist für öffentliche Repos kostenlos; für ein privates Repo mit Pages brauchst du GitHub Pro. Das Repo enthält keine Geheimnisse und keine Daten.

### 5. Erster Start

1. Seite öffnen → *Mit Microsoft 365 anmelden*
2. *Einstellungen* → **Listen einrichten / prüfen** (legt `EF_Kunden`, `EF_Artikel`, `EF_Belege`, `EF_Einstellungen` an)
3. Firmendaten ausfüllen (Anschrift, Steuernummer, Bank) → Speichern
4. Kunden und Artikel anlegen → erste Rechnung

### Lokal testen

```bash
python -m http.server 8080
```
→ `http://localhost:8080/` (ist als Redirect-URI bereits eingetragen).

## Automatische E-Mail-Benachrichtigungen (Rechnungs-Wächter)

Der **Rechnungs-Wächter** läuft als GitHub Action etwa alle 10 Minuten – auch wenn die App geschlossen ist.
Die Bank fragt er tagsüber nur ca. alle 3,5 Stunden neu ab (Banken erlauben ohne dich nur wenige automatische Abrufe pro Tag); Zahlungen, die die App beim Öffnen holt, meldet er beim nächsten Lauf:

1. holt über den **Gehalt-Monitor** die Zahlungseingänge der Bank und bucht passende Rechnungen als **Bezahlt** (Rechnungsnummer + Betrag),
2. schickt eine **E-Mail**, sobald eine Rechnung **überfällig** oder **bezahlt** ist – jede Meldung nur einmal.

Empfänger, CC und Schalter: **App → Einstellungen → 📧 Benachrichtigungen**.

### Einmalige Einrichtung

1. **Mail.Send erlauben:** `setup/Setup-Benachrichtigung.ps1` in PowerShell ausführen (Gerätecode-Anmeldung als Administrator).
   Das Skript erteilt der App die Anwendungsberechtigung **Mail.Send** und beschränkt das Senden auf `rechnung@ein-facher.de`.
   *Alternativ im Portal:* Entra ID → App-Registrierungen → Rechnungs-App → API-Berechtigungen → Microsoft Graph → **Anwendungsberechtigungen** → `Mail.Send` → Administratorzustimmung erteilen.
2. **Secrets in GitHub anlegen:** Repository → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*

   | Name | Wert |
   |---|---|
   | `EF_CLIENT_SECRET` | geheimer Schlüssel (Wert) der App-Registrierung – derselbe wie für die Setup-Skripte |
   | `SB_EMAIL` | E-Mail des Gehalt-Monitor-Kontos (für die Bankprüfung, optional) |
   | `SB_PASSWORD` | Passwort des Gehalt-Monitor-Kontos (optional) |

3. **Testen:** *Actions* → *Rechnungs-Wächter* → *Run workflow* (mit Haken „Trockenlauf“ wird nichts gebucht und keine E-Mail gesendet).

Beim **ersten Lauf** werden bereits bezahlte Rechnungen nur gemerkt (keine E-Mail); überfällige werden gemeldet.
Das Protokoll in GitHub Actions ist öffentlich und enthält deshalb nur Zahlen – keine Namen, Beträge oder Rechnungsnummern.

## Rechtliches (kurz)

- Pflichtangaben nach § 14 UStG sind abgedeckt: Name/Anschrift beider Seiten, Steuernummer oder USt-IdNr., Datum, fortlaufende Nummer, Menge und Art der Leistung, Leistungszeitpunkt, Entgelt, Hinweis auf § 19 UStG.
- Bis die Steuernummer da ist, warnt die App beim Festschreiben von Rechnungen.
- Kleinunternehmer sind von der Pflicht zur Ausstellung von E-Rechnungen (XRechnung/ZUGFeRD) ausgenommen; der *Empfang* von E-Rechnungen muss trotzdem möglich sein (E-Mail-Postfach reicht).
- GoBD: Festgeschriebene Belege werden nicht mehr verändert, Korrekturen laufen über Storno. Für eine revisionssichere Archivierung in SharePoint empfiehlt sich zusätzlich eine **Aufbewahrungsrichtlinie (Purview Retention, 8–10 Jahre)** auf der Site.
- Keine Steuerberatung – im Zweifel mit dem Steuerberater abstimmen.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Seitengerüst |
| `css/style.css` | Design |
| `js/config.js` | Tenant-/Site-Konfiguration |
| `js/graph.js` | Anmeldung (MSAL) und Graph-Aufrufe, Listen-Schema |
| `js/pdf.js` | PDF-Layout (pdfmake) |
| `js/app.js` | Oberfläche und Logik |
| `setup/Setup-AppRegistration.ps1` | Entra-App, Consent, SendAs |
