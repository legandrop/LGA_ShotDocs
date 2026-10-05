import { describe, expect, it, vi } from 'vitest';
import { Portero, type Env, type Store } from './core';
import { nvidiaEvents, nvidiaFrame } from '../../src/assistant/nvidiaProtocol';
import { handleNvidia } from './assistantNvidia';

const PAGE = '00112233-4455-6677-8899-aabbccddeeff';
const SESSION = 'sesion-del-workspace-no-es-nvidia';
const KEY = 'nvapi-SENUELO-NVIDIA-solo-prueba';
const QWEN = 'qwen/qwen3.5-122b-a10b';
const LLAMA = 'meta/llama-3.3-70b-instruct';
const ORIGIN = 'https://shotdocs.example';
const env = { SUPABASE_URL: 'https://isla.example', SUPABASE_PUBLISHABLE_KEY: 'publicable-isla', APP_ORIGINS: ORIGIN } as Env;
const encoded = new TextEncoder();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function harness(opts: { role?: string | null; policy?: unknown; pages?: unknown; status?: number; retry?: string; stream?: ReadableStream<Uint8Array>; models?: unknown } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const store = { get: vi.fn(), put: vi.fn(), delete: vi.fn() } as Store;
  const upstream = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/rpc/media_whoami')) return json({ user_id: 'user-propio', is_owner: false, role: opts.role === undefined ? 'member' : opts.role });
    if (url.includes('/workspace_settings?')) return json(opts.policy === undefined ? [{ assistant_policy: 'on' }] : opts.policy);
    if (url.includes('/pages?')) return json(opts.pages === undefined ? [{ id: PAGE }] : opts.pages);
    if (url.endsWith('/models')) return json(opts.models ?? { data: [{ id: QWEN }, { id: LLAMA }, { id: 'desconocido/vision' }] }, opts.status ?? 200);
    return new Response(opts.stream ?? encoded.encode('data: {"choices":[{"delta":{"content":"hola"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'), {
      status: opts.status ?? 200, headers: { 'Content-Type': 'text/event-stream', ...(opts.retry ? { 'Retry-After': opts.retry } : {}) },
    });
  });
  // Regresión del helper después de un control admitido. El DO real se verifica en la receta nativa.
  const namespace = { newUniqueId: () => ({ toString: () => 'a'.repeat(64) }), idFromString: () => ({ toString: () => 'a'.repeat(64) }), get: () => ({ fetch: async (request: Request) => handleNvidia(request, env, upstream, (signal) => portero.authenticateNvidia(request, signal)) }) };
  const portero = new Portero({ ...env, NVIDIA_REQUESTS: namespace }, store, upstream);
  return { portero, calls, store, upstream };
}
function req(body: unknown = {}, options: { path?: string; method?: string; headers?: Record<string,string>; signal?: AbortSignal; raw?: BodyInit } = {}) {
  return new Request(`https://gateway.example${options.path ?? '/assistant/nvidia/chat/completions'}`, {
    method: options.method ?? 'POST', headers: { Origin: ORIGIN, Authorization: `Bearer ${SESSION}`, 'x-shotdocs-nvidia-key': KEY, 'x-shotdocs-nvidia-control': '1', 'x-shotdocs-nvidia-owner': 'a'.repeat(64), 'x-shotdocs-nvidia-capability': 'c'.repeat(43), 'Content-Type': 'application/json', ...options.headers },
    body: options.method === 'GET' || options.method === 'OPTIONS' ? undefined : options.raw ?? JSON.stringify({ pageId: PAGE, model: QWEN, system: 'Reglas', user: 'Lo elegido', maxTokens: 16000, ...body as object }), signal: options.signal,
  });
}
const inferCalls = (h: ReturnType<typeof harness>) => h.calls.filter((c) => c.url.startsWith('https://integrate.api.nvidia.com/'));
async function outcome(res: Response) {
  if (res.headers.get('X-Shotdocs-Nvidia-Protocol') !== '1') return { status: res.status, text: await res.text(), retryAfter: null as number | null };
  const frames = [];
  for await (const frame of nvidiaEvents(res.body, {eventLimit:1024*1024})) frames.push(nvidiaFrame(frame.event, frame.data));
  const error = frames.find((f) => f.event === 'sd.error');
  return { status: error?.event === 'sd.error' ? error.value.status : 200, text: JSON.stringify(frames), retryAfter: error?.event === 'sd.error' ? error.value.retryAfter : null };
}
const statusOf = async (res: Response) => (await outcome(res)).status;
describe('NVIDIA por la isla del workspace', () => {
  it('T27: el catálogo real del portero filtra desconocidos y conserva los cuatro IDs', async () => {
    const ids = [QWEN, LLAMA, 'moonshotai/kimi-k3', 'z-ai/glm-5.3'];
    const h = harness({models:{data:[...ids,'desconocido'].map(id=>({id}))}});
    const result = await outcome(await h.portero.handle(req({}, {path:'/assistant/nvidia/models',method:'GET'})));
    expect(JSON.parse(result.text).find((f:{event:string})=>f.event==='sd.models').value.data).toEqual(ids.map(id=>({id})));
    expect(h.calls.some(c=>c.url.endsWith('/chat/completions'))).toBe(false);
  });

  it.each(['moonshotai/kimi-k3', 'z-ai/glm-5.3'])('T27: %s usa sólo texto16000 y rechaza excesos/fotos antes del vendor', async model => {
    const h = harness();
    await (await h.portero.handle(req({model,maxTokens:16000}))).text();
    expect(JSON.parse(inferCalls(h)[0].init.body as string)).toEqual({model,messages:[{role:'system',content:'Reglas'},{role:'user',content:'Lo elegido'}],max_tokens:16000,stream:true});
    for (const body of [{maxTokens:16001},{maxTokens:16000,image:{mime:'image/jpeg',data:'/9j/'}}]) {
      const denied = harness();
      expect(await statusOf(await denied.portero.handle(req({model,...body})))).toBe(422);
      expect(inferCalls(denied)).toHaveLength(0);
    }
  });

  it.each(['auth','policy','page','models','chat'].flatMap((boundary) => [301,302,307,308].map((status) => ({boundary,status}))))('cierra y no sigue $boundary $status', async ({boundary,status}) => {
    const h=harness(); let cancelled=0;
    const original=h.upstream.getMockImplementation()!;
    h.upstream.mockImplementation(async (input,init) => {
      const u=String(input),target=boundary==='auth'?u.endsWith('/rpc/media_whoami'):boundary==='policy'?u.includes('/workspace_settings?'):boundary==='page'?u.includes('/pages?'):boundary==='models'?u.endsWith('/models'):u.endsWith('/chat/completions');
      if(!target)return original(input,init);
      expect(init?.redirect).toBe('manual');
      return new Response(new ReadableStream({cancel(){cancelled++;}}),{status,headers:{Location:'https://destino-no-admitido.example/'+KEY}});
    });
    const r=await h.portero.handle(req({},boundary==='models'?{path:'/assistant/nvidia/models',method:'GET'}:{}));
    const result=await outcome(r);expect(result.status).toBe(502);expect(cancelled).toBe(1);
    expect(result.text).not.toContain(KEY);expect(result.text).not.toContain('Location');expect(result.text).not.toContain('destino-no-admitido');
  });
  it('separa sesión/clave, usa RLS fresco, no cache ni Store y devuelve streaming', async () => {
    const h = harness(); const res = await h.portero.handle(req());
    expect(await res.text()).toContain('hola');
    expect(h.calls.map((c) => c.url)).toEqual(['https://isla.example/rest/v1/rpc/media_whoami','https://isla.example/rest/v1/workspace_settings?select=assistant_policy',`https://isla.example/rest/v1/pages?select=id&id=eq.${PAGE}&deleted_at=is.null`,'https://integrate.api.nvidia.com/v1/chat/completions']);
    for (const call of h.calls.slice(0, 3)) { expect(new Headers(call.init.headers).get('Authorization')).toBe(`Bearer ${SESSION}`); expect(JSON.stringify(call.init)).not.toContain(KEY); }
    const last = inferCalls(h)[0]; expect(new Headers(last.init.headers).get('Authorization')).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(last.init)).not.toContain(SESSION); expect(last.init.redirect).toBe('manual'); expect(last.init.cache).toBe('no-store');
    expect(JSON.parse(last.init.body as string)).toEqual({ model: QWEN, messages: [{ role:'system',content:'Reglas' },{ role:'user',content:'Lo elegido' }], max_tokens:16000,stream:true,chat_template_kwargs:{enable_thinking:false} });
    expect(h.store.put).not.toHaveBeenCalled(); expect(h.store.get).not.toHaveBeenCalled(); expect(h.store.delete).not.toHaveBeenCalled();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
  it.each([null, 'removed', 'password'])('role %s no usa inferencia', async (role) => {
    const h = harness({role}); expect(await statusOf(await h.portero.handle(req()))).toBe(403); expect(inferCalls(h)).toHaveLength(0);
  });
  it.each([[],null,[{assistant_policy:'off'}],[{assistant_policy:'local_only'}],[{}],[{assistant_policy:'nuevo'}],[{assistant_policy:'on'},{assistant_policy:'on'}]].map(policy=>({policy})))('política desconocida/restringida falla cerrada: %j', async ({policy}) => {
    const h = harness({policy}); expect(await statusOf(await h.portero.handle(req()))).toBe(403); expect(inferCalls(h)).toHaveLength(0);
  });
  it.each([[], [{id:'otra-pagina'}], [{id:PAGE},{id:PAGE}]].map(pages=>({pages})))('RLS sin una página exacta falla: %j', async ({pages}) => {
    const h=harness({pages}); expect(await statusOf(await h.portero.handle(req()))).toBe(403); expect(inferCalls(h)).toHaveLength(0);
  });
  it('link y origen ajeno no consultan el proveedor ni la base', async () => {
    for (const headers of [{'x-shotdocs-link':'enlace'}, {Origin:'https://ajeno.example'}]) {
      const h=harness(); expect((await h.portero.handle(req({}, {headers}))).status).toBe(403); expect(h.calls).toHaveLength(0);
    }
  });
  it('catálogo filtra capacidades y no infiere', async () => {
    const h=harness(); const res=await h.portero.handle(req({}, {path:'/assistant/nvidia/models',method:'GET'}));
    const frames=[];for await(const f of nvidiaEvents(res.body))frames.push(nvidiaFrame(f.event,f.data));
    expect(frames).toContainEqual({event:'sd.models',value:{data:[{id:QWEN},{id:LLAMA}]}});
    expect(frames.at(-1)).toEqual({event:'sd.done',value:{cut:false,usage:{input:null,output:null}}});expect(h.calls.some((c)=>c.url.endsWith('/chat/completions'))).toBe(false);
  });
  it('Llama es texto4096 y Qwen admite JPEG inline', async () => {
    const h=harness(); let res=await h.portero.handle(req({model:LLAMA,maxTokens:4096})); await res.text();
    expect(JSON.parse(inferCalls(h)[0].init.body as string).chat_template_kwargs).toBeUndefined();
    res=await h.portero.handle(req({image:{mime:'image/jpeg',data:btoa('\xff\xd8\xff\xe0prueba')}})); await res.text();
    expect(JSON.parse(inferCalls(h)[1].init.body as string).messages[1].content[0].image_url.url).toContain('data:image/jpeg;base64,');
  });
  it.each([{model:'desconocido/vision'},{model:LLAMA,maxTokens:4097},{maxTokens:0},{maxTokens:1.5},{image:{mime:'image/png',data:'abcd'}},{image:{mime:'image/jpeg',data:'https://ajeno.example'}},{model:LLAMA,maxTokens:4096,image:{mime:'image/jpeg',data:'/9j/'}},{url:'https://ajeno.example'},{pageId:'otra'}])('body no admitido no llega a NVIDIA: %j', async (body) => {
    const h=harness(); expect(await statusOf(await h.portero.handle(req(body)))).toBeGreaterThanOrEqual(400); expect(inferCalls(h)).toHaveLength(0);
  });
  it.each([401,403,404,422,429,500,202,302])('status%d no genera éxito/retry ni refleja secretos', async (status) => {
    const h=harness({status,retry:'7'}); const res=await h.portero.handle(req()); expect(res.status).toBe(200);
    const result=await outcome(res); expect(result.status).toBe(status===202||status===302?502:status);
    expect(result.text).not.toContain(KEY); expect(inferCalls(h)).toHaveLength(1); expect(result.retryAfter).toBe(status===429?7:null);
  });
  it('body sin Content-Length y texto excesivo se rechazan sin recortarlos', async () => {
    for (const options of [{raw:'x'.repeat(2*1024*1024+1)}, {raw:JSON.stringify({pageId:PAGE,model:QWEN,system:'s',user:'x'.repeat(128*1024),maxTokens:1})}]) {
      const h=harness(); expect(await statusOf(await h.portero.handle(req({},options)))).toBe(413); expect(inferCalls(h)).toHaveLength(0);
    }
  });
  it('cancelar el consumidor aborta señal upstream y cancela lector', async () => {
    let cancelled=false;
    const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(encoded.encode('data: {"choices":[{"delta":{"content":"parte"}}]}\n\n'));},cancel(){cancelled=true;}});
    const h=harness({stream}); const res=await h.portero.handle(req()); const reader=res.body!.getReader();await reader.read();await reader.read(); const signal=inferCalls(h)[0].init.signal!;
    await reader.cancel(); expect(signal.aborted).toBe(true); expect(cancelled).toBe(true);
  });
  it('CORS agrega key solo en nueva ruta, y rutas vecinas/query no proxifican', async () => {
    const h=harness(); const pre=await h.portero.handle(req({}, {method:'OPTIONS'})); expect(pre.headers.get('Access-Control-Allow-Headers')).toContain('x-shotdocs-nvidia-key');
    const old=await h.portero.handle(req({}, {path:'/upload',method:'OPTIONS'})); expect(old.headers.get('Access-Control-Allow-Headers')).not.toContain('nvidia');
    for(const path of ['/assistant/nvidia/otro','/assistant/nvidia/models?url=https://ajeno.example']) expect((await h.portero.handle(req({}, {path,method:'GET'}))).status).toBe(404);
    expect(h.calls).toHaveLength(0);
  });
});
