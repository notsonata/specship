import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { interruptCommand } from '../../dist/hooks.js';
import { LONG_TOOL_TIMEOUT_SECONDS } from '../../dist/timeouts.js';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Store } from '../../dist/state.js';

const cli=fileURLToPath(new URL('../../dist/cli.js',import.meta.url));
const brief={outcome:'test',acceptance:['works'],boundaries:[],decisions:[],verified_context:[],validation:[]};
async function temp(t,prefix){
  const root=await mkdtemp(join(tmpdir(),prefix));
  t.after(async()=>{
    const path=await realpath(root);
    assert.equal(dirname(path),await realpath(tmpdir()));
    assert.ok(basename(path).startsWith(prefix));
    await rm(path,{recursive:true,force:true});
  });
  return root;
}

async function installRuntime(workspace) {
  const root=join(workspace,'.specship','runtime');await mkdir(root,{recursive:true});
  await cp(dirname(cli),join(root,'dist'),{recursive:true});
  await cp(fileURLToPath(new URL('../../package.json',import.meta.url)),join(root,'package.json'));
  await cp(fileURLToPath(new URL('../../.agents',import.meta.url)),join(root,'.agents'),{recursive:true});
  // npm creates dependency links too; the runtime boundary must preserve them.
  await symlink(fileURLToPath(new URL('../../node_modules',import.meta.url)),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
  return join(root,'dist','cli.js');
}

async function invokeSetup(script, workspace, extra=[]) {
  const args=[script,'setup','--workspace',workspace,'--profile','chosen','--model','openai/gpt-6-luna','--executable',process.execPath,...extra];
  const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
  const code=await new Promise(resolve=>child.on('close',resolve));return {code,out,err};
}

test('CLI setup requires explicit values and emits portable timeout/hook registrations',async t=>{
  const workspace=await temp(t,'specship-setup-');const installed=await installRuntime(workspace);
  const {code,out,err}=await invokeSetup(cli,workspace,['--shell',process.execPath,'--max-dispatch-seconds','90','--delivery-margin-seconds','35']);assert.equal(code,0,err);const result=JSON.parse(out);assert.match(result.codex_toml,/tool_timeout_sec = 125/);assert.match(result.codex_toml,/direct_only_tool_namespaces = \["mcp__specship"\]/);assert.equal(result.hooks_json.hooks.Interrupt[0].hooks[0].timeout,3);assert.equal(result.hooks_json.hooks.Interrupt[0].hooks[0].command,interruptCommand(process.execPath,installed,workspace));assert.match(await readFile(join(workspace,'.specship','config.json'),'utf8'),/"max_dispatch_seconds": 90/);
  assert.equal(result.environment,join(workspace,'.specship','.env'));assert.equal(result.environment_created,true);assert.match(await readFile(result.environment,'utf8'),/^DEEPSEEK_API_KEY=/m);assert.match(await readFile(join(workspace,'.specship','.env.example'),'utf8'),/^DEEPSEEK_API_KEY=$/m);
  const invalid=spawn(process.execPath,[cli,'setup','--workspace',workspace],{stdio:'ignore'});assert.notEqual(await new Promise(resolve=>invalid.on('close',resolve)),0);
});

test('CLI setup defaults to no assignment limit and emits one long direct MCP wait',async t=>{
  const workspace=await temp(t,'specship-setup-unlimited-');const installed=await installRuntime(workspace);
  const {code,out,err}=await invokeSetup(installed,workspace);assert.equal(code,0,err);
  const result=JSON.parse(out);assert.match(result.codex_toml,new RegExp(`tool_timeout_sec = ${LONG_TOOL_TIMEOUT_SECONDS}`));assert.match(result.codex_toml,/direct_only_tool_namespaces = \["mcp__specship"\]/);
  const config=JSON.parse(await readFile(join(workspace,'.specship','config.json'),'utf8'));assert.equal(config.limits.max_dispatch_seconds,null);assert.equal(config.limits.delivery_margin_seconds,120);
});

test('local runtime registration works and setup preserves existing runs and reconnect data byte for byte',async t=>{
  let transport;t.after(async()=>{await transport?.close();});
  const workspace=await temp(t,"specship-local O'Reilly-");const store=new Store(workspace);await store.initialize();
  const state=await store.create();state.supervisor={handle:'existing-supervisor',thread:'original-thread',turn:'original-turn',waiting:false};await store.save(state);
  await store.writePrivate(state.run_id,'adapter.json',{session:'original-session',password:'fixture-secret'});
  await store.writeCallbackDescriptor(state.run_id,{url:'http://127.0.0.1:1',capability:'original-callback'});
  const paths=[join(store.runDir(state.run_id),'state.json'),join(store.runDir(state.run_id),'adapter.json'),store.callbackDescriptorPath(state.run_id)];
  const originals=await Promise.all(paths.map(path=>readFile(path)));
  const installed=await installRuntime(workspace);const setup=await invokeSetup(installed,workspace);assert.equal(setup.code,0,setup.err);
  const output=JSON.parse(setup.out);assert.equal(output.runtime,dirname(dirname(installed)));assert.ok(output.codex_toml.includes(JSON.stringify(installed)));assert.equal(output.hooks_json.hooks.Interrupt[0].hooks[0].command,interruptCommand(process.execPath,installed,workspace));
  const configPath=join(workspace,'.specship','config.json');const config=await readFile(configPath);const envPath=join(workspace,'.specship','.env');const envBefore=await readFile(envPath);
  const repeated=await invokeSetup(cli,workspace);assert.equal(repeated.code,0,repeated.err);assert.deepEqual(await readFile(configPath),config);assert.deepEqual(await readFile(envPath),envBefore);
  for(let i=0;i<paths.length;i++)assert.deepEqual(await readFile(paths[i]),originals[i]);
  transport=new StdioClientTransport({command:process.execPath,args:[installed,'serve',workspace]});const client=new Client({name:'local-install-test',version:'1'});await client.connect(transport);
  const profiles=await client.callTool({name:'specship_inspect',arguments:{workspace,section:'profiles'}});assert.notEqual(profiles.isError,true);assert.equal(JSON.parse(profiles.content[0].text).default_profile,'chosen');
  const loaded=await new Store(workspace).load(state.run_id);assert.equal(loaded.supervisor.handle,'existing-supervisor');assert.deepEqual(await store.readPrivate(state.run_id,'adapter.json'),{session:'original-session',password:'fixture-secret'});
});

test('CLI setup configures a DeepSeek ACP profile while keeping the Codex registration unchanged',async t=>{
  const workspace=await temp(t,'specship-setup-deepseek-');const installed=await installRuntime(workspace);const fakeCli=join(workspace,'dsh-cli.js');await writeFile(fakeCli,'');
  const args=[cli,'setup','--workspace',workspace,'--harness','deepseek','--profile','dsh','--model','deepseek-account/deepseek-flash','--executable',process.execPath,'--cli',fakeCli,'--variant','high','--sandbox','workspace-write'];
  const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
  const code=await new Promise(resolve=>child.on('close',resolve));assert.equal(code,0,err);const result=JSON.parse(out);assert.match(result.codex_toml,/direct_only_tool_namespaces = \["mcp__specship"\]/);
  const config=JSON.parse(await readFile(join(workspace,'.specship','config.json'),'utf8'));assert.deepEqual(config.ship.profiles.dsh,{harness:'deepseek',model:'deepseek-account/deepseek-flash',executable:process.execPath,options:{reasoning_effort:'high',cli:fakeCli,sandbox:'workspace-write'}});assert.equal((await readFile(join(workspace,'.specship','.env'),'utf8')).includes('DEEPSEEK_API_KEY='),true);
  const repeated=spawn(process.execPath,args,{stdio:['ignore','ignore','pipe']});let repeatErr='';repeated.stderr.on('data',x=>repeatErr+=x);assert.equal(await new Promise(resolve=>repeated.on('close',resolve)),0,repeatErr);
});

test('setup without a built local runtime fails before creating or replacing configuration',async t=>{
  const workspace=await temp(t,'specship-no-runtime-');await mkdir(join(workspace,'.specship','runs','saved'),{recursive:true});const saved=join(workspace,'.specship','runs','saved','state.json');await writeFile(saved,'existing run bytes');
  const setup=await invokeSetup(cli,workspace);assert.notEqual(setup.code,0);assert.match(setup.err,/Install and build Specship in/);assert.equal(await readFile(saved,'utf8'),'existing run bytes');
  await assert.rejects(readFile(join(workspace,'.specship','config.json')),{code:'ENOENT'});await assert.rejects(readFile(join(workspace,'.specship','.env')),{code:'ENOENT'});
});

test('production callback bridge waits without an assignment deadline and rejects an expired finite deadline',async t=>{
  let transport,server;t.after(async()=>{await transport?.close();server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));});
  const workspace=await temp(t,'specship-bridge-unlimited-');const descriptor=join(workspace,'callback.json');
  let received;const requestReceived=new Promise(resolve=>{received=resolve;});let requests=0;
  server=createServer(async(req,res)=>{for await(const _chunk of req){}requests++;received(res);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const value={url:`http://127.0.0.1:${server.address().port}`,capability:'fixture',deadline:null,delivery_margin_ms:120000,callback_timeout_ms:null};await writeFile(descriptor,JSON.stringify(value));
  transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../../dist/callback-cli.js',import.meta.url))],env:{SPECSHIP_CALLBACK_DESCRIPTOR:descriptor}});const client=new Client({name:'unlimited-bridge-test',version:'1'});await client.connect(transport);
  const args={request_id:'long-question',blocker:'Need a decision',decision:'Choose one',evidence:[],attempts:[]};let completed=false;
  const waiting=client.callTool({name:'ask_spec',arguments:args},undefined,{timeout:5000}).then(result=>{completed=true;return result;});
  const response=await Promise.race([requestReceived,waiting.then(()=>{throw Error('Callback returned before the runner answered');})]);
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(completed,false);assert.equal(requests,1);
  response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({text:'Approved direction',images:[]}));const result=await waiting;assert.equal(result.content[0].text,'Approved direction');
  await writeFile(descriptor,JSON.stringify({...value,deadline:Date.now()-1000,delivery_margin_ms:0,callback_timeout_ms:100}));
  const expired=await client.callTool({name:'ask_spec',arguments:{...args,request_id:'expired'}});assert.equal(expired.isError,true);assert.match(expired.content[0].text,/deadline has expired/);assert.equal(requests,1);
});

