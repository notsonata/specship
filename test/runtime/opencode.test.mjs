import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenCodeAdapter, shipPermissionPolicy } from '../../dist/adapters/opencode.js';

const profile={harness:'opencode',model:'openai/gpt-6-luna',options:{variant:'high'}};

test('ship permission policy pins Specship routing while a profile may answer path prompts',()=>{
  assert.deepEqual(shipPermissionPolicy('implement'),{question:'deny',task:'deny'});
  assert.deepEqual(shipPermissionPolicy('implement',{external_directory:'allow',webfetch:'deny'}),{external_directory:'allow',webfetch:'deny',question:'deny',task:'deny'});
  assert.deepEqual(shipPermissionPolicy('correct',{question:'allow',task:'allow'}),{question:'deny',task:'deny'});
  assert.deepEqual(shipPermissionPolicy('explore',{external_directory:'allow'}),{'*':'deny',read:'allow',glob:'allow',grep:'allow',specship_callbacks_ask_spec:'allow',specship_callbacks_report_result:'allow'});
});

test('OpenCode profile validation accepts a permission policy and rejects unknown actions',async()=>{
  const adapter=new OpenCodeAdapter('not-spawned');
  await adapter.validate({...profile,options:{...profile.options,permission:{external_directory:'allow'}}},[]);
  await assert.rejects(adapter.validate({...profile,options:{...profile.options,permission:{external_directory:'sometimes'}}},[]),/must be allow, ask, or deny/);
  await assert.rejects(adapter.validate({...profile,options:{...profile.options,retry:'allow'}},[]),/unsupported options/);
});
async function fakeOpenCode(t,version='1.18.30',options={}){
  const sessions=new Map(),streams=new Set();let promptRequests=0,ambiguous=false,lastPrompt,configRequests=0;
  const model={capabilities:{input:{image:true}},variants:{high:{reasoningEffort:'high'}}};
  const providers=options.providers??[{id:'openai',models:{'gpt-6-luna':model}}];
  const server=createServer(async(req,res)=>{
    if(req.headers.authorization!==`Basic ${Buffer.from('opencode:test-password').toString('base64')}`){res.writeHead(401).end();return;}
    const url=new URL(req.url,'http://127.0.0.1');const parts=url.pathname.split('/').filter(Boolean);
    if(url.pathname==='/global/health'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({version}));return;}
    if(url.pathname==='/config'){configRequests++;res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(options.config??{model:'openai/gpt-6-luna'}));return;}
    if(url.pathname==='/config/providers'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({providers,default:{openai:'gpt-6-luna'}}));return;}
    if(url.pathname==='/path'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({state:options.state}));return;}
    if(url.pathname==='/permission/p1/reply'&&req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;assert.deepEqual(JSON.parse(raw),{reply:'once'});res.writeHead(200).end('true');return;}
    if(url.pathname===`/api/session/${[...sessions.keys()][0]}/permission/p2/reply`&&req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;assert.deepEqual(JSON.parse(raw),{reply:'reject'});res.writeHead(204).end();return;}
    if(url.pathname==='/provider'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({all:providers}));return;}
    if(url.pathname==='/session'&&req.method==='POST'){const id='01a149b7-8297-7002-9918-ccb79cff880c';sessions.set(id,{messages:[],status:'busy'});res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id}));return;}
    if(url.pathname==='/event'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});res.flushHeaders();streams.add(res);req.on('close',()=>streams.delete(res));return;}
    if(url.pathname==='/session/status'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(Object.fromEntries([...sessions].filter(([,s])=>s.status!=='idle').map(([id,s])=>[id,{type:s.status}]))));return;}
    if(parts[0]==='session'&&parts.length===2&&req.method==='GET'){const s=sessions.get(parts[1]);if(!s){res.writeHead(404).end();return;}res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:parts[1]}));return;}
    if(parts[0]==='session'&&parts.length===3&&parts[2]==='message'&&req.method==='GET'){const s=sessions.get(parts[1]);res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(s?.messages??[]));return;}
    if(parts[0]==='session'&&parts[2]==='prompt_async'&&req.method==='POST'){
      let raw='';for await(const chunk of req)raw+=chunk;lastPrompt=JSON.parse(raw);promptRequests++;
      const s=sessions.get(parts[1]);const text=lastPrompt.parts.find(x=>x.type==='text').text;
      assert.equal(lastPrompt.agent,'specship_ship');assert.deepEqual(lastPrompt.model,options.expectedModel??{providerID:'openai',modelID:'gpt-6-luna'});assert.equal(lastPrompt.variant,(options.profile??profile).options.variant);
      assert.match(text,/\[specship-operation:operation with spaces\]/);
      assert.equal(Object.hasOwn(lastPrompt,'messageID'),false);
      s.messages.push({info:{id:'01a149b7-8297-7002-9918-ccb79cff880d',role:'user',sessionID:parts[1]},parts:[{type:'text',text}]});
      if(ambiguous){req.socket.destroy();return;}
      res.writeHead(204).end();return;
    }
    if(parts[0]==='session'&&parts[2]==='abort'&&req.method==='POST'){res.writeHead(200,{'content-type':'application/json'}).end('{}');return;}
    res.writeHead(404).end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{for(const stream of streams)stream.end();await new Promise(resolve=>server.close(resolve));});
  const adapter=new OpenCodeAdapter('not-spawned',150,{address,password:'test-password'});
  const selected=options.profile??profile;
  await adapter.validate(selected,['image/png']);const session=await adapter.start(process.cwd(),selected,'implement',{url:'http://127.0.0.1:1',capability:'cap'});
  return {adapter,session:session.session,resolvedProfile:session.profile,sessions,streams,endpoint:{address,password:'test-password'},setAmbiguous:value=>ambiguous=value,get promptRequests(){return promptRequests;},get configRequests(){return configRequests;},get lastPrompt(){return lastPrompt;}};
}

