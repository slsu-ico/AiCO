param(
  [switch]$UseCurrentEnv
)

if (-not $env:DATABASE_URL) {
  Write-Error 'DATABASE_URL is not set in the current shell.'
  exit 1
}

if (-not $env:BOOTSTRAP_ADMIN_PASSWORD) {
  Write-Error 'BOOTSTRAP_ADMIN_PASSWORD is not set in the current shell.'
  exit 1
}

Write-Host "Using DATABASE_URL=$($env:DATABASE_URL)"
Write-Host 'Running database migrations...'
npm run migrate

if ($LASTEXITCODE -ne 0) {
  Write-Error 'Migration failed.'
  exit $LASTEXITCODE
}

Write-Host 'Seeding initial data...'
npm run seed

if ($LASTEXITCODE -ne 0) {
  Write-Error 'Seed failed.'
  exit $LASTEXITCODE
}

Write-Host 'Database initialization completed.'
