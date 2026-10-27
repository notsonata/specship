import { Store } from '../../dist/state.js';
import { Runner } from '../../dist/runner.js';
import { serveSpec } from '../../dist/mcp.js';

const workspace=process.argv[2];
const config={ship:{default_profile:'fake',profiles:{fake:{harness:'opencode',model:'fake/model',options:{}}}},limits:{max_dispatch_seconds:60,delivery_margin_seconds:5}};
class Fake {
  name='independent-fake';
  async validate(){}
  async start(_workspace,_profile,_kind,callback){this.callback=callback;return {session:'native-fake-session',version:'fake-1'};}
  async subscribe(){}
  async submit(_session,operation){if(operation==='report'){
    const report={status:'ready_for_review',changes:['x'.repeat(2_000)],acceptance_evidence:['A1 observed'],acceptance_results:[{criterion_id:'A1',evidence:'A1 observed'}],validation:['independent test passed'],deviations:[],remaining_issues:['review this limitation']};
    const response=await fetch(`${this.callback.url}/report_result`,{method:'POST',headers:{authorization:`Bearer ${this.callback.capability}`,'content-type':'application/json'},body:JSON.stringify(report)});
    if(!response.ok)throw new Error(await response.text());this.reported=true;this.wake?.();
  }else if(operation==='permission'){this.permission={id:'native-permission',permission:'bash',patterns:['node --test']};this.wake?.();}else void fetch(`${this.callback.url}/ask_spec`,{method:'POST',headers:{authorization:`Bearer ${this.callback.capability}`,'content-type':'application/json'},body:JSON.stringify({request_id:`q-${operation}`,blocker:'Need a choice',evidence:[],attempts:[],decision:'Choose one'})});return {messageId:`m-${operation}`};}
  async *events(_session,signal){while(!signal.aborted){if(this.reported){yield {type:'idle'};return;}if(this.permission){const data=this.permission;this.permission=undefined;yield {type:'permission',data};continue;}await new Promise(resolve=>{this.wake=resolve;signal.addEventListener('abort',resolve,{once:true});});}}
  async reconcile(){return this.reported?'complete':'active';}
  async abort(){return true;}
  async reply(){}
}
const store=new Store(workspace);await store.initialize();const runner=new Runner(store,config,new Fake());
process.stdin.on('end',()=>{void runner.close();});
await serveSpec(runner,store);
