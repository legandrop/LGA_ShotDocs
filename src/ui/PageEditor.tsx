import '@blocknote/core/fonts/inter.css';
import { withCollaboration } from '@blocknote/core/yjs';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { useCreateBlockNote } from '@blocknote/react';
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { useServices } from '../services';
import { useColorScheme } from './useColorScheme';

/** Nombre del fragmento de Yjs donde vive el contenido. No se cambia: lo usan todos los documentos. */
export const CONTENT_FRAGMENT = 'document-store';

export function PageEditor({ pageId }: { pageId: string }) {
  const { docs, engine } = useServices();
  const [doc, setDoc] = useState<Y.Doc | null>(null);

  useEffect(() => {
    let cancelled = false;
    let opened = false;
    void engine
      .prefetchPage(pageId)
      .then(() => docs.open(pageId))
      .then((d) => {
        opened = true;
        if (cancelled) docs.close(pageId);
        else setDoc(d);
      });
    return () => {
      cancelled = true;
      if (opened) docs.close(pageId);
      setDoc(null);
    };
  }, [docs, engine, pageId]);

  if (!doc) return <div className="editor-placeholder" />;
  return <BlockEditor key={pageId} doc={doc} pageId={pageId} />;
}

function BlockEditor({ doc, pageId }: { doc: Y.Doc; pageId: string }) {
  const { files, user } = useServices();
  const scheme = useColorScheme();
  const editor = useCreateBlockNote(
    withCollaboration({
      uploadFile: (file: File) => files.add(pageId, file),
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

  return <BlockNoteView editor={editor} theme={scheme} className="editor" />;
}
