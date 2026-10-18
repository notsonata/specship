import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Store } from '../../dist/state.js';
import { Runner } from '../../dist/runner.js';
import { readConfig, splitModel } from '../../dist/config.js';
import { verifyArtifact } from '../../dist/artifacts.js';

const profile = { harness:'opencode', model:'openai/gpt-6-luna', options:{variant:'high'} };
const brief = { outcome:'Implement the specified behavior', acceptance:['works','tests pass'], boundaries:[], decisions:[], verified_context:[], validation:['node tests'] };
const report = { status:'ready_for_review', changes:['implemented'], acceptance_evidence:['works'], validation:['tests pass'], deviations:[], remaining_issues:[] };
const sharedSessions=new Map();

// Deliberately independent of OpenCode: it uses only the adapter contract and a local callback URL.
class FakeAdapter {
  name='fake'; next=1; sessions=new Map(); mode='question'; confirmed=true; errors=[]; reconciles=[];
  async validate(p,media){ if(p.model!=='openai/gpt-6-luna')throw Error('wrong model');if(media.some(x=>x==='application/pdf'))throw Error('unsupported media'); }
  async start(_workspace,profile,_kind,callback){const id=`fake-${this.next++}`;const session={callback,profile,events:[],waiters:[],report:false,aborted:false,submissions:0};this.sessions.set(id,session);sharedSessions.set(id,session);return {session:id,version:'fake-1'};}
  async subscribe(){}
  async submit(session,operation,prompt){const s=this.sessions.get(session);s.operation=operation;s.prompt=prompt;s.submissions++;queueMicrotask(async()=>{try{const r=await fetch(`${s.callback.url}/ask_spec`,{method:'POST',headers:{authorization:`Bearer ${s.callback.capability}`,'content-type':'application/json'},body:JSON.stringify({request_id:`q-${operation}`,blocker:'Need the approved detail',evidence:['test evidence'],attempts:['bounded investigation'],decision:'Choose A'})});if(r.ok){await r.json();const reportResult=await fetch(`${s.callback.url}/report_result`,{method:'POST',headers:{authorization:`Bearer ${s.callback.capability}`,'content-type':'application/json'},body:JSON.stringify(report)});if(reportResult.ok)s.report=true;else this.errors.push(await reportResult.text());}else this.errors.push(`ask ${r.status} ${await r.text()}`);}catch(e){this.errors.push(String(e));} });return {messageId:`message-${operation}`};}
  async *events(session,signal){const s=this.sessions.get(session);while(!signal.aborted){if(s.events.length){yield s.events.shift();continue;}await new Promise(resolve=>{s.waiters.push(resolve);signal.addEventListener('abort',resolve,{once:true});});}}
  async reconcile(session,message){const s=this.sessions.get(session);this.reconciles.push({message,expected:`message-${s.operation}`,report:s.report});assert.equal(message,`message-${s.operation}`);return s.report?'complete':s.aborted?'unknown':'active';}
  async abort(session){const s=this.sessions.get(session);s.aborted=true;return this.confirmed;}
  async reply(session,operation,answer){const s=this.sessions.get(session);s.operation=operation;s.submissions++;const r=await fetch(`${s.callback.url}/report_result`,{method:'POST',headers:{authorization:`Bearer ${s.callback.capability}`,'content-type':'application/json'},body:JSON.stringify(report)});if(!r.ok)throw Error(await r.text());s.report=true;s.answer=answer;}
  async snapshot(session){const s=this.sessions.get(session);return {address:'http://127.0.0.1:1',password:'private-fake',version:'fake-1',profile:s.profile,session};}
  async restore(snapshot,callback){const value=snapshot;const s=sharedSessions.get(value.session);if(!s)throw Error('fake session disappeared');s.callback=callback;this.sessions.set(value.session,s);return {session:value.session,version:value.version};}
  async reconcileOperation(session,operation){const s=this.sessions.get(session);return {messageId:`message-${operation}`,status:s.report?'complete':'active'};}
}
async function fixture(t, max=5){const root=await mkdtemp(join(tmpdir(),'specship-runtime-'));await mkdir(join(root,'.specship'),{recursive:true});const configFile=join(root,'config.json');const config={ship:{default_profile:'luna',profiles:{luna:profile}},limits:{max_dispatch_seconds:max,delivery_margin_seconds:2}};await writeFile(configFile,JSON.stringify(config));const parsed=await readConfig(configFile);const store=new Store(root);await store.initialize();const adapter=new FakeAdapter();const runner=new Runner(store,parsed,adapter);const runners=[runner];t.after(async()=>{for(const item of [...runners].reverse())await item.close();const resolved=await realpath(root);assert.equal(dirname(resolved),await realpath(tmpdir()));assert.ok(basename(resolved).startsWith('specship-runtime-'));await rm(resolved,{recursive:true,force:true});});return {root,store,runner,adapter,track(item){runners.push(item);return item;}};}

