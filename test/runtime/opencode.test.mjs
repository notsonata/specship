import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { OpenCodeAdapter } from '../../dist/adapters/opencode.js';

const profile={harness:'opencode',model:'openai/gpt-6-luna',options:{variant:'high'}};
async function fakeOpenCode(t){
  const sessions=new Map(),streams=new Set();let promptRequests=0,ambiguous=false,lastPrompt;
  const server=createServer(async(req,res)=>{
    if(req.headers.authorization!==`Basic ${Buffer.from('opencode:test-password').toString('base64')}`){res.writeHead(401).end();return;}
    const url=new URL(req.url,'http://127.0.0.1');const parts=url.pathname.split('/').filter(Boolean);
    if(url.pathname==='/global/health'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({version:'1.18.30'}));return;}
    if(url.pathname==='/permission/p1/reply'&&req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;assert.deepEqual(JSON.parse(raw),{reply:'once'});res.writeHead(200).end('true');return;}
    if(url.pathname===`/api/session/${[...sessions.keys()][0]}/permission/p2/reply`&&req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;assert.deepEqual(JSON.parse(raw),{reply:'reject'});res.writeHead(204).end();return;}
    if(url.pathname==='/provider'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({all:[{id:'openai',models:{'gpt-6-luna':{capabilities:{input:{image:true}},variants:{high:{reasoningEffort:'high'}}}}}]}));return;}
    if(url.pathname==='/session'&&req.method==='POST'){const id='01a149b7-8297-7002-9918-ccb79cff880c';sessions.set(id,{messages:[],status:'busy'});res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id}));return;}
    if(url.pathname==='/event'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});res.flushHeaders();streams.add(res);req.on('close',()=>streams.delete(res));return;}
    if(url.pathname==='/session/status'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(Object.fromEntries([...sessions].filter(([,s])=>s.status!=='idle').map(([id,s])=>[id,{type:s.status}]))));return;}
    if(parts[0]==='session'&&parts.length===2&&req.method==='GET'){const s=sessions.get(parts[1]);if(!s){res.writeHead(404).end();return;}res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:parts[1]}));return;}
    if(parts[0]==='session'&&parts.length===3&&parts[2]==='message'&&req.method==='GET'){const s=sessions.get(parts[1]);res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(s?.messages??[]));return;}
    if(parts[0]==='session'&&parts[2]==='prompt_async'&&req.method==='POST'){
      let raw='';for await(const chunk of req)raw+=chunk;lastPrompt=JSON.parse(raw);promptRequests++;
      const s=sessions.get(parts[1]);const text=lastPrompt.parts.find(x=>x.type==='text').text;
      assert.equal(lastPrompt.agent,'specship_ship');assert.deepEqual(lastPrompt.model,{providerID:'openai',modelID:'gpt-6-luna'});assert.equal(lastPrompt.variant,'high');
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
  await adapter.validate(profile,['image/png']);const session=await adapter.start(process.cwd(),profile,'implement',{url:'http://127.0.0.1:1',capability:'cap'});
  return {adapter,session:session.session,sessions,streams,endpoint:{address,password:'test-password'},setAmbiguous:value=>ambiguous=value,get promptRequests(){return promptRequests;},get lastPrompt(){return lastPrompt;}};
}

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
