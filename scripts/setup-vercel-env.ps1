param(
  [string]$Scope = 'slsu-icos-projects'
)

$required = @(
  'MESSENGER_VERIFY_TOKEN',
  'PAGE_ACCESS_TOKEN',
  'DATABASE_URL',
  'REDIS_URL',
  'SESSION_SECRET',
  'BOOTSTRAP_ADMIN_EMAIL',
  'BOOTSTRAP_ADMIN_PASSWORD'
)

$optional = @(
  'UPLOAD_DIR',
  'AI_FALLBACK_ENABLED'
)

Write-Host "Configuring Vercel environment variables for scope: $Scope"

$allVars = $required + $optional
foreach ($name in $allVars) {
  $value = [string]($env:$name)
  if (-not $value) {
    Write-Warning "$name is not set in the current shell. Skipping."
    continue
  }

  Write-Host "Adding $name to Vercel production environment..."
  vercel env add $name production --value "$value" --yes --scope $Scope
}

Write-Host "Completed Vercel env setup. Verify values with: vercel env list production --scope $Scope"
