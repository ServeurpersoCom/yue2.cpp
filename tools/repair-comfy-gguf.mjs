// Narrow compatibility repair for metadata-free Qwen Image 2.1 GGUF exports.
// Supply the installed GGUF node directory; no model download or launcher edits.
import {readFile,writeFile,copyFile,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const folder=resolve(process.argv[2]??''),file=join(folder,'tools/convert.py');
const source=await readFile(file,'utf8');
if(source.includes('class ModelQwenImage21')){console.log('Qwen Image 2.1 detector already present.');process.exit(0);}
if(!source.includes('ModelKrea2, ModelIdeogram, ModelMinimaxH3]')||!source.includes('arch_list = ['))throw Error('Loader changed; review the patch before applying.');
const block=`class ModelQwenImage21(ModelTemplate):
    arch = "qwen_image"
    keys_detect = [(
        "txt_in.text_norm.weight", "modulation.1.weight",
        "transformer_blocks.0.attn.norm_q.weight", "img_in.weight",
        "proj_out.weight", "transformer_blocks.0.img_mlp.proj.weight",
    )]


`;
const target=source.replace('arch_list = [',block+'arch_list = [').replace('ModelKrea2, ModelIdeogram, ModelMinimaxH3]','ModelKrea2, ModelIdeogram, ModelMinimaxH3, ModelQwenImage21]');
const backup=file+'.before-yue2-qwen21';try{await access(backup);throw Error('Repair backup already exists; inspect it before replacing anything.');}catch(error){if(error.code!=='ENOENT')throw error;}
await copyFile(file,backup);await writeFile(file,target,'utf8');console.log('Added Qwen Image 2.1 tensor signature; original saved at '+backup);
