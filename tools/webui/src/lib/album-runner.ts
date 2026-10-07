import type { Album } from './album-types.js';
import { saveAlbum } from './album-db.js';
import { albumRequest, artPrompt, trackSeed } from './album-plan.js';
import { synthSubmit, pollJob, jobResultTracks, renderVideo } from './api.js';
import { getSong, putJobSongs, updateSong, loadJob } from './db.js';
import { completedTracks } from './completed-tracks.js';
import { generateTrackArtwork } from './track-artwork.js';

// Caller owns the shared Studio lock. Every external job ID is saved before
// waiting; completed stages are skipped on resume, with no duplicate tracks.
export async function runAlbum(album: Album, pause:()=>boolean, changed:()=>void) {
 const save=async(stage:string)=>{album.stage=stage;await saveAlbum(album);changed();};
 if(await loadJob())throw new Error('Recover the pending Create job before starting an album.');
 album.status='running';album.error=undefined;
 try {
  await save('Preparing album');
  for(const [index,track] of album.tracks.entries()) {
   if(pause())break;
   let song=track.songId==null?undefined:await getSong(track.songId);
   if(track.songId!=null&&!song)throw new Error(`${track.title} was deleted from the library. Restore it or remove it from this album plan.`);
   if(!song) {
    const request=albumRequest(album.request,track,trackSeed(album,index));
    track.jobId ??= crypto.randomUUID().replaceAll('-','');await save(`Track ${index+1}: generating audio`);
    await synthSubmit(request,'mp3',track.jobId);await pollJob(track.jobId);
    const results=completedTracks(await jobResultTracks(track.jobId));
    const landed=await putJobSongs(track.jobId,results.map(result=>({name:track.title,created:Date.now(),format:'mp3',duration:0,style:request.style,seed:request.lm_seed??0,score:result.request.abc??'',request:result.request,audio:result.audio,originalAudio:result.originalAudio,albumId:album.id,albumTitle:album.title,albumTrackId:track.id,trackNumber:index+1})));
    song=landed[0];if(!song)throw new Error('Album result was previously removed. Restore the deleted track before resuming.');
    track.songId=song.id;await save(`Track ${index+1}: audio saved`);
    void fetch(`job?id=${track.jobId}&ack=1`,{method:'POST'}).catch(()=>{});
   }
   if(pause())break;
   if((album.artwork||album.video)&&!album.cover) {
    await save('Creating album master cover');
    album.cover=await generateTrackArtwork({name:album.title,style:album.visualStyle,request:album.request,created:album.created},album.coverJobId,async id=>{album.coverJobId=id;await save('Creating album master cover');},undefined,{prompt:artPrompt(album),seed:album.seed});
    await save('Master cover saved');
   }
   if(pause())break;
   if((album.artwork||album.video)&&!track.artDone) {
    await save(`Track ${index+1}: creating referenced artwork`);
    const artworkRevision=song.mediaRevision??0;
    const image=await generateTrackArtwork(song,track.artJobId,async id=>{track.artJobId=id;await save(`Track ${index+1}: creating referenced artwork`);},undefined,{prompt:artPrompt(album,track),seed:trackSeed(album,index),reference:album.cover});
    song=await updateSong(song.id!,{artwork:image,artworkJobId:undefined},artworkRevision);track.artDone=true;await save(`Track ${index+1}: artwork saved`);
   }
   if(pause())break;
   if(album.video&&!track.videoDone) {
    await save(`Track ${index+1}: rendering video`);
    if(!song.artwork)throw new Error('Track artwork is missing. Retry artwork first.');
    const revision=song.mediaRevision??0;
    const video=await renderVideo(song.audio,song.artwork,undefined,track.videoJobId,async id=>{track.videoJobId=id;await save(`Track ${index+1}: rendering video`);});
    await updateSong(song.id!,{video,format:'mp4',videoVersion:'mastered'},revision);track.videoDone=true;await save(`Track ${index+1}: video saved`);
    if(track.videoJobId)void fetch(`job?id=${track.videoJobId}&ack=1`,{method:'POST'}).catch(()=>{});
   }
  }
  album.status=pause()?'paused':'complete';await save(album.status==='complete'?'Album complete':'Paused — resume when ready');
 } catch(error) {album.status='paused';album.error=error instanceof Error?error.message:String(error);await save('Needs attention');throw error;}
}
