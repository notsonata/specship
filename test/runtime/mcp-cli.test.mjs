import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { interruptCommand } from '../../dist/hooks.js';

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

test('CLI setup requires explicit values and emits portable timeout/hook registrations',async t=>{
  const workspace=await temp(t,'specship-setup-');const args=['--workspace',workspace,'--profile','chosen','--model','openai/gpt-6-luna','--executable',process.execPath,'--shell',process.execPath,'--max-dispatch-seconds','90','--delivery-margin-seconds','35'];
  const child=spawn(process.execPath,[cli,'setup',...args],{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);const code=await new Promise(resolve=>child.on('close',resolve));assert.equal(code,0,err);const result=JSON.parse(out);assert.match(result.codex_toml,/tool_timeout_sec = 125/);assert.match(result.codex_toml,/direct_only_tool_namespaces = \["mcp__specship"\]/);assert.equal(result.hooks_json.hooks.Interrupt[0].hooks[0].timeout,3);assert.equal(result.hooks_json.hooks.Interrupt[0].hooks[0].command,interruptCommand(process.execPath,cli,workspace));assert.match((await import('node:fs/promises')).readFile? await (await import('node:fs/promises')).readFile(join(workspace,'.specship','config.json'),'utf8'):'',/"max_dispatch_seconds": 90/);
  const invalid=spawn(process.execPath,[cli,'setup','--workspace',workspace],{stdio:'ignore'});assert.notEqual(await new Promise(resolve=>invalid.on('close',resolve)),0);
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
