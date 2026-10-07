<script lang="ts">
 import { onMount } from 'svelte';
 import { Maximize2, Minimize2, AudioLines } from '@lucide/svelte';
 import { getPlaybackAnalyser, isPlaying, subscribePlayback } from '../lib/audio.js';
 let playing = $state(isPlaying());
 let mode = $state<'ribbon' | 'orbit' | 'spectrum'>('ribbon');
 let expanded = $state(false);
 let canvas: HTMLCanvasElement;
 let stage: HTMLDivElement;
 let expandButton: HTMLButtonElement;
 let meters: HTMLDivElement;
 let dialog: HTMLDialogElement;
 let dock: HTMLDivElement;
 let surface: HTMLElement;
 function expand() {
  expanded = !expanded;
  if (expanded) { dialog.appendChild(surface); dialog.showModal(); expandButton.focus(); }
  else { dialog.close(); dock.appendChild(surface); expandButton.focus(); }
 }
 onMount(() => {
  const context = canvas.getContext('2d');
  if (!context) return;
  const ctx = context, motion = matchMedia('(prefers-reduced-motion: reduce)');
  let width = 1, height = 1, frame = 0, previous = 0, visible = true, mix = 0, level = 0;
  const bands = new Float32Array(96);
  let spectrum: Uint8Array<ArrayBuffer> | undefined, samples: Uint8Array<ArrayBuffer> | undefined;
  const meterBars = Array.from(meters.querySelectorAll<HTMLElement>('i'));
  function resize() {
   const rect = stage.getBoundingClientRect(); width = rect.width; height = rect.height;
   const dpr = Math.min(devicePixelRatio || 1, 2);
   canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
   ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const observer = new ResizeObserver(resize); observer.observe(stage);
  const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule(); });
  intersection.observe(stage);
  function schedule() { if (!frame && !document.hidden && visible) frame = requestAnimationFrame(draw); }
  function visibility() { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else schedule(); }
  document.addEventListener('visibilitychange', visibility);
  const unsubscribe = subscribePlayback(active => { playing = active; schedule(); });
  function draw(now: number) {
   frame = 0;
   if (document.hidden || !visible) return;
   if (now - previous < (motion.matches ? 100 : 1000 / 45)) { schedule(); return; }
   const dt = Math.min(0.1, (now - previous) / 1000 || 0.022); previous = now;
   const t = motion.matches ? 0 : now * 0.00018;
   mix += ((playing ? 1 : 0) - mix) * (1 - Math.exp(-dt * 3));
   let bass = 0, body = 0, air = 0, rms = 0;
   if (playing) {
    const analyser = getPlaybackAnalyser();
    spectrum ??= new Uint8Array(analyser.frequencyBinCount); samples ??= new Uint8Array(analyser.fftSize);
    analyser.getByteFrequencyData(spectrum); analyser.getByteTimeDomainData(samples);
    for (const value of samples) rms += ((value - 128) / 128) ** 2;
    rms = Math.sqrt(rms / samples.length);
    const binHz = analyser.context.sampleRate / analyser.fftSize;
    for (let i = 0; i < bands.length; i++) {
     const lo = Math.max(1, Math.floor(35 * (16000 / 35) ** (i / bands.length) / binHz));
     const hi = Math.min(spectrum.length, Math.max(lo + 1, Math.ceil(35 * (16000 / 35) ** ((i + 1) / bands.length) / binHz)));
     let energy = 0; for (let j = lo; j < hi; j++) energy += spectrum[j] / 255;
     energy /= Math.max(1, hi - lo);
     bands[i] += (energy - bands[i]) * (1 - Math.exp(-dt * (energy > bands[i] ? 18 : 5)));
     if (i<30) bass+=bands[i]/30; else if(i<65) body+=bands[i]/35; else air+=bands[i]/31;
    }
   } else for (let i = 0; i < bands.length; i++) bands[i] *= Math.exp(-dt * 4);
   level += (Math.min(1, rms * 3) - level) * (1 - Math.exp(-dt * 9));
   [bass, body, air].forEach((value, i) => meterBars[i].style.transform = `scaleX(${value})`);
   ctx.clearRect(0,0,width,height);
   const cx = width / 2, cy = height / 2, radius = Math.min(width * .24, height * .32);
   const glow = ctx.createRadialGradient(cx,cy,0,cx,cy,width*.55);
   glow.addColorStop(0,`rgba(30,210,171,${.06 + level*.16})`); glow.addColorStop(1,'rgba(4,20,28,0)');
   ctx.fillStyle=glow; ctx.fillRect(0,0,width,height); ctx.lineWidth=.65;
   for(let ring=0;ring<3;ring++) {
    ctx.strokeStyle=`rgba(94,231,203,${.10-ring*.025})`; ctx.beginPath();
    ctx.ellipse(cx,cy,radius*(1+ring*.32),radius*(1+ring*.32),0,0,Math.PI*2); ctx.stroke();
   }
   ctx.strokeStyle='rgba(120,200,193,.075)';
   for(let i=1;i<8;i++){ctx.beginPath();ctx.moveTo(width*i/8,24);ctx.lineTo(width*i/8,height-24);ctx.stroke();}
   ctx.save(); ctx.globalCompositeOperation='lighter';
   if(mode === 'ribbon') {
    for(let ribbon=0;ribbon<7;ribbon++) {
     ctx.beginPath();
     for(let i=0;i<=200;i++) {
      const p=i/200, envelope=Math.sin(p*Math.PI)**1.3, index=Math.min(95,Math.floor(p*95));
      const sample=samples && playing ? (samples[Math.floor(p*(samples.length-1))]-128)/128 : 0;
      const idle=Math.sin(p*12-t*4+ribbon*.3)*.42+Math.cos(p*21+t*2)*.18;
      const live=sample*1.4+Math.sin(p*17-t*5+ribbon*.38)*bands[index]*.6;
      const y=cy+envelope*height*.34*(idle*(1-mix)+live*mix)+(ribbon-3)*3;
      const x=width*(.035+p*.93); if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
     }
     ctx.strokeStyle=`hsla(${157+ribbon*9},85%,${58+ribbon*3}%,${ribbon===3?.9:.18})`;
     ctx.lineWidth=ribbon===3?1.8:.9; ctx.shadowBlur=ribbon===3?14:0;ctx.shadowColor='#36e9c1';ctx.stroke();
    }
   } else if(mode === 'orbit') {
    for(let lane=0;lane<3;lane++) {
     ctx.beginPath();
     for(let i=0;i<=192;i++) {
      const a=i/192*Math.PI*2, index=Math.min(95,Math.floor((1-Math.abs(i/96-1))*95));
      const r=radius*(.72+lane*.14)+(bands[index]*mix*.65+(1-mix)*Math.sin(a*5+t*3+lane)*.045)*radius;
      const x=cx+Math.cos(a-Math.PI/2)*r,y=cy+Math.sin(a-Math.PI/2)*r;
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
     }
     ctx.closePath();ctx.strokeStyle=`hsla(${158+lane*30},85%,65%,${.85-lane*.2})`;ctx.lineWidth=1.5;
     ctx.shadowBlur=12;ctx.shadowColor='#30d8b6';ctx.stroke();
    }
   } else {
    const gap=width*.84/96;
    for(let i=0;i<96;i++) {
     const h=3+(bands[i]*mix+(.12+.17*Math.sin(i*.18+t)**2)*(1-mix))*height*.55, x=width*.08+i*gap;
     ctx.fillStyle=`hsla(${155+i*.6},85%,65%,.85)`;ctx.shadowBlur=0;
     ctx.fillRect(x,cy-h*.5,Math.max(1,gap*.5),h);
     ctx.fillStyle='rgba(154,255,228,.12)';ctx.fillRect(x,cy+h*.5+5,Math.max(1,gap*.5),h*.14);
    }
   }
   ctx.shadowBlur=0;
   for(let i=0;i<42;i++) {
    const a=i*2.39996+t*(.2+i%3*.1), r=radius*(1.1+(i%7)*.12+level*.12);
    ctx.fillStyle=`rgba(150,252,228,${.12+(i%5)*.05+level*.25})`;
    ctx.beginPath();ctx.arc(cx+Math.cos(a)*r*1.55,cy+Math.sin(a)*r*.74,i%6===0?1.6:.7,0,Math.PI*2);ctx.fill();
   }
   ctx.restore();schedule();
  }
  resize();schedule();
  return () => { cancelAnimationFrame(frame); observer.disconnect(); intersection.disconnect(); unsubscribe(); document.removeEventListener('visibilitychange',visibility); };
 });
