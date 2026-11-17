<#
.SYNOPSIS
  Ein-Facher Rechnungen – E-Mail-Benachrichtigungen einrichten (einmalig)

.DESCRIPTION
  Der "Rechnungs-Wächter" (GitHub Actions) schickt E-Mails über Microsoft Graph,
  wenn eine Rechnung überfällig oder bezahlt ist. Dafür braucht die App-Registrierung
  die ANWENDUNGSBERECHTIGUNG Mail.Send.

  Dieses Skript:
    1. meldet dich per Gerätecode als Administrator an (Browser, kein Modul nötig – nur REST)
    2. gibt der App die Anwendungsberechtigung Mail.Send inkl. Administratorzustimmung
    3. (optional) beschränkt das Senden auf das Postfach rechnung@ein-facher.de
       (Exchange Online "ApplicationAccessPolicy") – empfohlen

  Danach in GitHub (Repository Rechnung-System → Settings → Secrets and variables → Actions)
  die Secrets EF_CLIENT_SECRET, SB_EMAIL und SB_PASSWORD anlegen (siehe README).

.NOTES
  Läuft mit Windows PowerShell 5.1 und PowerShell 7. Keine Module für Schritt 1–2 nötig.
#>

$ErrorActionPreference = "Stop"

# ---------------- Einstellungen ----------------
$TenantId  = "69a7d3e4-6d53-43dd-a016-dc755b1f684b"
$AppId     = "4c131eb5-395e-4cbc-8c6d-66667e2f03b1"     # App-Registrierung der Rechnungs-App
$Postfach  = "rechnung@ein-facher.de"                    # von hier werden die E-Mails gesendet
# Öffentliche Client-ID "Microsoft Graph Command Line Tools" (für die Gerätecode-Anmeldung)
$CliClient = "14d82eec-204b-4c2f-b7e8-296a70dab67e"
$GraphApp  = "00000003-0000-0000-c000-000000000000"     # Microsoft Graph

function Ok($t)   { Write-Host "  ✓ $t" -ForegroundColor Green }
function Info($t) { Write-Host "  • $t" -ForegroundColor Cyan }
function Warn($t) { Write-Host "  ! $t" -ForegroundColor Yellow }

Write-Host ""
Write-Host "Ein-Facher Rechnungen – E-Mail-Benachrichtigungen einrichten" -ForegroundColor Magenta
Write-Host "-----------------------------------------------------------"

# ---------------- 1. Anmeldung per Gerätecode ----------------
Info "Anmeldung als Administrator (Gerätecode) ..."
$scope = "https://graph.microsoft.com/Application.Read.All https://graph.microsoft.com/AppRoleAssignment.ReadWrite.All offline_access"
$dc = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/devicecode" `
        -Body @{ client_id = $CliClient; scope = $scope }
Write-Host ""
Write-Host "  $($dc.message)" -ForegroundColor White
Write-Host ""
try { Set-Clipboard -Value $dc.user_code; Info "Code ist in der Zwischenablage." } catch { }
try { Start-Process $dc.verification_uri } catch { }

$token = $null
$ende = (Get-Date).AddSeconds([int]$dc.expires_in)
while (-not $token -and (Get-Date) -lt $ende) {
    Start-Sleep -Seconds ([int]$dc.interval)
    try {
        $t = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token" -Body @{
            grant_type  = "urn:ietf:params:oauth:grant-type:device_code"
            client_id   = $CliClient
            device_code = $dc.device_code
        }
        $token = $t.access_token
    } catch {
        $fehler = $null
        try { $fehler = ($_.ErrorDetails.Message | ConvertFrom-Json).error } catch { }
        if ($fehler -ne "authorization_pending" -and $fehler -ne "slow_down") { throw "Anmeldung fehlgeschlagen: $fehler" }
    }
}
if (-not $token) { throw "Anmeldung abgelaufen – Skript bitte neu starten." }
Ok "Angemeldet"
$H = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

# ---------------- 2. Mail.Send als Anwendungsberechtigung ----------------
Info "Suche Dienstprinzipale ..."
$appSp   = (Invoke-RestMethod -Headers $H -Uri "https://graph.microsoft.com/v1.0/servicePrincipals?`$filter=appId eq '$AppId'").value | Select-Object -First 1
$graphSp = (Invoke-RestMethod -Headers $H -Uri "https://graph.microsoft.com/v1.0/servicePrincipals?`$filter=appId eq '$GraphApp'").value | Select-Object -First 1
if (-not $appSp)   { throw "Dienstprinzipal der App $AppId nicht gefunden." }
if (-not $graphSp) { throw "Microsoft Graph-Dienstprinzipal nicht gefunden." }
$rolle = $graphSp.appRoles | Where-Object { $_.value -eq "Mail.Send" -and $_.allowedMemberTypes -contains "Application" } | Select-Object -First 1
if (-not $rolle) { throw "Rolle Mail.Send nicht gefunden." }

