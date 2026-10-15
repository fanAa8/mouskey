# Sync the built app into the portable release and restart it. Run after `npm run build`.
# Copies everything the packaged app needs at runtime: electron/, dist/, src/games, src/data, public/, tools/.
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$final = Join-Path $project 'release\mouskey-final\resources\app'
foreach ($f in Get-ChildItem (Join-Path $project 'electron') -Filter *.cjs) { Copy-Item $f.FullName (Join-Path $final 'electron') -Force }
foreach ($d in 'dist', 'src\games', 'src\data', 'public', 'tools') {
  $src = Join-Path $project $d; $dst = Join-Path $final $d
  if (-not (Test-Path $src)) { continue }
  if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
  New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
  Copy-Item $src $dst -Recurse -Force
}
# package.json is NOT copied: its name decides the userData folder (overlay settings, theme).
Get-Process -Name 'mouskey' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3
Start-Process -FilePath (Join-Path $project 'release\mouskey-final\mouskey.exe')
Write-Host "synced + restarted: $final"