</script>

<div class="signal-dock" bind:this={dock}>
 <section class="audio-sculpture" class:is-playing={playing} class:expanded bind:this={surface} aria-label="Live music visualizer">
  <div class="sculpture-head"><span class="sculpture-brand"><AudioLines size={15}/> SIGNAL <b>/</b> STUDIO</span><span class="signal-state"><i></i>{playing ? 'LIVE AUDIO' : 'STANDBY'}</span></div>
  <div class="sculpture-stage" bind:this={stage}>
   <canvas bind:this={canvas} aria-label={playing ? 'Visualization of playing audio' : 'Idle audio sculpture'}></canvas>
   <div class="sculpture-note">{playing ? 'THE SOUND, IN MOTION' : 'YOUR NEXT FREQUENCY'}<span>{playing ? 'Connected to playback' : 'Play a track to bring this to life'}</span></div>
  </div>
  <footer class="sculpture-controls">
   <div class="view-modes" aria-label="Visualizer mode">{#each ['ribbon','orbit','spectrum'] as item}<button type="button" class:selected={mode===item} aria-pressed={mode===item} onclick={() => mode=item as typeof mode}>{item}</button>{/each}</div>
   <button type="button" class="expand-signal" bind:this={expandButton} onclick={expand} aria-label={expanded ? 'Close expanded visualizer' : 'Expand visualizer'}>{#if expanded}<Minimize2 size={16}/>{:else}<Maximize2 size={16}/>{/if}</button>
  </footer>
  <div class="signal-meters" bind:this={meters}>{#each ['BASS','BODY','AIR'] as band}<div><span>{band}</span><b><i></i></b></div>{/each}</div>
 </section>
</div>
<dialog class="signal-dialog" bind:this={dialog} oncancel={(event) => {event.preventDefault();expand();}} aria-label="Expanded audio visualizer"></dialog>

<style>
 .signal-dock{width:100%;min-width:0;}
 .audio-sculpture{position:relative;isolation:isolate;overflow:hidden;border:1px solid #6fffe324;border-radius:24px;background:radial-gradient(ellipse at 50% 35%,#0b282e 0%,#06151b 65%,#060e15 100%);box-shadow:inset 0 1px 0 #c5fff511,0 20px 80px #0003;color:#b9ece4;}
 .sculpture-head{display:flex;justify-content:space-between;align-items:center;padding:20px 24px 0;gap:12px;}
 .sculpture-brand{display:flex;align-items:center;gap:8px;font:10px ui-monospace,monospace;letter-spacing:.18em}.sculpture-brand b{color:#398a7f;font-weight:400}
 .signal-state{font:9px ui-monospace,monospace;letter-spacing:.12em;display:flex;align-items:center;gap:7px;color:#79aaa1}.signal-state i{height:5px;width:5px;background:#52766e;border-radius:50%}.is-playing .signal-state i{background:#6fffd0;box-shadow:0 0 10px #56edba}
 .sculpture-stage{position:relative;height:270px}.sculpture-stage canvas{width:100%;height:100%;display:block}
 .sculpture-note{position:absolute;bottom:8px;left:0;width:100%;text-align:center;pointer-events:none;font:9px ui-monospace,monospace;letter-spacing:.24em;color:#8cddc9}.sculpture-note span{display:block;font:11px system-ui;letter-spacing:.025em;margin-top:7px;color:#65948d}
 .sculpture-controls{display:flex;justify-content:space-between;align-items:center;padding:14px 24px 10px;gap:10px}.view-modes{display:flex;gap:4px;border:1px solid #8efbe51a;border-radius:10px;padding:3px;background:#031114}
 button{cursor:pointer;color:#759b94;border:0;background:transparent;padding:7px 12px;border-radius:7px;font-size:11px;text-transform:capitalize}button.selected{background:#133a35;color:#b9ffe8;box-shadow:inset 0 1px 0 #9effe522}button:hover{color:#d0fff4}.expand-signal{border:1px solid #8efbe524;display:grid;place-items:center;padding:9px}
 .signal-meters{display:flex;gap:20px;margin:3px 24px 19px}.signal-meters>div{display:flex;flex:1;align-items:center;gap:9px}.signal-meters span{font:8px ui-monospace,monospace;letter-spacing:.1em;color:#70948c}.signal-meters b{height:2px;background:#76ffd51a;flex:1;overflow:hidden}.signal-meters i{display:block;background:#63e4bd;width:100%;height:100%;transform:scaleX(0);transform-origin:left}
 .signal-dialog{width:min(1200px,94vw);max-width:94vw;padding:0;border:0;background:transparent;margin:auto;overflow:visible}.signal-dialog::backdrop{background:#02090eec;backdrop-filter:blur(18px)}.expanded .sculpture-stage{height:min(65vh,640px)}
 @media(max-width:600px){.sculpture-stage{height:240px}.sculpture-head{padding:17px 16px 0}.sculpture-controls{padding:12px 16px}.signal-meters{margin:3px 16px 17px;gap:12px}.sculpture-brand{font-size:9px}.signal-state{font-size:8px}.view-modes button{padding:7px 9px}}
</style>
