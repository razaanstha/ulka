// JSON-lines subprocess for repeatable runtime evaluation. It only loads our synthetic
// fixtures in an isolated profile; callers cannot supply HTML, URLs, or code.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CdpObserver } from '../../apps/extension/src/agent/observer';
import { BrowserExecutor } from '../../apps/extension/src/agent/executor';
import { FreshnessValidator } from '../../apps/extension/src/agent/freshness';
import { buildActionSpace } from '../../apps/extension/src/agent/action-space';
import { modelPage } from '../../apps/extension/src/agent/model-context';
import type { AgentDecision, PageSnapshot } from '../../packages/protocol/src';
import { browserTask, taskFamilies, type BrowserTask, type TaskFamily } from './tasks';

const profile = await mkdtemp(join(tmpdir(), 'ulka-eval-'));
const child = Bun.spawn([process.env.BROWSER_BINARY || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdout: 'ignore', stderr: 'ignore' });
let ws: WebSocket | undefined;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let counter = 0;
try {
  let port = '';
  for (let i=0; i<100; i++) { try { port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]; break; } catch { await Bun.sleep(100); } }
  if (!port) throw new Error('Isolated Chrome failed to start');
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as { webSocketDebuggerUrl: string };
  ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolve,reject)=>{ws!.onopen=()=>resolve();ws!.onerror=()=>reject(new Error('Chrome connection failed'));});
  ws.onmessage = event => { const reply=JSON.parse(String(event.data)); const item=pending.get(reply.id); if(!item)return; clearTimeout(item.timer); pending.delete(reply.id); reply.error ? item.reject(new Error(reply.error.message)) : item.resolve(reply.result); };
  const command = (method: string, params: object={}, sessionId?: string) => new Promise<any>((resolve,reject)=>{
    const id=++counter;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},10000);
    pending.set(id,{resolve,reject,timer}); ws!.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
  let sessionId: string | undefined, targetId: string | undefined, task: BrowserTask | undefined;
  let observer: CdpObserver, executor: BrowserExecutor, snapshot: PageSnapshot, steps=0, terminal=false;
  const evaluate = async (expression: string) => {
    const result=await command('Runtime.evaluate',{expression,returnByValue:true},sessionId);
    if(result.exceptionDetails)throw new Error('Fixture evaluation failed');
    return result.result?.value;
  };
  const response = async () => ({ taskId: task!.id, goal: task!.goal, observation: modelPage(snapshot), actions: buildActionSpace(snapshot), steps,
    success: !!await evaluate(`Boolean(${task!.success})`), done: terminal });
  async function dispatch(request: Record<string, any>) {
    if (request.method === 'reset') {
      if (!taskFamilies.includes(request.family) || !Number.isSafeInteger(request.seed) || Math.abs(request.seed)>1000000) throw new Error('Invalid task family or seed');
      if (targetId) await command('Target.closeTarget',{targetId});
      ({targetId}=await command('Target.createTarget',{url:'about:blank'}));
      ({sessionId}=await command('Target.attachToTarget',{targetId,flatten:true}));
      const api={attach:async()=>{},detach:async()=>{},sendCommand:(_:unknown,method:string,params?:Record<string,unknown>)=>command(method,params,sessionId)};
      observer=new CdpObserver(api,{tabId:1}); executor=new BrowserExecutor(api,{tabId:1},new FreshnessValidator(api,{tabId:1}));
      task=browserTask(request.family as TaskFamily,request.seed); steps=0;terminal=false;
      await evaluate(`document.body.innerHTML=${JSON.stringify(task.html)};${task.setup}`);
      snapshot=await observer.observe();
      return response();
    }
    if(!task)throw new Error('Reset required');
    if(request.method==='observe'){snapshot=await observer.observe();return response();}
    if(request.method!=='step')throw new Error('Unknown method');
    if(terminal)throw new Error('Episode finished; reset required');
    steps++;
    if(steps>=12)terminal=true;
    const operation=request.operation;
    const allowed=['CLICK','TYPE_TEXT','SELECT','PRESS_ENTER','PRESS_ESCAPE','ARROW_DOWN','ARROW_UP','SCROLL_DOWN','SCROLL_UP','WAIT','DONE'];
    if(!allowed.includes(operation))throw new Error('Unsupported fixture operation');
    const space=buildActionSpace(snapshot);
    if(!space.operations[operation])throw new Error('Operation unavailable');
    const targets=space.targets[operation as AgentDecision['operation']];
    if(targets && (typeof request.target!=='string' || !targets[request.target]))throw new Error('Unobserved target');
    if(operation==='TYPE_TEXT' && (typeof request.text!=='string' || request.text.length>2000))throw new Error('Invalid field text');
    if(operation==='DONE') terminal=true;
    else if(operation==='WAIT') snapshot=await observer.waitForChange(snapshot,()=>false,10000);
    else {
      const decision: AgentDecision={operation,target:request.target,confidence:1,...(operation==='SELECT'?{option:request.target.split(':').at(-1)}:{})};
      await executor.execute(snapshot,decision,request.text);
      snapshot=await observer.waitForChange(snapshot,()=>false,3000);
    }
    return response();
  }
  let buffer='';
  const decoder=new TextDecoder();
  for await (const chunk of Bun.stdin.stream()) {
    buffer+=decoder.decode(chunk,{stream:true});
    let newline: number;
    while((newline=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
      if(!line.trim())continue;
      try { console.log(JSON.stringify({ok:true,result:await dispatch(JSON.parse(line))})); }
      catch(error){console.log(JSON.stringify({ok:false,error:error instanceof Error?error.message:'Environment error'}));}
    }
  }
} finally {
  for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Environment closed'));}
  ws?.close();child.kill();await child.exited;await rm(profile,{recursive:true,force:true});
}
