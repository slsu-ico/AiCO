param(
  [string]$Scope = 'slsu-icos-projects'
)

$required = @(
  'VAULT_ADDR',
  'VAULT_SECRET_PATH',
  'VAULT_JWT_AUTH_PATH',
  'VAULT_JWT_ROLE'
)

$optional = @(
  'VAULT_NAMESPACE'
)

Write-Host "Configuring non-secret Vault bootstrap variables for scope: $Scope"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$projectLink = Join-Path $repoRoot '.vercel\project.json'
if (-not (Test-Path -LiteralPath $projectLink)) {
  Write-Error "Vercel project linkage is missing at $projectLink. Run 'vercel link --scope $Scope' from $repoRoot first."
  exit 1
}

$values = [ordered]@{
  SECRETS_MANAGER_PROVIDER = 'hashicorp-vault'
}
$missing = @()

$allVars = $required + $optional
foreach ($name in $allVars) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if (-not $value) {
    if ($required -contains $name) {
      $missing += $name
    }
    continue
  }

  $values[$name] = $value
}

if ($missing.Count -gt 0) {
  Write-Error "Missing required Vault bootstrap variables: $($missing -join ', ')"
  exit 1
}

Push-Location $repoRoot
try {
  foreach ($entry in $values.GetEnumerator()) {
    Write-Host "Updating $($entry.Key) in the Vercel production environment..."
    $entry.Value | corepack pnpm dlx vercel env add $entry.Key production --force --yes --scope $Scope
    if ($LASTEXITCODE -ne 0) {
      Write-Error "Failed to configure $($entry.Key)."
      exit $LASTEXITCODE
    }
  }
}
finally {
  Pop-Location
}

Write-Host 'Vault-managed application secrets were not copied to Vercel.'
Write-Host "Completed bootstrap setup. Verify values with: vercel env ls production --scope $Scope"
