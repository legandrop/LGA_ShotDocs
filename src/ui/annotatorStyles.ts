import { cleanStyles, TOOLS, type DrawTool, type Tool, type ToolStyle } from '../media/markupEdit';
import { safeColor } from '../media/markup';

// El estilo de cada herramienta del anotador, recordado POR DISPOSITIVO (como el INI de FrameRev): elegir rojo en
// Arrow no tiñe Ellipse, y lo que se cambia en una forma elegida queda como el de la próxima. Es una comodidad: si el
// navegador no deja guardar (ventana privada), el anotador anda igual con los de fábrica.

const KEY = 'shotdocs-annotate-styles';

export interface AnnotatorPrefs {
  styles: Record<DrawTool, ToolStyle>;
  recent: string[];
  /** La última herramienta usada (la próxima vez abre con esa). */
  tool: Tool;
}

/** Lo guardado, limpio (cualquier cosa rara vuelve a los valores de fábrica). */
export function parsePrefs(raw: string | null): AnnotatorPrefs {
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  const o = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const recent = Array.isArray(o.recent) ? o.recent.map((c) => safeColor(c, '')).filter(Boolean).slice(0, 8) : [];
  const tool = typeof o.tool === 'string' && (TOOLS as readonly string[]).includes(o.tool) ? (o.tool as Tool) : 'arrow';
  return { styles: cleanStyles(o.styles), recent: [...new Set(recent)], tool };
}

export function loadPrefs(): AnnotatorPrefs {
  try {
    return parsePrefs(localStorage.getItem(KEY));
  } catch {
    return parsePrefs(null);
  }
}

export function savePrefs(p: AnnotatorPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Sin almacenamiento: queda para esta vez.
  }
}
