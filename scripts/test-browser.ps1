param([string]$Filter = '')

$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    $result = docker compose --env-file .local/test.env -p x-cleaner-ai-test -f compose.yaml -f ops/compose.test.yaml exec -T backend node dist/server/account-cli.js reset-password --json
    if ($LASTEXITCODE -ne 0) { throw 'Nie udało się uzyskać hasła dla odizolowanego testu.' }
    $credentials = $result | ConvertFrom-Json
    $env:XC_E2E_USER = $credentials.username
    $env:XC_E2E_PASSWORD = $credentials.password
    if ($Filter) { npm run test:e2e -- --grep $Filter }
    else { npm run test:e2e }
    $exitCode = $LASTEXITCODE
} finally {
    Remove-Item Env:XC_E2E_USER,Env:XC_E2E_PASSWORD -ErrorAction SilentlyContinue
    Pop-Location
}
exit $exitCode
