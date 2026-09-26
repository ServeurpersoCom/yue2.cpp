<script lang="ts">
 import { app } from '../lib/state.svelte.js';
 import { delivery, songPlan, lyricWarnings, estimatedDuration } from '../lib/producer.js';
 let { disabled = false }: { disabled?: boolean } = $props();
 const warnings = $derived(lyricWarnings(app.producer, app.request.lyrics || ''));
</script>

<section class="card producer" aria-label="Song planner and voices">
 <div class="heading"><h3>Song planner &amp; voices</h3><label><input type="checkbox" bind:checked={app.producer.enabled} disabled={disabled} /> Enable</label></div>
 {#if disabled}<p>Loaded performances and remixes keep their original direction. Enable a new composition to use this planner.</p>{/if}
 <fieldset disabled={disabled || !app.producer.enabled}>
  <label>Amount of singing <output>{app.producer.singing}%</output><input aria-label="Amount of singing" type="range" min="0" max="100" step="5" bind:value={app.producer.singing} /></label>
  <div class="scale"><span>Rap / spoken</span><span>Fully sung</span></div>
  <p>{delivery(app.producer)}</p>
  <label>Vocal presence <output>{app.producer.presence}%</output><input aria-label="Vocal presence" type="range" min="0" max="100" step="5" bind:value={app.producer.presence} /></label>
  <div class="scale"><span>Instrumental</span><span>Vocal-led</span></div>
  <div class="row">
   <label>Different voices<select aria-label="Different voices" bind:value={app.producer.voices} disabled={app.producer.voiceLocked || app.producer.presence === 0}>{#each [1, 2, 3, 4] as n}<option value={n}>{n === 1 ? '1 · Solo' : `${n} · Ensemble`}</option>{/each}</select></label>
   <label>Tempo · BPM<input aria-label="Planner tempo" type="number" min="40" max="220" bind:value={app.producer.bpm} /></label>
  </div>
  <label class="lock"><input type="checkbox" bind:checked={app.producer.voiceLocked} /> Lock voice profiles across songs</label>
  <p>Reuses these descriptions. YuE2 cannot guarantee the same singer or exact voice count; a seed is not a voice identity.</p>
  {#each app.producer.voiceProfiles.slice(0, app.producer.voices) as _, i}
   <label>Voice {i + 1}<input aria-label={`Voice ${i + 1} description`} maxlength="240" bind:value={app.producer.voiceProfiles[i]} disabled={app.producer.voiceLocked || app.producer.presence === 0} /></label>
  {/each}
  <label>Arrangement direction<textarea aria-label="Arrangement direction" rows="3" maxlength="2000" placeholder={songPlan({...app.producer, structure: ''})} bind:value={app.producer.structure}></textarea></label>
  <p class="plan">{songPlan(app.producer)}</p>
  <label>Takes per generation<select aria-label="Takes per generation" bind:value={app.producer.takes}><option value={1}>1 take</option><option value={3}>3 takes · compare new compositions</option></select></label>
  <p>Three takes run one at a time and keep the same plan and voice descriptions. Each has fresh composition and audio seeds. Reloading recovers the active take; remaining takes are not submitted.</p>
  {#if app.request.duration === 0}<p>Estimated length: {estimatedDuration(app.producer, app.request.lyrics || '')} seconds (tempo and phrase estimate; actual length can differ).</p>{/if}
  {#each warnings as warning}<p class="warning">{warning}</p>{/each}
 </fieldset>
 <p>These controls guide the model; percentages describe intent, not measured audio coverage.</p>
</section>

<style>
 .producer { padding: 1.2rem; }
 .heading, .row, .scale { display:flex; gap:1rem; justify-content:space-between; }
 h3 { margin:0; font-size:1rem; }
 fieldset { border:0; padding:0; margin-top:1rem; min-width:0; display:grid; gap:.7rem; }
 label { display:block; font-size:.8rem; }
 .row > label { flex:1; min-width:0; }
 input:not([type=checkbox]), select, textarea { display:block; width:100%; box-sizing:border-box; margin-top:.4rem; color:var(--fg); background:var(--bg-input,var(--bg-card)); border:1px solid var(--border); border-radius:8px; padding:.6rem; }
 input[type=range] { padding:0; accent-color:var(--accent); }
 output { float:right; color:var(--accent); }
 p, .scale { font-size:.75rem; color:var(--fg-dim); line-height:1.5; margin:.3rem 0; }
 .plan { padding:.7rem; border-left:2px solid var(--accent); }
 .warning { color:var(--accent); }
 fieldset:disabled { opacity:.55; }
 .lock { display:flex; gap:.5rem; align-items:center; }
 @media(max-width:480px) { .row { flex-direction:column; } }
</style>
