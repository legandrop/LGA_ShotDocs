// El `import('heic-convert')` del comando, en las pruebas (ver codaFakeApi.mjs): el conversor de mentira, o
// "no está instalado".

let mode = 'missing'
let converter = ''

export function initialize(data) {
  mode = data.mode
  converter = data.converter
}

export async function resolve(specifier, context, next) {
  if (specifier !== 'heic-convert') return next(specifier, context)
  if (mode === 'fake') return { url: converter, shortCircuit: true }
  const error = new Error(`Cannot find package 'heic-convert'`)
  error.code = 'ERR_MODULE_NOT_FOUND'
  throw error
}