test('OpenCode default resolves before submission and stays pinned in prompts and reconnect snapshots',async t=>{
  const options={profile:{...profile,model:'default'},config:{model:'openai/gpt-6-luna'}};
  const f=await fakeOpenCode(t,'1.18.30',options);
  assert.equal(f.promptRequests,0);assert.deepEqual(f.resolvedProfile,profile);assert.equal(f.configRequests,1);
  const snapshot=await f.adapter.snapshot(f.session);assert.equal(snapshot.profile.model,profile.model);
  options.config.model='changed/unavailable';
  const restored=new OpenCodeAdapter('not-spawned',150);await restored.restore(snapshot,{url:'http://127.0.0.1:1',capability:'cap'});
  const controller=new AbortController();t.after(()=>controller.abort());await restored.subscribe(f.session,controller.signal);
  await restored.submit(f.session,'operation with spaces','work',[]);
  assert.equal(f.configRequests,1);assert.deepEqual(f.lastPrompt.model,{providerID:'openai',modelID:'gpt-6-luna'});
});

test('explicit OpenCode profiles bypass default resolution',async t=>{
  const f=await fakeOpenCode(t,'1.18.30',{config:{model:'unavailable/default'}});
  assert.equal(f.configRequests,0);assert.deepEqual(f.resolvedProfile,profile);
});

test('a new run resolves changed OpenCode defaults and an omitted variant stays inherited',async t=>{
  const options={profile:{harness:'opencode',model:'default',options:{}},config:{model:'openai/gpt-6-luna'}};
  const first=await fakeOpenCode(t,'1.18.30',options);assert.equal(first.resolvedProfile.model,profile.model);
  options.config.model='another/model';options.providers=[{id:'another',models:{model:{capabilities:{input:{image:true}}}}}];options.expectedModel={providerID:'another',modelID:'model'};
  const next=await fakeOpenCode(t,'1.18.30',options);assert.equal(next.resolvedProfile.model,'another/model');
  const controller=new AbortController();t.after(()=>controller.abort());await next.adapter.subscribe(next.session,controller.signal);
  await next.adapter.submit(next.session,'operation with spaces','work',[]);assert.equal(Object.hasOwn(next.lastPrompt,'variant'),false);
});

test('OpenCode default checks recent models before the connected provider fallback',async t=>{
  const state=await mkdtemp(join(tmpdir(),'specship-opencode-model-'));t.after(()=>rm(state,{recursive:true,force:true}));
  const options={profile:{...profile,model:'default'},config:{provider:{unavailable:{}}},state};
  await writeFile(join(state,'model.json'),JSON.stringify({recent:[null,{providerID:'missing',modelID:'missing'},{providerID:'openai',modelID:'gpt-6-luna'}]}));
  const recent=await fakeOpenCode(t,'1.18.30',options);assert.equal(recent.resolvedProfile.model,profile.model);assert.equal(recent.promptRequests,0);
  options.config={};await writeFile(join(state,'model.json'),'invalid json');
  const fallback=await fakeOpenCode(t,'1.18.30',options);assert.equal(fallback.resolvedProfile.model,profile.model);assert.equal(fallback.promptRequests,0);
  options.providers=[];await assert.rejects(fakeOpenCode(t,'1.18.30',options),/no available default model/);
});

test('OpenCode default fails before creating a session when selection or capabilities are invalid',async t=>{
  for(const options of [
    {config:{model:'invalid'}},
    {config:{model:'missing/model'}},
    {config:{},state:'relative/state'},
    {config:{model:'openai/gpt-6-luna'},providers:[{id:'openai',models:{'gpt-6-luna':{capabilities:{input:{image:false}}}}}]},
    {config:{model:'openai/gpt-6-luna'},providers:[{id:'openai',models:{'gpt-6-luna':{capabilities:{input:{image:true}},variants:{}}}}]},
  ])await assert.rejects(fakeOpenCode(t,'1.18.30',{...options,profile:{...profile,model:'default'}}),/provider\/model|unavailable|absolute state|image input/);
});

