import { BlockNoteEditor } from '@blocknote/core';
import { withCollaboration } from '@blocknote/core/yjs';
import { CONTENT_FRAGMENT } from '../../sync/structure';
import type { Device } from '../../sync/testing';
import { schema } from '../../ui/editorSchema';
import type { PageSettings } from '../../sync/types';

// Un proyecto sintético con la forma del recorte de la maqueta (S4 «D»): una escena filmada en dos locaciones y tres
// días, un scouting que la nombra, fichas con una pregunta abierta, fotos por sección, una página índice y un archivo
// fuera del grafo. Los nombres y textos son inventados (el repo es público: nada de datos reales de un proyecto). Lo
// usan las pruebas de la cabecera viva y el arnés de desarrollo (`src/dev/cabecera-viva.html`).

type Run = string | { link: string; text: string };
export type Block =
  | { h: 1 | 2 | 3; text: string }
  /** Un título con links («Escena » + el número como link a la escena, como lo deja Prepare). */
  | { hl: 1 | 2 | 3; runs: Run[] }
  | { p: Run[] | string }
  | { photo: string; caption?: string }
  | { cell: string }
  /** Una tabla de un renglón (una ficha como las de Coda: «VFX Cat» | «DMP 2.5D, CG»). */
  | { row: string[] }
  /** Una tabla de varios renglones; una celda puede llevar links (la ficha de Coda: «Locacion Guion» | link al decorado). */
  | { table: (string | Run[])[][] };

export interface Built {
  projectId: string;
  /** Las páginas por nombre corto. */
  ids: Record<string, string>;
  /** Las fotos por etiqueta. */
  photos: Record<string, string>;
}

/** Escribe bloques en una página con el editor de verdad (el mismo esquema de la app). */
export async function writeBlocks(d: Device, pageId: string, blocks: Block[]): Promise<void> {
  const doc = await d.docs.open(pageId, { seed: true });
  const editor = BlockNoteEditor.create(
    withCollaboration({ schema, collaboration: { fragment: doc.getXmlFragment(CONTENT_FRAGMENT), user: { name: 'f', color: '#000' } } }),
  ) as unknown as BlockNoteEditor;
  const el = document.createElement('div');
  editor.mount(el);
  const inline = (runs: Run[]) =>
    runs.map((r) => (typeof r === 'string' ? { type: 'text', text: r, styles: {} } : { type: 'link', href: `/p/${r.link}`, content: [{ type: 'text', text: r.text, styles: {} }] }));
  const toBn = (b: Block): unknown => {
    if ('h' in b) return { type: 'heading', props: { level: b.h }, content: b.text };
    if ('hl' in b) return { type: 'heading', props: { level: b.hl }, content: inline(b.runs) };
    if ('photo' in b) return { type: 'image', props: { url: `sdmedia://${b.photo}`, caption: b.caption ?? '' } };
    if ('cell' in b) return { type: 'table', content: { type: 'tableContent', rows: [{ cells: [b.cell] }] } };
    if ('row' in b) return { type: 'table', content: { type: 'tableContent', rows: [{ cells: b.row }] } };
    if ('table' in b) return { type: 'table', content: { type: 'tableContent', rows: b.table.map((row) => ({ cells: row.map((c) => (typeof c === 'string' ? c : inline(c))) })) } };
    return { type: 'paragraph', content: inline(typeof b.p === 'string' ? [b.p] : b.p) };
  };
  editor.replaceBlocks(editor.document, blocks.map(toBn) as never);
  await new Promise((r) => setTimeout(r, 20));
  editor.unmount();
  await d.docs.flush(pageId);
  d.docs.close(pageId);
}

