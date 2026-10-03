import { describe, expect, it } from 'vitest';
import { complete, defaultModel, isLocalUrl, listModels, outputCap, ProviderError, REASONING_ALLOWANCE, reasons, redact, type ProviderConfig } from './providers';

// Los adaptadores de los cuatro proveedores con un `fetch` simulado (Docs/Doc_Asistente.md, prueba 1 de la sección 13):
// los headers de cada uno, la respuesta por partes, *Stop*, los errores, la respuesta cortada y la lista de modelos.

const KEY = 'sk-ant-api03-PRUEBA-secreta-1234567890';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Un `fetch` que anota cada pedido y contesta con lo que diga `reply`. */
function fakeFetch(reply: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
      body: init.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return reply(call);
  }) as typeof fetch;
  return { fetcher, calls };
}

/** Un cuerpo de eventos (`text/event-stream`) que llega en pedazos (cortados en cualquier lado). */
function sse(events: (string | object)[], { chunk = 7, failAfter }: { chunk?: number; failAfter?: number } = {}): Response {
  const text = events.map((e) => (typeof e === 'string' ? e : `data: ${JSON.stringify(e)}`)).join('\n\n') + '\n\n';
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (failAfter !== undefined && at >= failAfter) {
        controller.error(new TypeError('network error'));
        return;
      }
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + chunk));
      at += chunk;
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const anthropic: ProviderConfig = { provider: 'anthropic', model: 'claude-haiku-4-5' };
const openai: ProviderConfig = { provider: 'openai', model: 'gpt-5.4-mini' };
const gemini: ProviderConfig = { provider: 'gemini', model: 'gemini-2.5-flash-lite' };
const compatible: ProviderConfig = { provider: 'compatible', baseUrl: 'http://localhost:11434/v1/', model: 'llama3' };
const request = { system: 'SYS', user: 'USER', maxTokens: 1000 };

const anthropicStream = (text: string[], stop = 'end_turn') => [
  'event: message_start',
  { type: 'message_start', message: { usage: { input_tokens: 1240, output_tokens: 1 } } },
  ...text.map((t) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })),
  { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 512 } },
  { type: 'message_stop' },
];

