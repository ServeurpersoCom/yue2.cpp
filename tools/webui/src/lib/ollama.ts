export interface LyricModel { name: string; size: number }
const endpoint = 'ollama';

export async function discoverLyricModels(): Promise<LyricModel[]> {
	const response = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(10000) });
	if (!response.ok) throw new Error(`Ollama model discovery failed (${response.status})`);
	const data = await response.json();
	return (data.models || []).filter((m: LyricModel) => typeof m.name === 'string')
		.sort((a: LyricModel, b: LyricModel) => a.size - b.size);
}

export async function writeLyrics(model: string, prompt: string, signal: AbortSignal, onStatus?: (message:string)=>void): Promise<string> {
 const request={model,prompt,stream:false,think:false,keep_alive:0,options:{temperature:.82,num_ctx:8192,num_predict:2048,num_gpu:undefined as number|undefined}};
 for(let attempt=0;attempt<2;attempt++){
  const response=await fetch(`${endpoint}/api/generate`,{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
  const data=await response.json();
  if(!response.ok){
   const error=String(data.error||`Ollama failed (${response.status})`);
   if(attempt===0&&/CUDA.*(initialization failed|out of memory)|CUDA error/i.test(error)){
    signal.throwIfAborted();request.options.num_gpu=0;onStatus?.('Ollama GPU unavailable. Retrying lyrics on CPU; this may take longer.');continue;
   }
   throw new Error(error);
  }
  const lyrics=typeof data.response==='string'?data.response.trim():'';
  if(!lyrics)throw new Error('Ollama returned no lyrics. Existing lyrics preserved.');
  return lyrics;
 }
 throw new Error('Ollama could not generate lyrics.');
}
