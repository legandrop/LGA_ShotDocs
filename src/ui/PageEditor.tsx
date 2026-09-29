import { BlockNoteSchema, defaultBlockSpecs, type Block } from '@blocknote/core';
import '@blocknote/core/fonts/inter.css';
import { withCollaboration } from '@blocknote/core/yjs';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { useCreateBlockNote } from '@blocknote/react';
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { useServices, useSyncStatus } from '../services';
import { FileRejected } from '../sync/files';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { notify } from './notice';
import { useColorScheme } from './useColorScheme';

// En la fase 1 solo se guardan imágenes (el bucket no acepta otros archivos): sin bloques de archivo,
// video ni audio.
const { audio: _audio, file: _file, video: _video, ...blockSpecs } = defaultBlockSpecs;
const schema = BlockNoteSchema.create({ blockSpecs });

type Opening = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; doc: Y.Doc };

export function PageEditor({ pageId }: { pageId: string }) {
  const { docs, engine } = useServices();
  const status = useSyncStatus();
  const [opening, setOpening] = useState<Opening>({ state: 'loading' });

  // Si el servidor tiene contenido de esta página que el dispositivo todavía no bajó, no se abre para
  // editar: empezar sobre un documento vacío arma una estructura paralela que después hay que reparar.
  useEffect(() => {
    let cancelled = false;
    let opened = false;
    void engine.prefetchPage(pageId).then(async (complete) => {
      if (cancelled) return;
      if (!complete) {
        setOpening({ state: 'missing' });
        return;
      }
      const doc = await docs.open(pageId);
      opened = true;
      if (cancelled) docs.close(pageId);
      else setOpening({ state: 'ready', doc });
    });
    return () => {
      cancelled = true;
      if (opened) docs.close(pageId);
      setOpening({ state: 'loading' });
    };
    // `lastSyncAt` vuelve a intentar cuando la sincronización trajo algo nuevo.
  }, [docs, engine, pageId, opening.state === 'missing' ? status.lastSyncAt : null]);

  if (opening.state === 'loading') return <div className="editor-placeholder" />;
  if (opening.state === 'missing') {
    return (
      <p className="muted editor-missing">
        {status.online
          ? 'Downloading this page…'
          : 'This page has not been downloaded to this device yet. Connect to the internet to open it.'}
      </p>
    );
  }
  return <BlockEditor key={pageId} doc={opening.doc} pageId={pageId} />;
}

function BlockEditor({ doc, pageId }: { doc: Y.Doc; pageId: string }) {
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
  // documento no cargue megas y la imagen se sincronice como las demás.
  useEffect(() => {
    const converting = new Set<string>();
    const convert = () => {
      for (const block of flatten(editor.document as Block[])) {
        const url = (block.props as { url?: string }).url;
        if (block.type !== 'image' || !url?.startsWith('data:') || converting.has(block.id)) continue;
        converting.add(block.id);
        void fetch(url)
          .then((r) => r.blob())
          .then((blob) => files.add(pageId, blob))
          .then((stored) => {
            if (editor.getBlock(block.id)) editor.updateBlock(block.id, { props: { url: stored } } as never);
          })
          .catch(() => undefined)
          .finally(() => converting.delete(block.id));
      }
    };
    convert();
    return editor.onChange(convert);
  }, [editor, files, pageId]);

  return <BlockNoteView editor={editor} theme={scheme} className="editor" />;
}

function flatten(blocks: Block[]): Block[] {
  return blocks.flatMap((b) => [b, ...flatten(b.children as Block[])]);
}
