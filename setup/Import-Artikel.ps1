<#
.SYNOPSIS
  Schreibt den Ein-Facher-Artikelkatalog (mit Kategorien) in die SharePoint-Liste EF_Artikel.

.DESCRIPTION
  - Anmeldung NUR mit Tenant-ID + Client-ID + Client-Secret – reines REST, keine PowerShell-Module (kein DLL-Konflikt)
  - Legt die Spalte "Kategorie" in EF_Artikel an, falls sie fehlt
  - Artikel sind direkt im Skript hinterlegt (39 Leistungen von ein-facher.de, 7 Kategorien)
    ODER werden aus einer CSV gelesen (-CsvPath, Spalten: Artikelnummer;Kategorie;Bezeichnung;Einheit;Preis;Beschreibung)
  - Gleiche Artikelnummer -> wird aktualisiert, neue Artikelnummer -> wird angelegt (keine Duplikate)
  - Kann beliebig oft ausgeführt werden

.EXAMPLE
  .\Import-Artikel.ps1
  .\Import-Artikel.ps1 -CsvPath "C:\Users\Mohammed\Downloads\Ein-Facher_Artikel.csv"

.NOTES
  Läuft in Windows PowerShell 5.1 UND PowerShell 7 – egal was vorher im Fenster geladen war.
  App braucht die Anwendungsberechtigung Sites.FullControl.All (oder Sites.ReadWrite.All) mit Admin-Zustimmung.
  Secret wird abgefragt (WERT, nicht Secret-ID) und nicht gespeichert.
#>
[CmdletBinding()]
param(
    [string] $TenantId     = "69a7d3e4-6d53-43dd-a016-dc755b1f684b",
    [string] $ClientId     = "4c131eb5-395e-4cbc-8c6d-66667e2f03b1",
    [string] $SiteHostname = "6zxkpr.sharepoint.com",
    [string] $SitePath     = "/sites/ein-facher-Rechnung-system",
    [string] $ListName     = "EF_Artikel",
    [string] $CsvPath
)

$ErrorActionPreference = "Stop"
$G = "https://graph.microsoft.com/v1.0"
function Info($t) { Write-Host $t -ForegroundColor Cyan }
function Ok($t)   { Write-Host $t -ForegroundColor Green }
function Warn($t) { Write-Host $t -ForegroundColor Yellow }

# =====================================================================
# Kategorien
# =====================================================================
$K_SUP = "Support & Beratung"
$K_365 = "Microsoft 365 & Cloud"
$K_AUT = "Automatisierung & Power Platform"
$K_DEV = "Entwicklung & WebApps"
$K_ONP = "On-Premises (AD, DHCP, Server)"
$K_NET = "Arbeitsplatz & Netzwerk"
$K_MIG = "Migration & Backup"