$vorhanden = (Invoke-RestMethod -Headers $H -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$($appSp.id)/appRoleAssignments").value |
             Where-Object { $_.appRoleId -eq $rolle.id -and $_.resourceId -eq $graphSp.id }
if ($vorhanden) {
    Ok "Mail.Send ist bereits erteilt"
} else {
    $body = @{ principalId = $appSp.id; resourceId = $graphSp.id; appRoleId = $rolle.id } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Headers $H -Uri "https://graph.microsoft.com/v1.0/servicePrincipals/$($graphSp.id)/appRoleAssignedTo" -Body $body | Out-Null
    Ok "Mail.Send (Anwendung) erteilt – Administratorzustimmung ist damit erledigt"
}

# ---------------- 3. Optional: Senden nur aus $Postfach erlauben ----------------
Write-Host ""
Warn "Mail.Send als Anwendung darf technisch aus JEDEM Postfach senden."
$antwort = Read-Host "  Auf $Postfach beschränken (Exchange Online, empfohlen)? [J/n]"
if ($antwort -eq "" -or $antwort -match "^[jJyY]") {
    if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
        Info "Installiere Modul ExchangeOnlineManagement (nur für dich) ..."
        Install-Module ExchangeOnlineManagement -Scope CurrentUser -Force -AllowClobber
    }
    Import-Module ExchangeOnlineManagement
    Connect-ExchangeOnline -ShowBanner:$false -DisableWAM

    # Mail-aktivierte Sicherheitsgruppe, die nur das Absender-Postfach enthält
    $gruppe = "EF-Rechnungs-App-Senden"
    $g = Get-DistributionGroup -Identity $gruppe -ErrorAction SilentlyContinue
    if (-not $g) {
        $alias = "ef-rechnungsapp-senden"
        $g = New-DistributionGroup -Name $gruppe -Alias $alias -Type Security -Members $Postfach
        Set-DistributionGroup -Identity $g.Identity -HiddenFromAddressListsEnabled $true
        Ok "Gruppe $gruppe angelegt (enthält $Postfach)"
    } else {
        $mitglieder = Get-DistributionGroupMember -Identity $gruppe | ForEach-Object { $_.PrimarySmtpAddress.ToString().ToLower() }
        if ($mitglieder -notcontains $Postfach.ToLower()) { Add-DistributionGroupMember -Identity $gruppe -Member $Postfach; Ok "$Postfach zur Gruppe hinzugefügt" }
        else { Ok "Gruppe $gruppe vorhanden" }
    }

    $pol = Get-ApplicationAccessPolicy -ErrorAction SilentlyContinue | Where-Object { $_.AppId -eq $AppId }
    if (-not $pol) {
        New-ApplicationAccessPolicy -AppId $AppId -PolicyScopeGroupId $g.PrimarySmtpAddress -AccessRight RestrictAccess `
            -Description "Ein-Facher Rechnungs-App darf nur aus $Postfach senden" | Out-Null
        Ok "Beschränkung angelegt"
    } else { Ok "Beschränkung ist bereits vorhanden" }

    $test = Test-ApplicationAccessPolicy -Identity $Postfach -AppId $AppId
    if ($test.AccessCheckResult -eq "Granted") { Ok "Test: Senden aus $Postfach erlaubt" } else { Warn "Test: $($test.AccessCheckResult) – Änderungen brauchen manchmal bis zu 1 Stunde" }
    Disconnect-ExchangeOnline -Confirm:$false
} else {
    Info "Beschränkung übersprungen."
}

Write-Host ""
Write-Host "Fertig. Jetzt noch in GitHub die Secrets anlegen:" -ForegroundColor Magenta
Write-Host "  Repository Rechnung-System → Settings → Secrets and variables → Actions → New repository secret"
Write-Host "    EF_CLIENT_SECRET = geheimer Schlüssel (Wert) der App-Registrierung $AppId"
Write-Host "    SB_EMAIL         = E-Mail deines Gehalt-Monitor-Kontos"
Write-Host "    SB_PASSWORD      = Passwort deines Gehalt-Monitor-Kontos"
Write-Host "  Danach: Actions → Rechnungs-Wächter → Run workflow (einmal testen)."
Write-Host ""
