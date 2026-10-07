import { register } from '../index';
import type { Dict } from '../types';

// La lista de archivos por peso del selector de proyectos (P.8; se carga aparte, con la lista).

export const filesBySize = {
  'filesBySize.project': { en: "Project", es: "Proyecto" },
  'filesBySize.total': {
    en: { one: "{size} in Google Drive, in {files} file", other: "{size} in Google Drive, in {files} files" },
    es: { one: "{size} en Google Drive, en {files} archivo", other: "{size} en Google Drive, en {files} archivos" },
  },
  'filesBySize.intro': {
    en: "Heaviest first. To free space, take a file out of its pages and then send it to the Google Drive trash from Trash › Files.",
    es: "Del más pesado al más liviano. Para liberar espacio, sacá el archivo de sus páginas y después mandalo a la papelera de Google Drive desde Papelera › Archivos.",
  },
  'filesBySize.kindPhoto': { en: "Photo", es: "Foto" },
  'filesBySize.kindVideo': { en: "Video", es: "Video" },
  'filesBySize.kindFolder': { en: "Folder", es: "Carpeta" },
  'filesBySize.kindFile': { en: "File", es: "Archivo" },
  'filesBySize.unused': {
    en: "Not used on any page (it's in the trash)",
    es: "No lo usa ninguna página (está en la papelera)",
  },
  'filesBySize.pageInTrash': { en: "{page} (in the trash)", es: "{page} (en la papelera)" },
  'filesBySize.pageElsewhere': { en: "{page} · {project}", es: "{page} · {project}" },
  'filesBySize.noPage': {
    en: "On a page you can't open from this device",
    es: "En una página que no podés abrir desde este dispositivo",
  },
  'filesBySize.morePages': {
    en: { one: "+{count} more page", other: "+{count} more pages" },
    es: { one: "+{count} página más", other: "+{count} páginas más" },
  },
  'filesBySize.more': { en: "Show more", es: "Mostrar más" },
  'filesBySize.empty': {
    en: "This project has no files in Google Drive.",
    es: "Este proyecto no tiene archivos en Google Drive.",
  },
  'filesBySize.offline': {
    en: "The list of files needs an internet connection.",
    es: "La lista de archivos necesita conexión a internet.",
  },
  'filesBySize.failed': {
    en: "The files could not be listed ({reason}).",
    es: "No se pudo leer la lista de archivos ({reason}).",
  },
  'filesBySize.notAllowed': {
    en: "Only people who see this project's file trash can see this list.",
    es: "Esta lista la ve solo quien ve la papelera de archivos del proyecto.",
  },
  'filesBySize.hidden': {
    en: "{size} more is in files you can't see from here.",
    es: "Hay {size} más en archivos que no podés ver desde acá.",
  },
} satisfies Dict;

// Se suma al diccionario cuando se carga la parte que lo usa (viaja con ella, no en la primera carga).
register(filesBySize);
