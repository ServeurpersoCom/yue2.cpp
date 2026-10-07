$ErrorActionPreference = 'Stop'

Write-Host 'Installing local vocal separation for YuE2...'
$python = Join-Path $PSScriptRoot '.venv-vocal\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    python -m venv (Join-Path $PSScriptRoot '.venv-vocal')
    if ($LASTEXITCODE -ne 0) {
        throw 'Could not create the vocal-separation environment. Confirm Python 3 is installed.'
    }
}
& $python -m pip install 'audio-separator[gpu]==0.47.0' 'audioread>=3,<4'
if ($LASTEXITCODE -ne 0) {
    throw 'Could not install audio-separator. Confirm Python and pip are available.'
}

Write-Host ''
& $python -m pip install 'torch==2.11.0+cu128' 'torchvision==0.26.0+cu128' --index-url https://download.pytorch.org/whl/cu128
if ($LASTEXITCODE -ne 0) { throw 'Could not install the CUDA PyTorch wheels.' }
$env:AUDIO_SEPARATOR_MODEL_DIR = Join-Path $env:TEMP 'yue2-audio-separator-models'
New-Item -ItemType Directory -Force -Path $env:AUDIO_SEPARATOR_MODEL_DIR | Out-Null
Write-Host 'Checking the audio-separator command and GPU provider...'
& (Join-Path $PSScriptRoot '.venv-vocal\Scripts\audio-separator.exe') --env_info
if ($LASTEXITCODE -ne 0) {
    throw 'audio-separator did not start. See the output above for its CUDA or PATH issue.'
}

Write-Host ''
Write-Host 'Setup complete. Restart YuE2, open a generated song menu, and choose Adjust vocal level.'