test('valid profile configuration parses at the ship object and unknown model options are rejected',async t=>{const f=await fixture(t);assert.equal((await readConfig(join(f.root,'config.json'))).ship.default_profile,'luna');await writeFile(join(f.root,'bad.json'),JSON.stringify({ship:{default_profile:'missing',profiles:{luna:profile}},limits:{max_dispatch_seconds:1,delivery_margin_seconds:1}}));await assert.rejects(readConfig(join(f.root,'bad.json')));});

test('missing limits, an omitted assignment cap, and null all default to no assignment deadline',async t=>{
  const f=await fixture(t);const ship={default_profile:'luna',profiles:{luna:profile}};
  for(const limits of [undefined,{}, {max_dispatch_seconds:null}, {delivery_margin_seconds:15}]){
    const path=join(f.root,'optional-limits.json');await writeFile(path,JSON.stringify({ship,...(limits===undefined?{}:{limits})}));const config=await readConfig(path);
    assert.equal(config.limits.max_dispatch_seconds??null,null);assert.equal(config.limits.delivery_margin_seconds,limits?.delivery_margin_seconds??120);
  }
});

test('an unlimited assignment stays blocked silently across elapsed time and stops on cancellation',async t=>{
  const f=await fixture(t,null);
  f.adapter.submit=async(session,operation)=>{f.adapter.sessions.get(session).operation=operation;return {messageId:`message-${operation}`};};
  const abort=new AbortController();let returned=false;
  const waiting=f.runner.dispatch({operation_id:'unlimited-wait',kind:'implement',brief},undefined,abort.signal).then(event=>{returned=true;return event;});
  for(let count=0;count<200&&!f.adapter.sessions.size;count++)await new Promise(resolve=>setTimeout(resolve,5));
  t.mock.timers.enable({apis:['Date'],now:Date.now()});t.mock.timers.setTime(Date.now()+7*24*60*60*1000);
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(returned,false);
  const [run]=await f.store.listRuns();const state=await f.store.load(run.run_id);
  assert.equal(state.deadline,null);assert.equal(state.events.length,0);
  abort.abort();const event=await waiting;assert.equal(event.kind,'paused');assert.equal((await f.store.load(event.run_id)).writer,false);
});

test('an unlimited decision survives recovery and a newly configured cap without gaining a deadline',async t=>{
  const f=await fixture(t,null);const question=await f.runner.dispatch({operation_id:'unlimited-question',kind:'implement',brief});
  const descriptor=JSON.parse(await readFile(f.store.callbackDescriptorPath(question.run_id),'utf8'));assert.equal(descriptor.deadline,null);assert.equal(descriptor.callback_timeout_ms,null);
  await f.runner.close();
  const next=f.track(new Runner(new Store(f.root),{ship:{default_profile:'luna',profiles:{luna:profile}},limits:{max_dispatch_seconds:1,delivery_margin_seconds:2}},new FakeAdapter()));
  const recovered=await next.recover(question.run_id,question.supervisor_handle);assert.equal(recovered.event_id,question.event_id);
  t.mock.timers.enable({apis:['Date'],now:Date.now()});t.mock.timers.setTime(Date.now()+7*24*60*60*1000);
  const ready=await next.reply({run_id:question.run_id,request_id:question.payload.id,operation_id:'unlimited-answer',answer:'Ascending',expected_brief_version:question.brief_version});
  assert.equal(ready.kind,'implementation_ready');assert.equal((await f.store.load(question.run_id)).deadline,null);
  await next.accept(ready.run_id,ready.activity_id,ready.report_id,ready.brief_version,'Independently checked the result after recovery');
});

