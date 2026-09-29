import { BlockNoteSchema, defaultBlockSpecs, type Block } from '@blocknote/core';
import '@blocknote/core/fonts/inter.css';
import { withCollaboration } from '@blocknote/core/yjs';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { useCreateBlockNote } from '@blocknote/react';
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { useServices, useSyncStatus } from '../services';
import { FileRejected, isAllowedImage } from '../sync/files';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { notify } from './notice';
import { useColorScheme } from './useColorScheme';

// En la fase 1 solo se guardan imágenes (el bucket no acepta otros archivos): sin bloques de archivo,
// video ni audio.
const { audio: _audio, file: _file, video: _video, ...blockSpecs } = defaultBlockSpecs;
const schema = BlockNoteSchema.create({ blockSpecs });

type Opening = { state: 'loading' } | { state: 'ready'; doc: Y.Doc; complete: boolean };

export function PageEditor({ pageId }: { pageId: string }) {
  const { docs, engine } = useServices();
  const status = useSyncStatus();
  const [opening, setOpening] = useState<Opening>({ state: 'loading' });
  const incomplete = opening.state === 'ready' && !opening.complete;

  // Si el servidor tiene contenido de esta página que el dispositivo todavía no bajó, se muestra lo que
  // hay en solo lectura: editar sobre un documento a medio bajar arma una estructura paralela. Cuando
  // llega lo que falta, se vuelve a abrir para editar.
  useEffect(() => {
    let cancelled = false;
    let opened = false;
    void engine.prefetchPage(pageId).then(async (complete) => {
      if (cancelled) return;
      const doc = await docs.open(pageId, { seed: complete });
      opened = true;
      if (cancelled) docs.close(pageId);
      else setOpening({ state: 'ready', doc, complete });
    });
    return () => {
      cancelled = true;
      if (opened) docs.close(pageId);
      setOpening({ state: 'loading' });
    };
    // Mientras falte contenido, cada sincronización vuelve a probar.
  }, [docs, engine, pageId, incomplete ? status.lastSyncAt : null]);

  if (opening.state === 'loading') return <div className="editor-placeholder" />;
  return (
    <>
      {!opening.complete && (
        <p className="muted editor-missing">
          {status.online
            ? 'Part of this page is still downloading. It opens for editing as soon as it arrives.'
            : 'Part of this page has not been downloaded to this device yet. You can read what is here; connect to the internet to edit it.'}
        </p>
      )}
      <BlockEditor key={`${pageId}:${opening.complete}`} doc={opening.doc} pageId={pageId} editable={opening.complete} />
    </>
  );
}

function BlockEditor({ doc, pageId, editable }: { doc: Y.Doc; pageId: string; editable: boolean }) {
  const { files, user } = useServices();
  const scheme = useColorScheme();
  const editor = useCreateBlockNote(
    withCollaboration({
      schema,
      uploadFile: (file: File) =>
        files.add(pageId, file).catch((err: unknown) => {
          notify(err instanceof FileRejected ? err.message : 'This image could not be saved on this device.');
          throw err;
        }),
      resolveFileUrl: (url: string) => files.resolve(url),
      tables: { splitCells: true, cellBackgroundColor: true, cellTextColor: true, headers: true },
      collaboration: {
        fragment: doc.getXmlFragment(CONTENT_FRAGMENT),
        user: { name: user.email, color: '#2383e2' },
      },
    }),
    [doc],
  );

  useEffect(() => {
    const focus = () => editor.focus();
    window.addEventListener('shotdocs:focus-editor', focus);
    return () => window.removeEventListener('shotdocs:focus-editor', focus);
  }, [editor]);

  // Una imagen pegada dentro de HTML puede venir embebida (`data:`): se pasa a archivo para que el
  // documento no cargue megas y la imagen se sincronice como las demás. Solo lo hace el dispositivo que la
  // pegó (cambios locales), así no se sube una copia por cada dispositivo que abre la página.
  useEffect(() => {
    if (!editable) return;
    const converting = new Set<string>();
    return editor.onChange((_, { getChanges }) => {
      for (const change of getChanges()) {
        if (change.type === 'delete' || change.type === 'move') continue;
        for (const block of flatten([change.block as Block])) {
          const url = (block.props as { url?: string }).url;
          if (block.type !== 'image' || !url?.startsWith('data:') || converting.has(block.id)) continue;
          converting.add(block.id);
          void fetch(url)
            .then((r) => r.blob())
            .then((blob) => files.add(pageId, blob))
            .then((stored) => {
              if (editor.getBlock(block.id)) editor.updateBlock(block.id, { props: { url: stored } } as never);
            })
            .catch((err: unknown) =>
              notify(
                err instanceof FileRejected
                  ? `A pasted image stays embedded in the page: ${err.message}`
                  : 'A pasted image could not be saved as a file; it stays embedded in the page.',
              ),
            )
            .finally(() => converting.delete(block.id));
        }
      }
    }, false);
  }, [editor, files, pageId, editable]);

  // Pegar o soltar un archivo que no es una imagen permitida haría que el editor intente crear un bloque
  // que no existe en el esquema: se corta antes, con un aviso.
  const rejectOtherFiles = (e: ClipboardEvent | DragEvent, data: DataTransfer | null) => {
    const files = Array.from(data?.files ?? []);
    if (files.length === 0 || files.every((f) => isAllowedImage(f.type))) return;
    e.preventDefault();
    e.stopPropagation();
    notify('Only images can be added for now (JPEG, PNG, GIF, WebP, AVIF or HEIC).');
  };

  return (
    <div
      onPasteCapture={(e) => rejectOtherFiles(e.nativeEvent, e.clipboardData)}
      onDropCapture={(e) => rejectOtherFiles(e.nativeEvent, e.dataTransfer)}
    >
      <BlockNoteView editor={editor} editable={editable} theme={scheme} className="editor" />
    </div>
  );
}

function flatten(blocks: Block[]): Block[] {
  return blocks.flatMap((b) => [b, ...flatten(b.children as Block[])]);
}
