import { useRef } from 'react';
import { useT } from '../i18n';
import { followHeight, useNotice } from './notice';

/**
 * Anota en la app el alto del aviso a la vista (`--notice-height`): puede ocupar varios renglones, y los avisos que van
 * apilados encima (el avance de reemplazar, los del espacio) se corren con él (styles.css). Sin aviso, la variable no
 * está.
 */
const followNoticeHeight = followHeight('--notice-height', 0, 'parent');

/**
 * El aviso a la vista, abajo: el texto, sus botones (*Undo*…) y OK. Con el mouse o el foco encima no vence (D712): llegar
 * al botón lleva su tiempo, y a veces es la única forma de volver atrás.
 */
export function NoticeBar() {
  const [notice, dismissNotice, noticeAction, noticeSecond, holdNotice] = useNotice();
  const tr = useT();
  // Un clic o un toque en un botón del aviso también le da el foco: ese foco no lo sostiene (si no, el aviso que sigue
  // queda quieto hasta un clic afuera). Solo el que llega con el teclado (Tab) lo sostiene.
  const byPointer = useRef(false);
  if (!notice) return null;
  return (
    <div
      className="notice"
      role="status"
      ref={followNoticeHeight}
      // Solo un mouse lo sostiene: un toque en el teléfono emula «mouse encima» hasta el próximo toque afuera (D717).
      onPointerEnter={(e) => e.pointerType === 'mouse' && holdNotice('mouse', true)}
      onPointerLeave={() => holdNotice('mouse', false)}
      onPointerDownCapture={() => {
        byPointer.current = true;
      }}
      onFocus={() => {
        if (!byPointer.current) holdNotice('focus', true);
        byPointer.current = false;
      }}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && holdNotice('focus', false)}
    >
      <span>{notice}</span>
      {noticeAction && (
        <button
          className="link"
          onClick={() => {
            dismissNotice();
            noticeAction.run();
          }}
        >
          {noticeAction.label}
        </button>
      )}
      {noticeSecond && (
        <button
          className="link"
          onClick={() => {
            dismissNotice();
            noticeSecond.run();
          }}
        >
          {noticeSecond.label}
        </button>
      )}
      <button className="link" onClick={dismissNotice}>
        {tr('common.ok')}
      </button>
    </div>
  );
}
