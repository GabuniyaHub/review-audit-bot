import {hash,cleanText} from '../collection/normalize.js';
import {AnalysisResult,redact,SENTIMENTS,TOPICS,validateResult} from '../analysis/contract.js';
export interface EvaluationRow {id:string;organization:string;source:string;rating:number|null;text:string;expected:{sentiment:typeof SENTIMENTS[number]|null;topics:typeof TOPICS[number][]|null}}
export function prepareSample(input:Omit<EvaluationRow,'expected'>[],size=100,seed='vkr-holdout-v1'):EvaluationRow[]{
 if(!Number.isInteger(size)||size<1||size>1000)throw new Error('Invalid sample size');
 const ids=new Set<string>(),texts=new Set<string>();const groups=new Map<string,Map<string,typeof input>>();
 // Hash-order before deduplication makes the representative independent of file order.
 for(const r of [...input].sort((a,b)=>hash(seed+a.id).localeCompare(hash(seed+b.id)))){
  if(!r.id||ids.has(r.id))throw new Error('Duplicate or missing review ID');ids.add(r.id);
  const text=cleanText(redact(r.text));if(!text||texts.has(hash(text)))continue;texts.add(hash(text));
  if(!groups.has(r.organization))groups.set(r.organization,new Map());const sub=groups.get(r.organization)!;const key=r.source+':'+String(r.rating);if(!sub.has(key))sub.set(key,[]);sub.get(key)!.push({...r,text});
 }
 const orgs=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([organization,sub])=>({organization,strata:[...sub.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,rows])=>rows),cursor:0}));
 const selected:EvaluationRow[]=[];
 while(selected.length<size){let progress=false;for(const org of orgs){for(let i=0;i<org.strata.length;i++){const rows=org.strata[org.cursor++%org.strata.length];const row=rows.shift();if(row){selected.push({...row,expected:{sentiment:null,topics:null}});progress=true;break;}}if(selected.length===size)break;}if(!progress)break;}
 return selected;
}
export function scoreEvaluation(rows:EvaluationRow[],predictions:AnalysisResult[]){
 if(!rows.length||new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('Empty or duplicate evaluation IDs');
 if(predictions.some(p=>!rows.some(r=>r.id===p.reviewId))||new Set(predictions.map(p=>p.reviewId)).size!==predictions.length)throw new Error('Unknown or duplicate prediction IDs');
 for(const r of rows)if(!SENTIMENTS.includes(r.expected.sentiment as any)||!Array.isArray(r.expected.topics)||r.expected.topics.some(t=>!TOPICS.includes(t))||new Set(r.expected.topics).size!==r.expected.topics.length)throw new Error('Human reference labels are incomplete or invalid');
 const predicted=new Map<string,AnalysisResult>();let invalidResponses=0,quotes=0,validQuotes=0;
 for(const p of predictions){const row=rows.find(r=>r.id===p.reviewId)!;for(const t of p.topics??[]){quotes++;if(typeof t.evidence==='string'&&t.evidence.trim()&&redact(row.text).includes(t.evidence))validQuotes++;}
  try{validateResult({reviews:[p]},[{id:row.id,text:redact(row.text),contentHash:hash(row.text)}]);predicted.set(p.reviewId,p);}catch{invalidResponses++;}
 }
 const ratio=(a:number,b:number)=>b?a/b:0;
 const measures=(tp:number,fp:number,fn:number)=>({tp,fp,fn,precision:ratio(tp,tp+fp),recall:ratio(tp,tp+fn),f1:ratio(2*tp,2*tp+fp+fn)});
 const sentiment=Object.fromEntries(SENTIMENTS.map(label=>{let tp=0,fp=0,fn=0;for(const row of rows){const actual=row.expected.sentiment,pred=predicted.get(row.id)?.sentiment;if(actual===label&&pred===label)tp++;else{if(pred===label)fp++;if(actual===label)fn++;}}return [label,{support:rows.filter(r=>r.expected.sentiment===label).length,...measures(tp,fp,fn)}];}));
 const topics=Object.fromEntries(TOPICS.map(label=>{let tp=0,fp=0,fn=0;for(const row of rows){const actual=row.expected.topics!.includes(label),pred=predicted.get(row.id)?.topics.some(t=>t.topic===label)??false;if(actual&&pred)tp++;else{if(pred)fp++;if(actual)fn++;}}return [label,{support:rows.filter(r=>r.expected.topics!.includes(label)).length,...measures(tp,fp,fn)}];}));
 const confusion=Object.fromEntries(SENTIMENTS.map(label=>[label,Object.fromEntries([...SENTIMENTS,'missing_or_invalid'].map(p=>[p,rows.filter(r=>r.expected.sentiment===label&&(predicted.get(r.id)?.sentiment??'missing_or_invalid')===p).length]))]));
 return {referenceCount:rows.length,predictionCount:predictions.length,validPredictions:predicted.size,invalidResponses,missingPredictions:rows.length-predictions.length,coverage:predicted.size/rows.length,sentiment:{macroF1:Object.values(sentiment).reduce((a,v)=>a+v.f1,0)/SENTIMENTS.length,perClass:sentiment,confusion},topics:{micro:measures(Object.values(topics).reduce((a,v)=>a+v.tp,0),Object.values(topics).reduce((a,v)=>a+v.fp,0),Object.values(topics).reduce((a,v)=>a+v.fn,0)),perTopic:topics},evidence:{quotes,validQuotes,exactQuoteRate:quotes?validQuotes/quotes:null},notes:['Macro-F1 averages four predefined sentiment classes; absent classes contribute zero.','Missing/invalid predictions remain in the denominator.','Exact quotations establish provenance, not semantic correctness.','Ground truth must be independently annotated; this tool does not establish annotator independence.']};
}
