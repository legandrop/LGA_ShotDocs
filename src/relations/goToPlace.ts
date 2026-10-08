import { navigate, pagePath } from '../router';
import { searchSession } from '../ui/projectSearchUi';
import type { IndexDocs, IndexTree } from '../search/projectIndex';
import type { Place } from './liveView';

// Ir al lugar exacto desde la cabecera viva (Docs/Doc_Relaciones.md, sección 10): abre la página en la sección (o el
// bloque), la abre si estaba colapsada (para vos, como «Ir al bloque» de los comentarios) y la resalta un momento.
// Va por el mismo pedido que la búsqueda del proyecto (`ResultRequest`): lo toma el editor de esa página cuando está
// listo, y lo muestra con `showPlace` (placeFlash.ts, que va con el editor: la primera carga no lo trae).

export function goToPlace(services: { tree: IndexTree; docs: IndexDocs }, place: Place): void {
  searchSession(services).requestResult({
    pageId: place.pageId,
    term: null,
    blockId: place.blockId,
    place: { endBlockId: place.endBlockId },
  });
  // En la misma página `navigate` no hace nada: el editor, ya abierto, toma el pedido enseguida.
  navigate(pagePath(place.pageId));
}
