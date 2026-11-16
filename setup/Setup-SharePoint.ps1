<#
.SYNOPSIS
  Erstellt die SharePoint-Site "ein-facher-Rechnung-system" und alle Listen für die Rechnungs-WebApp.
  Anmeldung NUR mit Tenant-ID + Client-ID + Client-Secret – ohne PowerShell-Module (reines REST).

.DESCRIPTION
  1. Holt per REST ein App-Token (client_credentials) – kein Microsoft.Graph-Modul, daher kein DLL-Konflikt
  2. Prüft, ob die App die nötigen Anwendungsberechtigungen hat
  3. Legt eine Microsoft-365-Gruppe an -> SharePoint erstellt automatisch die Teamsite
     https://<tenant>.sharepoint.com/sites/ein-facher-Rechnung-system
  4. Legt die Listen EF_Kunden, EF_Artikel, EF_Belege, EF_Einstellungen, EF_Benutzer mit allen Spalten an
     (fehlende Spalten werden immer ergänzt – auch bei bestehenden Listen)
  5. Legt den Ordner "Rechnungen" in der Dokumentbibliothek an
  6. Gibt die Werte für js/config.js aus
  Kann beliebig oft ausgeführt werden – Vorhandenes wird übersprungen.

.EXAMPLE
  .\Setup-SharePoint.ps1
  .\Setup-SharePoint.ps1 -OwnerUpn "mohammed.babat@ein-facher.de"

.NOTES
  Läuft in Windows PowerShell 5.1 UND PowerShell 7 – egal was vorher im Fenster geladen war.
  Die App braucht EINMALIG im Entra-Portal unter "API-Berechtigungen" -> Microsoft Graph -> ANWENDUNGSBERECHTIGUNGEN:
    - Sites.FullControl.All
    - Group.ReadWrite.All   (nur nötig, wenn die Site noch nicht existiert)
    - User.Read.All         (nur nötig, wenn die Site noch nicht existiert)
  und danach "Administratorzustimmung erteilen".
  Das Secret wird beim Start abgefragt (WERT des Secrets, nicht die Secret-ID!) und nirgends gespeichert.