test('production callback bridge can expose only report_result when a harness caps a tool call',async t=>{
  const workspace=await temp(t,'specship-report-only-');const descriptor=join(workspace,'callback.json');await writeFile(descriptor,JSON.stringify({url:'http://127.0.0.1:1',capability:'fixture',deadline:null,delivery_margin_ms:120000,callback_timeout_ms:null}));
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../../dist/callback-cli.js',import.meta.url))],env:{SPECSHIP_CALLBACK_DESCRIPTOR:descriptor,SPECSHIP_CALLBACK_REPORT_ONLY:'1'}});
  const client=new Client({name:'report-only-test',version:'1'});await client.connect(transport);t.after(()=>transport.close());
  const tools=await client.listTools();assert.deepEqual(tools.tools.map(tool=>tool.name),['report_result']);
});

test('Interrupt command validates native identity and safely no-ops without an active descriptor',async t=>{
  const workspace=await temp(t,'specship-hook-');await mkdir(join(workspace,'.specship'),{recursive:true});let payload;
  const server=(await import('node:http')).createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;payload=JSON.parse(raw);res.writeHead(202).end('{}');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await writeFile(join(workspace,'.specship','active-run.json'),JSON.stringify({run_id:'run',session_id:'thread',turn_id:'turn',url:`http://127.0.0.1:${port}`,capability:'secret'}));
  const invoke=event=>new Promise(resolve=>{const p=spawn(process.execPath,[cli,'interrupt','--workspace',workspace],{stdio:['pipe','ignore','ignore']});p.stdin.end(JSON.stringify({hook_event_name:'Interrupt',...event}));p.on('close',resolve);});
  assert.equal(await invoke({session_id:'thread',turn_id:'old'}),1);assert.equal(await invoke({session_id:'thread',turn_id:'turn'}),0);assert.deepEqual(payload,{session_id:'thread',turn_id:'turn'});await server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));
  await import('node:fs/promises').then(fs=>fs.unlink(join(workspace,'.specship','active-run.json')));assert.equal(await invoke({session_id:'other',turn_id:'other'}),0);
});

