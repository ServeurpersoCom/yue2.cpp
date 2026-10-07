import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
if(process.platform!=='win32')throw Error('This deployment wrapper is for the Windows music launcher.');
const root=fileURLToPath(new URL('../',import.meta.url));
// Windows environment keys are case insensitive; inherited Path/PATH duplicates
// break PowerShell Start-Process unless normalized before starting the shell.
const env=Object.fromEntries(Object.entries(process.env).map(([k,v])=>[k.toUpperCase(),v]));
const r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','tools/activate-studio.ps1'],{cwd:root,env,stdio:'inherit',windowsHide:true});process.exit(r.status??1);
