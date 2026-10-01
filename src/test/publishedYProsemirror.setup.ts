// Antes de las pruebas *.published.test.ts: arma la librería de las versiones publicadas (publishedYProsemirror.ts).
import { buildPublishedYProsemirror } from './publishedYProsemirror';

export default function setup(): void {
  buildPublishedYProsemirror();
}