# =====================================================================
# Artikelkatalog (Preise in €, Kleinunternehmer – keine USt)
# =====================================================================
$katalog = @(
    # --- Support & Beratung ---
    @{ Nr = "EF-001"; Kat = $K_SUP; Titel = "Kostenloses Erstgespräch";                  Einheit = "pausch."; Preis = 0;    Text = "Analyse der Anforderungen, ca. 30 Minuten – kostenlos" }
    @{ Nr = "EF-010"; Kat = $K_SUP; Titel = "IT-Support Remote";                         Einheit = "Std.";    Preis = 69;   Text = "Fernwartung per Telefon/Bildschirmfreigabe, Abrechnung im 15-Minuten-Takt" }
    @{ Nr = "EF-011"; Kat = $K_SUP; Titel = "IT-Support vor Ort";                        Einheit = "Std.";    Preis = 79;   Text = "Einsatz beim Kunden, Abrechnung im 15-Minuten-Takt" }
    @{ Nr = "EF-012"; Kat = $K_SUP; Titel = "Anfahrtspauschale Zone 1 (bis 20 km)";      Einheit = "pausch."; Preis = 25;   Text = "Anfahrt pro Einsatz" }
    @{ Nr = "EF-013"; Kat = $K_SUP; Titel = "Anfahrtspauschale Zone 2 (20–50 km)";       Einheit = "pausch."; Preis = 45;   Text = "Anfahrt pro Einsatz" }
    @{ Nr = "EF-014"; Kat = $K_SUP; Titel = "Zuschlag Notfall / Wochenende";             Einheit = "Std.";    Preis = 35;   Text = "Zuschlag pro Stunde für Einsätze außerhalb Mo–Fr 8–18 Uhr" }
    @{ Nr = "EF-015"; Kat = $K_SUP; Titel = "IT-Beratung & Konzeption";                  Einheit = "Std.";    Preis = 89;   Text = "Planung, Konzepte, Dokumentation" }
    # --- Microsoft 365 & Cloud ---
    @{ Nr = "EF-101"; Kat = $K_365; Titel = "Microsoft 365 Grundeinrichtung";            Einheit = "pausch."; Preis = 390;  Text = "Tenant, Domain, DNS-Einträge, Sicherheits-Grundeinstellungen, bis 5 Benutzer" }
    @{ Nr = "EF-102"; Kat = $K_365; Titel = "M365-Benutzer einrichten";                  Einheit = "Stk.";    Preis = 29;   Text = "Konto, Lizenz, Postfach, MFA, Gruppen" }
    @{ Nr = "EF-103"; Kat = $K_365; Titel = "E-Mail-Migration pro Postfach";             Einheit = "Stk.";    Preis = 59;   Text = "Übernahme von E-Mails, Kontakten und Kalender vom alten Anbieter nach Exchange Online" }
    @{ Nr = "EF-104"; Kat = $K_365; Titel = "Freigegebenes Postfach / Verteiler";        Einheit = "Stk.";    Preis = 25;   Text = "Einrichtung inkl. Berechtigungen" }
    @{ Nr = "EF-105"; Kat = $K_365; Titel = "SharePoint-Struktur einrichten";            Einheit = "pausch."; Preis = 290;  Text = "Site, Dokumentenbibliotheken, Berechtigungen, Integration in Teams/Outlook" }
    @{ Nr = "EF-106"; Kat = $K_365; Titel = "Entra ID Sicherheitspaket";                 Einheit = "pausch."; Preis = 349;  Text = "MFA, Conditional Access, Single Sign-On, Sicherheitsrichtlinien" }
    @{ Nr = "EF-107"; Kat = $K_365; Titel = "Intune Grundeinrichtung";                   Einheit = "pausch."; Preis = 490;  Text = "Geräterichtlinien, Verschlüsselung, App-Verteilung, Fernlöschung" }
    @{ Nr = "EF-108"; Kat = $K_365; Titel = "Gerät in Intune aufnehmen";                 Einheit = "Stk.";    Preis = 39;   Text = "Registrierung/Autopilot und Zuweisung der Richtlinien" }
    @{ Nr = "EF-109"; Kat = $K_365; Titel = "M365-Betreuung pro Benutzer";               Einheit = "Monat";   Preis = 12;   Text = "Laufende Verwaltung: Lizenzen, Benutzeränderungen, Sicherheitsupdates, Überwachung" }
    # --- Automatisierung & Power Platform ---
    @{ Nr = "EF-201"; Kat = $K_AUT; Titel = "Prozess-Workshop & Konzept";                Einheit = "pausch."; Preis = 299;  Text = "Analyse der Abläufe und Lösungskonzept (ca. 4 Stunden)" }
    @{ Nr = "EF-202"; Kat = $K_AUT; Titel = "Power Automate Flow (einfach)";             Einheit = "pausch."; Preis = 249;  Text = "z. B. automatische Benachrichtigung oder Ablage" }
    @{ Nr = "EF-203"; Kat = $K_AUT; Titel = "Power Automate Flow (komplex)";             Einheit = "pausch."; Preis = 590;  Text = "z. B. mehrstufige Genehmigung, Berichte, mehrere Systeme" }
    @{ Nr = "EF-204"; Kat = $K_AUT; Titel = "Power-Apps-Entwicklung";                    Einheit = "Std.";    Preis = 85;   Text = "Individuelle Geschäfts-App ohne Programmierung" }
    @{ Nr = "EF-205"; Kat = $K_AUT; Titel = "Schulung";                                  Einheit = "Std.";    Preis = 69;   Text = "Einweisung des Teams, vor Ort oder online" }
    # --- Arbeitsplatz & Netzwerk ---
    @{ Nr = "EF-301"; Kat = $K_NET; Titel = "Arbeitsplatz einrichten";                   Einheit = "Stk.";    Preis = 149;  Text = "Windows 10/11, Microsoft Office, Programme, Drucker" }
    @{ Nr = "EF-302"; Kat = $K_NET; Titel = "Datenübernahme vom alten PC";               Einheit = "Stk.";    Preis = 69;   Text = "Dateien, Profile, Favoriten, E-Mail-Daten" }
    @{ Nr = "EF-303"; Kat = $K_NET; Titel = "Drucker / Multifunktionsgerät einrichten";  Einheit = "Stk.";    Preis = 59;   Text = "Netzwerkdrucker, Scanner, Treiber für alle PCs" }
    @{ Nr = "EF-307"; Kat = $K_NET; Titel = "WLAN einrichten & absichern";               Einheit = "pausch."; Preis = 129;  Text = "Access Points, Verschlüsselung, Gäste-WLAN" }
    @{ Nr = "EF-308"; Kat = $K_NET; Titel = "Firewall / VPN konfigurieren";              Einheit = "pausch."; Preis = 249;  Text = "Router, Firewall-Regeln, VPN-Zugang" }
    # --- On-Premises (AD, DHCP, Server) ---
    @{ Nr = "EF-304"; Kat = $K_ONP; Titel = "Windows Server Installation";               Einheit = "pausch."; Preis = 690;  Text = "Installation und Grundkonfiguration, Updates, Rollen" }
    @{ Nr = "EF-305"; Kat = $K_ONP; Titel = "Active Directory einrichten";               Einheit = "pausch."; Preis = 490;  Text = "Benutzer, Gruppen, GPOs, DNS, DHCP" }
    @{ Nr = "EF-306"; Kat = $K_ONP; Titel = "Virtualisierung Hyper-V / VMware";          Einheit = "pausch."; Preis = 390;  Text = "Einrichtung Host und erste virtuelle Maschine" }
    # --- Migration & Backup ---
    @{ Nr = "EF-401"; Kat = $K_MIG; Titel = "Local → Cloud Migration";                   Einheit = "Std.";    Preis = 85;   Text = "Schrittweise Migration in die Microsoft-Cloud, Umfang nach Angebot" }
    @{ Nr = "EF-402"; Kat = $K_MIG; Titel = "Hybrid Join / Entra Connect";               Einheit = "pausch."; Preis = 590;  Text = "Synchronisation lokales AD mit Entra ID, Hybrid-Join der Geräte" }
    @{ Nr = "EF-403"; Kat = $K_MIG; Titel = "Backup-Lösung einrichten";                  Einheit = "pausch."; Preis = 349;  Text = "Veeam oder Azure Backup inkl. Wiederherstellungstest" }
    @{ Nr = "EF-404"; Kat = $K_MIG; Titel = "Backup-Überwachung";                        Einheit = "Monat";   Preis = 29;   Text = "Monatliche Prüfung der Sicherungen und Bericht" }
    # --- Entwicklung & WebApps ---
    @{ Nr = "EF-501"; Kat = $K_DEV; Titel = "Business-WebApp Paket";                     Einheit = "pausch."; Preis = 1490; Text = "Individuelle HTML-WebApp mit Microsoft-365-Anmeldung, Microsoft Graph API und SharePoint als Datenbank. Enthalten: Konzeptgespräch, bis zu 4 Datenbereiche (Listen), Erfassen/Bearbeiten/Suchen, PDF-Erstellung, E-Mail-Versand, Hosting-Einrichtung, Einbindung von Impressum und Datenschutzerklärung, Einweisung" }
    @{ Nr = "EF-502"; Kat = $K_DEV; Titel = "WebApp Zusatzfunktion";                     Einheit = "Std.";    Preis = 85;   Text = "Erweiterung einer bestehenden WebApp, z. B. weitere Listen, Auswertungen, Dashboards, Import/Export" }
    @{ Nr = "EF-503"; Kat = $K_DEV; Titel = "Impressum & Datenschutzerklärung einbinden"; Einheit = "pausch."; Preis = 149; Text = "Einbindung von Impressum und Datenschutzerklärung (Texte durch den Kunden bzw. Generator) als eigene Seiten, Verlinkung in der App" }
    @{ Nr = "EF-504"; Kat = $K_DEV; Titel = "Eigene Domain für WebApp";                  Einheit = "pausch."; Preis = 79;   Text = "Einrichtung einer eigenen (Sub-)Domain inkl. DNS und HTTPS" }
    @{ Nr = "EF-505"; Kat = $K_DEV; Titel = "WebApp Wartung & Support";                  Einheit = "Monat";   Preis = 49;   Text = "Updates, Überwachung, Anpassung an Microsoft-Änderungen, kleine Änderungen bis 30 Minuten/Monat" }
    @{ Nr = "EF-506"; Kat = $K_DEV; Titel = "Datenübernahme in WebApp";                  Einheit = "pausch."; Preis = 199;  Text = "Import bestehender Daten aus Excel/CSV in die SharePoint-Listen" }
)

