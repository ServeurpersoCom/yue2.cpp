$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$candidate = Join-Path $studioRoot 'build\Release-producer'
$target = Join-Path $studioRoot 'build\Release-reference'
$executable = Join-Path $target 'yue-server.exe'
$files = @('yue-server.exe','ggml.dll','ggml-base.dll','ggml-cpu.dll','ggml-cuda.dll')
foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $candidate $file))) { throw "Candidate missing $file" }
}
$currentServer = Get-Process yue-server -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executable } | Select-Object -First 1
if ($currentServer) {
    Write-Output "Preparing to replace server PID $($currentServer.Id)."
    try { $jobs = Invoke-RestMethod 'http://127.0.0.1:8087/jobs' -TimeoutSec 3; if ($jobs.Count -gt 0) { throw 'Wait for active jobs to finish before activation.' } }
    catch { if ($_.Exception.Message -notmatch '404') { throw } }
}
$backup = Join-Path $studioRoot ('build\backup-before-producer-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup | Out-Null
foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $target $file) -Destination (Join-Path $backup $file) }
$env:PATH = "$studioRoot\.venv-vocal\Scripts;$target;$studioRoot\build\Release;$env:PATH"
$serverArguments = @('--host','127.0.0.1','--port','8087','--model','models\YuE2-3B-Q8_0.gguf','--vae','models\YuE2-Vae-F32.gguf','--transcriber','models\SheetSage2-Q8_0.gguf')
$nextServer = $null
try {
    if ($currentServer) { $currentServer.Kill(); if (-not $currentServer.WaitForExit(10000)) { throw 'Server did not stop within 10 seconds.' } }
    foreach ($file in $files) {
        for ($attempt=0; $attempt -lt 20; $attempt++) {
            try { Copy-Item -LiteralPath (Join-Path $candidate $file) -Destination (Join-Path $target $file) -Force; break }
            catch { if ($attempt -eq 19) { throw }; Start-Sleep -Milliseconds 250 }
        }
    }
    $nextServer = Start-Process -FilePath $executable -ArgumentList $serverArguments -WorkingDirectory $studioRoot -WindowStyle Hidden -RedirectStandardOutput "$studioRoot\build\producer-server.out.log" -RedirectStandardError "$studioRoot\build\producer-server.err.log" -PassThru
    $healthy = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 500
        $nextServer.Refresh()
        if ($nextServer.HasExited) { throw 'Updated server exited during startup.' }
        try { if ((Invoke-RestMethod 'http://127.0.0.1:8087/health' -TimeoutSec 2).status -eq 'ok') { $healthy = $true; break } } catch {}
    }
    if (-not $healthy) { throw 'Updated server did not become ready.' }
    Write-Output "Producer controls active on http://localhost:8087. PID $($nextServer.Id). Previous build: $backup"
} catch {
    $activationError = $_
    Write-Output "Activation failed: $activationError at $($_.ScriptStackTrace)"
    if ($nextServer -and -not $nextServer.HasExited) { $nextServer.Kill(); $null = $nextServer.WaitForExit(10000) }
    foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $backup $file) -Destination (Join-Path $target $file) -Force }
    Start-Process -FilePath $executable -ArgumentList $serverArguments -WorkingDirectory $studioRoot -WindowStyle Hidden
    throw
}