#>
[CmdletBinding()]
param(
    [string] $TenantId   = "69a7d3e4-6d53-43dd-a016-dc755b1f684b",
    [string] $ClientId   = "4c131eb5-395e-4cbc-8c6d-66667e2f03b1",
    [string] $OwnerUpn   = "mohammed.babat@ein-facher.de",
    [string] $SiteTitle  = "ein-facher-Rechnung-system",
    [string] $SiteAlias  = "ein-facher-Rechnung-system",
    [string] $ListPrefix = "EF_",
    [string] $PdfFolder  = "Rechnungen"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$G = "https://graph.microsoft.com/v1.0"
function Info($t) { Write-Host $t -ForegroundColor Cyan }
function Ok($t)   { Write-Host $t -ForegroundColor Green }
function Warn($t) { Write-Host $t -ForegroundColor Yellow }

# =====================================================================
# REST-Helfer (ohne Module)
# =====================================================================
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

# Gibt $null zurück, wenn das Objekt nicht existiert (404)
function Get-GraphOrNull([string]$Uri) {
    try { return Invoke-Graph -Uri $Uri } catch {
        $code = 0
        try { $code = [int]$_.Exception.Response.StatusCode } catch { }
        if ($code -eq 404) { return $null }
        throw
    }
}

# =====================================================================
# 1. Anmeldung per Client-Secret
# =====================================================================
Write-Host "Client-Secret eingeben (der WERT aus 'Zertifikate & Geheimnisse', nicht die Secret-ID):" -ForegroundColor Cyan
$sec = Read-Host -AsSecureString "Secret-Wert"
$plain = [Net.NetworkCredential]::new("", $sec).Password

Info "`n[1/6] Anmeldung (Tenant $TenantId, App $ClientId) ..."
try {
    $script:Token = Get-AppToken $plain
} catch {
    Write-Host (Get-ErrorText $_) -ForegroundColor Red
    Warn "Anmeldung fehlgeschlagen. Häufigste Ursachen:"
    Warn " - Secret-ID statt Secret-WERT eingegeben"
    Warn " - Secret abgelaufen oder gelöscht (Entra -> App -> Zertifikate & Geheimnisse)"
    return
} finally {
    $plain = $null
}
Ok "Token erhalten"

# =====================================================================
# 2. Berechtigungen prüfen
# =====================================================================
Info "[2/6] Prüfe Berechtigungen ..."
$rollen = Get-TokenRoles $script:Token
Write-Host "  Rollen im Token: $($rollen -join ', ')" -ForegroundColor DarkGray
if ($rollen -notcontains "Sites.FullControl.All") {
    Warn @"

Der App fehlt die Anwendungsberechtigung Sites.FullControl.All.
Entra -> App-Registrierungen -> App $ClientId -> API-Berechtigungen -> Berechtigung hinzufügen
-> Microsoft Graph -> ANWENDUNGSBERECHTIGUNGEN -> Sites.FullControl.All
-> "Administratorzustimmung erteilen". Danach 2 Minuten warten und Skript erneut starten.
"@
    return
}
Ok "✓ Sites.FullControl.All vorhanden"

$spHost = (Invoke-Graph -Uri "/sites/root").siteCollection.hostname
Ok "SharePoint: $spHost"

# =====================================================================
# 3. Site (über Microsoft-365-Gruppe) prüfen bzw. anlegen
# =====================================================================
Info "`n[3/6] Site '$SiteTitle' ..."
$site = Get-GraphOrNull "/sites/$($spHost):/sites/$SiteAlias"

if ($site) {
    Ok "✓ Site existiert bereits: $($site.webUrl)"
} else {
    foreach ($r in "Group.ReadWrite.All", "User.Read.All") {
        if ($rollen -notcontains $r) { Warn "Zum Anlegen der Site fehlt die Anwendungsberechtigung $r (mit Admin-Zustimmung)."; return }
    }
    $grp = (Invoke-Graph -Uri "/groups?`$filter=mailNickname eq '$SiteAlias'").value | Select-Object -First 1
    if (-not $grp) {
        $owner = Get-GraphOrNull "/users/$OwnerUpn"
        if (-not $owner) { throw "Benutzer $OwnerUpn nicht gefunden (Tippfehler? @ = AltGr+Q)." }
        $body = @{
            displayName          = $SiteTitle
            description          = "Ein-Facher Rechnungssystem – Daten und PDFs"
            groupTypes           = @("Unified")
            mailEnabled          = $true
            mailNickname         = $SiteAlias
            securityEnabled      = $false
            visibility           = "Private"
            "owners@odata.bind"  = @("$G/users/$($owner.id)")
            "members@odata.bind" = @("$G/users/$($owner.id)")
        }
        $grp = Invoke-Graph -Method POST -Uri "/groups" -Body $body
        Ok "+ Gruppe angelegt (ID $($grp.id))"
    } else {
        Ok "✓ Gruppe existiert bereits (ID $($grp.id))"
    }

    Info "Warte, bis SharePoint die Site bereitgestellt hat (bis zu 5 Minuten) ..."
    for ($i = 1; $i -le 30 -and -not $site; $i++) {
        try { $site = Invoke-Graph -Uri "/groups/$($grp.id)/sites/root" }
        catch { Write-Host "  ... noch nicht bereit ($($i * 10) s)" -ForegroundColor DarkGray; Start-Sleep -Seconds 10 }
    }
    if (-not $site) { throw "Site nach 5 Minuten noch nicht bereit. Bitte Skript in ein paar Minuten erneut starten." }
    Ok "+ Site bereit: $($site.webUrl)"
}
$siteId   = $site.id
$sitePath = ([uri]$site.webUrl).AbsolutePath

# =====================================================================
# 4. Listen-Schema (passt zu js/graph.js der WebApp)
# =====================================================================
$schema = [ordered]@{
    "Kunden"        = @{ TitleName = "Name / Firma"; Fields = @(
        @("Kundennummer","Text"), @("Ansprechpartner","Text"), @("Strasse","Text"), @("PLZ","Text"), @("Ort","Text"),
        @("Land","Text"), @("Email","Text"), @("Telefon","Text"), @("Notiz","Note")) }
    "Artikel"       = @{ TitleName = "Bezeichnung"; Fields = @(
        @("Artikelnummer","Text"), @("Kategorie","Text"), @("Beschreibung","Note"), @("Einheit","Text"), @("Preis","Number")) }
    "Belege"        = @{ TitleName = "Nummer"; Fields = @(
        @("Typ","Text"), @("Status","Text"), @("KundeId","Number"), @("KundeJson","Note"), @("Datum","Text"),
        @("Faellig","Text"), @("Leistungsdatum","Text"), @("Positionen","Note"), @("Summe","Number"), @("Notiz","Note"),
        @("BezugNr","Text"), @("BezahltAm","Text"), @("PdfUrl","Text"), @("Versendet","Text"),
        @("Firma","Text"), @("UstSatz","Number")) }
    "Einstellungen" = @{ TitleName = "Schluessel"; Fields = @( @("Wert","Note") ) }
    "Benutzer"      = @{ TitleName = "Konto (UPN)"; Fields = @(
        @("Name","Text"), @("EntraId","Text"), @("Rolle","Text"), @("Aktiv","Text")) }
}

function New-ColumnDef([string]$name, [string]$type) {
    switch ($type) {
        "Note"   { return @{ name = $name; text = @{ allowMultipleLines = $true; textType = "plain"; linesForEditing = 6 } } }
        "Number" { return @{ name = $name; number = @{ decimalPlaces = "two" } } }
        default  { return @{ name = $name; text = @{ maxLength = 255 } } }
    }
}

# =====================================================================
# 5. Listen und Spalten anlegen
# =====================================================================
Info "`n[4/6] Lege Listen an ..."
$vorhanden = (Invoke-Graph -Uri "/sites/$siteId/lists?`$select=id,displayName").value

foreach ($entry in $schema.GetEnumerator()) {
    $listTitle = "$ListPrefix$($entry.Key)"
    $list = $vorhanden | Where-Object { $_.displayName -eq $listTitle } | Select-Object -First 1

    if (-not $list) {
        $body = @{
            displayName = $listTitle
            columns     = @($entry.Value.Fields | ForEach-Object { New-ColumnDef $_[0] $_[1] })
            list        = @{ template = "genericList" }
        }
        $list = Invoke-Graph -Method POST -Uri "/sites/$siteId/lists" -Body $body
        Ok "+ Liste $listTitle angelegt"
    } else {
        Ok "✓ Liste $listTitle vorhanden"
    }

    # Spalten IMMER prüfen und fehlende ergänzen (auch direkt nach dem Anlegen)
    $colObjs = (Invoke-Graph -Uri "/sites/$siteId/lists/$($list.id)/columns").value
    $cols = @($colObjs | ForEach-Object { $_.name })
    foreach ($f in $entry.Value.Fields) {
        if ($cols -contains $f[0]) { continue }
        Invoke-Graph -Method POST -Uri "/sites/$siteId/lists/$($list.id)/columns" -Body (New-ColumnDef $f[0] $f[1]) | Out-Null
        Write-Host "   + Spalte $($f[0])" -ForegroundColor Green
    }

    # Anzeigename der Title-Spalte anpassen (interner Name bleibt "Title")
    try {
        $titleCol = $colObjs | Where-Object { $_.name -eq "Title" } | Select-Object -First 1
        if ($titleCol -and $titleCol.displayName -ne $entry.Value.TitleName) {
            Invoke-Graph -Method PATCH -Uri "/sites/$siteId/lists/$($list.id)/columns/$($titleCol.id)" -Body @{ displayName = $entry.Value.TitleName } | Out-Null
        }
    } catch { Warn "   Anzeigename der Title-Spalte nicht geändert (nicht schlimm)." }
}

# =====================================================================
# 6. PDF-Ordner in der Dokumentbibliothek
# =====================================================================
Info "`n[5/6] PDF-Ordner ..."
$drive = Invoke-Graph -Uri "/sites/$siteId/drive"
if (Get-GraphOrNull "/drives/$($drive.id)/root:/$PdfFolder") {
    Ok "✓ Ordner '$PdfFolder' vorhanden"
} else {
    $body = @{ name = $PdfFolder; folder = @{}; "@microsoft.graph.conflictBehavior" = "fail" }
    Invoke-Graph -Method POST -Uri "/drives/$($drive.id)/root/children" -Body $body | Out-Null
    Ok "+ Ordner '$PdfFolder' angelegt"
}

$script:Token = $null

# =====================================================================
# Ausgabe
# =====================================================================
Info "`n[6/6] Fertig"
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Site: $($site.webUrl)`n"
Write-Host "Diese Zeilen in js/config.js auf GitHub eintragen:" -ForegroundColor Cyan
Write-Host "  siteHostname: `"$spHost`","
Write-Host "  sitePath: `"$sitePath`","
