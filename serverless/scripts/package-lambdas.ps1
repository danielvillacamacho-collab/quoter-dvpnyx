param(
  [string]$OutDir = "..\src",
  [string]$WorkDir = "dist\terraform-lambdas\work"
)

$ErrorActionPreference = "Stop"

$modules = @(
  "assignments",
  "capacity",
  "clients",
  "contracts",
  "crm",
  "employees",
  "internal-ops",
  "opportunities",
  "platform",
  "project-health",
  "quotations",
  "reports",
  "resource-requests",
  "revenue",
  "time-tracking"
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$zipRoot = Join-Path $root $OutDir
$workRoot = Join-Path $root $WorkDir

New-Item -ItemType Directory -Force -Path $workRoot | Out-Null
New-Item -ItemType Directory -Force -Path $zipRoot | Out-Null

foreach ($module in $modules) {
  $entry = Join-Path $root "packages\$module\handler.ts"
  $moduleWork = Join-Path $workRoot $module
  $outfile = Join-Path $moduleWork "index.js"
  $zipfile = Join-Path $zipRoot "$module.zip"

  if (-not (Test-Path $entry)) {
    throw "Missing Lambda entrypoint: $entry"
  }

  if (Test-Path $moduleWork) {
    Remove-Item -Recurse -Force $moduleWork
  }
  New-Item -ItemType Directory -Force -Path $moduleWork | Out-Null

  npx esbuild $entry `
    --bundle `
    --platform=node `
    --target=node20 `
    --format=cjs `
    --sourcemap `
    --tsconfig=tsconfig.json `
    --outfile=$outfile

  if (Test-Path $zipfile) {
    Remove-Item -Force $zipfile
  }
  Compress-Archive -Path (Join-Path $moduleWork "*") -DestinationPath $zipfile
  Write-Host "Packaged $module -> $zipfile"
}

Write-Host "Lambda zips ready in $zipRoot"
