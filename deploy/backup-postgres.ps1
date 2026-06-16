param(
  [string]$ComposeProject = "tg",
  [string]$OutputDir = ".\backups",
  [int]$RetentionDays = 14
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $OutputDir "astrachat-postgres-$timestamp.sql.gz"

docker compose exec -T postgres pg_dump -U astrachat -d astrachat |
  gzip > $target

Get-ChildItem -Path $OutputDir -Filter "astrachat-postgres-*.sql.gz" |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
  Remove-Item -Force

Write-Output "Backup written: $target"