test('production MCP stdio registers six tools and routes exact caller/handle through blocking dispatch and Interrupt',async t=>{
  let transport;t.after(async()=>{await transport?.close();});
  const workspace=await temp(t,'specship-mcp-');transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./mcp-server.mjs',import.meta.url)),workspace]});const client=new Client({name:'runtime-test',version:'1'});await client.connect(transport);
  const tools=await client.listTools();assert.deepEqual(tools.tools.map(x=>x.name).sort(),['specship_accept','specship_control','specship_dispatch','specship_inspect','specship_reply','specship_wait']);
  for(const name of ['specship_dispatch','specship_reply']){
    const schema=tools.tools.find(tool=>tool.name===name).inputSchema.properties.brief;
    assert.equal(schema.type,'object');
    assert.equal(schema.properties.verified_context.items.type,'string');
    assert.equal(schema.properties.acceptance.minItems,1);
  }
  const malformed=await client.callTool({name:'specship_dispatch',arguments:{workspace,operation_id:'bad-brief',kind:'implement',brief:{...brief,verified_context:[{reference:'file:1',finding:'test'}]}}});
  assert.equal(malformed.isError,true);assert.match(malformed.content[0].text,/verified_context/);
  assert.deepEqual(await new Store(workspace).listRuns(0,20),[],'invalid schema must not create orphan runs');
  const unsupported=await client.callTool({name:'specship_dispatch',arguments:{workspace,operation_id:'missing-native-caller',kind:'implement',brief}});assert.equal(unsupported.isError,true);assert.match(unsupported.content[0].text,/native thread\/turn metadata/);
  const meta={threadId:'codex-thread', 'x-codex-turn-metadata':JSON.stringify({turn_id:'codex-turn'})};
  const first=await client.callTool({name:'specship_dispatch',arguments:{workspace,operation_id:'mcp-op',kind:'implement',brief},_meta:meta});const event=JSON.parse(first.content[0].text);assert.equal(event.kind,'decision_required');assert.ok(event.supervisor_handle);
  const wrong=await client.callTool({name:'specship_wait',arguments:{run_id:event.run_id,supervisor_handle:event.supervisor_handle},_meta:{threadId:'other-chat'}});assert.equal(wrong.isError,true);
  const pending=client.callTool({name:'specship_wait',arguments:{run_id:event.run_id,supervisor_handle:event.supervisor_handle,last_event_id:event.event_id},_meta:meta});await new Promise(resolve=>setTimeout(resolve,30));
  const hook=spawn(process.execPath,[cli,'interrupt','--workspace',workspace],{stdio:['pipe','ignore','pipe']});hook.stdin.end(JSON.stringify({hook_event_name:'Interrupt',session_id:'codex-thread',turn_id:'codex-turn'}));assert.equal(await new Promise(resolve=>hook.on('close',resolve)),0);
  const paused=JSON.parse((await pending).content[0].text);assert.equal(paused.kind,'paused');assert.equal(paused.payload.stop_confirmed,true);
});

