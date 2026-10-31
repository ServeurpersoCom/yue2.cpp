<script lang="ts">
 // The header's one characterful element: a cassette whose reels spin while the
 // track plays and whose tape winds from the left reel to the right with progress.
 let { progress = 0, playing = false, hue = null }: { progress?: number; playing?: boolean; hue?: number | null } = $props();
 const uid = $props.id();
 const clip = `tape-window-${uid}`;
 const HUB = 7, FULL = 19;
 // Tape area is conserved, so pack radii follow the square root of the share left on each side.
 function pack(share: number) { return Math.sqrt(HUB * HUB + (FULL * FULL - HUB * HUB) * Math.max(0, Math.min(1, share))); }
 let p = $derived(Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0);
 let supply = $derived(pack(1 - p)), takeup = $derived(pack(p));
 // A small pack turns faster than a full one at the same tape speed.
 let supplySpin = $derived(`${(1.1 * supply / HUB).toFixed(2)}s`), takeupSpin = $derived(`${(1.1 * takeup / HUB).toFixed(2)}s`);
 let stripe = $derived(hue == null ? '#9aa0ab' : `hsl(${hue} 72% 58%)`);
 const teeth = [0, 60, 120, 180, 240, 300];
</script>

<div class="tape-deck" class:playing aria-hidden="true">
 <svg viewBox="0 0 120 76" focusable="false">
  <defs><clipPath id={clip}><rect x="22" y="19" width="76" height="25" rx="12.5"/></clipPath></defs>
  <rect class="shell" x="1" y="1" width="118" height="74" rx="7"/>
  <rect class="label" x="6" y="5" width="108" height="46" rx="3"/>
  <rect x="6" y="5" width="108" height="9" rx="3" fill={stripe}/>
  <rect x="6" y="11" width="108" height="3" fill={stripe}/>
  <path class="ink" d="M12 49H34M86 49H108"/>
  <rect class="window" x="22" y="19" width="76" height="25" rx="12.5"/>
  <g clip-path={`url(#${clip})`}>
   <circle class="tape" cx="40" cy="31.5" r={supply}/>
   <circle class="tape" cx="80" cy="31.5" r={takeup}/>
  </g>
  {#each [[40, supplySpin], [80, takeupSpin]] as [x, spin]}
   <g class="reel" style={`animation-duration:${spin}`}>
    <circle class="hub" cx={x} cy="31.5" r="6"/>
    {#each teeth as angle}<rect class="tooth" x={Number(x) - 1} y="25.6" width="2" height="2.6" transform={`rotate(${angle} ${x} 31.5)`}/>{/each}
    <circle class="spindle" cx={x} cy="31.5" r="2.4"/>
   </g>
  {/each}
  <rect class="window-edge" x="22" y="19" width="76" height="25" rx="12.5"/>
  <path class="foot" d="M28 56H92L98 74H22Z"/>
  <circle class="hole" cx="40" cy="66" r="2.6"/><circle class="hole" cx="80" cy="66" r="2.6"/>
  <circle class="screw" cx="5.5" cy="70.5" r="1.6"/><circle class="screw" cx="114.5" cy="70.5" r="1.6"/>
 </svg>
</div>

<style>
 .tape-deck{flex:none;width:var(--tape-width,112px);aspect-ratio:120/76;filter:drop-shadow(0 2px 3px #0005)}
 svg{display:block;width:100%;height:100%}
 .shell{fill:#262830;stroke:#4b4f5b;stroke-width:1.5}
 .label{fill:#ece5d3}
 .ink{stroke:#9b9483;stroke-width:1}
 .window{fill:#121318}
 .window-edge{fill:none;stroke:#0008;stroke-width:1.2}
 .tape{fill:#5a3b28;stroke:#3d2719;stroke-width:.6;transition:r 400ms ease-out}
 .hub{fill:#f3f0e6;stroke:#a9a395;stroke-width:.6}
 .tooth{fill:#2a2b31}
 .spindle{fill:#2a2b31}
 .foot{fill:#1d1f25;stroke:#454955;stroke-width:1}
 .hole{fill:#0c0d10}
 .screw{fill:#8d929c}
 .reel{transform-box:fill-box;transform-origin:center;animation:reel-spin 1.1s linear infinite reverse;animation-play-state:paused}
 .playing .reel{animation-play-state:running}
 @keyframes reel-spin{to{transform:rotate(360deg)}}
 @media(prefers-reduced-motion:reduce){.reel{animation:none}.tape{transition:none}}
</style>
