param(
  [string]$Scope = 'slsu-icos-projects'
)

# This helper deploys the app to Vercel production after configuring any environment variables
# that are already present in the current PowerShell session.

Write-Host "Deploying production app for scope: $Scope"

# Ensure the helper script exists
$envHelper = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'setup-vercel-env.ps1'
if (-not (Test-Path $envHelper)) {
  Write-Error "Could not find helper script: $envHelper"
  exit 1
}

Write-Host 'Adding available environment variables to Vercel production...'
& $envHelper -Scope $Scope
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Environment setup failed.'
  exit $LASTEXITCODE
}

Write-Host 'Deploying to Vercel production...'
npx vercel --prod --yes
if ($LASTEXITCODE -ne 0) {
  Write-Error 'Vercel deployment failed.'
  exit $LASTEXITCODE
}

Write-Host 'Deployment completed. Verify the production URL and webhook settings in Vercel.'
