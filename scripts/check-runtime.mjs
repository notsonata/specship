// Opt-in live production-runner check. Uses the selected harness's existing auth.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { quotePosix } from '../dist/hooks.js';

const [executable,model='openai/gpt-6-luna',variant='high',scenario='full']=process.argv.slice(2);
if(!['full','stop','permission','permission-bash'].includes(scenario))throw Error('Expected full, stop, permission, or permission-bash scenario');
if(!executable)throw Error('Usage: node scripts/check-runtime.mjs <opencode-executable> [provider/model] [variant]');
const output=resolve('.specship','compatibility',`${new Date().toISOString().replace(/[:.]/g,'-')}-runtime`);
const workspace=join(output,'workspace');await mkdir(join(workspace,'.specship'),{recursive:true});
const shipShell=process.platform==='win32'?(process.env.ComSpec??'C:/Windows/System32/cmd.exe'):undefined;
assert.equal(spawnSync('git',['init','--quiet',workspace]).status,0);
await writeFile(join(workspace,'.specship','config.json'),JSON.stringify({ship:{default_profile:'test',profiles:{test:{harness:'opencode',model,executable,options:{variant,...(shipShell?{shell:shipShell}:{})}}}},limits:{max_dispatch_seconds:240,delivery_margin_seconds:120}}));
await writeFile(join(workspace,'numbers.mjs'),scenario==='stop'?'export function uniqueSorted(values) { return [...new Set(values)].sort((a,b)=>a-b); }\n':'export function uniqueSorted(values) { throw Error("TODO"); }\n');
const tests=`import test from 'node:test';import assert from 'node:assert/strict';import {uniqueSorted} from './numbers.mjs';test('numeric sort, deduplication, no mutation',()=>{const a=[10,-1,2,10,0];assert.deepEqual(uniqueSorted(a),[-1,0,2,10]);assert.deepEqual(a,[10,-1,2,10,0]);assert.deepEqual(uniqueSorted([]),[]);});`;
await writeFile(join(workspace,'numbers.test.mjs'),tests);
const untouched=randomUUID();await writeFile(join(workspace,'user-notes.txt'),untouched);
if(scenario.startsWith('permission'))await writeFile(join(workspace,'opencode.json'),JSON.stringify({permission:{'*':'deny',[scenario==='permission'?'read':'bash']:'ask',specship_callbacks_ask_spec:'allow',specship_callbacks_report_result:'allow'}}));
const cli=fileURLToPath(new URL('../dist/cli.js',import.meta.url));
const validationCommand=process.platform==='win32'?`"${process.execPath}" --test numbers.test.mjs`:[process.execPath,'--test','numbers.test.mjs'].map(quotePosix).join(' ');
let transport,client;
async function connect(){transport=new StdioClientTransport({command:process.execPath,args:[cli,'serve',workspace],stderr:'pipe'});client=new Client({name:'specship-live-verifier',version:'1'});await client.connect(transport);transport.stderr?.on('data',()=>{});}
async function crashRunner(){const pid=transport.pid;assert.ok(pid);process.kill(pid,'SIGKILL');await new Promise(done=>setTimeout(done,500));await client.close().catch(()=>{});await connect();}
await connect();
const meta={threadId:`runtime-${randomUUID()}`,'x-codex-turn-metadata':JSON.stringify({turn_id:randomUUID()})};
const events=[];let active;
const call=async(name,args)=>{const result=await client.callTool({name,arguments:args,_meta:meta},undefined,{timeout:360000});if(result.isError)throw Error(result.content[0].text);const value=JSON.parse(result.content[0].text);events.push({tool:name,result:value});await writeFile(join(output,'events.json'),JSON.stringify(events,null,2));console.log(`${name}: ${value.kind??JSON.stringify(value)}`);return value;};
try{
  console.log(`Live production runner: ${model}/${variant}; evidence=${output}`);
  if(scenario.startsWith('permission')){
    const readScript="console.log(require('node:fs').readFileSync('user-notes.txt','utf8'))";
    const readCommand=process.platform==='win32'?`"${process.execPath}" -e "${readScript}"`:[process.execPath,'-e',readScript].map(quotePosix).join(' ');
    const instruction=scenario==='permission'?'Use the read tool to read user-notes.txt; do not run shell commands.':`Use the bash tool to run this exact read-only command in the workspace: ${readCommand}. Do not use the read tool.`;
    const permission=active=await call('specship_dispatch',{workspace,operation_id:'live-permission',kind:'implement',brief:{outcome:'Read the exact token from user-notes.txt and report it without edits',acceptance:['Report the exact token from the file'],boundaries:['Do not modify files'],decisions:[`${instruction} Allow the harness to request permission. After the read, report through report_result kind=implementation with the token in acceptance_evidence and ready_for_review status.`],verified_context:['user-notes.txt exists; its token is intentionally absent from this assignment'],validation:['Read the file after receiving native permission; report the actual token']}});
    assert.equal(permission.kind,'user_input_required');assert.ok(permission.payload.id);
    for(const answer of ['once','always'])await assert.rejects(call('specship_reply',{run_id:permission.run_id,supervisor_handle:permission.supervisor_handle,request_id:permission.payload.id,operation_id:`fixture-forbidden-${answer}`,answer,expected_brief_version:permission.brief_version}),/permission grants are disabled/);
    const stopped=await call('specship_control',{run_id:permission.run_id,supervisor_handle:permission.supervisor_handle,operation_id:'cancel-permission-fixture',action:'cancel',reason:'Verified native permission grants are blocked'});assert.equal(stopped.kind,'cancelled');active=undefined;
    assert.equal(await readFile(join(workspace,'user-notes.txt'),'utf8'),untouched);
    await writeFile(join(output,'summary.json'),JSON.stringify({passed:true,scenario,model,variant,workspace,native_permission:true,grants_blocked:true,permission_api:permission.payload.action?'v2':'v1'},null,2));
  }else{
  const brief={outcome:'Implement numeric uniqueSorted without mutating the input',acceptance:['Returns sorted unique numbers including negatives and empty inputs','Existing tests pass; user files are preserved'],boundaries:['Edit only numbers.mjs; preserve numbers.test.mjs and user-notes.txt'],decisions:['Before implementation call ask_spec exactly once with request_id=ordering to ask whether ordering is ascending or descending. Await its answer.'],verified_context:['numbers.mjs is a stub; numbers.test.mjs contains observable checks'],validation:['Run node --test numbers.test.mjs; report actual results using report_result kind=implementation']};
  brief.validation=[`Run this exact shell command: ${validationCommand}; report actual results using report_result kind=implementation`];
  if(scenario==='full'){
  const question=active=await call('specship_dispatch',{workspace,operation_id:'live-implement',kind:'implement',brief});
  assert.equal(question.kind,'decision_required');
  await crashRunner();
  const recoveredQuestion=await call('specship_wait',{run_id:question.run_id,supervisor_handle:question.supervisor_handle,recover:true});assert.equal(recoveredQuestion.event_id,question.event_id);
  const ready=active=await call('specship_reply',{run_id:question.run_id,supervisor_handle:question.supervisor_handle,request_id:question.payload.id,operation_id:'live-answer',expected_brief_version:question.brief_version,answer:'Use ascending numeric order, remove duplicates, and preserve the input array. Implement and validate now, then call report_result with kind=implementation and finish.'});
  assert.equal(ready.kind,'implementation_ready');
  const nativeBefore=JSON.parse(await readFile(join(workspace,'.specship','runs',ready.run_id,'state.json'),'utf8')).adapter.session;
  assert.equal(spawnSync(process.execPath,['--test','numbers.test.mjs'],{cwd:workspace,encoding:'utf8'}).status,0);
  const snapshot=JSON.parse(await readFile(join(workspace,'.specship','runs',ready.run_id,'adapter.json'),'utf8'));assert.equal(snapshot.workspace,workspace);assert.ok(snapshot.pid);
  process.kill(snapshot.pid,'SIGKILL');await crashRunner();
  const recoveredReport=await call('specship_wait',{run_id:ready.run_id,supervisor_handle:ready.supervisor_handle,recover:true});assert.equal(recoveredReport.report_id,ready.report_id);
  const correction=active=await call('specship_dispatch',{workspace,run_id:ready.run_id,supervisor_handle:ready.supervisor_handle,operation_id:'live-correction',kind:'correct',expected_brief_version:ready.brief_version,corrections:['Keep the verified behavior. Add one concise exported-function comment describing numeric deduplication and input preservation. Run existing tests, submit a fresh report_result kind=implementation and finish. Do not ask ordering again.']});
  assert.equal(correction.kind,'implementation_ready');
  const state=JSON.parse(await readFile(join(workspace,'.specship','runs',ready.run_id,'state.json'),'utf8'));
  assert.equal(state.adapter.session,nativeBefore);
  assert.equal(spawnSync(process.execPath,['--test','numbers.test.mjs'],{cwd:workspace,encoding:'utf8'}).status,0);
  assert.equal(await readFile(join(workspace,'numbers.test.mjs'),'utf8'),tests);assert.equal(await readFile(join(workspace,'user-notes.txt'),'utf8'),untouched);
  await call('specship_accept',{run_id:correction.run_id,supervisor_handle:correction.supervisor_handle,activity_id:correction.activity_id,report_id:correction.report_id,brief_version:correction.brief_version,evidence:'Independent node tests passed twice; tests and user-notes bytes preserved; same native session used for correction.'});active=undefined;
  const exploration=await call('specship_dispatch',{workspace,operation_id:'live-explore',kind:'explore',assignment:'Read numbers.mjs and numbers.test.mjs. Report the implementation behavior and test cases through report_result kind=exploration with findings including file references, checks_performed and uncertainties. Do not modify files or use shell.'});assert.equal(exploration.kind,'exploration_completed');
  }
  const wait=call('specship_dispatch',{workspace,operation_id:'live-stop',kind:'implement',brief:{...brief,decisions:['Immediately call ask_spec with request_id=stop-probe. Wait for its answer; do not modify anything.']}});
  active=await wait;assert.equal(active.kind,'decision_required');
  const stopped=call('specship_wait',{run_id:active.run_id,supervisor_handle:active.supervisor_handle,last_event_id:active.event_id});
  const hook=spawn(process.execPath,[cli,'interrupt','--workspace',workspace],{stdio:['pipe','ignore','pipe'],windowsHide:true});hook.stdin.end(JSON.stringify({hook_event_name:'Interrupt',session_id:meta.threadId,turn_id:JSON.parse(meta['x-codex-turn-metadata']).turn_id}));assert.equal(await new Promise(done=>hook.once('close',done)),0);
  const paused=await stopped;assert.equal(paused.kind,'paused');assert.equal(paused.payload.stop_confirmed,true);
  const pausedState=JSON.parse(await readFile(join(workspace,'.specship','runs',paused.run_id,'state.json'),'utf8'));assert.equal(pausedState.writer,false);
  const resumed=active=await call('specship_reply',{run_id:paused.run_id,supervisor_handle:paused.supervisor_handle,request_id:active.payload.id,operation_id:'after-stop-answer',expected_brief_version:paused.brief_version,answer:`Resume the authorized activity in this same session. Leave the current implementation intact. Run this exact shell command: ${validationCommand}. Submit report_result kind=implementation with actual evidence and finish.`});assert.equal(resumed.kind,'implementation_ready');
  assert.equal(spawnSync(process.execPath,['--test','numbers.test.mjs'],{cwd:workspace,encoding:'utf8'}).status,0);assert.equal(await readFile(join(workspace,'numbers.test.mjs'),'utf8'),tests);assert.equal(await readFile(join(workspace,'user-notes.txt'),'utf8'),untouched);
  await call('specship_accept',{run_id:resumed.run_id,supervisor_handle:resumed.supervisor_handle,activity_id:resumed.activity_id,report_id:resumed.report_id,brief_version:resumed.brief_version,evidence:'Confirmed native stop followed by an explicit decision continuation; same fixture tests already independently verified.'});active=undefined;
  await writeFile(join(output,'summary.json'),JSON.stringify({passed:true,scenario,model,variant,workspace,same_session_correction:scenario==='full',independent_tests:true,exploration:scenario==='full',interrupt_confirmed:true,reply_after_interrupt:true,pending_callback_crash_recovery:scenario==='full',native_server_restart_same_session:scenario==='full'},null,2));
  }
}finally{
  if(active)await call('specship_control',{run_id:active.run_id,supervisor_handle:active.supervisor_handle,operation_id:'cleanup-failure',action:'cancel',reason:'Live check cleanup'}).catch(()=>{});
  await client.close();await transport.close();
}