test('OpenCode accepts the minimum and newer semantic versions and rejects older or invalid versions',async t=>{
  for(const version of ['1.18.30','1.18.30+build.1','1.18.31','1.18.31-beta.1','1.19.0','1.100.0','2.0.0']){
    await t.test(`accepts ${version}`,async t=>{const f=await fakeOpenCode(t,version);f.sessions.get(f.session).status='idle';await f.adapter.close(f.session);});
  }
  for(const version of ['1.18.29','1.17.100','0.99.0','1.18.30-beta.1','1.18.30-01','1.018.30','latest','1.18',null]){
    await t.test(`rejects ${version}`,async t=>{await assert.rejects(fakeOpenCode(t,version),/requires 1\.18\.30 or newer/);});
  }
});

test('async prompt accepts while callbacks can remain pending; SSE subscribes and filters native session shape',async t=>{
  const f=await fakeOpenCode(t);const controller=new AbortController();await f.adapter.subscribe(f.session,controller.signal);
  const started=Date.now();const submitted=await f.adapter.submit(f.session,'operation with spaces','work',[{mime:'image/png',name:'original.png',data:Buffer.from([1,2])}]);
  assert.ok(Date.now()-started<1000);assert.equal(submitted.messageId,'01a149b7-8297-7002-9918-ccb79cff880d');assert.equal(f.promptRequests,1);assert.match(f.lastPrompt.parts[1].url,/data:image\/png;base64,/);
  const iterator=f.adapter.events(f.session,controller.signal)[Symbol.asyncIterator]();
  const other=JSON.stringify({type:'session.status',properties:{sessionID:'other-session',status:{type:'idle'}}});
  const permission=JSON.stringify({type:'permission.asked',properties:{sessionID:f.session,id:'p1',permission:'bash',patterns:['node --test']}});
  for(const stream of f.streams){stream.write(`data: ${other}\n\n`);stream.write(`data: ${permission}\n\n`);}
  const event=await iterator.next();assert.equal(event.value.type,'permission');assert.equal(event.value.session,f.session);
  await f.adapter.resolvePermission(f.session,'p1','once');
  for(const stream of f.streams)stream.write(`data: ${JSON.stringify({type:'permission.v2.asked',properties:{sessionID:f.session,id:'p2',action:'read',resources:['user-notes.txt']}})}\n\n`);
  const next=await iterator.next();assert.equal(next.value.data.id,'p2');await f.adapter.resolvePermission(f.session,'p2','reject');
  f.sessions.get(f.session).status='idle';controller.abort();await f.adapter.close(f.session);
});

test('reconciliation requires exact parent, non-tool-calls finish and idle status',async t=>{
  const f=await fakeOpenCode(t);const controller=new AbortController();await f.adapter.subscribe(f.session,controller.signal);const userId=(await f.adapter.submit(f.session,'operation with spaces','work',[])).messageId;const state=f.sessions.get(f.session);
  state.messages.push({info:{id:'assistant-1',role:'assistant',sessionID:f.session,parentID:userId,finish:'tool-calls'},parts:[]});state.status='idle';
  assert.equal(await f.adapter.reconcile(f.session,userId),'active');state.messages[1].info.finish='stop';state.status='busy';assert.equal(await f.adapter.reconcile(f.session,userId),'active');state.status='idle';assert.equal(await f.adapter.reconcile(f.session,userId),'complete');controller.abort();
});

test('abort HTTP success is insufficient until session status is idle',async t=>{
  const f=await fakeOpenCode(t);f.sessions.get(f.session).status='busy';assert.equal(await f.adapter.abort(f.session),false);f.sessions.get(f.session).status='idle';assert.equal(await f.adapter.abort(f.session),true);
});

test('ambiguous async delivery reconciles its generated native user message without resubmission',async t=>{
  const f=await fakeOpenCode(t);const controller=new AbortController();await f.adapter.subscribe(f.session,controller.signal);f.setAmbiguous(true);const result=await f.adapter.submit(f.session,'operation with spaces','work',[]);assert.equal(result.messageId,'01a149b7-8297-7002-9918-ccb79cff880d');assert.equal(f.promptRequests,1);controller.abort();
});

test('adapter snapshot restores the exact authenticated local session without another session or prompt',async t=>{
  const f=await fakeOpenCode(t);await f.adapter.subscribe(f.session,new AbortController().signal);const native=await f.adapter.submit(f.session,'operation with spaces','original',[ ]);const snapshot=await f.adapter.snapshot(f.session);const restored=new OpenCodeAdapter('not-spawned',150,f.endpoint);const session=await restored.restore(snapshot,{url:'http://127.0.0.1:1',capability:'new',descriptorPath:'private'});assert.equal(session.session,f.session);assert.equal(await restored.reconcile(session.session,native.messageId),'active');assert.equal(f.promptRequests,1);
});

