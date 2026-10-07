import http from 'node:http';
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {validateDraft} from './draft.mjs';

const root=fileURLToPath(new URL('.',import.meta.url)),folder=join(root,'runs');
await mkdir(folder,{recursive:true});
let state={status:'idle',channel:'HipHop Circuit',message:'Choose a track to prepare an upload.'},context,page,operation=false;
try{state=JSON.parse(await readFile(join(folder,'latest.json'),'utf8'));if(state.status!=='idle')state={...state,status:'needs-attention',message:'Agent restarted. Resume the existing Studio draft to avoid uploading twice.'};}catch{}
async function save(){const temp=join(folder,'latest.json.tmp');await writeFile(temp,JSON.stringify(state,null,2),{flush:true});await rename(temp,join(folder,'latest.json'));}
async function progress(status,message){state.status=status;state.message=message;await save();}
async function openBrowser(url){context??=await chromium.launchPersistentContext(join(root,'profile'),{channel:'chrome',headless:false,viewport:null});page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(20000);await page.goto(url,{waitUntil:'domcontentloaded'});}
function resumeUrl(value){const url=new URL(value);if(url.origin!=='https://studio.youtube.com'||!/^\/video\/[\w-]+\/edit/.test(url.pathname))throw new Error('Paste the existing video edit URL from YouTube Studio.');return url.href;}
async function launch(form){
 if(state.uploadAttempted&&form.get('newUpload')!=='true'&&!form.get('resumeUrl'))throw new Error('A previous upload may exist. Resume its Studio edit URL, or explicitly choose a new upload after checking the channel.');
 const draft=validateDraft(JSON.parse(String(form.get('draft'))));
 if(form.get('resumeUrl')){state={...state,draft,studioUrl:resumeUrl(String(form.get('resumeUrl'))),channel:'HipHop Circuit'};await save();await openBrowser(state.studioUrl);await progress('review','Existing draft opened. Review playlist, end screen, disclosures and visibility in Studio. No file was uploaded.');return;}
 const video=form.get('video');if(!(video instanceof Blob)||!video.size||video.size>256*1024*1024)throw new Error('Choose an MP4 smaller than 256 MiB.');
 const run=join(folder,crypto.randomUUID());await mkdir(run);
 await writeFile(join(run,'video.mp4'),Buffer.from(await video.arrayBuffer()));
 const thumbnail=form.get('thumbnail');let image;
 if(thumbnail instanceof Blob&&thumbnail.size){if(thumbnail.size>10*1024*1024)throw new Error('Thumbnail exceeds 10 MiB.');image=join(run,thumbnail.type==='image/jpeg'?'cover.jpg':thumbnail.type==='image/webp'?'cover.webp':'cover.png');await writeFile(image,Buffer.from(await thumbnail.arrayBuffer()));}
 state={status:'starting',channel:'HipHop Circuit',run,video:join(run,'video.mp4'),image,draft,uploadAttempted:false};await save();
 await openBrowser('https://studio.youtube.com');
 await progress('confirm-channel','Sign in to HipHop Circuit and open Create → Upload videos. Choose Confirm channel & upload here when ready.');
}
async function upload(){
 if(state.status!=='confirm-channel'||!page)throw new Error('Open an upload session and confirm the channel first.');
 const picker=page.locator('input[type="file"][accept*="video"]');if(await picker.count()!==1)throw new Error('Open Create → Upload videos in the HipHop Circuit Studio window.');
 // Mark before handing the file to the browser. A crash cannot silently re-upload.
 state.uploadAttempted=true;await progress('uploading','Uploading to the channel you confirmed. Keep Studio open.');
 await picker.setInputFiles(state.video);
 const title=page.locator('ytcp-social-suggestions-textbox#title-textarea #textbox');
 const description=page.locator('ytcp-social-suggestions-textbox#description-textarea #textbox');
 await title.fill(state.draft.title);await description.fill(state.draft.description);
 if((await title.innerText())!==state.draft.title)throw new Error('Studio did not retain the expected title.');
 if(state.draft.audience!=='review')await page.getByRole('radio',{name:state.draft.audience==='kids'?/Yes, it.*made for kids/i:/No, it.*not made for kids/i}).click();
 if(state.image){const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:/Upload (file|thumbnail)/i}).click()]);await chooser.setFiles(state.image);}
 if(state.draft.parsedTags.length){await page.getByRole('button',{name:/show more/i}).click();const tags=page.locator('ytcp-form-input-container#tags-container input');await tags.fill(state.draft.parsedTags.join(','));await tags.press('Enter');}
 const link=await page.locator('a[href*="youtu.be/"]').first().getAttribute('href').catch(()=>null);
 if(link){const id=new URL(link).pathname.slice(1);if(/^[\w-]+$/.test(id))state.studioUrl=`https://studio.youtube.com/video/${id}/edit`;}
 await progress('review','Details entered. Select your playlist in Studio, configure the end screen, check disclosures/copyright/processing, and choose visibility or scheduling. Saving or publishing is your action in Studio.');
}
const server=http.createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');
 // Loopback server accepts same-origin native proxy requests only; no CORS.
 if(req.headers.origin){res.writeHead(403);res.end(JSON.stringify({error:'Use the Studio app.'}));return;}
 try{
  if(req.method==='GET'&&req.url==='/status'){res.end(JSON.stringify(state));return;}
  if(req.method!=='POST'){res.writeHead(404);res.end('{}');return;}
  if(operation)throw new Error('An agent action is still running.');
  if(req.url==='/stop'){await context?.close();context=page=undefined;await progress('needs-attention','Browser closed. Any existing Studio draft remains. Resume it before retrying.');res.end(JSON.stringify(state));return;}
  const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>270*1024*1024)throw new Error('Request too large');parts.push(part);}
  let action;
  if(req.url==='/launch'){const request=new Request('http://localhost/',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:Buffer.concat(parts)});const form=await request.formData();action=()=>launch(form);}
  else if(req.url==='/continue')action=upload;
  else throw new Error('Unknown agent action');
  operation=true;res.end(JSON.stringify({accepted:true}));
  void action().catch(async error=>{await progress('needs-attention',error.message+' Inspect the current Studio draft before retrying.');}).finally(()=>{operation=false;});
 }catch(error){res.statusCode=400;res.end(JSON.stringify({error:error.message}));}
});
server.listen(18189,'127.0.0.1',()=>console.log('YouTube agent bridge ready on loopback:18189'));