test('an explicitly configured assignment limit still stops and reports expiry',async t=>{
  const f=await fixture(t,1);f.adapter.submit=async(session,operation)=>{f.adapter.sessions.get(session).operation=operation;return {messageId:`message-${operation}`};};
  const event=await f.runner.dispatch({operation_id:'bounded-wait',kind:'implement',brief});assert.equal(event.kind,'limit_reached');assert.equal(event.payload.stop_confirmed,true);assert.equal((await f.store.load(event.run_id)).writer,false);
});

test('dispatch -> durable question -> reply -> report -> independent accept',async t=>{const f=await fixture(t,30);const event=await f.runner.dispatch({workspace:f.root,operation_id:'op-1',kind:'implement',brief});assert.equal(event.kind,'decision_required');assert.equal(event.payload.id,'q-op-1');const result=await f.runner.reply({run_id:event.run_id,request_id:'q-op-1',operation_id:'reply-1',answer:'Choose A',expected_brief_version:event.brief_version});assert.equal(result.kind,'implementation_ready',JSON.stringify({errors:f.adapter.errors,sessions:[...f.adapter.sessions.values()],reconciles:f.adapter.reconciles.slice(-2),state:await f.store.load(event.run_id)}));const state=await f.store.load(event.run_id);assert.equal(state.lifecycle,'awaiting_review');assert.equal(state.writer,false);await assert.rejects(f.runner.accept(event.run_id,event.activity_id,'stale-report',event.brief_version,'independent review evidence'),/stale/);await f.runner.accept(event.run_id,event.activity_id,result.report_id,event.brief_version,'Spec independently reviewed current source and tests');assert.equal((await f.store.load(event.run_id)).lifecycle,'completed');});

test('correction reuses the same active Ship session and callback hub',async t=>{const f=await fixture(t,30);const first=await f.runner.dispatch({operation_id:'first',kind:'implement',brief});const ready=await f.runner.reply({run_id:first.run_id,request_id:'q-first',operation_id:'answer-first',answer:'A',expected_brief_version:first.brief_version});assert.equal(ready.kind,'implementation_ready');const correction=await f.runner.dispatch({run_id:first.run_id,supervisor_handle:ready.supervisor_handle,operation_id:'correction',kind:'correct',corrections:['Fix demonstrated acceptance defect'],expected_brief_version:ready.brief_version});assert.equal(correction.kind,'decision_required');assert.equal(f.adapter.sessions.size,1);assert.equal(f.adapter.next,2);});

test('duplicate operation IDs are idempotent and stale replies fail closed',async t=>{const f=await fixture(t,30);const event=await f.runner.dispatch({operation_id:'same',kind:'implement',brief});assert.equal(event.kind,'decision_required');const duplicate=await f.runner.dispatch({operation_id:'same',kind:'implement',brief});assert.equal(duplicate.event_id,event.event_id);await assert.rejects(f.runner.reply({run_id:event.run_id,request_id:'old',operation_id:'reply',answer:'no',expected_brief_version:event.brief_version}),/Stale request ID/);});

test('active workspace lease rejects a concurrent independent run',async t=>{const f=await fixture(t,30);const event=await f.runner.dispatch({operation_id:'writer',kind:'implement',brief});assert.equal(event.kind,'decision_required');await assert.rejects(f.runner.dispatch({operation_id:'second',kind:'implement',brief}),/Workspace writer is owned/);assert.equal((await f.store.load(event.run_id)).writer,true);});

test('ambiguous submission is not replayed on duplicate operation ID',async t=>{const f=await fixture(t);const original=f.adapter.submit.bind(f.adapter);f.adapter.submit=async()=>{throw new Error('connection lost after send may have occurred');};await assert.rejects(f.runner.dispatch({operation_id:'ambiguous',kind:'implement',brief}),/connection lost/);await assert.rejects(f.runner.dispatch({operation_id:'ambiguous',kind:'implement',brief}),/already prepared\/submitted/);f.adapter.submit=original;});

test('cancellation requires adapter stop confirmation and never manufactures success',async t=>{const f=await fixture(t);f.adapter.submit=async(session,operation)=>{f.adapter.sessions.get(session).operation=operation;return {messageId:`message-${operation}`};};const ctrl=new AbortController();const pending=f.runner.dispatch({operation_id:'cancel',kind:'implement',brief},undefined,ctrl.signal);await new Promise(r=>setTimeout(r,30));ctrl.abort();const event=await pending;assert.equal(event.kind,'paused');const state=await f.store.load(event.run_id);assert.equal(state.lifecycle,'paused');assert.equal(state.writer,false);});

