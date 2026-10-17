import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { request } from 'node:http';

const descriptorPath=process.env.SPECSHIP_CALLBACK_DESCRIPTOR;
if(!descriptorPath)throw new Error('Callback bridge must be launched with its configured run descriptor');
const descriptorFile:string=descriptorPath;
const server=new McpServer({name:'specship-callbacks',version:'1.0.0'});
async function post(path:string,body:unknown,signal?:AbortSignal){
  const descriptor=JSON.parse(await (await import('node:fs/promises')).readFile(descriptorFile,'utf8'));
  const endpoint=new URL(descriptor.url);
  if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||endpoint.pathname!=='/'||!endpoint.port||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||typeof descriptor.capability!=='string')throw new Error('Invalid authenticated callback endpoint');
  const timeout=Math.min(descriptor.deadline-Date.now()+descriptor.delivery_margin_ms,descriptor.callback_timeout_ms);
  if(!Number.isFinite(timeout)||timeout<=0)throw new Error('The activity deadline has expired; callback canceled without an answer');
  return await new Promise<any>((resolve,reject)=>{
    let settled=false;let size=0;const chunks:Buffer[]=[];
    const finish=(error?:Error,value?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(value);};
    const req=request({hostname:endpoint.hostname,port:Number(endpoint.port),path,method:'POST',headers:{authorization:`Bearer ${descriptor.capability}`,'content-type':'application/json'},setHost:true},res=>{
      res.on('data',chunk=>{size+=chunk.length;if(size>8_000_000){res.destroy(new Error('Callback response exceeds 8 MB'));return;}chunks.push(Buffer.from(chunk));});
      res.on('error',error=>finish(error));
      res.on('end',()=>{const text=Buffer.concat(chunks).toString();if((res.statusCode??500)<200||(res.statusCode??500)>=300){finish(new Error(text||`Callback failed (${res.statusCode})`));return;}try{finish(undefined,text?JSON.parse(text):{});}catch(error){finish(error as Error);}});
    });
    const timer=setTimeout(()=>req.destroy(new Error('Callback exceeded the remaining activity deadline')),timeout);
    const cancel=()=>req.destroy(new Error('Callback canceled by supervisor transport'));
    if(signal?.aborted){cancel();return;}signal?.addEventListener('abort',cancel,{once:true});
    req.on('error',error=>finish(error));req.end(JSON.stringify(body));
  });
}
server.registerTool('ask_spec',{description:'Persist a consequential blocker and wait for the original Spec supervisor answer.',inputSchema:{request_id:z.string().min(1),blocker:z.string().min(1),evidence:z.array(z.string()),attempts:z.array(z.string()),decision:z.string().min(1),image_artifact_ids:z.array(z.string()).optional()}},async(args,extra)=>{const answer=await post('/ask_spec',args,extra.signal);return {content:[{type:'text',text:answer.text},...(answer.images??[]).map((image:any)=>({type:'image' as const,data:image.data,mimeType:image.mime}))]};});
server.registerTool('report_result',{description:'Submit a structured exploration result or final implementation report.',inputSchema:{kind:z.enum(['exploration','implementation']),status:z.enum(['ready_for_review','needs_decision','unable_to_continue']).optional(),changes:z.array(z.string()).optional(),acceptance_evidence:z.array(z.string()).optional(),validation:z.array(z.string()).optional(),deviations:z.array(z.string()).optional(),remaining_issues:z.array(z.string()).optional(),findings:z.array(z.string()).optional(),checks_performed:z.array(z.string()).optional(),uncertainties:z.array(z.string()).optional(),artifacts:z.array(z.unknown()).optional()}},async(args,extra)=>({content:[{type:'text',text:JSON.stringify(await post('/report_result',args,extra.signal))}]}));
await server.connect(new StdioServerTransport());