# Optional: CSV statt eingebautem Katalog
if ($CsvPath) {
    if (-not (Test-Path $CsvPath)) { throw "CSV nicht gefunden: $CsvPath" }
    $first = Get-Content -Path $CsvPath -TotalCount 1 -Encoding utf8
    $delim = if (($first -split ";").Count -ge ($first -split ",").Count) { ";" } else { "," }
    $katalog = Import-Csv -Path $CsvPath -Delimiter $delim -Encoding utf8 | Where-Object { $_.Bezeichnung } | ForEach-Object {
        $p = ($_.Preis -replace "[€\s]", "")
        if ($p -match ",") { $p = ($p -replace "\.", "") -replace ",", "." }
        @{
            Nr      = "$($_.Artikelnummer)".Trim()
            Kat     = "$($_.Kategorie)".Trim()
            Titel   = "$($_.Bezeichnung)".Trim()
            Einheit = $(if ($_.Einheit) { "$($_.Einheit)".Trim() } else { "Stk." })
            Preis   = [math]::Round([double]::Parse($(if ($p) { $p } else { "0" }), [Globalization.CultureInfo]::InvariantCulture), 2)
            Text    = "$($_.Beschreibung)".Trim()
        }
    }
    Ok "$($katalog.Count) Artikel aus CSV gelesen"
}