test('unverified stop retains writer ownership and reports failure',async t=>{const f=await fixture(t);f.adapter.confirmed=false;f.adapter.submit=async(session,operation)=>{f.adapter.sessions.get(session).operation=operation;return {messageId:`message-${operation}`};};const ctrl=new AbortController();const pending=f.runner.dispatch({operation_id:'unconfirmed',kind:'implement',brief},undefined,ctrl.signal);await new Promise(r=>setTimeout(r,30));ctrl.abort();await assert.rejects(pending,/Stop could not be verified/);await assert.rejects(f.runner.dispatch({operation_id:'other',kind:'implement',brief}),/Workspace writer is owned/);});

test('closing an unresolved callback settles HTTP with failure and preserves the durable question',async t=>{const f=await fixture(t,30);const event=await f.runner.dispatch({operation_id:'close-question',kind:'implement',brief});assert.equal(event.kind,'decision_required');await f.runner.close();await new Promise(r=>setTimeout(r,10));const state=await f.store.load(event.run_id);assert.equal(state.lifecycle,'paused');assert.equal(state.pending.id,event.payload.id);assert.ok(state.events.some(e=>e.event_id===event.event_id));assert.ok(state.events.some(e=>e.kind==='paused'));assert.notEqual(f.adapter.errors.length,0);});

test('artifact reference checks real image bytes, hash, MIME and size',async t=>{const f=await fixture(t);const bytes=Buffer.from([137,80,78,71,13,10,26,10,1]);await writeFile(join(f.root,'image.png'),bytes);const artifact={id:'image.png',mime:'image/png',path:'image.png',sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,purpose:'acceptance image'};assert.deepEqual((await verifyArtifact(f.root,artifact)).bytes,bytes);const bad={...artifact,sha256:'0'.repeat(64)};await assert.rejects(verifyArtifact(f.root,bad),/integrity check failed/);});

test('known unsupported modality fails before adapter work',async t=>{const f=await fixture(t);await assert.rejects(f.runner.dispatch({operation_id:'pdf',kind:'implement',brief:{...brief,artifacts:[{id:'doc',mime:'application/pdf',path:'doc.pdf',sha256:'0'.repeat(64),size:2,purpose:'input'}]}}),/Unsupported artifact MIME/);});

test('fresh Runner recovers unresolved question in same session, continues with answer, and accepts exact report',async t=>{
  const f=await fixture(t,30);const event=await f.runner.dispatch({operation_id:'recover-question',kind:'implement',brief});await f.runner.close();
  const changed={...profile,model:'other/model'};const config={ship:{default_profile:'changed',profiles:{changed}},limits:{max_dispatch_seconds:999,delivery_margin_seconds:2}};
  const store2=new Store(f.root),adapter2=new FakeAdapter(),runner2=new Runner(store2,config,adapter2);f.track(runner2);
  const replay=await runner2.recover(event.run_id,event.supervisor_handle);assert.equal(replay.kind,'decision_required');assert.equal(replay.event_id,event.event_id);
  const ready=await runner2.reply({run_id:event.run_id,request_id:event.payload.id,operation_id:'answer-after-restart',answer:'Choose A',expected_brief_version:event.brief_version});assert.equal(ready.kind,'implementation_ready');assert.equal((await store2.load(event.run_id)).profile.model,'openai/gpt-6-luna');
  const lease=JSON.parse(await readFile(join(f.root,'.specship','active-writer.json'),'utf8'));lease.pid=2_000_000_000;await writeFile(join(f.root,'.specship','active-writer.json'),JSON.stringify(lease));
  await runner2.close();const runner3=new Runner(new Store(f.root),config,new FakeAdapter());f.track(runner3);
  const reportEvent=await runner3.recover(event.run_id,event.supervisor_handle);assert.equal(reportEvent.report_id,ready.report_id);await runner3.accept(event.run_id,event.activity_id,reportEvent.report_id,event.brief_version,'Independent review after restart');assert.equal((await new Store(f.root).load(event.run_id)).lifecycle,'completed');
});

test('recovery refuses a live writer process and never steals its lease',async t=>{const f=await fixture(t,30);const event=await f.runner.dispatch({operation_id:'live-owner',kind:'implement',brief});const second=new Runner(new Store(f.root),await readConfig(join(f.root,'config.json')),new FakeAdapter());f.track(second);await assert.rejects(second.recover(event.run_id,event.supervisor_handle),/may still be alive/);});

