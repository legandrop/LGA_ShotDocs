// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { getDefaultSlashMenuItems } from '@blocknote/core/extensions';
import { blockTypeSelectItems } from '@blocknote/react';
import { describe, expect, it } from 'vitest';
import { headingItems, notToggleHeading } from './collapseMenus';
import { editorDictionary } from './editorLocale';
import { schema } from './editorSchema';

// Sin "Encabezado plegable" en los menús (Docs/Doc_Colapsar.md): todos los títulos se colapsan con el triángulo.

describe('los menús sin encabezados plegables', () => {
  it('el menú "/" no los ofrece; los títulos comunes siguen', () => {
    const editor = BlockNoteEditor.create({ schema, dictionary: editorDictionary('es') });
    const all = getDefaultSlashMenuItems(editor) as { key: string; title: string }[];
    expect(all.some((i) => i.key === 'toggle_heading')).toBe(true);
    const items = all.filter(notToggleHeading);
    expect(items.map((i) => i.key)).not.toEqual(expect.arrayContaining(['toggle_heading']));
    expect(items.some((i) => /plegable 1|Toggle Heading/i.test(i.title))).toBe(false);
    expect(items.filter((i) => i.key.startsWith('heading')).map((i) => i.key)).toEqual(['heading', 'heading_2', 'heading_3', 'heading_4', 'heading_5']);
    // La lista plegable (otro bloque) queda.
    expect(items.some((i) => i.key === 'toggle_list')).toBe(true);
  });

  it('el selector de tipo tampoco, y compara los títulos solo por el nivel', () => {
    const editor = BlockNoteEditor.create({ schema });
    const items = headingItems(blockTypeSelectItems(editor.dictionary));
    const headings = items.filter((i) => i.type === 'heading');
    expect(headings.map((i) => i.props?.level)).toEqual([1, 2, 3, 4, 5]);
    expect(headings.every((i) => i.props && !('isToggleable' in i.props))).toBe(true);
    expect(headings.map((i) => i.props?.level)).toEqual([...new Set(headings.map((i) => i.props?.level))]);
  });

  it('H6 existente conserva contenido y nivel al filtrar ambos menús y al importar HTML', async () => {
    const editor = BlockNoteEditor.create({ schema, initialContent: [{ type: 'heading', props: { level: 6 }, content: 'Referencia conservada' }] });
    const before = JSON.stringify(editor.document);
    getDefaultSlashMenuItems(editor).filter(notToggleHeading);
    headingItems(blockTypeSelectItems(editor.dictionary));
    expect(JSON.stringify(editor.document)).toBe(before);
    const html = await editor.blocksToFullHTML(editor.document);
    const imported = await editor.tryParseHTMLToBlocks(html);
    expect(imported[0].type).toBe('heading');
    expect(imported[0].props).toMatchObject({ level: 6 });
    expect(JSON.stringify(imported[0].content)).toContain('Referencia conservada');
  });
});