/** Una ficha de desglose con la forma de las de Coda (inventada): la tabla de campos y sus títulos con texto. */
function fichaCampos(shot: string, set: string): Block[] {
  return [
    {
      table: [
        ['Shot Name', shot],
        ['INT/EXT DIA/NOCHE', 'INT-EXT/NOCHE'],
        ['Locacion Guion', [{ link: set, text: 'Ambulancia | Ruta INT' }]],
        ['Locacion Real', 'La Arenera'],
        ['VFX Cat', 'DMP 2.5D'],
        ['Fecha Rodaje', '06/03/2026'],
      ],
    },
    { h: 3, text: 'Descripción' },
    { p: 'El fugitivo va acostado atrás; adelante, el chofer y el oficial forcejean.' },
    { h: 3, text: 'Consultas' },
    { p: '¿Todo el interior de la ambulancia se filma en estudio o solo el vuelco?' },
    { p: 'Referencias del estilo del vuelco.' },
  ];
}

/** Con `days`: la fecha de rodaje (y la pregunta abierta con su categoría) de algunas fichas, como en el desglose de Coda. */
const DAY_FIELDS: Record<string, Block[]> = {
  s008: [{ table: [['Fecha Rodaje', '20/02/2026'], ['Consultas', '¿Solo planos desde el exterior?'], ['Consultas Cat', 'Locaciones, Guion Técnico']] }],
  s009: [{ table: [['Fecha Rodaje', '20/02/2026'], ['Consultas', 'Dirección dijo que esto se filma en locación. Confirmar.'], ['Consultas Cat', 'Locaciones, Arte']] }],
  s025: [{ table: [['Fecha Rodaje', '19/02/2026']] }],
  s029: [{ table: [['Fecha Rodaje', '20/02/2026'], ['Consultas', 'Definir qué se puede volcar en set y qué intervención lleva.'], ['Consultas Cat', 'Story']] }],
};

/**
 * Arma el proyecto. `photo(label, pageId)` da el id `sdmedia://` de cada foto: en las pruebas, un id inventado; en el
 * arnés, una imagen dibujada y guardada en el dispositivo.
 */
