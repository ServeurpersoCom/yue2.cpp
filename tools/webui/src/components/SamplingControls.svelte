<script lang="ts">
 import type { Yue2Sampling } from '../lib/types.js';
 let { values, defaults, automatic, onchange }: { values: Yue2Sampling; defaults?: Yue2Sampling; automatic: boolean; onchange: (key: keyof Yue2Sampling, value: number | undefined) => void } = $props();
 const fields: { key: keyof Yue2Sampling; label: string; min: number; max: number; step: number }[] = [
  {key:'temperature',label:'Temperature',min:0,max:2,step:.01},
  {key:'top_p',label:'Top P',min:0,max:1,step:.01},
  {key:'top_k',label:'Top K',min:0,max:200,step:1},
  {key:'repetition_penalty',label:'Rep. penalty',min:1,max:2,step:.001},
  {key:'penalty_window',label:'Penalty window',min:0,max:500,step:1},
  {key:'min_tokens',label:'Min tokens',min:0,max:500,step:1},
  {key:'max_tokens',label:'Max tokens',min:1,max:16000,step:1}
 ];
</script>
<div class="sampling-controls" class:automatic>
 {#each fields as field}
  <div class="sampling-control">
   <span>{field.label}</span>
   <input type="range" aria-label={`${field.label} slider`} min={field.min} max={field.max} step={field.step} value={values[field.key] ?? defaults?.[field.key] ?? field.min} disabled={automatic} oninput={e => onchange(field.key, Number(e.currentTarget.value))} />
   <input type="number" aria-label={field.label} step={field.step} value={values[field.key]} placeholder={String(defaults?.[field.key] ?? '')} disabled={automatic} oninput={e => onchange(field.key, e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value))} />
  </div>
 {/each}
</div>
<style>
 .sampling-controls {display:grid;grid-template-rows:repeat(4,1fr);grid-auto-flow:column;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 14px}
 .sampling-control {display:grid;grid-template-columns:minmax(65px,1fr) minmax(32px,.8fr) 48px;gap:7px;align-items:center;min-width:0}
 .sampling-control span {font-size:10px;white-space:nowrap;color:var(--fg-dim)}
 .sampling-control input[type=range] {width:100%;min-width:0;accent-color:var(--accent);height:16px;cursor:pointer}
 .sampling-control input[type=number] {width:100%;padding:3px!important;font:10px ui-monospace,monospace!important;text-align:center;appearance:textfield;border-radius:6px!important}
 input::-webkit-inner-spin-button {appearance:none}
 .automatic input:disabled {opacity:.85;cursor:default}
 @media(max-width:1350px) and (min-width:1001px) {.sampling-controls {grid-template-columns:1fr;grid-auto-flow:row;grid-template-rows:none}}
 @media(max-width:440px) {.sampling-controls {grid-template-columns:1fr;grid-auto-flow:row;grid-template-rows:none}}
</style>
