param(
  [string]$Scope = 'slsu-icos-projects'
)

# This helper deploys the app after configuring only non-secret Vault bootstrap variables.

Write-Host "Deploying production app for scope: $Scope"

# Ensure the helper script exists
$envHelper = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'setup-vercel-env.ps1'
if (-not (Test-Path $envHelper)) {
  Write-Error "Could not find helper script: $envHelper"
  exit 1
}

Write-Host 'Adding non-secret Vault bootstrap variables to Vercel production...'
& $envHelper -Scope $Scope
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Environment setup failed.'
  exit $LASTEXITCODE
}

Write-Host 'Deploying to Vercel production...'
$deployExitCode = 0
Push-Location (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
try {
  corepack pnpm dlx vercel --prod --yes --scope $Scope
  $deployExitCode = $LASTEXITCODE
}
finally {
  Pop-Location
}
if ($deployExitCode -ne 0) {
  Write-Error 'Vercel deployment failed.'
  exit $deployExitCode
}

Write-Host 'Deployment completed. Verify the production URL and webhook settings in Vercel.'
