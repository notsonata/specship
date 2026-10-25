import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, rmdir, copyFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readShipUsage, recoverShipUsage, applyShipUsage } from '../scripts/benchmark/usage.mjs';
import { trialEstimate, summarize } from '../scripts/benchmark/accounting.mjs';

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'specship-usage-test-')),file=join(root,'opencode.db');
  const db=new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
    CREATE TABLE session(id TEXT PRIMARY KEY, directory TEXT, time_created INTEGER);
    CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);`);
  t.after(async()=>{db.close();for(const suffix of ['-shm','-wal',''])await rm(file+suffix,{force:true});await rmdir(root);});
  const session=(id,directory='/testbed',created=100)=>db.prepare('INSERT INTO session VALUES(?,?,?)').run(id,directory,created);
  const message=(id,sessionID,extra={})=>db.prepare('INSERT INTO message VALUES(?,?,?,?)').run(id,sessionID,110,JSON.stringify({role:'assistant',providerID:'openai',modelID:'gpt-6-luna',time:{completed:120},tokens:{input:10,output:20,reasoning:5,cache:{read:80,write:4}},cost:0.03,prompt:'must-not-export',access_token:'must-not-export',...extra}));
  return {file,db,session,message};
}
const options={since:50,model:'openai/gpt-6-luna',reasoningIsSeparate:true};
const config={spec:{rates:{input:2,cached_input:.1,cache_write:2.5,output:10}},ship:{rates:{input:.1,cached_input:.01,cache_write:.125,output:.5,reasoning_is_separate:true}}};

test('native Ship usage includes corrections and multiple sessions, excludes other trials, and exports only accounting fields',async t=>{
  const f=await fixture(t);f.session('first');f.session('second');f.session('foreign','/other');f.session('old','/testbed',1);
  f.message('a','first');f.message('b','first');f.message('c','second');f.message('foreign','foreign');f.message('old','old');
  // Native messages are updated in place, not accumulated once per SSE update.
  f.db.prepare("UPDATE message SET data=json_set(data,'$.tokens.input',30) WHERE id='a'").run();
  f.db.prepare("UPDATE message SET data=json_set(data,'$.tokens.unrelated','must-not-export') WHERE id='a'").run();
  const evidence=await readShipUsage(f.file,options);
  assert.equal(evidence.complete,true);assert.deepEqual(evidence.sessions,['first','second']);
  assert.equal(evidence.observed.assistant_messages,3);assert.equal(evidence.observed.input,50);
  assert.equal(evidence.observed.cached_input,240);assert.equal(evidence.observed.reasoning,15);
  assert.equal(evidence.observed.input_total,302);assert.equal(evidence.observed.output_total,75);
  assert.doesNotMatch(JSON.stringify(evidence),/must-not-export|access_token|prompt/);
  const result={arm:'ship'};applyShipUsage(result,evidence);Object.assign(result,trialEstimate(result,config));
  assert.equal(typeof result.ship_api_equivalent_usd,'number');
  const report=summarize([result],['ship'])[0];
  assert.equal(report.ship_tokens.reasoning,15);assert.equal(report.ship_tokens.assistant_messages,3);
  assert.equal(report.ship_api_equivalent_usd,result.ship_api_equivalent_usd);
});

test('interrupted or missing usage stays explicitly incomplete while preserving observed token and cost lower bounds',async t=>{
  const f=await fixture(t);f.session('active');f.message('complete','active');f.message('interrupted','active',{time:{},tokens:null});
  const evidence=await readShipUsage(f.file,options);assert.equal(evidence.complete,false);assert.equal(evidence.observed.input,10);
  const result={arm:'ship'};applyShipUsage(result,evidence);Object.assign(result,trialEstimate(result,config));
  assert.equal(result.ship_usage,null);assert.equal(result.api_equivalent_usd,null);
  assert.ok(result.known_ship_api_equivalent_usd>0);
  const report=summarize([result],['ship'])[0];assert.equal(report.ship_tokens,null);
  assert.equal(report.ship_tokens_observed.input,10);assert.equal(report.ship_usage_complete,false);
  assert.equal(report.ship_api_equivalent_usd,null);
});

test('model changes retain measured tokens but do not apply the configured model tariff to other models',async t=>{
  const f=await fixture(t);f.session('mixed');f.message('a','mixed');f.message('compaction','mixed',{modelID:'different-model'});
  const evidence=await readShipUsage(f.file,options);assert.equal(evidence.complete,true);assert.equal(evidence.model_matches,false);
  assert.equal(Object.keys(evidence.by_model).length,2);
  const result={arm:'ship'};applyShipUsage(result,evidence);
  assert.equal(trialEstimate(result,config).ship_api_equivalent_usd,null);
});

test('controller recovery reads committed WAL usage before container deletion and removes private database copies',async t=>{
  const f=await fixture(t);f.session('durable');f.message('a','durable');
  let destination;const copies=[];
  const command=async(_docker,args)=>{
    assert.equal(args[0],'cp');copies.push(args[1]);const suffix=args[1].split('opencode.db')[1];
    destination??=args[2];await copyFile(f.file+suffix,args[2]);
  };
  const evidence=await recoverShipUsage('docker','stopped-container',options,command);
  assert.equal(evidence.observed.input,10);assert.equal(copies.length,3);
  await assert.rejects(access(destination));await assert.rejects(access(destination+'-wal'));
  // Empty/wrong-schema databases must not become zero usage.
  await assert.rejects(readShipUsage(f.file,{...options,since:999}),/No Ship assistant/);
});
