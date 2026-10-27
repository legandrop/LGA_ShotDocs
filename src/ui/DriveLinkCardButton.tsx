import { useBlockNoteEditor, useComponentsContext, type LinkToolbarProps } from '@blocknote/react';
import { useT } from '../i18n';
import '../i18n/lazy/editor';
import { DRIVE_CARD_PROP } from './driveCard';
import { parseDriveLink } from './driveLinks';
import { showLinkAsCard } from './drivePaste';

// "Show as card" en la barra del link (D796): un link de Drive ya escrito (video, foto, carpeta, documento) pasa a ser
// la tarjeta con el reproductor, como "Card" al pegar. No aparece en solo lectura, con un link que no es de Drive ni en
// el link del pie de una tarjeta (ya es una).

/** El link `href` en `from` se puede mostrar como tarjeta: es de Drive y no está ya en una tarjeta. */
export function canShowAsCard(doc: { content: { size: number }; resolve(pos: number): { parent: { type: { name: string }; attrs: Record<string, unknown> } } }, from: number, href: string): boolean {
  if (!parseDriveLink(href) || from < 0 || from > doc.content.size) return false;
  const parent = doc.resolve(from).parent;
  return !(parent.type.name === 'paragraph' && parent.attrs[DRIVE_CARD_PROP] === true);
}

/** Una tarjeta con el triángulo de reproducir. */
function CardIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="4" width="15" height="12" rx="2" />
      <path d="M8.5 7.75v4.5L12.25 10z" fill="currentColor" />
    </svg>
  );
}

export function DriveLinkCardButton(props: Pick<LinkToolbarProps, 'url' | 'range' | 'setToolbarOpen'>) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const tr = useT();
  if (!editor.isEditable || !canShowAsCard(editor.prosemirrorState.doc, props.range.from, props.url)) return null;
  const label = tr('driveCard.showAsCard');
  return (
    <Components.LinkToolbar.Button
      className="bn-button"
      label={label}
      {...({ 'data-tip': label } as object)}
      isSelected={false}
      onClick={() => {
        props.setToolbarOpen?.(false);
        showLinkAsCard(editor, props.range.from, props.range.to, props.url);
        editor.focus();
      }}
      icon={<CardIcon />}
    />
  );
}
