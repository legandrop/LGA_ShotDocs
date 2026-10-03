import { register } from '../index';
import type { Dict } from '../types';

// La pantalla de permiso de un asistente (MCP, Docs/Doc_Asistente.md, 9.2; se carga aparte, solo en esa dirección).

export const oauthConsent = {
  'oauth.loading': { en: "Opening the request…", es: "Abriendo el pedido…" },
  'oauth.title': { en: "{client} wants to connect to LGA Shot Docs", es: "{client} quiere conectarse a LGA Shot Docs" },
  'oauth.unnamed': { en: "An app without a name", es: "Una app sin nombre" },
  'oauth.as': { en: "It will use your account, {email}, in {workspace}.", es: "Va a usar tu cuenta, {email}, en {workspace}." },
  'oauth.returnsTo': { en: "Returns to", es: "Vuelve a" },
  'oauth.returnsTo.tip': {
    en: "Full address: {uri}. Anyone can register an app with any name: check that this is your assistant.",
    es: "Dirección completa: {uri}. Cualquiera puede registrar una app con cualquier nombre: fijate que sea tu asistente.",
  },
  'oauth.local': { en: "an app on this computer", es: "una app de esta computadora" },
  'oauth.asks': { en: "It asks for", es: "Pide" },
  'oauth.scope.email': { en: "Your email address", es: "Tu correo" },
  'oauth.scope.openid': { en: "Confirm who you are", es: "Confirmar quién sos" },
  'oauth.scope.profile': { en: "Your name and picture", es: "Tu nombre y tu foto" },
  'oauth.scope.phone': { en: "Your phone number", es: "Tu teléfono" },
  'oauth.scope.offline': { en: "Stay connected while you're away", es: "Seguir conectado aunque no estés" },
  'oauth.warning': {
    en: "Allow it only if you just started this connection from your assistant. It will be able to read your pages in this workspace through Shot Docs.",
    es: "Permitilo solo si recién empezaste esta conexión desde tu asistente. Va a poder leer tus páginas de este workspace a través de Shot Docs.",
  },
  'oauth.allow': { en: "Allow", es: "Permitir" },
  'oauth.deny': { en: "Deny", es: "No permitir" },
  'oauth.returning': { en: "Returning to {host}…", es: "Volviendo a {host}…" },
  'oauth.signIn': { en: "Sign in to connect your assistant.", es: "Entrá para conectar tu asistente." },
  'oauth.error.title': { en: "Couldn't connect the assistant", es: "No se pudo conectar el asistente" },
  'oauth.error.missing': {
    en: "This link is incomplete. Start the connection again from your assistant.",
    es: "Este link está incompleto. Empezá la conexión de nuevo desde tu asistente.",
  },
  'oauth.error.expired': {
    en: "This request expired or was already answered. Start the connection again from your assistant.",
    es: "Este pedido venció o ya se contestó. Empezá la conexión de nuevo desde tu asistente.",
  },
  'oauth.error.disabled': {
    en: "Assistant connections aren't turned on in this workspace.",
    es: "Las conexiones de asistentes no están prendidas en este workspace.",
  },
  'oauth.error.offline': {
    en: "No connection. Check the internet and try again.",
    es: "Sin conexión. Revisá internet y probá de nuevo.",
  },
  'oauth.error.other': { en: "Something went wrong with this request.", es: "Algo salió mal con este pedido." },
  'oauth.error.detail': { en: "Details: {detail}", es: "Detalle: {detail}" },
  'oauth.retry': { en: "Try again", es: "Probar de nuevo" },
  'oauth.openApp': { en: "Open the app", es: "Abrir la app" },
  'oauth.noWorkspace.title': { en: "This workspace isn't on this device", es: "Este workspace no está en este dispositivo" },
  'oauth.noWorkspace.text': {
    en: "The assistant asked to connect to a workspace ({ref}) that this device doesn't have. Open its invitation link first, then start the connection again.",
    es: "El asistente pidió conectarse a un workspace ({ref}) que este dispositivo no tiene. Abrí primero su link de invitación y después empezá la conexión de nuevo.",
  },
} satisfies Dict;

register(oauthConsent);