describe('Anthropic', () => {
  it('manda los headers en todo pedido (también la lista de modelos), recibe por partes y lee los tokens', async () => {
    const { fetcher, calls } = fakeFetch((c) =>
      c.url.endsWith('/messages') ? sse(anthropicStream(['La cá', 'mara se ', 'movió'])) : json(200, { data: [{ id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' }] }),
    );
    const seen: string[] = [];
    const out = await complete(anthropic, KEY, request, { fetcher, onText: (t) => seen.push(t) });
    expect(out).toEqual({ text: 'La cámara se movió', cut: false, usage: { input: 1240, output: 512 } });
    expect(seen.at(-1)).toBe('La cámara se movió');
    expect(seen.length).toBeGreaterThan(1);
    await listModels(anthropic, KEY, fetcher);
    for (const c of calls) {
      expect(c.headers['x-api-key']).toBe(KEY);
      expect(c.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
      expect(c.headers['anthropic-version']).toBe('2023-06-01');
    }
    expect(calls[0]).toMatchObject({ url: 'https://api.anthropic.com/v1/messages', method: 'POST' });
    expect(calls[0].body).toMatchObject({ model: 'claude-haiku-4-5', system: 'SYS', messages: [{ role: 'user', content: 'USER' }], stream: true, max_tokens: 1000 });
    expect(calls[1].url).toBe('https://api.anthropic.com/v1/models?limit=1000');
  });

  it('cortada por largo, o la conexión que se corta a mitad: lo recibido, marcado como cortado', async () => {
    let { fetcher } = fakeFetch(() => sse(anthropicStream(['Hola'], 'max_tokens')));
    expect((await complete(anthropic, KEY, request, { fetcher })).cut).toBe(true);
    ({ fetcher } = fakeFetch(() => sse(anthropicStream(['Hola mundo, esto sigue largo']), { chunk: 20, failAfter: 200 })));
    const out = await complete(anthropic, KEY, request, { fetcher });
    expect(out.cut).toBe(true);
    // Sin el aviso de "terminó": cortada.
    ({ fetcher } = fakeFetch(() => sse(anthropicStream(['Hola']).slice(0, 3))));
    expect((await complete(anthropic, KEY, request, { fetcher })).cut).toBe(true);
  });

  it('los errores: 401, 403, 429 con retry-after, el tope del nivel (429) y el tope propio (400), el modelo, el servidor', async () => {
    const cases: [Response, string, number | null][] = [
      [json(401, { type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY}` } }), 'auth', null],
      [json(403, { type: 'error', error: { type: 'permission_error', message: 'no' } }), 'forbidden', null],
      [json(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, { 'retry-after': '17' }), 'rateLimit', 17],
      [json(429, { type: 'error', error: { type: 'rate_limit_error', message: 'Your organization has reached its monthly spend limit (enforced_spend_limit_reached)' } }), 'spendTier', null],
      [json(400, { type: 'error', error: { type: 'invalid_request_error', message: 'You have reached your specified API usage limits. You will regain access on 2026-11-01.' } }), 'spendOwn', null],
      [json(404, { type: 'error', error: { type: 'not_found_error', message: 'model: claude-x' } }), 'model', null],
      [json(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), 'server', null],
    ];
    for (const [res, kind, retry] of cases) {
      const { fetcher } = fakeFetch(() => res);
      const err = await complete(anthropic, KEY, request, { fetcher }).catch((e: unknown) => e);
      expect(err, kind).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).kind, kind).toBe(kind);
      expect((err as ProviderError).retryAfter, kind).toBe(retry);
      // La clave nunca en el error.
      expect((err as ProviderError).message).not.toContain(KEY);
    }
  });

  it('Stop corta el pedido', async () => {
    const controller = new AbortController();
    const { fetcher } = fakeFetch(() => {
      controller.abort();
      return sse(anthropicStream(['Hola']));
    });
    const err = await complete(anthropic, KEY, request, { fetcher, signal: controller.signal }).catch((e: unknown) => e);
    expect((err as ProviderError).kind).toBe('aborted');
  });
});

describe('OpenAI', () => {
  it('usa /v1/responses con store: false, Bearer, y lee por partes y los tokens', async () => {
    const { fetcher, calls } = fakeFetch(() =>
      sse([
        { type: 'response.created', response: {} },
        { type: 'response.output_text.delta', delta: 'Hola ' },
        { type: 'response.output_text.delta', delta: 'mundo' },
        { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 10, output_tokens: 3 } } },
      ]),
    );
    const out = await complete(openai, 'sk-proj-ABCDEF123456', request, { fetcher });
    expect(out).toEqual({ text: 'Hola mundo', cut: false, usage: { input: 10, output: 3 } });
    expect(calls[0].url).toBe('https://api.openai.com/v1/responses');
    expect(calls[0].headers.authorization).toBe('Bearer sk-proj-ABCDEF123456');
    expect(calls[0].body).toMatchObject({ store: false, stream: true, instructions: 'SYS', input: 'USER', max_output_tokens: 1000 + REASONING_ALLOWANCE });
  });

  it('incompleta: cortada; 429 sin retry-after legible usa el tiempo del cuerpo; el 401 que repite la clave no la muestra', async () => {
    let { fetcher } = fakeFetch(() =>
      sse([
        { type: 'response.output_text.delta', delta: 'Hola' },
        { type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } },
      ]),
    );
    expect((await complete(openai, 'k', request, { fetcher })).cut).toBe(true);
    ({ fetcher } = fakeFetch(() => json(429, { error: { message: 'Rate limit reached. Please try again in 20s.', type: 'requests' } })));
    let err = (await complete(openai, 'k', request, { fetcher }).catch((e: unknown) => e)) as ProviderError;
    expect([err.kind, err.retryAfter]).toEqual(['rateLimit', 20]);
    ({ fetcher } = fakeFetch(() => json(429, { error: { message: 'Rate limit reached.', type: 'requests' } })));
    err = (await complete(openai, 'k', request, { fetcher }).catch((e: unknown) => e)) as ProviderError;
    expect([err.kind, err.retryAfter]).toEqual(['rateLimit', null]);
    const key = 'sk-proj-SECRETO0123456789abcdef';
    ({ fetcher } = fakeFetch(() => json(401, { error: { message: `Incorrect API key provided: sk-proj-SECR************cdef. You can find your API key at https://platform.openai.com/account/api-keys.` } })));
    err = (await complete(openai, key, request, { fetcher }).catch((e: unknown) => e)) as ProviderError;
    expect(err.kind).toBe('auth');
    expect(err.message).not.toMatch(/sk-proj-SECR/);
  });

  it('la lista de modelos saca lo que no escribe texto y preelige uno barato', async () => {
    const { fetcher } = fakeFetch(() =>
      json(200, {
        data: [
          { id: 'gpt-6.1-sol', created: 30 },
          { id: 'text-embedding-3-small', created: 50 },
          { id: 'gpt-5.4-mini', created: 20 },
          { id: 'gpt-5.4-mini-2026-03-01', created: 21 },
          { id: 'whisper-1', created: 1 },
          { id: 'gpt-image-1', created: 40 },
        ],
      }),
    );
    const list = await listModels(openai, 'k', fetcher);
    expect(list.map((m) => m.id)).toEqual(['gpt-6.1-sol', 'gpt-5.4-mini-2026-03-01', 'gpt-5.4-mini']);
    expect(defaultModel('openai', list)).toBe('gpt-5.4-mini');
  });
});

describe('Gemini', () => {
  it('x-goog-api-key, streamGenerateContent con alt=sse, sin lo que el modelo "pensó", y los tokens', async () => {
    const { fetcher, calls } = fakeFetch(() =>
      sse([
        { candidates: [{ content: { parts: [{ text: 'pienso…', thought: true }, { text: 'Hola ' }] } }] },
        { candidates: [{ content: { parts: [{ text: 'mundo' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 } },
      ]),
    );
    const out = await complete(gemini, 'AIzaSyPRUEBA1234567890', request, { fetcher });
    expect(out).toEqual({ text: 'Hola mundo', cut: false, usage: { input: 7, output: 2 } });
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:streamGenerateContent?alt=sse');
    expect(calls[0].headers['x-goog-api-key']).toBe('AIzaSyPRUEBA1234567890');
    expect(calls[0].body).toMatchObject({ systemInstruction: { parts: [{ text: 'SYS' }] }, contents: [{ role: 'user', parts: [{ text: 'USER' }] }], generationConfig: { maxOutputTokens: 1000 + REASONING_ALLOWANCE } });
  });

  it('MAX_TOKENS o SAFETY: cortada; el 429 lee el tiempo del cuerpo; la lista de modelos y la preelección', async () => {
    let { fetcher } = fakeFetch(() => sse([{ candidates: [{ content: { parts: [{ text: 'Ho' }] }, finishReason: 'MAX_TOKENS' }] }]));
    expect((await complete(gemini, 'k', request, { fetcher })).cut).toBe(true);
    ({ fetcher } = fakeFetch(() => json(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded', details: [{ retryDelay: '33s' }] } })));
    const err = (await complete(gemini, 'k', request, { fetcher }).catch((e: unknown) => e)) as ProviderError;
    expect([err.kind, err.retryAfter]).toEqual(['rateLimit', 33]);
    ({ fetcher } = fakeFetch(() =>
      json(200, {
        models: [
          { name: 'models/gemini-3.1-pro-preview', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/imagen-4', supportedGenerationMethods: ['predict'] },
        ],
      }),
    ));
    const list = await listModels(gemini, 'k', fetcher);
    expect(list.map((m) => m.id)).toEqual(['gemini-3.1-pro-preview', 'gemini-2.5-flash-lite']);
    expect(defaultModel('gemini', list)).toBe('gemini-2.5-flash-lite');
  });
});

describe('compatible con OpenAI', () => {
  it('su dirección con /chat/completions, sin Authorization si no hay clave, y lee por partes y los tokens', async () => {
    const { fetcher, calls } = fakeFetch(() =>
      sse([
        { choices: [{ delta: { content: 'Ho' } }] },
        { choices: [{ delta: { content: 'la' }, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } },
        'data: [DONE]',
      ]),
    );
    const out = await complete(compatible, '', request, { fetcher });
    expect(out).toEqual({ text: 'Hola', cut: false, usage: { input: 5, output: 2 } });
    expect(calls[0].url).toBe('http://localhost:11434/v1/chat/completions');
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[0].body).toMatchObject({ model: 'llama3', stream: true, messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USER' }] });
  });

  it('finish_reason length: cortada; sin red: error de red', async () => {
    let { fetcher } = fakeFetch(() => sse([{ choices: [{ delta: { content: 'Ho' }, finish_reason: 'length' }] }, 'data: [DONE]']));
    expect((await complete(compatible, '', request, { fetcher })).cut).toBe(true);
    ({ fetcher } = fakeFetch(() => {
      throw new TypeError('Failed to fetch');
    }));
    const err = (await complete(compatible, '', request, { fetcher }).catch((e: unknown) => e)) as ProviderError;
    expect(err.kind).toBe('network');
  });
});

describe('el tope de salida de los modelos que razonan', () => {
  it('OpenAI (o-, gpt-5 y siguientes) y Gemini 2.5 o más nuevo suman lo que pueden pensar; los demás, el tope justo', () => {
    for (const model of ['gpt-5.4-mini', 'gpt-5-nano', 'gpt-6-luna', 'o4-mini', 'o3']) expect(reasons({ provider: 'openai', model }), model).toBe(true);
    for (const model of ['gpt-4.1-mini', 'gpt-4o-mini']) expect(reasons({ provider: 'openai', model }), model).toBe(false);
    for (const model of ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3-flash', 'gemini-flash-latest']) expect(reasons({ provider: 'gemini', model }), model).toBe(true);
    expect(reasons({ provider: 'gemini', model: 'gemini-2.0-flash' })).toBe(false);
    expect(reasons({ provider: 'anthropic', model: 'claude-haiku-4-5' })).toBe(false);
    expect(reasons({ provider: 'compatible', model: 'gpt-5-mini', baseUrl: 'https://openrouter.ai/api/v1' })).toBe(false);
    expect(outputCap({ provider: 'openai', model: 'gpt-5-mini' }, 1024)).toBe(1024 + REASONING_ALLOWANCE);
    expect(outputCap({ provider: 'openai', model: 'gpt-4.1-mini' }, 1024)).toBe(1024);
  });

  it('el pedido lleva ese tope: OpenAI y Gemini que razonan, con margen; uno que no, el justo', async () => {
    const { fetcher, calls } = fakeFetch(() => sse([{ type: 'response.completed', response: { status: 'completed' } }]));
    await complete({ provider: 'openai', model: 'gpt-4.1-mini' }, 'sk-proj-ABCDEF123456', request, { fetcher });
    expect(calls[0].body).toMatchObject({ max_output_tokens: 1000 });
    const g = fakeFetch(() => sse([{ candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' }] }]));
    await complete({ provider: 'gemini', model: 'gemini-2.0-flash' }, 'AIzaSyPRUEBA1234567890', request, { fetcher: g.fetcher });
    expect(g.calls[0].body).toMatchObject({ generationConfig: { maxOutputTokens: 1000 } });
  });
});

describe('lo demás', () => {
  it('la preelección por nombre: Haiku, -mini/-nano/-luna, flash-lite; si no, el primero', () => {
    const m = (...ids: string[]) => ids.map((id) => ({ id, name: id }));
    expect(defaultModel('anthropic', m('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'))).toBe('claude-haiku-4-5');
    expect(defaultModel('openai', m('gpt-6.1-sol', 'gpt-6-luna'))).toBe('gpt-6-luna');
    expect(defaultModel('gemini', m('gemini-3.8-flash', 'gemini-2.5-flash-lite'))).toBe('gemini-2.5-flash-lite');
    expect(defaultModel('compatible', m('llama3', 'qwen'))).toBe('llama3');
    expect(defaultModel('anthropic', [])).toBe('');
  });

  it('redact saca la clave y lo que parece una', () => {
    expect(redact(`bad key ${KEY} here`, KEY)).toBe('bad key [key] here');
    expect(redact('sk-proj-abcdef1234567 and AIzaSyABCDEFGHIJKLMNOP', 'otra')).toBe('[key] and [key]');
    // Una clave de un servicio compatible con otra forma (sin prefijo conocido) también se saca.
    expect(redact('token llave-local-XYZ987 rechazado', 'llave-local-XYZ987')).toBe('token [key] rechazado');
  });

  it('qué dirección es local (para la política local_only y para intentar sin red)', () => {
    for (const url of ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:8080', 'http://192.168.1.20:11434', 'http://10.0.0.5', 'http://172.20.1.1', 'http://mac-studio.local:1234'])
      expect(isLocalUrl(url), url).toBe(true);
    for (const url of ['https://openrouter.ai/api/v1', 'http://172.40.0.1', 'https://api.openai.com', 'nada', undefined]) expect(isLocalUrl(url), String(url)).toBe(false);
  });
});

describe('con una foto (Suggest caption, entrega A3)', () => {
  const image = { mime: 'image/jpeg', data: 'L9j/4AAQ' };
  const request = { system: 'S', user: 'Suggest a caption for this photo.', maxTokens: 200, image };
  const done = (provider: string) =>
    provider === 'anthropic'
      ? sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Pie' } }, { type: 'message_stop' }])
      : provider === 'openai'
        ? sse([{ type: 'response.output_text.delta', delta: 'Pie' }, { type: 'response.completed', response: { usage: {} } }])
        : provider === 'gemini'
          ? sse([{ candidates: [{ content: { parts: [{ text: 'Pie' }] }, finishReason: 'STOP' }] }])
          : sse([{ choices: [{ delta: { content: 'Pie' }, finish_reason: 'stop' }] }, '[DONE]']);

  it('cada proveedor recibe la foto antes del texto, en su forma (base64, nunca una dirección de afuera)', async () => {
    const bodies: Record<string, unknown> = {};
    for (const config of [anthropic, openai, gemini, { provider: 'compatible', baseUrl: 'http://localhost:11434/v1', model: 'llava' } as ProviderConfig]) {
      const { fetcher, calls } = fakeFetch(() => done(config.provider));
      const out = await complete(config, KEY, request, { fetcher });
      expect(out.text).toBe('Pie');
      bodies[config.provider] = calls[0].body;
    }
    expect((bodies.anthropic as { messages: unknown[] }).messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'L9j/4AAQ' } },
        { type: 'text', text: 'Suggest a caption for this photo.' },
      ],
    });
    expect((bodies.openai as { input: unknown; store: boolean }).input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_image', image_url: 'data:image/jpeg;base64,L9j/4AAQ' },
          { type: 'input_text', text: 'Suggest a caption for this photo.' },
        ],
      },
    ]);
    expect((bodies.openai as { store: boolean }).store).toBe(false);
    expect((bodies.gemini as { contents: unknown[] }).contents[0]).toEqual({
      role: 'user',
      parts: [{ inline_data: { mime_type: 'image/jpeg', data: 'L9j/4AAQ' } }, { text: 'Suggest a caption for this photo.' }],
    });
    expect((bodies.compatible as { messages: unknown[] }).messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,L9j/4AAQ' } },
        { type: 'text', text: 'Suggest a caption for this photo.' },
      ],
    });
  });

  it('sin foto, el pedido de texto sigue igual que antes (una cadena)', async () => {
    const { fetcher, calls } = fakeFetch(() => done('anthropic'));
    await complete(anthropic, KEY, { system: 'S', user: 'U', maxTokens: 10 }, { fetcher });
    expect((calls[0].body as { messages: { content: unknown }[] }).messages[0].content).toBe('U');
  });
});
