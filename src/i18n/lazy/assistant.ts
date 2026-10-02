import { register } from '../index';
import type { Dict } from '../types';

// El asistente (Docs/Doc_Asistente.md, entregas A1 y A2): el panel, la ventana de ajustes y la política del workspace.
// Se carga aparte, con ellos.

export const assistant = {
  'assistant.title': { en: "Assistant", es: "Asistente" },
  'assistant.settings': { en: "Assistant settings", es: "Ajustes del asistente" },
  'assistant.close': { en: "Close the assistant", es: "Cerrar el asistente" },
  'assistant.setupText': {
    en: "Fix, improve, shorten, translate or reshape what you select, or summarize and translate the whole page, with your own key from Anthropic, OpenAI, Google or a compatible service. The key stays on this device.",
    es: "Corregí, mejorá, acortá, traducí o cambiale la forma a lo que elijas, o resumí y traducí toda la página, con tu propia clave de Anthropic, OpenAI, Google o un servicio compatible. La clave queda en este dispositivo.",
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
  'assistant.format.nested': {
    en: "Some of these blocks have blocks nested inside, and the new shape would remove them. Nothing was applied.",
    es: "Algunos de estos bloques tienen bloques adentro, y la forma nueva los sacaría. No se aplicó nada.",
  },
  'assistant.format.history': {
    en: "Edits others make to this text at the same time may only remain in the history.",
    es: "Lo que otros escriban en este texto al mismo tiempo puede quedar solo en el historial.",
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
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(assistant);
