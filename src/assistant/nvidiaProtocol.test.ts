import { describe, expect, it } from 'vitest';
import { complete, listModels } from './providers';
import { nvidiaFrame, type NvidiaFrame, encodeNvidiaFrame } from './nvidiaProtocol';
import type { NvidiaContext } from './nvidiaTransport';
import { NvidiaControl } from './nvidiaControl';

const config={provider:'nvidia' as const,model:'qwen/qwen3.5-122b-a10b'};
const context:NvidiaContext={pageId:'00112233-4455-6677-8899-aabbccddeeff',check(){},control:new NvidiaControl(new AbortController().signal,async()=>({base:'https://workspace.example',token:'sesion'}),()=>{},'chat'),close:async()=>{},prepare:async()=>({base:'https://workspace.example',token:'sesion',handle:{v:1,id:'a'.repeat(64),capability:'c'.repeat(43),prepareExpiresAt:30000,retentionExpiresAt:600000}})};
const request={system:'reglas',user:'texto',maxTokens:1};
const ready=(kind:'chat'|'models'):NvidiaFrame=>({event:'sd.ready',value:{v:1,kind}});
const done:NvidiaFrame={event:'sd.done',value:{cut:false,usage:{input:null,output:null}}};
const delta:NvidiaFrame={event:'sd.delta',value:{text:'parte á 🎥'}};
const models:NvidiaFrame={event:'sd.models',value:{data:[{id:config.model}]}};
const response=(body:BodyInit|ReadableStream<Uint8Array>)=>new Response(body,{headers:{'Content-Type':'text/event-stream','X-Shotdocs-Nvidia-Protocol':'1'}});
const bytes=(frames:NvidiaFrame[])=>frames.map(f=>new TextDecoder().decode(encodeNvidiaFrame(f))).join('');
const run=(body:BodyInit|ReadableStream<Uint8Array>)=>complete(config,'clave-senuelo',request,{nvidia:context,fetcher:async()=>response(body)});
describe('integridad del canal propio NVIDIA',()=>{
  it.each([
    [ready('chat'),delta], [ready('chat'),delta,done,done], [ready('chat'),delta,done,delta],
    [delta,done], [ready('models'),delta,done], [ready('chat'),ready('chat'),delta,done],
  ])('un canal incompleto o contradictorio no es aplicable: %j',async(...frames)=>{
    expect((await run(bytes(frames as NvidiaFrame[]))).cut).toBe(true);
  });
  it('ni done antes de EOF ni error de lectura posterior dan éxito',async()=>{
    let controller!:ReadableStreamDefaultController<Uint8Array>;
    const body=new ReadableStream<Uint8Array>({start(c){controller=c;c.enqueue(new TextEncoder().encode(bytes([ready('chat'),delta,done])));}});
    let settled=false;const pending=run(body).then(value=>{settled=true;return value;});
    await new Promise<void>(resolve=>queueMicrotask(()=>queueMicrotask(resolve)));
    expect(settled).toBe(false);controller.error(new Error('corte posterior al terminal'));
    expect(await pending).toMatchObject({cut:true});
  });
  it('UTF8 cortado, evento desconocido o frame final sin delimitador impiden Apply',async()=>{
    for(const suffix of ['event: otro\ndata: {}\n\n','event: sd.done\ndata: {"cut":false,"usage":{"input":null,"output":null}}']) {
      expect((await run(bytes([ready('chat'),delta])+suffix)).cut).toBe(true);
    }
    const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode(bytes([ready('chat'),delta])));c.enqueue(new Uint8Array([0xc3]));c.close();}});
    expect((await run(body)).cut).toBe(true);
  });
  it('catálogo sólo se compromete después de terminal y EOF; O1 admite un único objeto',async()=>{
    let controller!:ReadableStreamDefaultController<Uint8Array>;
    const body=new ReadableStream<Uint8Array>({start(c){controller=c;c.enqueue(new TextEncoder().encode(bytes([ready('models'),models,done])));}});
    let settled=false;const pending=listModels(config,'senuelo',async()=>response(body),undefined,context).then(value=>{settled=true;return value;});
    await new Promise<void>(resolve=>queueMicrotask(()=>queueMicrotask(resolve)));
    expect(settled).toBe(false);controller.close();expect(await pending).toEqual([{id:config.model,name:config.model}]);
    for(const usage of [null,{input:0,output:null},{input:null},{input:null,output:null,extra:1}]) {
      const invalid=bytes([ready('models'),models])+`event: sd.done\ndata: ${JSON.stringify({cut:false,usage})}\n\n`;
      await expect(listModels(config,'senuelo',async()=>response(invalid),undefined,context)).rejects.toMatchObject({kind:'server'});
    }
  });
  it('el status y RetryAfter propios no dependen de res.ok ni reflejan cuerpos',async()=>{
    const error:NvidiaFrame={event:'sd.error',value:{status:429,code:'nvidia_rate_limit',retryAfter:8}};
    await expect(run(bytes([ready('chat'),error]))).rejects.toMatchObject({kind:'rateLimit',retryAfter:8,status:429});
    await expect(run(bytes([ready('chat'),{event:'sd.error',value:{status:401,code:'workspace_session',retryAfter:null}}]))).rejects.toMatchObject({kind:'workspace',message:'workspace_session'});
    expect(()=>nvidiaFrame('sd.error',JSON.stringify({status:401,code:'nvidia_rate_limit',retryAfter:8}))).toThrow();
    expect(()=>nvidiaFrame('sd.error',JSON.stringify({status:502,code:'nvidia_unavailable',retryAfter:8}))).toThrow();
  });
  it('Stop invalida el terminal pendiente y cancela la lectura; contexto tardío no produce onText',async()=>{
    const controller=new AbortController();let cancelled=0;
    const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(encodeNvidiaFrame(ready('chat')));},cancel(){cancelled++;}});
    let entered!:()=>void;const called=new Promise<void>(resolve=>{entered=resolve;});
    const pending=complete(config,'senuelo',request,{nvidia:context,signal:controller.signal,fetcher:async()=>{entered();return response(body);}});
    await called;await new Promise<void>(resolve=>setImmediate(resolve));
    controller.abort();await expect(pending).rejects.toMatchObject({kind:'aborted'});expect(cancelled).toBe(1);
    let checks=0,updates=0;
    await expect(complete(config,'senuelo',request,{nvidia:{...context,check(){if(++checks>3)throw new Error('isla cambiada');}},onText(){updates++;},fetcher:async()=>response(bytes([ready('chat'),delta,done]))})).rejects.toThrow('isla cambiada');
    expect(updates).toBe(0);
  });
});
