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
  async submit(_session,operation){void fetch(`${this.callback.url}/ask_spec`,{method:'POST',headers:{authorization:`Bearer ${this.callback.capability}`,'content-type':'application/json'},body:JSON.stringify({request_id:`q-${operation}`,blocker:'Need a choice',evidence:[],attempts:[],decision:'Choose one'})});return {messageId:`m-${operation}`};}
  async *events(_session,signal){while(!signal.aborted)await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}
  async reconcile(){return 'active';}
  async abort(){return true;}
  async reply(){}
}
const store=new Store(workspace);await store.initialize();const runner=new Runner(store,config,new Fake());
process.stdin.on('end',()=>{void runner.close();});
await serveSpec(runner,store);
