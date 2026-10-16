import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {prepareSample,scoreEvaluation} from '../dist/src/evaluation/evaluate.js';
const [mode,input,other,output]=process.argv.slice(2);
try{
 if(mode==='prepare'){
  const data=JSON.parse(await readFile(input,'utf8'));const sample=prepareSample(data);const dir=resolve(other);await mkdir(dir,{recursive:true});await writeFile(join(dir,'reference.json'),JSON.stringify(sample,null,2)+'\n');
  const groups=Object.fromEntries([...new Set(sample.map(r=>r.organization))].map(o=>[o,sample.filter(r=>r.organization===o).length]));const manifest={seed:'vkr-holdout-v1',inputCount:data.length,sampleCount:sample.length,organizations:groups,sources:Object.fromEntries([...new Set(sample.map(r=>r.source))].map(s=>[s,sample.filter(r=>r.source===s).length])),labeled:false,notes:'Previously captured public reviews; locally masked, authors excluded. Check anonymization manually. No labels or predictions are pre-filled.'};await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
 }else if(mode==='score'){
  const reference=JSON.parse(await readFile(input,'utf8'));const data=JSON.parse(await readFile(other,'utf8'));const metrics=scoreEvaluation(reference,data.reviews??data.analyses??data);await writeFile(output,JSON.stringify(metrics,null,2)+'\n');console.log(JSON.stringify({ok:true,referenceCount:metrics.referenceCount,coverage:metrics.coverage,macroF1:metrics.sentiment.macroF1}));
 }else throw new Error('Usage: node tools/evaluate.mjs prepare input.json directory | score reference.json predictions.json metrics.json');
}catch(e){console.error(e instanceof Error?e.message:'Evaluation failed');process.exitCode=1;}
