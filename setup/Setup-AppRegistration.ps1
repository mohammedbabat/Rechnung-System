<#
.SYNOPSIS
  Legt die Entra-App-Registrierung für die Ein-Facher Rechnungs-WebApp an.

.DESCRIPTION
  - Erstellt eine Single-Tenant-App mit SPA-Plattform (Redirect-URIs für GitHub Pages + localhost)
  - Fügt delegierte Graph-Berechtigungen hinzu: User.Read, Sites.Manage.All, Mail.Send, Mail.Send.Shared
  - Erteilt die Administratorzustimmung (Admin Consent) für den ganzen Tenant
  - Schränkt die Anmeldung optional auf zugewiesene Benutzer ein (Assignment required) und weist dich selbst zu
  - Setzt optional das SendAs-Recht auf das freigegebene Postfach rechnung@ein-facher.de
  - Gibt clientId und tenantId für js/config.js aus

.EXAMPLE
  .\Setup-AppRegistration.ps1 -GitHubPagesUrl "https://mbabat.github.io/ein-facher-rechnung/" -AdminUpn "mohammed@ein-facher.de"

.NOTES
  Benötigt: PowerShell 7+, Module Microsoft.Graph.Applications, Microsoft.Graph.Users,
            optional ExchangeOnlineManagement (für SendAs).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $GitHubPagesUrl,
    [Parameter(Mandatory)] [string] $AdminUpn,
    [string] $AppName       = "Ein-Facher Rechnungen",
    [string] $LocalUrl      = "http://localhost:8080/",
    [string] $SharedMailbox = "rechnung@ein-facher.de",
    [switch] $SkipSendAs,
    [switch] $AllowAllUsers
)

$ErrorActionPreference = "Stop"

# ---------- Module ----------
foreach ($m in "Microsoft.Graph.Applications", "Microsoft.Graph.Users") {
    if (-not (Get-Module -ListAvailable -Name $m)) {
        Write-Host "Installiere Modul $m ..." -ForegroundColor Yellow
        Install-Module $m -Scope CurrentUser -Force
    }
    Import-Module $m
}

# ---------- Anmeldung ----------
Connect-MgGraph -Scopes "Application.ReadWrite.All", "DelegatedPermissionGrant.ReadWrite.All", "AppRoleAssignment.ReadWrite.All", "User.Read.All" -NoWelcome
$ctx      = Get-MgContext
$tenantId = $ctx.TenantId
Write-Host "Verbunden mit Tenant $tenantId als $($ctx.Account)" -ForegroundColor Cyan

# ---------- Redirect-URIs normalisieren (müssen mit / enden, genau wie window.location) ----------
$redirects = @($GitHubPagesUrl, $LocalUrl) | ForEach-Object { if ($_.EndsWith("/")) { $_ } else { "$_/" } }

# ---------- Graph-Berechtigungen dynamisch auflösen ----------
$graphAppId = "00000003-0000-0000-c000-000000000000"
$graphSp    = Get-MgServicePrincipal -Filter "appId eq '$graphAppId'"
$scopeNames = @("User.Read", "Sites.Manage.All", "Mail.Send", "Mail.Send.Shared")
$access = foreach ($name in $scopeNames) {
    $s = $graphSp.Oauth2PermissionScopes | Where-Object { $_.Value -eq $name }
    if (-not $s) { throw "Berechtigung $name nicht gefunden." }
    @{ Id = $s.Id; Type = "Scope" }
}

# ---------- App anlegen oder aktualisieren ----------
$app = Get-MgApplication -Filter "displayName eq '$AppName'" | Select-Object -First 1
$appParams = @{
    DisplayName            = $AppName
    SignInAudience         = "AzureADMyOrg"
    Spa                    = @{ RedirectUris = $redirects }
    RequiredResourceAccess = @(@{ ResourceAppId = $graphAppId; ResourceAccess = $access })
}
if ($app) {
    Update-MgApplication -ApplicationId $app.Id @appParams
    Write-Host "App '$AppName' aktualisiert." -ForegroundColor Green
} else {
    $app = New-MgApplication @appParams
    Write-Host "App '$AppName' angelegt." -ForegroundColor Green
}
$app = Get-MgApplication -ApplicationId $app.Id

# ---------- Service Principal ----------
$sp = Get-MgServicePrincipal -Filter "appId eq '$($app.AppId)'"
if (-not $sp) {
    $sp = New-MgServicePrincipal -AppId $app.AppId
    Start-Sleep -Seconds 5
}

# ---------- Admin Consent (delegiert, für alle Benutzer) ----------
$scopeString = $scopeNames -join " "
$grant = Get-MgOauth2PermissionGrant -Filter "clientId eq '$($sp.Id)' and resourceId eq '$($graphSp.Id)'" | Select-Object -First 1
if ($grant) {
    Update-MgOauth2PermissionGrant -OAuth2PermissionGrantId $grant.Id -Scope $scopeString
} else {
    New-MgOauth2PermissionGrant -ClientId $sp.Id -ConsentType "AllPrincipals" -ResourceId $graphSp.Id -Scope $scopeString | Out-Null
}
Write-Host "Admin Consent erteilt: $scopeString" -ForegroundColor Green

# ---------- Zugriff auf zugewiesene Benutzer beschränken ----------
if (-not $AllowAllUsers) {
    Update-MgServicePrincipal -ServicePrincipalId $sp.Id -AppRoleAssignmentRequired:$true
    $user = Get-MgUser -UserId $AdminUpn
    $existing = Get-MgServicePrincipalAppRoleAssignedTo -ServicePrincipalId $sp.Id -All | Where-Object { $_.PrincipalId -eq $user.Id }
    if (-not $existing) {
        New-MgServicePrincipalAppRoleAssignedTo -ServicePrincipalId $sp.Id -PrincipalId $user.Id -ResourceId $sp.Id -AppRoleId ([Guid]::Empty) | Out-Null
    }
    Write-Host "Anmeldung nur für zugewiesene Benutzer – $AdminUpn zugewiesen." -ForegroundColor Green
}

# ---------- SendAs auf freigegebenes Postfach ----------
if (-not $SkipSendAs) {
    try {
        if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
            Install-Module ExchangeOnlineManagement -Scope CurrentUser -Force
        }
        Import-Module ExchangeOnlineManagement
        Connect-ExchangeOnline -UserPrincipalName $AdminUpn -ShowBanner:$false
        $has = Get-RecipientPermission -Identity $SharedMailbox -Trustee $AdminUpn -ErrorAction SilentlyContinue | Where-Object { $_.AccessRights -contains "SendAs" }
        if (-not $has) {
            Add-RecipientPermission -Identity $SharedMailbox -Trustee $AdminUpn -AccessRights SendAs -Confirm:$false | Out-Null
        }
        Write-Host "SendAs für $AdminUpn auf $SharedMailbox gesetzt." -ForegroundColor Green
        Disconnect-ExchangeOnline -Confirm:$false
    } catch {
        Write-Warning "SendAs konnte nicht gesetzt werden: $($_.Exception.Message)"
    }
}

# ---------- Ausgabe ----------
Write-Host ""
Write-Host "=== Werte für js/config.js ===" -ForegroundColor Cyan
Write-Host "clientId: `"$($app.AppId)`","
Write-Host "tenantId: `"$tenantId`","
Write-Host ""
Write-Host "Redirect-URIs:" ($redirects -join ", ")
Disconnect-MgGraph | Out-Null