test('closing an owned server confirms real process exit, including signal termination',async t=>{
  const f=await fakeOpenCode(t);f.sessions.get(f.session).status='idle';f.adapter.stopTimeoutMs=2_000;
  const child=spawn(process.execPath,['-e',"process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  await once(child,'message');f.adapter.child=child;
  assert.equal(await f.adapter.close(f.session),true);
  assert.ok(child.exitCode!==null||child.signalCode!==null);
  assert.equal(f.adapter.child,undefined);
});

test('unconfirmed owned-server termination is bounded, preserves recovery data, and can be retried',async t=>{
  const f=await fakeOpenCode(t);f.sessions.get(f.session).status='idle';
  const child=Object.assign(new EventEmitter(),{exitCode:null,signalCode:null,kill:()=>true});
  f.adapter.child=child;const address=f.adapter.address,password=f.adapter.password;
  const started=Date.now();
  assert.equal(await f.adapter.close(f.session),false);
  assert.ok(Date.now()-started<2000,'close must return when the child never emits exit');
  assert.equal(f.adapter.child,child);assert.equal(f.adapter.address,address);assert.equal(f.adapter.password,password);
  assert.equal(child.listenerCount('exit'),0);assert.equal(child.listenerCount('error'),0);
  // Emit synchronously to ensure listeners are registered before kill is requested.
  child.kill=()=>{child.signalCode='SIGTERM';child.emit('exit',null,'SIGTERM');return true;};
  assert.equal(await f.adapter.close(f.session),true);
  assert.equal(f.adapter.child,undefined);
});

test('owned-server kill refusal, exception, and error never claim successful cleanup',async t=>{
  for(const mode of ['refused','throws','error'])await t.test(mode,async t=>{
    const f=await fakeOpenCode(t);f.sessions.get(f.session).status='idle';
    const child=Object.assign(new EventEmitter(),{exitCode:null,signalCode:null,kill:()=>{
      if(mode==='throws')throw Error('kill failed');
      if(mode==='error')child.emit('error',Error('kill failed'));
      return mode!=='refused';
    }});
    f.adapter.child=child;
    assert.equal(await f.adapter.close(f.session),false);
    assert.equal(f.adapter.child,child);
    assert.equal(child.listenerCount('exit'),0);assert.equal(child.listenerCount('error'),0);
  });
});

test('an already signal-terminated owned child does not wait for a second exit event',async t=>{
  const f=await fakeOpenCode(t);f.sessions.get(f.session).status='idle';
  f.adapter.child={exitCode:null,signalCode:'SIGTERM',kill:()=>{throw Error('already exited');}};
  assert.equal(await f.adapter.close(f.session),true);
});

test('failed-startup cleanup is bounded and retains an unconfirmed server identity',async()=>{
  const adapter=new OpenCodeAdapter('not-spawned',150);
  const child=Object.assign(new EventEmitter(),{pid:1234,exitCode:null,signalCode:null,kill:()=>true});
  adapter.startServer=async()=>{adapter.child=child;adapter.address='http://127.0.0.1:1';};
  const failure=Error('profile validation failed');adapter.validateLiveProfile=async()=>{throw failure;};
  const started=Date.now();
  await assert.rejects(adapter.start(process.cwd(),profile,'implement',{url:'http://127.0.0.1:1',capability:'cap'}),error=>{
    assert.match(error.message,/termination is unconfirmed \(PID 1234\)/);assert.equal(error.cause,failure);return true;
  });
  assert.ok(Date.now()-started<2000);assert.equal(adapter.child,child);assert.equal(adapter.address,'http://127.0.0.1:1');
  assert.equal(child.listenerCount('exit'),0);assert.equal(child.listenerCount('error'),0);
});

test('failed-startup cleanup preserves the original error after confirmed termination',async()=>{
  const adapter=new OpenCodeAdapter('not-spawned',150);
  const child=Object.assign(new EventEmitter(),{exitCode:null,signalCode:null,kill:()=>{child.signalCode='SIGTERM';child.emit('exit',null,'SIGTERM');return true;}});
  adapter.startServer=async()=>{adapter.child=child;adapter.address='http://127.0.0.1:1';};
  const failure=Error('profile validation failed');adapter.validateLiveProfile=async()=>{throw failure;};
  await assert.rejects(adapter.start(process.cwd(),profile,'implement',{url:'http://127.0.0.1:1',capability:'cap'}),error=>error===failure);
  assert.equal(adapter.child,undefined);assert.equal(adapter.address,'');
});
