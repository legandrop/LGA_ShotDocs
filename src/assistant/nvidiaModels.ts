// Perfiles del endpoint hospedado, no del catálogo genérico. Doc_Asistente.md.
export const NVIDIA_MODELS = {
  'qwen/qwen3.5-122b-a10b': { tokens: 16000, vision: true },
  'meta/llama-3.3-70b-instruct': { tokens: 4096, vision: false },
} as const;
export type NvidiaModel = keyof typeof NVIDIA_MODELS;
export const nvidiaProfile = (model: string) => Object.hasOwn(NVIDIA_MODELS, model) ? NVIDIA_MODELS[model as NvidiaModel] : null;