test('production MCP rejects native grants even with a model-supplied human approval assertion',async t=>{
  let transport;t.after(async()=>{await transport?.close();});
  const workspace=await temp(t,'specship-mcp-permission-');transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./mcp-server.mjs',import.meta.url)),workspace]});const client=new Client({name:'permission-test',version:'1'});await client.connect(transport);
  const meta={threadId:'permission-thread','x-codex-turn-metadata':JSON.stringify({turn_id:'permission-turn'})};
  const dispatched=await client.callTool({name:'specship_dispatch',arguments:{workspace,operation_id:'permission',kind:'implement',brief},_meta:meta});
  const permission=JSON.parse(dispatched.content[0].text);assert.equal(permission.kind,'user_input_required');
  for(const answer of ['once','always']){
    const result=await client.callTool({name:'specship_reply',arguments:{run_id:permission.run_id,request_id:'native-permission',operation_id:`grant-${answer}`,answer,expected_brief_version:permission.brief_version,supervisor_handle:permission.supervisor_handle,human_approved:true},_meta:meta});
    assert.equal(result.isError,true);assert.match(result.content[0].text,/permission grants are disabled/);
  }
  const cancelled=await client.callTool({name:'specship_control',arguments:{run_id:permission.run_id,operation_id:'cancel-permission',action:'cancel',reason:'test complete',supervisor_handle:permission.supervisor_handle},_meta:meta});
  assert.equal(JSON.parse(cancelled.content[0].text).kind,'cancelled');
});
