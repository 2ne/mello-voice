# Mello Voice startup / relaunch soak — run from repo root.
# Usage: powershell -File scripts/startup-soak.ps1 [-Cycles 5] [-UseRelease]

param(
  [int]$Cycles = 5,
  [switch]$UseRelease
)

$ErrorActionPreference = "Continue"
$repoRoot = Split-Path $PSScriptRoot -Parent

$appExe = if ($UseRelease) {
  Join-Path $repoRoot "src-tauri\target\release\app.exe"
} else {
  Join-Path $repoRoot "src-tauri\target\debug\app.exe"
}

if (-not (Test-Path $appExe)) {
  Write-Error "app.exe not found at $appExe - run npm run tauri build first."
}

function Get-MelloSnapshot {
  $appProcs = @(Get-Process -Name app -ErrorAction SilentlyContinue)
  $appPidSet = [System.Collections.Generic.HashSet[int]]::new()
  foreach ($p in $appProcs) { [void]$appPidSet.Add($p.Id) }

  $wvProcs = @(Get-Process -Name msedgewebview2 -ErrorAction SilentlyContinue)
  $wvOwned = @(
    Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $appPidSet.Contains($_.ParentProcessId) }
  )

  [PSCustomObject]@{
    AppCount      = $appProcs.Count
    AppPids       = ($appProcs.Id -join ",")
    WebView2Count = $wvProcs.Count
    WebView2Owned = $wvOwned.Count
    AppMemMb      = if ($appProcs.Count -gt 0) { [math]::Round(($appProcs | Measure-Object WorkingSet64 -Sum).Sum / 1MB, 1) } else { 0 }
    WvMemMb       = if ($wvProcs.Count -gt 0) { [math]::Round(($wvProcs | Measure-Object WorkingSet64 -Sum).Sum / 1MB, 1) } else { 0 }
  }
}

function Stop-Mello {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  & taskkill /IM app.exe /F | Out-Null
  $ErrorActionPreference = $prev
  $deadline = (Get-Date).AddSeconds(8)
  while ((Get-Process -Name app -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 200
  }
}

function Start-Mello {
  $p = Start-Process -FilePath $appExe -PassThru -WindowStyle Normal
  return $p
}

Write-Host "=== Mello startup soak ===" -ForegroundColor Cyan
Write-Host "Binary: $appExe"
Write-Host "Cycles: $Cycles`n"

$results = @()

# --- Phase A: fresh launch, settle, snapshot ---
Stop-Mello
Start-Sleep -Seconds 1

for ($i = 1; $i -le $Cycles; $i++) {
  Write-Host "--- Cycle $i : fresh launch ---" -ForegroundColor Yellow
  Stop-Mello
  Start-Sleep -Milliseconds 800

  $launchAt = Get-Date
  $proc = Start-Mello
  Start-Sleep -Seconds 3

  $snap3 = Get-MelloSnapshot
  Start-Sleep -Seconds 5
  $snap8 = Get-MelloSnapshot

  $row = [PSCustomObject]@{
    Cycle = $i
    Phase = "fresh"
    AppAlive = $false
    Sec3_App = 0
    Sec3_WV2 = 0
    Sec8_App = 0
    Sec8_WV2 = 0
    DoubleLaunchSecondExit = $null
    AfterDouble_App = 0
  }

  $row.AppAlive = [bool](Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)
  $row.Sec3_App = $snap3.AppCount
  $row.Sec3_WV2 = $snap3.WebView2Owned
  $row.Sec8_App = $snap8.AppCount
  $row.Sec8_WV2 = $snap8.WebView2Owned

  # --- Phase B: double-launch (single-instance) ---
  Write-Host "  Double-launch (single-instance test)..."
  $before = Get-MelloSnapshot
  $proc2 = Start-Process -FilePath $appExe -PassThru -WindowStyle Normal
  Start-Sleep -Seconds 2
  $after = Get-MelloSnapshot
  $proc2Alive = $null -ne (Get-Process -Id $proc2.Id -ErrorAction SilentlyContinue)
  $row.DoubleLaunchSecondExit = -not $proc2Alive
  $row.AfterDouble_App = $after.AppCount
  Write-Host "  Second instance exited quickly: $($row.DoubleLaunchSecondExit) (app count $($before.AppCount) -> $($after.AppCount))"

  $results += $row

  # Simulate user closing main window — we cannot click X; full kill simulates Quit.
  Stop-Mello
  Start-Sleep -Milliseconds 500
}

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
$results | Format-Table Cycle, Phase, AppAlive, Sec3_App, Sec3_WV2, Sec8_App, Sec8_WV2, DoubleLaunchSecondExit, AfterDouble_App -AutoSize

$failures = @()
foreach ($r in $results) {
  if (-not $r.AppAlive) { $failures += "Cycle $($r.Cycle): app died within 8s of launch" }
  if ($r.Sec3_App -ne 1) { $failures += "Cycle $($r.Cycle): expected 1 app.exe at 3s, got $($r.Sec3_App)" }
  if ($r.DoubleLaunchSecondExit -ne $true) { $failures += "Cycle $($r.Cycle): second launch did NOT exit (single-instance may be broken)" }
  if ($r.AfterDouble_App -gt 1) { $failures += "Cycle $($r.Cycle): multiple app.exe after double-launch ($($r.AfterDouble_App))" }
  if ($r.Sec3_WV2 -gt 2) { $failures += "Cycle $($r.Cycle): >2 owned WebView2 at 3s ($($r.Sec3_WV2)); overlay may be spawning too early" }
}

if ($failures.Count -eq 0) {
  Write-Host "All automated checks passed." -ForegroundColor Green
  exit 0
} else {
  Write-Host "Failures:" -ForegroundColor Red
  $failures | ForEach-Object { Write-Host "  - $_" }
  exit 1
}