test('expired activity deadline survives restart and is not reset from changed config',async t=>{const f=await fixture(t,30);const event=await f.runner.dispatch({operation_id:'expired',kind:'implement',brief});const state=await f.store.load(event.run_id);state.deadline=Date.now()-1;f.runner.active.get(event.run_id).state.deadline=state.deadline;await f.store.save(state);await f.runner.close();const next=new Runner(new Store(f.root),{ship:{default_profile:'x',profiles:{x:{...profile,model:'changed/model'}}},limits:{max_dispatch_seconds:500,delivery_margin_seconds:2}},new FakeAdapter());f.track(next);const result=await next.recover(event.run_id,event.supervisor_handle);assert.equal(result.kind,'limit_reached');assert.equal(result.payload.stop_confirmed,true);});

test('canonical materialized image survives source deletion; retained-byte mutation blocks recovery',async t=>{const f=await fixture(t,30);const bytes=Buffer.from([137,80,78,71,13,10,26,10,1]);await writeFile(join(f.root,'original.png'),bytes);const event=await f.runner.dispatch({operation_id:'artifact-recovery',kind:'implement',brief:{...brief,artifacts:[{path:'original.png',mime:'image/png',purpose:'question image'}]}});const state=await f.store.load(event.run_id);const canonical=join(f.root,state.brief.artifacts[0].path);assert.match(state.brief.artifacts[0].path,/^\.specship\/artifacts\//);await unlink(join(f.root,'original.png'));await f.runner.close();const next=new Runner(new Store(f.root),await readConfig(join(f.root,'config.json')),new FakeAdapter());f.track(next);const resumed=await next.recover(event.run_id,event.supervisor_handle);assert.equal(resumed.kind,'decision_required');await next.close();await writeFile(canonical,Buffer.from('tampered'));const third=new Runner(new Store(f.root),await readConfig(join(f.root,'config.json')),new FakeAdapter());f.track(third);await assert.rejects(third.recover(event.run_id,event.supervisor_handle),/integrity check failed/);});

test('incorrect complete artifact hash is rejected without recomputing it',async t=>{const f=await fixture(t);const bytes=Buffer.from([137,80,78,71,13,10,26,10,1]);await writeFile(join(f.root,'bad.png'),bytes);await assert.rejects(f.runner.dispatch({operation_id:'bad-hash',kind:'implement',brief:{...brief,artifacts:[{id:'bad',path:'bad.png',mime:'image/png',purpose:'fixture',size:bytes.length,sha256:'0'.repeat(64)}]}}),/Supplied artifact hash\/size mismatch/);});

test('accepted but response-lost submission is adopted by operation marker without duplicate prompt',async t=>{const f=await fixture(t,30);f.adapter.confirmed=false;f.adapter.submit=async(session,operation)=>{const s=f.adapter.sessions.get(session);s.operation=operation;s.submissions++;throw Error('response lost after native acceptance');};await assert.rejects(f.runner.dispatch({operation_id:'lost-response',kind:'implement',brief}),/response lost/);const state=await f.store.load((await f.store.listRuns())[0].run_id);const active=JSON.parse(await readFile(join(f.root,'.specship','active-writer.json'),'utf8'));active.pid=2_000_000_000;await writeFile(join(f.root,'.specship','active-writer.json'),JSON.stringify(active));const next=new Runner(new Store(f.root),await readConfig(join(f.root,'config.json')),new FakeAdapter());f.track(next);const abort=new AbortController();const waiting=next.recover(state.run_id,state.supervisor.handle,undefined,abort.signal);await new Promise(r=>setTimeout(r,30));abort.abort();const event=await waiting;assert.equal(event.kind,'paused');assert.equal((await new Store(f.root).load(state.run_id)).adapter.message_id,'message-lost-response');assert.equal(f.adapter.sessions.values().next().value.submissions,1);});

test('unconfirmed recovery stop retains writer lease and partial-work ownership',async t=>{const f=await fixture(t,30);const event=await f.runner.dispatch({operation_id:'stop-unconfirmed',kind:'implement',brief});f.adapter.confirmed=false;await f.runner.close();const lease=JSON.parse(await readFile(join(f.root,'.specship','active-writer.json'),'utf8'));lease.pid=2_000_000_000;await writeFile(join(f.root,'.specship','active-writer.json'),JSON.stringify(lease));const adapter=new FakeAdapter();adapter.confirmed=false;const next=new Runner(new Store(f.root),await readConfig(join(f.root,'config.json')),adapter);f.track(next);const failure=await next.recover(event.run_id,event.supervisor_handle);assert.equal(failure.kind,'execution_failed');assert.equal((await new Store(f.root).load(event.run_id)).writer,true);assert.ok(await readFile(join(f.root,'.specship','active-writer.json'),'utf8'));});

test('stable operation ID rejects changed dispatch input',async t=>{const f=await fixture(t,30);const event=await f.runner.dispatch({operation_id:'fingerprinted',kind:'implement',brief});await assert.rejects(f.runner.dispatch({operation_id:'fingerprinted',kind:'implement',brief:{...brief,outcome:'different'}}),/different dispatch input/);assert.equal((await f.store.load(event.run_id)).activity_id,event.activity_id);});

test('attached pause reconciles and resume explicitly continues the existing session without replaying dispatch',async t=>{const f=await fixture(t,30);const q=await f.runner.dispatch({operation_id:'resume-initial',kind:'implement',brief});const ready=await f.runner.reply({run_id:q.run_id,request_id:q.payload.id,operation_id:'resume-answer',answer:'approved',expected_brief_version:q.brief_version});const paused=await f.runner.control({run_id:q.run_id,operation_id:'pause-once',action:'pause',reason:'Spec requested pause',supervisor_handle:ready.supervisor_handle});assert.equal(paused.kind,'paused');const resumed=await f.runner.control({run_id:q.run_id,operation_id:'resume-once',action:'resume',reason:'Spec explicitly resumes',supervisor_handle:ready.supervisor_handle});assert.equal(resumed.kind,'implementation_ready');assert.equal(f.adapter.sessions.size,1);assert.equal(f.adapter.sessions.values().next().value.submissions,2);});

test('permission grants fail closed, including after deferral; rejection resolves the exact native request',async t=>{
  const f=await fixture(t,30);let resolved=0;
  f.adapter.submit=async(session,operation)=>{const s=f.adapter.sessions.get(session);s.operation=operation;s.submissions++;s.events.push({type:'permission',data:{id:'native-permission',sessionID:session,permission:'bash',patterns:['node --test']}});for(const wake of s.waiters.splice(0))wake();return {messageId:`message-${operation}`};};
  f.adapter.resolvePermission=async(session,id,answer)=>{assert.equal(id,'native-permission');assert.equal(answer,'reject');resolved++;const s=f.adapter.sessions.get(session);const response=await fetch(s.callback.url+'/report_result',{method:'POST',headers:{authorization:`Bearer ${s.callback.capability}`,'content-type':'application/json'},body:JSON.stringify(report)});assert.equal(response.status,200);s.report=true;};
  const permission=await f.runner.dispatch({operation_id:'native-permission-dispatch',kind:'implement',brief});assert.equal(permission.kind,'user_input_required');
  const base={run_id:permission.run_id,request_id:'native-permission',expected_brief_version:permission.brief_version};
  for(const answer of ['once','always','human approved'])await assert.rejects(f.runner.reply({...base,operation_id:`grant-${answer}`,answer}),/permission grants are disabled/);
  assert.equal(resolved,0);
  const before=await f.store.load(permission.run_id);assert.equal(before.pending.kind,'permission');assert.equal(Object.keys(before.operation_ids).length,1);
  await f.runner.reply({...base,operation_id:'defer-permission',answer:'Ask the user',defer_to_user:true});
  await assert.rejects(f.runner.reply({...base,operation_id:'deferred-grant',answer:'once'}),/permission grants are disabled/);
  // Old preview state lost the permission kind when deferring. Its durable event still proves provenance.
  f.runner.active.get(permission.run_id).state.pending.kind='deferred';
  await assert.rejects(f.runner.reply({...base,operation_id:'old-deferred-grant',answer:'always'}),/permission grants are disabled/);
  assert.equal(resolved,0);
  const input={...base,operation_id:'reject-permission',answer:'reject'};
  const ready=await f.runner.reply(input);assert.equal(ready.kind,'implementation_ready');assert.equal((await f.runner.reply(input)).event_id,ready.event_id);assert.equal(resolved,1);
});

test('invalid correction leaves the idle review and brief intact; cancellation closes the owned adapter',async t=>{
  const f=await fixture(t,30);const q=await f.runner.dispatch({operation_id:'preflight',kind:'implement',brief});const ready=await f.runner.reply({run_id:q.run_id,request_id:q.payload.id,operation_id:'preflight-answer',answer:'approved',expected_brief_version:q.brief_version});
  await assert.rejects(f.runner.dispatch({run_id:q.run_id,supervisor_handle:q.supervisor_handle,operation_id:'stale-correction',kind:'correct',expected_brief_version:0}),/Stale brief version/);
  const state=await f.store.load(q.run_id);assert.equal(state.lifecycle,'awaiting_review');assert.equal(state.brief_version,ready.brief_version);assert.equal(f.adapter.sessions.values().next().value.aborted,false);
  let closed=0;f.adapter.close=async session=>{closed++;return f.adapter.abort(session);};
  await f.runner.control({run_id:q.run_id,supervisor_handle:q.supervisor_handle,operation_id:'cancel-closes',action:'cancel',reason:'done'});assert.equal(closed,1);
});

test('namespaced model IDs preserve everything after the provider separator',()=>{assert.deepEqual(splitModel('openrouter/vendor/model'),['openrouter','vendor/model']);});

test('outside edits invalidate acceptance and require a decision after exact-session recovery',async t=>{
  const f=await fixture(t,30);execFileSync('git',['init','--quiet',f.root]);await writeFile(join(f.root,'user-notes.txt'),'original user notes');
  const q=await f.runner.dispatch({operation_id:'drift-check',kind:'implement',brief});const ready=await f.runner.reply({run_id:q.run_id,request_id:q.payload.id,operation_id:'drift-answer',answer:'approved',expected_brief_version:q.brief_version});
  await writeFile(join(f.root,'user-notes.txt'),'outside edit');
  await assert.rejects(f.runner.accept(q.run_id,q.activity_id,ready.report_id,ready.brief_version,'reviewed before outside edit'),/Workspace changed/);
  await f.runner.close();await writeFile(join(f.root,'user-notes.txt'),'another outside edit after close');
  const leasePath=join(f.root,'.specship','active-writer.json');const lease=JSON.parse(await readFile(leasePath,'utf8'));lease.pid=2_000_000_000;await writeFile(leasePath,JSON.stringify(lease)); // Model the old runner process having exited.
  const next=new Runner(new Store(f.root),await readConfig(join(f.root,'config.json')),new FakeAdapter());f.track(next);
  const decision=await next.recover(q.run_id,q.supervisor_handle);assert.equal(decision.kind,'decision_required');assert.equal(decision.payload.kind,'recovery_review');assert.ok(decision.payload.body.evidence.includes('user-notes.txt'));assert.equal((await new Store(f.root).load(q.run_id)).report,undefined);
  const result=await next.reply({run_id:q.run_id,request_id:decision.payload.id,operation_id:'reviewed-outside-edit',answer:'The outside notes edit is authorized. Keep it and validate the implementation.',expected_brief_version:q.brief_version});assert.equal(result.kind,'implementation_ready');assert.equal(await readFile(join(f.root,'user-notes.txt'),'utf8'),'another outside edit after close');
});

test('a final needs-decision report can be answered and replaced by a fresh report',async t=>{
  const f=await fixture(t,30);
  f.adapter.submit=async(session,operation)=>{const s=f.adapter.sessions.get(session);s.operation=operation;s.submissions++;const response=await fetch(s.callback.url+'/report_result',{method:'POST',headers:{authorization:`Bearer ${s.callback.capability}`,'content-type':'application/json'},body:JSON.stringify({...report,status:'needs_decision',remaining_issues:['Choose the approved behavior']})});assert.equal(response.status,200);s.report=true;return {messageId:`message-${operation}`};};
  const decision=await f.runner.dispatch({operation_id:'reported-decision',kind:'implement',brief});assert.equal(decision.kind,'decision_required');assert.equal(decision.payload.request_id,decision.report_id);
  const ready=await f.runner.reply({run_id:decision.run_id,request_id:decision.payload.request_id,operation_id:'answer-reported-decision',answer:'Continue within the approved brief.',expected_brief_version:decision.brief_version});assert.equal(ready.kind,'implementation_ready');assert.notEqual(ready.report_id,decision.report_id);
});
