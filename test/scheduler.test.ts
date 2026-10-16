import test from 'node:test';
import assert from 'node:assert/strict';
import {nextDaily,localDay,validZone} from '../src/scheduler/time.js';
import {readSettings} from '../src/config/settings.js';
test('daily time respects timezone and avoids replaying a completed local day',()=>{
 assert.equal(nextDaily(new Date('2026-10-16T03:00:00Z'),'09:00','Asia/Yekaterinburg').toISOString(),'2026-10-16T04:00:00.000Z');
 assert.equal(nextDaily(new Date('2026-10-16T03:00:00Z'),'09:00','Asia/Yekaterinburg','2026-10-16').toISOString(),'2026-10-17T04:00:00.000Z');
 assert.equal(localDay(new Date('2026-10-16T23:00:00Z'),'Asia/Yekaterinburg'),'2026-10-17');
 assert.equal(validZone('Mars/Unknown'),false);assert.throws(()=>nextDaily(new Date(),'24:00','UTC'));
});
test('DST gap skips unavailable wall time; repeated hour is not executed twice',()=>{
 assert.equal(nextDaily(new Date('2026-03-08T05:00:00Z'),'02:30','America/New_York').toISOString(),'2026-03-09T06:30:00.000Z');
 assert.equal(nextDaily(new Date('2026-11-01T05:31:00Z'),'01:30','America/New_York','2026-11-01').toISOString(),'2026-11-02T06:30:00.000Z');
});
test('scheduler is opt-in and requires enabled collection and analysis',()=>{
 const env={DATABASE_URL:'postgresql://u:p@localhost/test'};assert.equal(readSettings(env).schedulerEnabled,false);
 assert.throws(()=>readSettings({...env,SCHEDULER_ENABLED:'true'}),/COLLECTION_ENABLED and ANALYSIS_ENABLED/);
 assert.equal(readSettings({...env,SCHEDULER_ENABLED:'true',COLLECTION_ENABLED:'true',ANALYSIS_ENABLED:'true',LLM_API_KEY:'test'}).schedulerEnabled,true);
});
