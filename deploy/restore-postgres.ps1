<#
.SYNOPSIS
  Restores a PostgreSQL backup (produced by backup-postgres.ps1 or the
  server's pg_dump-based admin backup) into the running `postgres` compose
  service.

.DESCRIPTION
  DESTRUCTIVE: drops and recreates the target database before loading the
  dump. Always prompts for confirmation (type the database name) unless
  -Confirm:$false-style automation is desired, in which case pass
  -Force to skip the interactive prompt (e.g. for scripted/CI use).

.EXAMPLE
  .\deploy\restore-postgres.ps1 -BackupFile .\backups\astrachat-postgres-20260702-101500.sql.gz

.EXAMPLE
  .\deploy\restore-postgres.ps1 -BackupFile .\backups\onda-2026-07-02T10-15-00\database.sql.gz -Force
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$BackupFile,
  [string]$PgUser = "astrachat",
  [string]$PgDb = "astrachat",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupFile)) {
  Write-Error "Backup file not found: $BackupFile"
  exit 1
}

Write-Output "This will DROP and recreate database '$PgDb' on the 'postgres' compose service,"
Write-Output "then load: $BackupFile"
Write-Output "All current data in '$PgDb' will be permanently lost."

if (-not $Force) {
  $answer = Read-Host "Type the database name ($PgDb) to confirm"
  if ($answer -ne $PgDb) {
    Write-Error "Confirmation did not match. Aborting, nothing was changed."
    exit 1
  }
}

Write-Output "Terminating existing connections to '$PgDb'..."
docker compose exec -T postgres psql -U $PgUser -d postgres -c `
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$PgDb' AND pid <> pg_backend_pid();"

Write-Output "Dropping and recreating '$PgDb'..."
docker compose exec -T postgres psql -U $PgUser -d postgres -c "DROP DATABASE IF EXISTS `"$PgDb`";"
docker compose exec -T postgres psql -U $PgUser -d postgres -c "CREATE DATABASE `"$PgDb`" OWNER `"$PgUser`";"

Write-Output "Restoring from $BackupFile..."
if ($BackupFile -match '\.gz$') {
  # gzip -dc works on Windows if Git-for-Windows / WSL gzip is on PATH;
  # otherwise decompress with .NET GZipStream to a temp file first.
  $gzipCmd = Get-Command gzip -ErrorAction SilentlyContinue
  if ($gzipCmd) {
    gzip -dc $BackupFile | docker compose exec -T postgres psql -U $PgUser -d $PgDb
  } else {
    $tempSql = [System.IO.Path]::GetTempFileName()
    $inStream = [System.IO.File]::OpenRead($BackupFile)
    $outStream = [System.IO.File]::Create($tempSql)
    $gzipStream = New-Object System.IO.Compression.GZipStream($inStream, [System.IO.Compression.CompressionMode]::Decompress)
    $gzipStream.CopyTo($outStream)
    $gzipStream.Dispose(); $outStream.Dispose(); $inStream.Dispose()
    Get-Content $tempSql -Raw | docker compose exec -T postgres psql -U $PgUser -d $PgDb
    Remove-Item $tempSql -Force
  }
} else {
  Get-Content $BackupFile -Raw | docker compose exec -T postgres psql -U $PgUser -d $PgDb
}

Write-Output "Restore complete. Restart the app service so it reconnects cleanly:"
Write-Output "  docker compose restart app"