# =====================================================================
# REST-Helfer (ohne Module)
# =====================================================================
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$script:Token = $null

function Get-AppToken([string]$Secret) {
    $body = @{
        client_id     = $ClientId
        client_secret = $Secret
        scope         = "https://graph.microsoft.com/.default"
        grant_type    = "client_credentials"
    }
    $r = Invoke-RestMethod -Method POST -Uri "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token" `
        -Body $body -ContentType "application/x-www-form-urlencoded"
    return $r.access_token
}

function Get-TokenRoles([string]$Jwt) {
    $p = $Jwt.Split(".")[1].Replace("-", "+").Replace("_", "/")
    switch ($p.Length % 4) { 2 { $p += "==" } 3 { $p += "=" } }
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
    return @($json.roles)
}

function Get-ErrorText($err) {
    $msg = $err.Exception.Message
    try {
        if ($err.ErrorDetails -and $err.ErrorDetails.Message) {
            $j = $err.ErrorDetails.Message | ConvertFrom-Json
            if ($j.error.message) { $msg = "$($j.error.code): $($j.error.message)" }
            elseif ($j.error_description) { $msg = $j.error_description }
        }
    } catch { }
    return $msg
}

function Invoke-Graph {
    param([string]$Method = "GET", [string]$Uri, $Body)
    $url = if ($Uri.StartsWith("https://")) { $Uri } else { "$G$Uri" }
    $p = @{ Method = $Method; Uri = $url; Headers = @{ Authorization = "Bearer $script:Token" } }
    if ($null -ne $Body) {
        $json = $Body | ConvertTo-Json -Depth 10 -Compress
        $p.Body = [Text.Encoding]::UTF8.GetBytes($json)
        $p.ContentType = "application/json; charset=utf-8"
    }
    return Invoke-RestMethod @p
}

# =====================================================================
# 1. Anmeldung per Client-Secret
# =====================================================================
Write-Host "Client-Secret eingeben (der WERT, nicht die Secret-ID):" -ForegroundColor Cyan
$sec   = Read-Host -AsSecureString "Secret-Wert"
$plain = [Net.NetworkCredential]::new("", $sec).Password

Info "[1/5] Anmeldung (Tenant $TenantId, App $ClientId) ..."
try {
    $script:Token = Get-AppToken $plain
} catch {
    Write-Host (Get-ErrorText $_) -ForegroundColor Red
    Warn "Anmeldung fehlgeschlagen. Häufige Ursachen:"
    Warn " - Secret-ID statt Secret-WERT eingegeben"
    Warn " - Secret abgelaufen oder gelöscht (Entra -> App -> Zertifikate & Geheimnisse)"
    return
} finally {
    $plain = $null
}
$rollen = Get-TokenRoles $script:Token
if (-not ($rollen -contains "Sites.FullControl.All" -or $rollen -contains "Sites.ReadWrite.All" -or $rollen -contains "Sites.Manage.All")) {
    Warn "Der App fehlt die Anwendungsberechtigung Sites.FullControl.All (oder Sites.ReadWrite.All) mit Admin-Zustimmung."
    Warn "Rollen im Token: $($rollen -join ', ')"
    return
}
Ok "Verbunden"

# =====================================================================
# 2. Site und Liste finden
# =====================================================================
Info "[2/5] Suche Liste $ListName ..."
$site   = Invoke-Graph -Uri "$G/sites/$($SiteHostname):$SitePath"
$listen = (Invoke-Graph -Uri "$G/sites/$($site.id)/lists?`$select=id,displayName").value
$liste  = $listen | Where-Object { $_.displayName -eq $ListName } | Select-Object -First 1
if (-not $liste) { throw "Liste $ListName nicht gefunden in $($site.webUrl). Bitte zuerst Setup-SharePoint.ps1 ausführen." }
$base = "$G/sites/$($site.id)/lists/$($liste.id)"
Ok "Liste gefunden: $($site.webUrl) -> $ListName"

# =====================================================================
# 3. Spalten prüfen (Kategorie neu)
# =====================================================================
Info "[3/5] Prüfe Spalten ..."
$spalten = @(
    @{ name = "Artikelnummer"; text = @{ maxLength = 255 } }
    @{ name = "Kategorie";     text = @{ maxLength = 255 } }
    @{ name = "Beschreibung";  text = @{ allowMultipleLines = $true; textType = "plain"; linesForEditing = 6 } }
    @{ name = "Einheit";       text = @{ maxLength = 255 } }
    @{ name = "Preis";         number = @{ decimalPlaces = "two" } }
)
$vorhandeneSpalten = (Invoke-Graph -Uri "$base/columns").value.name
foreach ($sp in $spalten) {
    if ($vorhandeneSpalten -notcontains $sp.name) {
        Invoke-Graph -Method POST -Uri "$base/columns" -Body $sp | Out-Null
        Ok "  + Spalte $($sp.name) angelegt"
    }
}
Ok "Spalten vollständig"

# =====================================================================
# 4. Vorhandene Artikel laden (mit Paging)
# =====================================================================
Info "[4/5] Lade vorhandene Artikel ..."
$vorhanden = @{}
$url = "$base/items?expand=fields(`$select=Title,Artikelnummer)&`$top=500"
while ($url) {
    $r = Invoke-Graph -Uri $url
    foreach ($i in $r.value) {
        $key = if ($i.fields.Artikelnummer) { "NR:" + $i.fields.Artikelnummer } else { "TI:" + $i.fields.Title }
        $vorhanden[$key] = $i.id
    }
    $url = $r.'@odata.nextLink'
}
Ok "$($vorhanden.Count) Artikel bereits in der Liste"

# =====================================================================
# 5. Anlegen bzw. aktualisieren
# =====================================================================
Info "[5/5] Schreibe $($katalog.Count) Artikel ..."
$neu = 0; $akt = 0; $fehler = 0
$letzteKat = ""
foreach ($a in ($katalog | Sort-Object { $_.Kat }, { $_.Nr })) {
    if ($a.Kat -ne $letzteKat) { Write-Host "`n  [$($a.Kat)]" -ForegroundColor Cyan; $letzteKat = $a.Kat }
    $fields = @{
        Title         = $a.Titel
        Artikelnummer = $a.Nr
        Kategorie     = $a.Kat
        Einheit       = $a.Einheit
        Preis         = [double]$a.Preis
        Beschreibung  = $a.Text
    }
    $key = if ($a.Nr) { "NR:" + $a.Nr } else { "TI:" + $a.Titel }
    try {
        if ($vorhanden.ContainsKey($key)) {
            Invoke-Graph -Method PATCH -Uri "$base/items/$($vorhanden[$key])/fields" -Body $fields | Out-Null
            Write-Host ("  ~ {0,-7} {1,-44} {2,9:N2} €" -f $a.Nr, $a.Titel, $a.Preis) -ForegroundColor DarkYellow
            $akt++
        } else {
            $res = Invoke-Graph -Method POST -Uri "$base/items" -Body @{ fields = $fields }
            $vorhanden[$key] = $res.id
            Write-Host ("  + {0,-7} {1,-44} {2,9:N2} €" -f $a.Nr, $a.Titel, $a.Preis) -ForegroundColor Green
            $neu++
        }
    } catch {
        Write-Host "  ! $($a.Nr) $($a.Titel): $($_.Exception.Message)" -ForegroundColor Red
        $fehler++
    }
}

$script:Token = $null

Write-Host "`n================ FERTIG ================" -ForegroundColor Cyan
Write-Host "Neu angelegt : $neu"
Write-Host "Aktualisiert : $akt"
Write-Host "Fehler       : $fehler"
Write-Host "Liste        : $($site.webUrl)/Lists/$ListName"
Write-Host "`nIn der WebApp unter 'Artikel' mit Strg+F5 neu laden." -ForegroundColor DarkGray
