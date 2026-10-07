// Manual: pass the path of a generated MP4, optionally its expected duration.
import {chromium} from '../tools/youtube-agent/node_modules/playwright/index.mjs';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const bytes=await readFile(process.argv[2]),expected=Number(process.argv[3]);
const server=http.createServer((req,res)=>{const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/);const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;res.writeHead(range?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});res.end(bytes.subarray(start,end+1));});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({...(process.env.CI?{}:{channel:'msedge'}),headless:true});
try{const page=await browser.newPage();await page.setContent(`<video muted src="http://127.0.0.1:${server.address().port}"></video>`);await page.waitForFunction(()=>document.querySelector('video').readyState>=2);const duration=await page.locator('video').evaluate(v=>v.duration);if(expected)assert.ok(Math.abs(duration-expected)<1);await page.locator('video').evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('video').currentTime>.1);await page.locator('video').evaluate(v=>{v.currentTime=v.duration-1;});await page.waitForFunction(()=>document.querySelector('video').ended,{},{timeout:10000});assert.equal(await page.locator('video').evaluate(v=>v.error),null);console.log('PASS: MP4 browser metadata, playback, end seek and completion.',{duration});}finally{await browser.close();server.close();}
