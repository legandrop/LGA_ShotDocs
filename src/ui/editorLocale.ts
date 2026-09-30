import type { Dictionary } from '@blocknote/core';
import { es } from '@blocknote/core/locales';
import type { Language } from '../prefs';

// Los textos propios del editor (menú "/", barras, menús de tablas, placeholders) vienen en los
// diccionarios de BlockNote. El castellano de BlockNote es de España ("Escribe", "Haz clic", "Vídeo"): acá
// se pasan a vos y a "video" los que se ven en la app. En inglés se usa el de fábrica.

type Deep<T> = { [K in keyof T]?: T[K] extends (...args: never[]) => unknown ? T[K] : T[K] extends object ? Deep<T[K]> : T[K] };

const RIOPLATENSE: Deep<Dictionary> = {
  slash_menu: {
    emoji: { ...es.slash_menu.emoji, subtext: 'Buscá e insertá un emoji' },
    video: { ...es.slash_menu.video, title: 'Video', subtext: 'Video con leyenda, se le puede cambiar el tamaño' },
    image: { ...es.slash_menu.image, subtext: 'Imagen con leyenda, se le puede cambiar el tamaño' },
  },
  placeholders: {
    default: 'Escribí, o “/” para ver los comandos',
    new_comment: 'Escribí un comentario…',
    edit_comment: 'Editá el comentario…',
    comment_reply: 'Agregá un comentario…',
  },
  file_blocks: { add_button_text: { ...es.file_blocks.add_button_text, video: 'Agregar video' } },
  toggle_blocks: { add_block_button: 'Lista plegable vacía. Hacé clic para agregar un bloque.' },
  color_picker: { colors: { ...es.color_picker.colors, purple: 'Violeta' } },
  formatting_toolbar: {
    comment: { tooltip: 'Agregar comentario' },
    file_replace: { tooltip: { ...es.formatting_toolbar.file_replace.tooltip, video: 'Reemplazar video' } },
    file_rename: {
      tooltip: { ...es.formatting_toolbar.file_rename.tooltip, video: 'Renombrar video' },
      input_placeholder: { ...es.formatting_toolbar.file_rename.input_placeholder, video: 'Renombrar video' },
    },
    file_download: { tooltip: { ...es.formatting_toolbar.file_download.tooltip, video: 'Descargar video' } },
    file_delete: { tooltip: { ...es.formatting_toolbar.file_delete.tooltip, video: 'Eliminar video' } },
  },
  file_panel: {
    upload: { file_placeholder: { ...es.file_panel.upload.file_placeholder, video: 'Subir video' } },
    embed: { embed_button: { ...es.file_panel.embed.embed_button, video: 'Insertar video' }, url_placeholder: 'Pegá la dirección' },
  },
  comments: { discard_pending_comment: '¿Descartar este comentario?' },
  exporter: { open_video_file: 'Abrir video' },
};

function merge<T>(base: T, patch: Deep<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = out[key];
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object'
        ? merge(current, value as Deep<typeof current>)
        : value;
  }
  return out as T;
}

let spanish: Dictionary | null = null;

/** El diccionario del editor para el idioma de la interfaz (`undefined`: el inglés de fábrica). */
export function editorDictionary(lang: Language): Dictionary | undefined {
  if (lang !== 'es') return undefined;
  spanish ??= merge(es, RIOPLATENSE);
  return spanish;
}
