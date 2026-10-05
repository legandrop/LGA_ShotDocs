import { describe, expect, it, vi } from 'vitest';
import { complete, defaultModel, listModels } from './providers';
import { nvidiaRequest, type NvidiaContext } from './nvidiaTransport';
import { assistantTranscribes } from '../dictation/voiceSettings';
import { NvidiaControl } from './nvidiaControl';
const MODEL='qwen/qwen3.5-122b-a10b';
const KEY='nvapi-clave-senuelo-nunca-real';
// Este corpus comienza con un handle admitido; el ciclo prepare/Stop tiene sus pruebas propias.
const context: NvidiaContext={pageId:'00112233-4455-6677-8899-aabbccddeeff',check(){},control:new NvidiaControl(new AbortController().signal,async()=>({base:'https://portero-propio.example',token:'sesion-propia'}),()=>{},'chat'),close:async()=>{},prepare:async()=>({base:'https://portero-propio.example',token:'sesion-propia',handle:{v:1,id:'a'.repeat(64),capability:'c'.repeat(43),prepareExpiresAt:30000,retentionExpiresAt:600000}})};
const config={provider:'nvidia' as const,model:MODEL};
const request={system:'instrucciones',user:'lo elegido',maxTokens:16000};
const done='event: sd.done\ndata: {"cut":false,"usage":{"input":null,"output":null}}\n\n';
const sse=(text:string,kind='chat')=>new Response('event: sd.ready\ndata: '+JSON.stringify({v:1,kind})+'\n\n'+text,{headers:{'Content-Type':'text/event-stream','X-Shotdocs-Nvidia-Protocol':'1'}});
describe('NVIDIA en el adaptador y consumidores',()=>{
  it.each(['moonshotai/kimi-k3', 'z-ai/glm-5.3'])('T27: %s acota generación sin enviar imagen', async model => {
    const fetcher = vi.fn(async () => sse(done));
    await complete({provider:'nvidia',model}, KEY, {...request,maxTokens:16001}, {nvidia:context,fetcher});
    expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string,RequestInit])[1].body as string)).toMatchObject({model,maxTokens:16000,user:request.user});
    await expect(complete({provider:'nvidia',model}, KEY, {...request,image:{mime:'image/jpeg',data:'/9j/'}}, {nvidia:context,fetcher})).rejects.toMatchObject({kind:'model',message:'nvidia_no_vision'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('T27: catálogo admite los cuatro perfiles sin cambiar la preferencia automática', async () => {
    const ids = [MODEL, 'meta/llama-3.3-70b-instruct', 'moonshotai/kimi-k3', 'z-ai/glm-5.3'];
    const fetcher = vi.fn(async () => sse('event: sd.models\ndata: '+JSON.stringify({data:[...ids, 'desconocido'].map(id=>({id}))})+'\n\n'+done, 'models'));
    const models = await listModels(config, KEY, fetcher, undefined, context);
    expect(models.map(m=>m.id)).toEqual(ids);
    expect(defaultModel('nvidia', models)).toBe(MODEL);
    expect(defaultModel('nvidia', models.slice(1))).toBe(ids[1]);
    expect(defaultModel('nvidia', models.slice(2))).toBe('');
  });

  it('separa destino/credenciales y usa solamente el contenido final',async()=>{
    const fetcher=vi.fn(async()=>sse('event: sd.delta\ndata: {"text":"respuesta"}\n\n'+done+''));
    const result=await complete(config,KEY,request,{nvidia:context,fetcher}); expect(result).toMatchObject({text:'respuesta',cut:false});
    const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit]; expect(url).toBe('https://portero-propio.example/assistant/nvidia/chat/completions');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer sesion-propia'); expect(new Headers(init.headers).get('x-shotdocs-nvidia-key')).toBe(KEY); expect(init.redirect).toBe('error');
  });
  it('catálogo200 no prueba inferencia; preferencia solo perfiles admitidos',async()=>{
    const fetcher=vi.fn(async()=>sse('event: sd.models\ndata: '+JSON.stringify({data:[{id:'embedding'},{id:'meta/llama-3.3-70b-instruct'},{id:MODEL}]})+'\n\n'+done,'models'));
    const models=await listModels(config,KEY,fetcher,undefined,context); expect(models).toHaveLength(2); expect(defaultModel('nvidia',models)).toBe(MODEL);
    expect(defaultModel('nvidia',[{id:'modelo-nuevo',name:'nuevo'}])).toBe(''); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['event: sd.delta\ndata: {"text":"parte"}\n\n','event: sd.delta\ndata: {"text":"parte"}\n\nevent: sd.done\ndata: {"cut":true,"usage":{"input":null,"output":null}}\n\n'])('EOF/length nunca producen sugerencia aplicable',async(text)=>{
    expect(await complete(config,KEY,request,{nvidia:context,fetcher:async()=>sse(text)})).toMatchObject({text:'parte',cut:true});
  });
  it('Llama conserva input y acota salida4096, sin foto',async()=>{
    const fetcher=vi.fn(async()=>sse(done)); const llama={...config,model:'meta/llama-3.3-70b-instruct'};
    await complete(llama,KEY,request,{nvidia:context,fetcher}); const init=(fetcher.mock.calls[0] as unknown as [string,RequestInit])[1]; expect(JSON.parse(init.body as string)).toMatchObject({maxTokens:4096,user:request.user});
    await expect(complete(llama,KEY,{...request,image:{mime:'image/jpeg',data:'/9j/'}},{nvidia:context,fetcher})).rejects.toMatchObject({kind:'model'}); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('sin contexto, cambio de isla, o sesión rechazada no se atribuyen a la clave',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({code:'workspace_session'}),{status:401}));
    await expect(complete(config,KEY,request,{fetcher})).rejects.toMatchObject({kind:'workspace'}); expect(fetcher).not.toHaveBeenCalled();
    await expect(complete(config,KEY,request,{nvidia:context,fetcher})).rejects.toMatchObject({kind:'workspace'});
    await expect(nvidiaRequest({...context,check(){throw new Error('cambió isla');}},KEY,'models',undefined,undefined,fetcher)).rejects.toThrow('cambió isla'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('error upstream con clave reflejada queda limpio y429 no reintenta',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({code:'nvidia_rate_limit',error:{message:KEY}}),{status:429,headers:{'Retry-After':'8'}}));
    await expect(complete(config,KEY,request,{nvidia:context,fetcher})).rejects.toMatchObject({kind:'rateLimit',retryAfter:8}); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('NVIDIA no transcribe y el resto de Voice mantiene lista positiva',()=>{
    expect(assistantTranscribes(config)).toBe(false); expect(assistantTranscribes({provider:'anthropic'})).toBe(false);
    for(const provider of ['openai','gemini','compatible'] as const) expect(assistantTranscribes({provider})).toBe(true);
  });
});
