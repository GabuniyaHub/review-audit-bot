import test from 'node:test';import assert from 'node:assert/strict';
import {prepareSample,scoreEvaluation,EvaluationRow} from '../src/evaluation/evaluate.js';
import {AnalysisResult,SENTIMENTS} from '../src/analysis/contract.js';
const reference:EvaluationRow[]=SENTIMENTS.map((s,i)=>({id:String(i),organization:'Demo',source:'test',rating:null,text:'кофе вкусный',expected:{sentiment:s,topics:['product']}}));
const predictions:AnalysisResult[]=reference.map(r=>({reviewId:r.id,sentiment:r.expected.sentiment!,topics:[{topic:'product',sentiment:r.expected.sentiment!,evidence:'кофе вкусный'}]}));
test('evaluation computes perfect reference and penalizes missing or invalid predictions',()=>{
 assert.equal(scoreEvaluation(reference,predictions).sentiment.macroF1,1);assert.equal(scoreEvaluation(reference,predictions).topics.micro.f1,1);
 const partial=scoreEvaluation(reference,predictions.slice(1));assert.equal(partial.coverage,.75);assert.equal(partial.sentiment.macroF1,.75);assert.equal(partial.topics.micro.fn,1);
 const wrong=structuredClone(predictions);wrong[0].topics[0].evidence='выдумка';const invalid=scoreEvaluation(reference,wrong);assert.equal(invalid.invalidResponses,1);assert.equal(invalid.evidence.exactQuoteRate,.75);assert.equal(invalid.sentiment.macroF1,.75);
});
test('unlabeled reference, unknown predictions or duplicate IDs cannot produce a benchmark',()=>{
 const incomplete=structuredClone(reference);incomplete[0].expected.sentiment=null;assert.throws(()=>scoreEvaluation(incomplete,predictions),/incomplete/);
 assert.throws(()=>scoreEvaluation(reference,[...predictions,predictions[0]]),/duplicate/);
 assert.throws(()=>scoreEvaluation(reference,[{...predictions[0],reviewId:'unknown'}]),/Unknown/);
});
test('blind sample balances organizations, is deterministic and masks contact data',()=>{
 const rows=Array.from({length:160},(_,i)=>({id:String(i),organization:String(i%4),source:i%2?'yandex':'2gis',rating:1+i%5,text:`уникальный отзыв номер ${String.fromCodePoint(0x4e00+i)} почта user@example.com`}));
 const a=prepareSample(rows);assert.equal(a.length,100);assert.deepEqual(a,prepareSample([...rows].reverse()));for(const o of ['0','1','2','3'])assert.equal(a.filter(r=>r.organization===o).length,25);assert.ok(a.every(r=>r.expected.sentiment===null&&!r.text.includes('user@example.com')));
});
