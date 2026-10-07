@echo off
setlocal
cd /d "%~dp0tools\youtube-agent"
if not exist "node_modules\playwright\package.json" (
  echo Run npm install in tools\youtube-agent first.
  exit /b 1
)
if "%~1"=="" (
  echo Usage: youtube-agent --draft "draft.json" --video "video.mp4" [--thumbnail "cover.png"]
  exit /b 1
)
node agent.mjs %*