export async function buildProject(
  d: Device,
  photo: (label: string, pageId: string) => Promise<string>,
  /**
   * `days`: lo del día de rodaje (E5): fechas de rodaje en las fichas de 104_008, 104_009, 105_025 y 105_029, una ficha
   * de 105_027 para el Día 59, preguntas abiertas con su categoría, un Día 58, un «Sin reporte» sin número de día y el
   * Día 60 sin su página *Plan* (así el plan sale del desglose, como en la maqueta).
   */
  options: { name?: string; indexPage?: boolean; days?: boolean } = {},
): Promise<Built> {
  const projectId = await d.tree.createProject(options.name ?? 'Serie de prueba');
  const ids: Record<string, string> = {};
  const photos: Record<string, string> = {};
  const page = async (key: string, title: string, parent: string | null, settings?: PageSettings) => {
    const id = await d.tree.create(parent, title, projectId);
    if (settings) await d.tree.setPatch(id, { settings });
    ids[key] = id;
    return id;
  };
  const pics = async (pageId: string, prefix: string, n: number): Promise<Block[]> => {
    const out: Block[] = [];
    for (let i = 1; i <= n; i++) {
      const label = `${prefix} ${i}`;
      photos[label] = await photo(label, pageId);
      out.push({ photo: photos[label] });
    }
    return out;
  };

  // Desglose: escenas en grupos de episodio, con sus fichas adentro.
  const bd = await page('desglose', '1.1 | Desglose', null, { holds: 'scene' });
  const ep4 = await page('ep4', '104 | Episodio 4', bd);
  const ep5 = await page('ep5', '105 | Episodio 5', bd);
  // Los decorados (la tabla «Decorados» de Coda): páginas sueltas con su locación real en un campo.
  const decorados = await page('decorados', '1.3 | Decorados', null);
  const setInt = await page('set_int', 'Ambulancia | Ruta INT', decorados);
  await writeBlocks(d, setInt, [{ table: [['Locacion Real', 'La Arenera'], ['Plate', 'Driving'], ['Bloque', '2']] }]);
  const setExt = await page('set_ext', 'Ambulancia | Ruta EXT', decorados);
  await writeBlocks(d, setExt, [{ table: [['Locacion Real', 'CENADE'], ['Plate', 'Ruta']] }]);
  const setAuto = await page('set_auto', 'Camioneta | Banquina', decorados);
  await writeBlocks(d, setAuto, [{ table: [['Locacion Real', 'CENADE'], ['Notas', '']] }]);
  for (const [key, n, ep, title, loc, extra] of [
    ['s008', '008', ep4, 'La camioneta frena en la banquina', 'CENADE', ''],
    ['s009', '009', ep4, 'El conductor revisa el mapa', 'CENADE', ''],
    ['s025', '025', ep5, 'El fugitivo espera escondido', 'CENADE', ''],
    ['s026', '026', ep5, 'El fugitivo cruza la ruta', 'CENADE', 'novfx'],
    ['s027', '027', ep5, 'La ambulancia empieza a zigzaguear', 'La Arenera', 'q'],
    ['s029', '029', ep5, 'El fugitivo abre los ojos', 'La Arenera', ''],
  ] as const) {
    const scene = await page(key, `${n} | ${title}`, ep);
    const card = await page(`${key}_010`, `PRUEBA_${ep === ep4 ? '104' : '105'}_${n}_010 Ambulancia`, scene);
    const blocks: Block[] = [
      { p: `Locación real: ${loc}` },
      { p: 'Plano general de la ruta, cámara en grúa.' },
    ];
    if (extra === 'novfx') blocks.push({ cell: 'No VFX' });
    if (options.days && DAY_FIELDS[key]) blocks.push(...DAY_FIELDS[key]);
    if (extra === 'q') {
      // La ficha como sale de Coda: la tabla de campos (con el decorado como link) y los títulos con su texto.
      blocks.splice(0, blocks.length, ...fichaCampos('PRUEBA_105_027_010', setInt), ...(await pics(card, 'Desglose 027', 2)));
    }
    await writeBlocks(d, card, blocks);
    if (key === 's027') {
      const card2 = await page('s027_020', 'PRUEBA_105_027_020 Ambulancia interior', scene);
      await writeBlocks(d, card2, [
        ...fichaCampos('PRUEBA_105_027_020', setInt),
        { h: 3, text: 'Sup Notes' },
        { p: 'Interior de la ambulancia con pantallas.' },
        { p: 'Open question: ¿la sangre del chofer es práctica o se agrega?' },
      ]);
      if (options.days) {
        const card3 = await page('s027_030', 'PRUEBA_105_027_030 Ambulancia vuelco', scene);
        await writeBlocks(d, card3, [
          { table: [['Shot Name', 'PRUEBA_105_027_030'], ['Fecha Rodaje', '19/02/2026'], ['Locacion Real', 'CENADE']] },
          { p: 'El vuelco en la curva, con la ambulancia de doble.' },
        ]);
      }
    }
  }

  // Locaciones con sus scoutings adentro.
  const locs = await page('locaciones', '1.2 | Locaciones y scoutings', null, { holds: 'location' });
  const cenade = await page('cenade', 'CENADE', locs);
  await writeBlocks(d, cenade, [{ p: 'Acceso por la autopista. Contacto en la guardia.' }]);
  const scout = await page('scout', 'Tech scout 06/01', cenade);
  await writeBlocks(d, scout, [
    { p: `Predio 34° 40' 12.5" S 58° 27' 03.1" W` },
    { h: 1, text: 'Accesos' },
    { p: 'Portón norte, camiones hasta la playa de maniobras.' },
    ...(await pics(scout, 'Accesos', 2)),
    { h: 1, text: '(5027b) Ambulancia vuelca' },
    { p: 'En el forcejeo la ambulancia pierde el control y se sale de la ruta en la curva; hay espacio para la grúa del lado de afuera.' },
    ...(await pics(scout, 'Vuelco', 3)),
  ]);
  const arenera = await page('arenera', 'La Arenera (estudio)', locs);
  await writeBlocks(d, arenera, [{ p: 'Estudio con fondo azul y la ambulancia de utilería.' }]);

  // Días de rodaje (la carpeta de reportes): la locación sale del título del día.
  const rodaje = await page('rodaje', '2 | Rodaje', null, { dayReports: {} });
  if (options.days) {
    const d58 = await page('d58', '2026-02-18 | Día 58 | CENADE', rodaje);
    await writeBlocks(d, d58, [{ h: 1, text: 'Info general' }, { p: 'Llamado 8:00. Prueba de cámara en la curva.' }]);
  }
  const d59 = await page('d59', '2026-02-19 | Día 59 | CENADE', rodaje);
  await writeBlocks(d, d59, [
    { h: 1, text: 'Info general' },
    { p: 'Llamado 7:00. Sol pleno toda la jornada.' },
    { h: 1, text: 'Escena 105_027b' },
    { p: 'Tres tomas del vuelco con la ambulancia de doble. Chrome ball y HDRI en la curva.' },
    ...(await pics(d59, 'D59 vuelco', 5)),
    { h: 1, text: 'Plates ambulancia' },
    { p: 'Plates de ruta para las escenas de traslado.' },
    ...(await pics(d59, 'D59 plates', 2)),
  ]);
  const d60 = await page('d60', '2026-02-20 | Día 60 | CENADE', rodaje);
  await writeBlocks(d, d60, [
    { h: 1, text: 'Escena 105_029a' },
    { p: 'Primer plano del fugitivo, luz de atardecer.' },
    ...(await pics(d60, 'D60', 2)),
  ]);
  // El plan del día: adentro del día, no es el reporte (nombra lo planeado, no lo filmado).
  if (!options.days) {
    const plan60 = await page('plan60', 'Plan | Día 60', d60);
    await writeBlocks(d, plan60, [{ p: 'Orden: 104_008, 104_009, 105_029 y si sobra tiempo la 105_027.' }]);
  }
  const d70 = await page('d70', '2026-03-06 | Día 70 | La Arenera', rodaje);
  await writeBlocks(d, d70, [
    { h: 1, text: 'Escena 105_027A + 029B' },
    { p: 'Interior de la ambulancia en estudio, pantallas encendidas.' },
    ...(await pics(d70, 'D70', 4)),
  ]);
  if (options.days) {
    // Un día sin número de día en el título (en ERSO, los «Sin reporte»): el botón del día vecino no puede usar el título.
    const sin = await page('d_sin', '2026-03-10 | Sin reporte | La Arenera (estudio), Colegio Pradere', rodaje);
    await writeBlocks(d, sin, [{ p: 'No hubo reporte este día.' }]);
  }
  const d76 = await page('d76', '2026-03-14 | Día 76 | La Arenera', rodaje);
  await writeBlocks(d, d76, [
    { h: 1, text: 'Escena 5-27' },
    { p: 'Insertos del volante.' },
    ...(await pics(d76, 'D76 a', 2)),
    { h: 1, text: 'Escena 5-27A' },
    { p: 'Repetición del inserto con otra lente.' },
    ...(await pics(d76, 'D76 b', 2)),
  ]);

  // Una nota suelta que la nombra, una página índice y un archivo fuera del grafo.
  const notas = await page('notas', 'Notas de dirección', null);
  await writeBlocks(d, notas, [{ p: 'Revisar con dirección la 105_027 antes del día 70.' }]);
  if (options.indexPage !== false) {
    const ep1 = await page('ep1', '101 | Episodio 1', bd);
    const codes: string[] = [];
    for (let i = 1; i <= 18; i++) {
      const n = String(i).padStart(3, '0');
      await page(`e1_${n}`, `${n} | Escena ${i}`, ep1);
      codes.push(`101_${n}`);
    }
    const plan = await page('planning', 'Planning general', null);
    await writeBlocks(d, plan, [{ p: `Orden previsto: ${codes.join(', ')}, 105_027, 105_029 y CENADE.` }]);
  }
  const archivo = await page('archivo', '90 | Archivo', null, { graph: false });
  await writeBlocks(d, archivo, [{ p: 'Versión vieja: Escena 105_027 en CENADE.' }]);
  await d.engine.syncNow();
  return { projectId, ids, photos };
}
