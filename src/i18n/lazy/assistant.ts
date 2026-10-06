import { register } from '../index';
import type { Dict } from '../types';

// El asistente (Docs/Doc_Asistente.md, entregas A1 y A2): el panel, la ventana de ajustes y la política del workspace.
// Se carga aparte, con ellos.

export const assistant = {
  'assistant.nvidia.stopping': { en: 'Stopping… Waiting for the workspace gateway.', es: 'Deteniendo… Esperando al portero del workspace.' },
  'assistant.nvidia.stopped': { en: 'Stopped. The workspace gateway confirmed that its request has closed. NVIDIA processing or charges may already have started.', es: 'Detenido. El portero confirmó el cierre de su pedido. El procesamiento o el cobro de NVIDIA puede haber empezado.' },
  'assistant.nvidia.stopUnconfirmed': { en: 'Stopped locally. Server cancellation was not confirmed; NVIDIA may still be processing the request.', es: 'Detenido en este dispositivo. No se confirmó la cancelación del servidor; NVIDIA puede seguir procesando el pedido.' },
  'assistant.nvidia.route': { en: "Requests and your NVIDIA key pass through this workspace’s file gateway to NVIDIA. The gateway does not save them.", es: "Los pedidos y tu clave de NVIDIA pasan por el portero de este workspace hacia NVIDIA. El portero no los guarda." },
  'assistant.nvidia.storage': { en: "The saved key is encrypted on this device. Syncing a passphrase-encrypted copy remains optional.", es: "La clave guardada queda cifrada en este dispositivo. Sincronizar una copia cifrada con una frase sigue siendo opcional." },
  'assistant.nvidia.modelsLoaded': { en: "Models loaded. Inference has not been tested.", es: "Modelos cargados. Todavía no se probó una respuesta." },
  'assistant.nvidia.noModels': { en: "Choose an admitted NVIDIA model: Qwen3.5-122b-a10b, Llama3.3-70b-instruct, Kimi K3 or GLM 5.3. Kimi and GLM are text-only in this app. Listing models does not confirm account access.", es: "Elegí un modelo NVIDIA admitido: Qwen3.5-122b-a10b, Llama3.3-70b-instruct, Kimi K3 o GLM 5.3. Kimi y GLM sólo reciben texto en esta app. La lista no confirma el acceso de tu cuenta." },
  'assistant.nvidia.llamaLimit': { en: "This text-only model has a 4,096-token output limit. Incomplete answers cannot be applied.", es: "Este modelo solo recibe texto y tiene un límite de salida de 4096 tokens. Las respuestas incompletas no se pueden aplicar." },
  'assistant.nvidia.noVision': { en: "This NVIDIA model does not receive photos. Choose Qwen3.5-122b-a10b in Assistant settings.", es: "Este modelo NVIDIA no recibe fotos. Elegí Qwen3.5-122b-a10b en los ajustes del asistente." },
  'assistant.nvidia.session': { en: "Your workspace session is not available. Sign in to this workspace again; your NVIDIA key has not been rejected.", es: "Tu sesión del workspace no está disponible. Volvé a entrar a este workspace; no se rechazó tu clave NVIDIA." },
  'assistant.nvidia.policy': { en: "This workspace does not allow NVIDIA requests, or its assistant policy could not be verified.", es: "Este workspace no permite pedidos a NVIDIA, o no se pudo verificar su política del asistente." },
  'assistant.nvidia.page': { en: "This page is no longer available with your current workspace permissions.", es: "Esta página ya no está disponible con tus permisos actuales del workspace." },
  'assistant.nvidia.outdated': { en: "Update this workspace’s file gateway to use NVIDIA. Your key has not been rejected.", es: "Actualizá el portero de este workspace para usar NVIDIA. No se rechazó tu clave." },
  'assistant.nvidia.pending': { en: "NVIDIA returned a pending request. No answer was applied; automatic polling is not supported.", es: "NVIDIA devolvió un pedido pendiente. No se aplicó una respuesta; no se consulta automáticamente su estado." },
  'assistant.nvidia.unavailable': { en: "The workspace’s NVIDIA gateway is not available. Check the gateway connection and try again.", es: "La pasarela NVIDIA del workspace no está disponible. Revisá la conexión del portero y volvé a intentar." },
  'assistant.nvidia.prepareTimeout': { en: "The workspace gateway took too long to prepare the NVIDIA request. Your key has not been sent to NVIDIA. Check the gateway connection and try again.", es: "El portero del workspace tardó demasiado en preparar el pedido NVIDIA. Tu clave no se envió a NVIDIA. Revisá la conexión del portero y volvé a intentar." },
  'assistant.nvidia.network': { en: "Couldn’t connect to this workspace’s NVIDIA gateway. Check the gateway connection and try again.", es: "No se pudo conectar con la pasarela NVIDIA de este workspace. Revisá la conexión del portero y volvé a intentar." },
  'assistant.title': { en: "Assistant", es: "Asistente" },
  'assistant.settings': { en: "Assistant settings", es: "Ajustes del asistente" },
  'assistant.close': { en: "Close the assistant", es: "Cerrar el asistente" },
  'assistant.setupText': {
    en: "Fix, improve, shorten, translate or reshape what you select, or summarize and translate the whole page, with your own key from NVIDIA, Anthropic, OpenAI, Google or a compatible service. The saved key is encrypted on this device; NVIDIA requests pass through your workspace’s gatekeeper.",
    es: "Corregí, mejorá, acortá, traducí o cambiale la forma a lo que elijas, o resumí y traducí toda la página, con tu propia clave de NVIDIA, Anthropic, OpenAI, Google o un servicio compatible. La clave guardada queda cifrada en este dispositivo; los pedidos NVIDIA pasan por el portero de tu workspace.",
  },
  'assistant.setup': { en: "Set up the assistant", es: "Configurar el asistente" },
  'assistant.fix': { en: "Fix spelling & grammar", es: "Corregir ortografía y gramática" },
  'assistant.improve': { en: "Improve writing", es: "Mejorar la redacción" },
  'assistant.shorter': { en: "Make shorter", es: "Acortar" },
  'assistant.translate': { en: "Translate to…", es: "Traducir al…" },
  'assistant.ask': { en: "Ask…", es: "Pedir…" },
  'assistant.language': { en: "Language", es: "Idioma" },
  'assistant.askPlaceholder': { en: "Ask the assistant to change the selection…", es: "Pedile al asistente que cambie lo elegido…" },
  'assistant.send': { en: "Send", es: "Enviar" },
  'assistant.hint': {
    en: "Works on the selected text, or on the paragraph with the cursor.",
    es: "Trabaja sobre el texto elegido, o sobre el párrafo donde está el cursor.",
  },
  'assistant.nothingSelected': {
    en: "Select some text first, or put the cursor in a paragraph.",
    es: "Primero elegí un texto, o poné el cursor en un párrafo.",
  },
  'assistant.tooLong': {
    en: "The selection is too long: select up to 20,000 characters.",
    es: "Lo elegido es demasiado largo: elegí hasta 20.000 caracteres.",
  },
  'assistant.thinking': { en: "{action}…", es: "{action}…" },
  'assistant.stop': { en: "Stop", es: "Parar" },
  'assistant.stopped': { en: "Stopped.", es: "Se paró." },
  'assistant.preview': { en: "Suggestion", es: "Sugerencia" },
  'assistant.blockChip': { en: "Block (unchanged)", es: "Bloque (sin cambios)" },
  'assistant.apply': { en: "Apply", es: "Aplicar" },
  'assistant.discard': { en: "Discard", es: "Descartar" },
  'assistant.tryAgain': { en: "Try again", es: "Probar de nuevo" },
  'assistant.copy': { en: "Copy", es: "Copiar" },
  'assistant.back': { en: "Back", es: "Volver" },
  'assistant.applied': { en: "Applied. Undo it with {undo}.", es: "Aplicado. Se deshace con {undo}." },
  'assistant.changed': {
    en: "This text changed while the assistant was working. Nothing was applied.",
    es: "Este texto cambió mientras el asistente trabajaba. No se aplicó nada.",
  },
  'assistant.readOnly': {
    en: "You can view this page but not edit it: copy the result instead.",
    es: "Podés ver esta página pero no editarla: copiá el resultado.",
  },
  'assistant.failed': {
    en: "The suggestion couldn't be applied. Nothing was changed.",
    es: "No se pudo aplicar la sugerencia. No cambió nada.",
  },
  'assistant.cutOff': { en: "The answer was cut off.", es: "La respuesta llegó cortada." },
  'assistant.invalid.marker': {
    en: "The suggestion would remove a photo or a block.",
    es: "La sugerencia sacaría una foto o un bloque.",
  },
  'assistant.copyOnly': {
    en: "This suggestion can only be copied here.",
    es: "Acá esta sugerencia solo se puede copiar.",
  },
  'assistant.invalid.structure': {
    en: "The suggestion changed how the text is split into paragraphs. Try again, or copy it.",
    es: "La sugerencia cambió cómo se divide el texto en párrafos. Probá de nuevo, o copiala.",
  },
  'assistant.linksRemoved': {
    en: "Links added by the assistant were removed.",
    es: "Se sacaron los links que agregó el asistente.",
  },
  'assistant.muchLonger': {
    en: "The suggestion is much longer than the original.",
    es: "La sugerencia es mucho más larga que el original.",
  },
  'assistant.muchShorter': {
    en: "The suggestion is much shorter than the original.",
    es: "La sugerencia es mucho más corta que el original.",
  },
  'assistant.offline': { en: "The assistant needs internet.", es: "El asistente necesita internet." },
  'assistant.policyOff': {
    en: "The owner of this workspace turned the assistant off.",
    es: "El dueño de este workspace apagó el asistente.",
  },
  'assistant.policyLocal': {
    en: "Only local models are allowed in this workspace.",
    es: "En este workspace solo se permiten modelos locales.",
  },
  'assistant.tokens': { en: "{input} in · {output} out", es: "{input} de entrada · {output} de salida" },
  'assistant.error.auth': {
    en: "{provider} rejected the key. Check it in Assistant settings.",
    es: "{provider} rechazó la clave. Revisala en los ajustes del asistente.",
  },
  'assistant.error.forbidden': {
    en: "{provider} refused the request: {message}",
    es: "{provider} rechazó el pedido: {message}",
  },
  'assistant.error.rateLimit': {
    en: "The provider is rate limiting your key. Try again in a moment.",
    es: "El proveedor está limitando tu clave. Probá de nuevo en un momento.",
  },
  'assistant.error.rateLimitIn': {
    en: "The provider is rate limiting your key. Try again in {seconds} s.",
    es: "El proveedor está limitando tu clave. Probá de nuevo en {seconds} s.",
  },
  'assistant.error.spendTier': {
    en: "Your monthly spending limit at {provider} was reached.",
    es: "Se alcanzó tu tope de gasto mensual en {provider}.",
  },
  'assistant.error.spendOwn': {
    en: "You reached the spending limit you set at {provider}.",
    es: "Llegaste al tope de gasto que fijaste en {provider}.",
  },
  'assistant.error.model': {
    en: "The model isn't available ({message}). Choose another one in Assistant settings.",
    es: "El modelo no está disponible ({message}). Elegí otro en los ajustes del asistente.",
  },
  'assistant.error.network': {
    en: "Couldn't reach {provider}. Check the connection, or that the local model is running and accepts this app.",
    es: "No se pudo llegar a {provider}. Revisá la conexión, o que el modelo local esté andando y acepte esta app.",
  },
  'assistant.error.server': {
    en: "{provider} had a problem ({message}). Try again.",
    es: "{provider} tuvo un problema ({message}). Probá de nuevo.",
  },
  'assistant.error.other': {
    en: "{provider} returned an error: {message}",
    es: "{provider} devolvió un error: {message}",
  },
  'assistant.settings.provider': { en: "Provider", es: "Proveedor" },
  'assistant.settings.baseUrl': { en: "Base URL", es: "Dirección" },
  'assistant.settings.baseUrlHint': {
    en: "OpenRouter, or a local model (Ollama, LM Studio) that accepts this app's address.",
    es: "OpenRouter, o un modelo local (Ollama, LM Studio) que acepte la dirección de esta app.",
  },
  'assistant.settings.key': { en: "API key", es: "Clave de la API" },
  'assistant.settings.keySaved': { en: "Saved on this device", es: "Guardada en este dispositivo" },
  'assistant.settings.keyOptional': { en: "Optional for a local model", es: "Opcional para un modelo local" },
  'assistant.settings.paste': { en: "Paste", es: "Pegar" },
  'assistant.settings.model': { en: "Model", es: "Modelo" },
  'assistant.settings.modelHint': { en: "Test lists the models of your key", es: "Probar lista los modelos de tu clave" },
  'assistant.settings.stays': {
    en: "Your key stays on this device and is sent only to {provider}. The provider charges each request to your account.",
    es: "Tu clave queda en este dispositivo y se manda solo a {provider}. Cada pedido lo cobra el proveedor a tu cuenta.",
  },
  'assistant.settings.limit': { en: "Set a spending limit there.", es: "Poné un tope de gasto ahí." },
  'assistant.settings.geminiFree': {
    en: "With a free Gemini key, Google may use what you send to improve its products.",
    es: "Con una clave gratis de Gemini, Google puede usar lo que mandás para mejorar sus productos.",
  },
  'assistant.settings.test': { en: "Test", es: "Probar" },
  'assistant.settings.save': { en: "Save", es: "Guardar" },
  'assistant.settings.forget': { en: "Forget key", es: "Olvidar la clave" },
  'assistant.settings.forgotten': { en: "The key was removed from this device.", es: "Se sacó la clave de este dispositivo." },
  'assistant.settings.works': { en: "Key works.", es: "La clave anda." },
  'assistant.settings.needKey': { en: "Paste your {provider} API key.", es: "Pegá tu clave de la API de {provider}." },
  'assistant.settings.needUrl': { en: "Write the base URL of the service.", es: "Escribí la dirección del servicio." },
  'assistant.settings.needModel': { en: "Choose a model.", es: "Elegí un modelo." },
  'assistant.settings.notSaved': {
    en: "The settings couldn't be saved on this device.",
    es: "No se pudieron guardar los ajustes en este dispositivo.",
  },
  'assistant.settings.pasteFailed': {
    en: "The browser didn't allow pasting: paste with the keyboard.",
    es: "El navegador no dejó pegar: pegá con el teclado.",
  },
  // --- Entrega A2: la página entera, Format as… y la política del workspace ---
  'assistant.pageSection': { en: "Whole page", es: "Toda la página" },
  // *Suggest caption* (entrega A3): el modelo mira una foto y propone un pie.
  'assistant.photoSection': { en: "Photo", es: "Foto" },
  'assistant.caption': { en: "Suggest caption", es: "Sugerir un pie de foto" },
  'assistant.caption.hint': {
    en: "Click a photo first. The assistant looks at it and suggests a line to put under it.",
    es: "Primero hacé clic en una foto. El asistente la mira y propone un renglón para poner debajo.",
  },
  'assistant.caption.select': {
    en: "Select a photo first: click it, then choose Suggest caption.",
    es: "Primero elegí una foto: hacé clic en ella y después tocá Sugerir un pie de foto.",
  },
  'assistant.caption.confirm': { en: "Send this photo to {provider}?", es: "¿Mandar esta foto a {provider}?" },
  'assistant.caption.confirmText': {
    en: "It gets a copy of up to 1,024 pixels, without the file's location and camera data, never the original. Nothing else from the page is sent.",
    es: "Le llega una copia de hasta 1024 píxeles, sin la ubicación ni los datos de la cámara del archivo, nunca el original. No se manda nada más de la página.",
  },
  'assistant.caption.language': { en: "Caption language", es: "Idioma del pie" },
  'assistant.caption.send': { en: "Send photo", es: "Mandar la foto" },
  'assistant.caption.cancel': { en: "Cancel", es: "Cancelar" },
  'assistant.caption.preparing': { en: "Preparing the photo…", es: "Preparando la foto…" },
  'assistant.caption.field': { en: "Caption", es: "Pie de foto" },
  'assistant.caption.whereBelow': {
    en: "Apply adds it as a new line under the photo. You can edit it here first, or later on the page.",
    es: "Aplicar lo agrega como un renglón nuevo debajo de la foto. Podés retocarlo acá antes, o después en la página.",
  },
  'assistant.caption.whereCell': {
    en: "Apply adds it in the same cell, on a new line under the photo. You can edit it here first, or later on the page.",
    es: "Aplicar lo agrega en la misma celda, en un renglón nuevo debajo de la foto. Podés retocarlo acá antes, o después en la página.",
  },
  'assistant.caption.sent': { en: "Sent {width} × {height} px · {kb} KB", es: "Se mandó de {width} × {height} px · {kb} KB" },
  'assistant.caption.fromThumbnail': {
    en: "from the thumbnail (less detail): a sharper copy wasn't available",
    es: "de la miniatura (con menos detalle): no había una copia más nítida",
  },
  'assistant.caption.applied': { en: "Caption added. Undo it with {undo}.", es: "Pie agregado. Se deshace con {undo}." },
  'assistant.caption.changed': {
    en: "This photo was removed or replaced while the assistant was working. Nothing was applied.",
    es: "Esta foto se borró o se reemplazó mientras el asistente trabajaba. No se aplicó nada.",
  },
  'assistant.caption.unavailable': {
    en: "This photo isn't on this device and couldn't be downloaded. Try again with internet.",
    es: "Esta foto no está en este dispositivo y no se pudo bajar. Probá de nuevo con internet.",
  },
  'assistant.caption.unreadable': {
    en: "This photo can't be read in this browser, so it can't be sent.",
    es: "Esta foto no se puede leer en este navegador, así que no se puede mandar.",
  },
  'assistant.caption.noVision': {
    en: "This model can't look at photos. Choose another one in the assistant settings.",
    es: "Este modelo no puede mirar fotos. Elegí otro en los ajustes del asistente.",
  },
  'assistant.summarize': { en: "Summarize page", es: "Resumir la página" },
  'assistant.translatePage': { en: "Translate page", es: "Traducir la página" },
  'assistant.pageLanguage': { en: "Language of the translated page", es: "Idioma de la página traducida" },
  'assistant.pageHint': {
    en: "Sends the title and the current text of the whole page.",
    es: "Manda el título y el texto actual de toda la página.",
  },
  'assistant.pageEmpty': { en: "This page has no text to work on.", es: "Esta página no tiene texto para trabajar." },
  'assistant.pageTooLong': {
    en: "This page is too long for the assistant (more than 20,000 characters): select a part and use the actions above.",
    es: "Esta página es demasiado larga para el asistente (más de 20.000 caracteres): elegí una parte y usá las acciones de arriba.",
  },
  'assistant.format': { en: "Format as…", es: "Dar forma de…" },
  'assistant.formatShape': { en: "Shape", es: "Forma" },
  'assistant.format.bullets': { en: "Bulleted list", es: "Lista con viñetas" },
  'assistant.format.checklist': { en: "Checklist", es: "Lista de casillas" },
  'assistant.format.table': { en: "Table", es: "Tabla" },
  'assistant.format.headings': { en: "Headings", es: "Títulos" },
  'assistant.format.inTable': {
    en: "Format as… works on whole blocks, not inside a table cell.",
    es: "Dar forma de… trabaja con bloques enteros, no adentro de una celda.",
  },
  'assistant.styleConflict': {
    en: 'The response could not preserve the original formatting. Try again or discard it.',
    es: 'La respuesta no pudo conservar el formato original. Probá de nuevo o descartala.',
  },
  'assistant.format.nested': {
    en: "Some of these blocks have blocks nested inside, and the new shape would remove them. Nothing was applied.",
    es: "Algunos de estos bloques tienen bloques adentro, y la forma nueva los sacaría. No se aplicó nada.",
  },
  'assistant.format.history': {
    en: "Edits others make to this text at the same time may only remain in the history.",
    es: "Lo que otros escriban en este texto al mismo tiempo puede quedar solo en el historial.",
  },
  'assistant.format.removesScript': {
    en: "Applying this shape will remove Script formatting. You can undo it after applying.",
    es: "Aplicar esta forma va a quitar el formato Guion. Podés deshacerlo después de aplicar.",
  },
  'assistant.format.lost': {
    en: "The suggestion leaves out text that was selected ({words}). Nothing can be applied: try again, or copy it.",
    es: "La sugerencia deja afuera texto de lo elegido ({words}). No se puede aplicar: probá de nuevo, o copiala.",
  },
  'assistant.format.added': {
    en: "The suggestion adds words that weren't in the selection (underlined). Check them before applying.",
    es: "La sugerencia agrega palabras que no estaban en lo elegido (subrayadas). Revisalas antes de aplicar.",
  },
  'assistant.format.nothing': { en: "These blocks already have that shape.", es: "Estos bloques ya tienen esa forma." },
  'assistant.nothingChanged': { en: "Nothing to change.", es: "No hay nada que cambiar." },
  'assistant.insertTop': { en: "Insert at top", es: "Agregar arriba" },
  'assistant.insertBelow': { en: "Insert below", es: "Agregar debajo" },
  'assistant.inserted': { en: "Added. Undo it with {undo}.", es: "Agregado. Se deshace con {undo}." },
  'assistant.replacePage': { en: "Replace page content", es: "Reemplazar el contenido" },
  'assistant.createSubpage': { en: "Create translated subpage", es: "Crear una subpágina traducida" },
  'assistant.subpage.creating': { en: "Creating the subpage…", es: "Creando la subpágina…" },
  'assistant.subpage.created': { en: "Translated subpage created.", es: "Se creó la subpágina traducida." },
  'assistant.subpage.untitled': { en: "Untitled", es: "Sin título" },
  'assistant.subpage.denied': {
    en: "You can't create pages inside this one: copy the result instead.",
    es: "No podés crear páginas adentro de esta: copiá el resultado.",
  },
  'assistant.subpage.failed': {
    en: "The subpage was created, but its content couldn't be written. This page didn't change.",
    es: "Se creó la subpágina, pero no se pudo escribir su contenido. Esta página no cambió.",
  },
  'assistant.policy.title': { en: "This workspace", es: "Este workspace" },
  'assistant.policy.text': {
    en: "Only the owner and the admins see this. It's a rule of the app, not a barrier: anyone who can read a page can still copy it.",
    es: "Solo lo ven el dueño y los admins. Es una regla de la app, no una barrera: quien puede leer una página igual la puede copiar.",
  },
  'assistant.policy.on': { en: "On", es: "Prendido" },
  'assistant.policy.onHint': {
    en: "Everyone uses the assistant with their own key and provider.",
    es: "Cada uno usa el asistente con su clave y su proveedor.",
  },
  'assistant.policy.local': { en: "Local models only", es: "Solo modelos locales" },
  'assistant.policy.localHint': {
    en: "Only a model on the same computer or local network: nothing goes to a provider.",
    es: "Solo un modelo en la misma computadora o red local: nada sale a un proveedor.",
  },
  'assistant.policy.off': { en: "Off", es: "Apagado" },
  'assistant.policy.offHint': { en: "Nobody can use the assistant in this workspace.", es: "Nadie puede usar el asistente en este workspace." },
  'assistant.policy.saved': { en: "Saved for everyone in this workspace.", es: "Guardado para todos en este workspace." },
  'assistant.policy.denied': {
    en: "Only the owner and the admins can change this.",
    es: "Solo el dueño y los admins pueden cambiar esto.",
  },
  'assistant.policy.missing': {
    en: "This workspace's database needs an update before this can be changed.",
    es: "La base de este workspace necesita una actualización para poder cambiar esto.",
  },
  'assistant.policy.failed': { en: "Couldn't save the change. Try again.", es: "No se pudo guardar el cambio. Probá de nuevo." },
  'assistant.policy.offline': { en: "Changing it needs internet.", es: "Para cambiarlo hace falta internet." },

  // *Dictate to report* (Docs/Doc_Dictado.md, entrega V1): la hoja, la vista previa por cambio y lo que no se ubicó.
  'dictation.title': { en: "Dictate to report", es: "Dictar al reporte" },
  'dictation.close': { en: "Close Dictate to report", es: "Cerrar Dictar al reporte" },
  'dictation.setupText': {
    en: "Write or dictate a note in your own words and the assistant places each piece where it goes in this page, with a preview before anything is written. It uses your assistant key: set it up first.",
    es: "Escribí o dictá una nota con tus palabras y el asistente pone cada dato donde va en esta página, con una vista previa antes de escribir nada. Usa tu clave del asistente: configurala primero.",
  },
  'dictation.readOnlyNotice': {
    en: "You can't edit this page: you can place the note and copy the result.",
    es: "No podés editar esta página: podés ubicar la nota y copiar el resultado.",
  },
  'dictation.note': { en: "Note", es: "Nota" },
  'dictation.placeholder': {
    en: "Type, or tap the microphone on your keyboard and talk: “this shot was a 50 mm, put it where it goes”",
    es: "Escribí, o tocá el micrófono del teclado y hablá: «este plano se filmó con un 50 mm, anotalo donde corresponda»",
  },
  'dictation.place': { en: "Place", es: "Ubicar" },
  'dictation.saveForLater': { en: "Save for later", es: "Guardar para después" },
  'dictation.hint': {
    en: "Say which shot, or put the cursor in its row first. Nothing is written until you check the preview and apply it.",
    es: "Decí qué plano, o poné antes el cursor en su fila. No se escribe nada hasta que revises la vista previa y la apliques.",
  },
  'dictation.offline': {
    en: "Placing a note needs internet. Your note stays saved on this device.",
    es: "Para ubicar una nota hace falta internet. Tu nota queda guardada en este dispositivo.",
  },
  'dictation.policyOff': {
    en: "The owner of this workspace turned the assistant off, so Dictate to report is off too.",
    es: "El dueño de este workspace apagó el asistente, y con él Dictar al reporte.",
  },
  'dictation.policyLocal': {
    en: "Only local models are allowed in this workspace: choose one in Assistant settings.",
    es: "En este workspace solo se permiten modelos locales: elegí uno en los ajustes del asistente.",
  },
  'dictation.placing': { en: "Placing…", es: "Ubicando…" },
  'dictation.whichShot': { en: "Which shot?", es: "¿Qué plano?" },
  'dictation.heard': { en: "Heard", es: "Se entendió" },
  'dictation.yourNote': { en: "Your note", es: "Tu nota" },
  'dictation.noteKept': {
    en: "Your note stays here until you choose Done or New note: check that nothing was left out.",
    es: "Tu nota queda acá hasta que toques Listo o Nota nueva: fijate que no haya quedado nada afuera.",
  },
  'dictation.nothing': {
    en: "The assistant couldn't place this note. Edit it and try again, or copy it.",
    es: "El asistente no pudo ubicar esta nota. Editala y probá de nuevo, o copiala.",
  },
  'dictation.replaces': { en: "Replaces “{text}”", es: "Reemplaza «{text}»" },
  'dictation.chosen': { en: "Row chosen by the assistant", es: "Fila elegida por el asistente" },
  'dictation.row': { en: "row {n}", es: "fila {n}" },
  'dictation.newRow': { en: "new: {slate}", es: "nueva: {slate}" },
  'dictation.addRow': { en: "New row after {after}", es: "Fila nueva después de {after}" },
  'dictation.newSection': { en: "New section: {title}", es: "Sección nueva: {title}" },
  'dictation.trimmed': {
    en: "The page is long: only its tables, checklists, labeled lines and the section with the cursor were sent.",
    es: "La página es larga: solo se mandaron sus tablas, casillas, renglones con rótulo y la sección del cursor.",
  },
  'dictation.couldntPlace': { en: "Couldn't place", es: "No se pudo ubicar" },
  'dictation.unplacedHint': {
    en: "These stay on this device after Apply, until you add them to the page or discard them (Copy keeps them).",
    es: "Esto queda en este dispositivo después de Aplicar, hasta que lo agregues a la página o lo descartes (Copiar lo deja).",
  },
  'dictation.addToSummary': { en: "Add to Summary", es: "Agregar al resumen" },
  'dictation.addFailed': {
    en: "It couldn't be added to the page. It's still here.",
    es: "No se pudo agregar a la página. Sigue acá.",
  },
  'dictation.unreadable': {
    en: "The answer couldn't be read. Your note is still here.",
    es: "No se pudo leer la respuesta. Tu nota sigue acá.",
  },
  'dictation.pageEmpty': { en: "This page has nothing to write in.", es: "Esta página no tiene dónde escribir." },
  'dictation.pageTooLong': {
    en: "This page is too long to place a note in it.",
    es: "Esta página es demasiado larga para ubicar una nota.",
  },
  'dictation.changed': {
    en: "Part of the page changed while the assistant was working. Nothing was applied.",
    es: "Parte de la página cambió mientras el asistente trabajaba. No se aplicó nada.",
  },
  'dictation.readOnly': {
    en: "You can't edit this page anymore. Nothing was applied.",
    es: "Ya no podés editar esta página. No se aplicó nada.",
  },
  'dictation.applied': {
    en: { one: "Applied {count} change.", other: "Applied {count} changes." },
    es: { one: "Se aplicó {count} cambio.", other: "Se aplicaron {count} cambios." },
  },
  'dictation.undo': { en: "Undo", es: "Deshacer" },
  'dictation.undone': { en: "Undone. Your note is back.", es: "Deshecho. Tu nota volvió." },
  'dictation.undoLater': {
    en: "The page was edited after this: undo it in the page with {undo}.",
    es: "La página se editó después: deshacelo en la página con {undo}.",
  },
  'dictation.another': { en: "New note", es: "Nota nueva" },
  'dictation.done': { en: "Done", es: "Listo" },
  'dictation.keep': { en: "Keep", es: "Conservar" },
  'dictation.discardNote': { en: "Discard this note?", es: "¿Descartar esta nota?" },
  'dictation.discardPending': {
    en: { one: "Discard {count} unplaced item?", other: "Discard {count} unplaced items?" },
    es: { one: "¿Descartar {count} dato sin ubicar?", other: "¿Descartar {count} datos sin ubicar?" },
  },
  // --- La clave sincronizada (Docs/Doc_Clave_Sincronizada.md, entrega S1) ---
  'assistant.unlockSynced': { en: "Unlock your synced key", es: "Abrir tu clave sincronizada" },
  'assistant.settings.staysSynced': {
    en: "Your key is sent only to {provider}. With sync on, an encrypted copy is stored in {workspace}. The provider charges each request to your account.",
    es: "Tu clave se manda solo a {provider}. Con la sincronización prendida, una copia cifrada queda en {workspace}. Cada pedido lo cobra el proveedor a tu cuenta.",
  },
  'assistant.sync.title': { en: "Sync across my devices", es: "Sincronizar en mis dispositivos" },
  'assistant.sync.needKey': { en: "Save a key first to sync it across your devices.", es: "Primero guardá una clave para sincronizarla en tus dispositivos." },
  'assistant.sync.onlyHere': { en: "Your key is only on this device.", es: "Tu clave está solo en este dispositivo." },
  'assistant.sync.turnOn': { en: "Turn on sync…", es: "Prender la sincronización…" },
  'assistant.sync.synced': { en: "Synced in {workspace} · updated {date}.", es: "Sincronizada en {workspace} · actualizada el {date}." },
  'assistant.sync.localChanged': {
    en: "The key on this device is different from the synced one.",
    es: "La clave de este dispositivo es distinta de la sincronizada.",
  },
  'assistant.sync.update': { en: "Update synced key", es: "Actualizar la clave sincronizada" },
  'assistant.sync.updateText': {
    en: "Enter your passphrase to replace the synced copy with the key on this device.",
    es: "Escribí tu frase para reemplazar la copia sincronizada por la clave de este dispositivo.",
  },
  'assistant.sync.updated': { en: "Your synced key was updated.", es: "Se actualizó tu clave sincronizada." },
  'assistant.sync.replace': { en: "Replace synced key…", es: "Reemplazar la clave sincronizada…" },
  'assistant.sync.replaceText': {
    en: "For a lost device: first Sign out other devices (account menu), create a new key at your provider and save it here. Then replace the synced copy with it and a new passphrase: your other devices will ask for the new one.",
    es: "Para un dispositivo perdido: primero Cerrar la sesión en los otros dispositivos (menú de la cuenta), creá una clave nueva en tu proveedor y guardala acá. Después reemplazá la copia sincronizada con ella y una frase nueva: tus otros dispositivos te van a pedir la nueva.",
  },
  'assistant.sync.currentPassphrase': { en: "Current passphrase", es: "Frase actual" },
  'assistant.sync.newPassphrase': { en: "New passphrase", es: "Frase nueva" },
  'assistant.sync.replaceButton': { en: "Replace synced key", es: "Reemplazar la clave sincronizada" },
  'assistant.sync.replaced': {
    en: "Your synced key was replaced. Use the new passphrase on your other devices.",
    es: "Se reemplazó tu clave sincronizada. Usá la frase nueva en tus otros dispositivos.",
  },
  'assistant.sync.stop': { en: "Stop syncing", es: "Dejar de sincronizar" },
  'assistant.sync.stopText': {
    en: "Delete the synced copy from {workspace}? Your key stays on this device.",
    es: "¿Borrar la copia sincronizada de {workspace}? Tu clave queda en este dispositivo.",
  },
  'assistant.sync.deleteCopy': { en: "Delete copy", es: "Borrar la copia" },
  'assistant.sync.stopped': {
    en: "The synced copy was deleted. Your key stays on this device.",
    es: "Se borró la copia sincronizada. Tu clave queda en este dispositivo.",
  },
  'assistant.sync.locked': {
    en: "Your key is synced (saved {date}). Enter your passphrase to use it on this device.",
    es: "Tu clave está sincronizada (guardada el {date}). Escribí tu frase para usarla en este dispositivo.",
  },
  'assistant.sync.elsewhere': { en: "Your key is synced in {workspace}.", es: "Tu clave está sincronizada en {workspace}." },
  'assistant.sync.passphrase': { en: "Passphrase", es: "Frase" },
  'assistant.sync.unlock': { en: "Unlock", es: "Abrir" },
  'assistant.sync.forgot': {
    en: "Forgot it? Paste your API key again and choose a new passphrase.",
    es: "¿La olvidaste? Pegá tu clave de la API de nuevo y elegí una frase nueva.",
  },
  'assistant.sync.newPassphraseButton': { en: "Choose a new passphrase…", es: "Elegir una frase nueva…" },
  'assistant.sync.unlocked': { en: "Unlocked: {provider} key ending in …{end}.", es: "Abierta: clave de {provider} que termina en …{end}." },
  'assistant.sync.unlockedAt': {
    en: "Unlocked: {provider} at {host}, key ending in …{end}.",
    es: "Abierta: {provider} en {host}, clave que termina en …{end}.",
  },
  'assistant.sync.ask': { en: "Your synced key now goes to {host}. Use it?", es: "Tu clave sincronizada ahora va a {host}. ¿La usás?" },
  'assistant.sync.askReplace': {
    en: "Replace the key on this device (…{local}) with the synced one (…{synced})?",
    es: "¿Reemplazar la clave de este dispositivo (…{local}) por la sincronizada (…{synced})?",
  },
  'assistant.sync.changed': {
    en: "Your synced key changed on another device. Enter your passphrase to update it here.",
    es: "Tu clave sincronizada cambió en otro dispositivo. Escribí tu frase para actualizarla acá.",
  },
  'assistant.sync.useIt': { en: "Use it", es: "Usarla" },
  'assistant.sync.keepMine': { en: "Keep my current key", es: "Seguir con mi clave" },
  'assistant.sync.kept': { en: "Your current key stays on this device.", es: "Tu clave de ahora queda en este dispositivo." },
  'assistant.sync.wrong': { en: "That passphrase doesn't open your synced key.", es: "Esa frase no abre tu clave sincronizada." },
  'assistant.sync.unlockOffline': { en: "Unlocking needs internet.", es: "Para abrirla hace falta internet." },
  'assistant.sync.offline': { en: "Syncing your key needs internet.", es: "Para sincronizar tu clave hace falta internet." },
  'assistant.sync.missing': {
    en: "This workspace's database needs an update to sync your key.",
    es: "La base de este workspace necesita una actualización para sincronizar tu clave.",
  },
  'assistant.sync.policyOff': {
    en: "The owner turned the assistant off in this workspace, so your key can't be synced here.",
    es: "El dueño apagó el asistente en este workspace, así que tu clave no se puede sincronizar acá.",
  },
  'assistant.sync.newer': {
    en: "This synced key was saved by a newer version of the app. Update the app to unlock it.",
    es: "Esta clave sincronizada la guardó una versión más nueva de la app. Actualizá la app para abrirla.",
  },
  'assistant.sync.tooLong': { en: "This key or Base URL is too long to sync.", es: "Esta clave o esta dirección son demasiado largas para sincronizar." },
  'assistant.sync.conflict': {
    en: "Your synced key changed on another device. Reload it?",
    es: "Tu clave sincronizada cambió en otro dispositivo. ¿La volvés a cargar?",
  },
  'assistant.sync.reload': { en: "Reload", es: "Volver a cargar" },
  'assistant.sync.failed': { en: "Couldn't sync your key. Try again.", es: "No se pudo sincronizar tu clave. Probá de nuevo." },
  'assistant.sync.done': { en: "Your key is synced in {workspace}.", es: "Tu clave está sincronizada en {workspace}." },
  'assistant.sync.yourPassphrase': { en: "Your passphrase", es: "Tu frase" },
  'assistant.sync.copy': { en: "Copy", es: "Copiar" },
  'assistant.sync.newOne': { en: "New one", es: "Otra" },
  'assistant.sync.saveIt': {
    en: "Save it in your password manager. You'll need it once on each new device. If you lose it, nobody can recover it: you'll paste your API key again.",
    es: "Guardala en tu gestor de contraseñas. La vas a necesitar una vez en cada dispositivo nuevo. Si la perdés, nadie la puede recuperar: vas a pegar tu clave de la API de nuevo.",
  },
  'assistant.sync.copied': {
    en: "Copied. Copied passphrases can stay in your clipboard history.",
    es: "Copiada. Una frase copiada puede quedar en el historial del portapapeles.",
  },
  'assistant.sync.useOwn': { en: "Use my own passphrase instead", es: "Usar una frase mía" },
  'assistant.sync.useGenerated': { en: "Use a generated passphrase", es: "Usar una frase generada" },
  'assistant.sync.ownWarning': {
    en: "A passphrase you make up is much easier to guess than a generated one. Anyone who gets a copy of this workspace's database could try.",
    es: "Una frase que inventás es mucho más fácil de adivinar que una generada. Cualquiera que consiga una copia de la base de este workspace podría intentarlo.",
  },
  'assistant.sync.ownRule': { en: "At least 20 characters and four words.", es: "Al menos 20 caracteres y cuatro palabras." },
  'assistant.sync.repeat': { en: "Repeat it", es: "Repetila" },
  'assistant.sync.mismatch': { en: "The two passphrases don't match.", es: "Las dos frases no coinciden." },
  'assistant.sync.saved': { en: "I saved my passphrase", es: "Guardé mi frase" },
  'assistant.sync.turnOnButton': { en: "Turn on sync", es: "Prender la sincronización" },
  'assistant.sync.footnote': {
    en: "Your key is encrypted on this device with your passphrase. {workspace} stores only the encrypted copy and can't read it.",
    es: "Tu clave se cifra en este dispositivo con tu frase. {workspace} guarda solo la copia cifrada y no la puede leer.",
  },
  // S2 (Doc_Clave_Sincronizada.md, sección 9)
  'assistant.sync.change': { en: "Change passphrase…", es: "Cambiar la frase…" },
  'assistant.sync.changeText': {
    en: "Your synced key stays the same; only the passphrase changes. Your other devices will ask for the new one.",
    es: "Tu clave sincronizada sigue igual; solo cambia la frase. Tus otros dispositivos te van a pedir la nueva.",
  },
  'assistant.sync.changeButton': { en: "Change passphrase", es: "Cambiar la frase" },
  'assistant.sync.passphraseChanged': {
    en: "Your passphrase was changed. Use the new one on your other devices.",
    es: "Se cambió tu frase. Usá la nueva en tus otros dispositivos.",
  },
  'assistant.sync.keepHere': { en: "Keep the key on this device", es: "Guardar la clave en este dispositivo" },
  'assistant.sync.keepHereTip': {
    en: "Off on a borrowed computer: the key lives only in this tab.",
    es: "Destildala en una computadora prestada: la clave vive solo en esta pestaña.",
  },
  'assistant.sync.tabOnly': {
    en: "This key is only in this tab. If you reload, you'll need your passphrase again.",
    es: "Esta clave está solo en esta pestaña. Si recargás, vas a necesitar tu frase de nuevo.",
  },
  'assistant.sync.older': {
    en: "This synced copy is older than the one on this device.",
    es: "Esta copia sincronizada es más vieja que la de este dispositivo.",
  },
  'assistant.sync.alsoSync': { en: "Also sync in this workspace…", es: "Sincronizar también en este workspace…" },
  'assistant.sync.alsoText': {
    en: "Enter the passphrase you use in {other}, twice. {workspace} gets its own encrypted copy.",
    es: "Escribí dos veces la frase que usás en {other}. {workspace} recibe su propia copia cifrada.",
  },
  'assistant.sync.alsoButton': { en: "Sync here too", es: "Sincronizar también acá" },
  'assistant.sync.useNewPassphrase': { en: "Use a new passphrase instead", es: "Usar una frase nueva" },
  'assistant.sync.voiceUnlocked': {
    en: "Voice: {provider} key ending in …{end}.",
    es: "Voz: clave de {provider} que termina en …{end}.",
  },
  'assistant.sync.voiceUnlockedAt': {
    en: "Voice: {provider} at {host}, key ending in …{end}.",
    es: "Voz: {provider} en {host}, clave que termina en …{end}.",
  },
  'assistant.sync.askVoice': {
    en: "Your synced voice key now goes to {host}. Use it?",
    es: "Tu clave de voz sincronizada ahora va a {host}. ¿La usás?",
  },
  'assistant.sync.askVoiceReplace': {
    en: "Replace the voice key on this device (…{local}) with the synced one (…{synced})?",
    es: "¿Reemplazar la clave de voz de este dispositivo (…{local}) por la sincronizada (…{synced})?",
  },
  'assistant.sync.stopTextTab': {
    en: "Delete the synced copy from {workspace}? Your key is only in this tab: after you reload, it won't be on this computer.",
    es: "¿Borrar la copia sincronizada de {workspace}? Tu clave está solo en esta pestaña: al recargar, no va a estar en esta computadora.",
  },
  'assistant.sync.stoppedTab': {
    en: "The synced copy was deleted. Your key is only in this tab until you reload.",
    es: "Se borró la copia sincronizada. Tu clave está solo en esta pestaña hasta que recargues.",
  },
  'assistant.sync.forgotTabKeepsSaved': {
    en: "Forgot the key in this tab. The key saved on this device before stays.",
    es: "Se olvidó la clave de esta pestaña. La que este dispositivo tenía guardada de antes queda.",
  },
  'assistant.sync.keepMyVoice': { en: "Keep my voice key", es: "Seguir con mi clave de voz" },
  'assistant.sync.keptVoice': { en: "Your current voice key stays on this device.", es: "Tu clave de voz de ahora queda en este dispositivo." },
  'assistant.sync.updateHere': { en: "Enter your passphrase to update it here", es: "Escribir tu frase para actualizarla acá" },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(assistant);
