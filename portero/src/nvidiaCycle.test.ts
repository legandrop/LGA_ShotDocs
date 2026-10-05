import { describe, expect, it, vi } from 'vitest';
import { handleNvidia, NvidiaDenied } from './assistantNvidia';
import type { Env } from './core';
import { nvidiaEvents, nvidiaFrame } from '../../src/assistant/nvidiaProtocol';

const env={SUPABASE_URL:'https://isla.example',SUPABASE_PUBLISHABLE_KEY:'publicable',APP_ORIGINS:'https://app.example'} as Env;
const page='00112233-4455-6677-8899-aabbccddeeff';
const request=(models=false)=>new Request(`https://portero.example/assistant/nvidia/${models?'models':'chat/completions'}`,{method:models?'GET':'POST',headers:{Origin:'https://app.example',Authorization:'Bearer sesion','x-shotdocs-nvidia-key':'nvapi-senuelo','Content-Type':'application/json'},...(models?{}:{body:JSON.stringify({pageId:page,model:'qwen/qwen3.5-122b-a10b',system:'reglas',user:'texto',maxTokens:1})})});
const json=(value:unknown)=>new Response(JSON.stringify(value));
const who={auth:'Bearer sesion',role:'member'};
const afterTurn=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function frames(res:Response){const result=[];for await(const f of nvidiaEvents(res.body))result.push(nvidiaFrame(f.event,f.data));return result;}
describe('dueño del ciclo temprano NVIDIA',()=>{
  it.each([false,true])('ready sin iniciar auth; cancelar preauth no avanza después del await tardío models=%s',async(models)=>{
    let resolveWho!:(value:typeof who)=>void,signal!:AbortSignal;
    let entered!:()=>void;const called=new Promise<void>(resolve=>{entered=resolve;});
    const auth=vi.fn((s:AbortSignal)=>{signal=s;entered();return new Promise<typeof who>(resolve=>{resolveWho=resolve;});});
    const http=vi.fn(async()=>json([]));
    const res=await handleNvidia(request(models),env,http,auth);expect(res.status).toBe(200);expect(auth).not.toHaveBeenCalled();
    const reader=res.body!.getReader();const first=await reader.read();expect(new TextDecoder().decode(first.value)).toContain('sd.ready');
    const next=reader.read();await called;await reader.cancel();expect(signal.aborted).toBe(true);
    resolveWho(who);await next;await afterTurn();expect(http).not.toHaveBeenCalled();reader.releaseLock();
  });
  it.each(['policy','page'])('cortar %s aborta la espera y una respuesta tardía no habilita vendor',async(phase)=>{
    let entered!:()=>void,release!:(res:Response)=>void,pendingSignal!:AbortSignal;
    const called=new Promise<void>(resolve=>{entered=resolve;});
    const http=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);if(url.includes(phase==='policy'?'workspace_settings?':'pages?')){pendingSignal=init!.signal!;entered();return await new Promise<Response>(resolve=>{release=resolve;});}
      return json([{assistant_policy:'on'}]);
    });
    const res=await handleNvidia(request(),env,http,async()=>who);const reader=res.body!.getReader();await reader.read();const pending=reader.read();await called;
    await reader.cancel();expect(pendingSignal.aborted).toBe(true);release(json(phase==='policy'?[{assistant_policy:'on'}]:[{id:page}]));
    await pending;await afterTurn();expect(http.mock.calls.some(([u])=>String(u).includes('integrate.api.nvidia.com'))).toBe(false);reader.releaseLock();
  });
  it('auth indisponible no se convierte en sesión expirada',async()=>{
    const http=vi.fn(async()=>json([]));
    const result=await frames(await handleNvidia(request(),env,http,async()=>{throw new NvidiaDenied(502,'workspace_unavailable');}));
    expect(result.at(-1)).toEqual({event:'sd.error',value:{status:502,code:'workspace_unavailable',retryAfter:null}});expect(http).not.toHaveBeenCalled();
  });
  it.each(['red','json'])('policy %s indisponible conserva el error de workspace',async(mode)=>{
    const http=vi.fn(async()=>{if(mode==='red')throw new Error('red de prueba');return new Response('no-json');});
    const result=await frames(await handleNvidia(request(),env,http,async()=>who));
    expect(result.at(-1)).toEqual({event:'sd.error',value:{status:502,code:'workspace_unavailable',retryAfter:null}});
  });
  it.each([
    'data: {"choices":[{"delta":{"content":"parte"},"finish_reason":"stop"}]}\n\n',
    'data: {"choices":[{"delta":{"content":"parte"}}]}\n\ndata: [DONE]\n\n',
    'data: {"choices":[{"delta":{"content":"parte"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":"extra"}}]}\n\n',
  ])('finish/DONE/EOF son necesarios y no admiten contenido posterior',async(stream)=>{
    const http=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('workspace_settings?')?json([{assistant_policy:'on'}]):String(input).includes('pages?')?json([{id:page}]):new Response(stream,{headers:{'Content-Type':'text/event-stream'}}));
    const result=await frames(await handleNvidia(request(),env,http,async()=>who));
    expect(result.some(f=>f.event==='sd.done')).toBe(false);expect(result.at(-1)).toMatchObject({event:'sd.error',value:{code:'nvidia_stream'}});
  });
});
