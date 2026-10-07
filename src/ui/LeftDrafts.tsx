import { useT } from '../i18n';
import { copyText, dropLeftDrafts, markLeftCopied, useLeftDrafts } from './commentsUi';

// Lo que quedó de un comentario a medio escribir cuando la app se reemplazó sola (Docs/Doc_Sincronizacion.md, "Un cuadro
// abierto y lo que llega de afuera"): otra pestaña tomó el control, sacaron a la persona del workspace, se quedó sin
// proyectos, un error frenó la app, venció la sesión. El cuadro se desmontó con la pantalla que dibuja los avisos, así
// que el aviso con *Copy text* no lo vio nadie; nadie pidió nada, así que tampoco hubo a quién preguntarle.
//
// Este cartel va por encima de todo lo que se reemplaza (junto a la barrera de la raíz, ErrorBarrier.tsx) y queda a la
// vista hasta que la persona copia el texto o lo descarta: no tiene tiempo, porque en esas pantallas puede no estar
// mirando. Depende solo de lo que guarda `commentsUi.ts` en memoria (que también pregunta al cerrar la ventana mientras
// no se copió) y de los textos de la app: nada de los servicios, del árbol ni de la pantalla que falló. Solo tiene lo de
// la cuenta que está adentro (o la última, sin sesión): `setDraftOwner`.

export function LeftDrafts() {
  const { texts, copied } = useLeftDrafts();
  const tr = useT();
  if (texts.length === 0) return null;
  const count = texts.length;
  return (
    <section className="left-drafts" role="alert">
      <p>
        <strong>{tr('comments.left.title', { count })}</strong> {tr('comments.left.text', { count })}
      </p>
      {/* Con muchos textos o muy largos se recorren adentro: el título y los botones quedan siempre a la vista. */}
      <div className="left-drafts-texts">
        {texts.map((text, i) => (
          <p key={i} className="left-draft">
            {text}
          </p>
        ))}
      </div>
      <div className="left-drafts-actions">
        {/* Todos, en el orden en que estaban en el panel, separados por una línea en blanco (como el aviso, D343). */}
        <button className="secondary" onClick={() => void copyText(texts.join('\n\n')).then((ok) => ok && markLeftCopied(texts))}>
          {copied ? tr('common.copied') : count > 1 ? tr('comments.copyAllTexts', { count }) : tr('sync.copyText')}
        </button>
        <button
          className="link"
          onClick={() => {
            // Sin haberlo copiado, descartarlo lo pierde: pregunta antes.
            if (!copied && !window.confirm(tr('comments.discardDraft'))) return;
            dropLeftDrafts();
          }}
        >
          {tr('common.discard')}
        </button>
      </div>
    </section>
  );
}
