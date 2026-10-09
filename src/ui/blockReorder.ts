import { createExtension } from '@blocknote/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { updateYFragment, ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import * as Y from 'yjs';
import { undoGroupingActive } from './undoGuard';

/** Solo mide la guarda, sin la traducción habitual de y-prosemirror. */
export interface BlockReorderStats { calls: number; triggered: number; ms: number; yVisits: number; pmVisits?: number }

interface Binding {
  doc: Y.Doc;
  type: Y.XmlFragment;
  mapping: Map<unknown, unknown>;
  _prosemirrorChanged: (doc: PMNode) => void;
}

function weight(node: PMNode): number {
  let n = 1;
  node.descendants((child) => {
    if (child.type.name === 'blockContainer') n++;
    return child.type.name === 'blockContainer' || child.type.name === 'blockGroup';
  });
  return n;
}

/** Solo se recorren ids/pesos si hay una inversión; las letras recortan por identidad de nodos PM. */
function collectDrops(before: PMNode, after: PMNode, drop: Set<PMNode>, groups: Map<PMNode, PMNode>, stats?: BlockReorderStats): void {
  if (before === after) return;
  let left = 0;
  const limit = Math.min(before.childCount, after.childCount);
  while (left < limit && before.child(left) === after.child(left)) left++;
  let oldEnd = before.childCount, newEnd = after.childCount;
  while (oldEnd > left && newEnd > left && before.child(oldEnd - 1) === after.child(newEnd - 1)) { oldEnd--; newEnd--; }
  const next = new Map<string, number>();
  for (let i = left; i < newEnd; i++) {
    if (stats) stats.pmVisits = (stats.pmVisits ?? 0) + 1;
    const id = after.child(i).attrs.id;
    if (!id || next.has(String(id))) return;
    next.set(String(id), i);
  }
  const common: { old: PMNode; node: PMNode; at: number }[] = [];
  let inversion = false, last = -1;
  const seen = new Set<string>();
  for (let i = left; i < oldEnd; i++) {
    if (stats) stats.pmVisits = (stats.pmVisits ?? 0) + 1;
    const old = before.child(i), id = old.attrs.id;
    if (!id || seen.has(String(id))) return;
    seen.add(String(id));
    const at = next.get(String(id));
    if (at === undefined) continue;
    if (at < last) inversion = true;
    last = at;
    common.push({ old, node: after.child(at), at: at - left });
  }
  if (inversion) {
    // Un id ausente o repetido vuelve ambiguo el emparejado: ese grupo queda como hoy.
    const unique = (group: PMNode) => {
      const ids = new Set<string>();
      for (let i = 0; i < group.childCount; i++) {
        const id = group.child(i).attrs.id;
        if (!id || ids.has(String(id))) return false;
        ids.add(String(id));
      }
      return true;
    };
    if (!unique(before) || !unique(after)) return;
    groups.set(before, after);
    // Subsecuencia creciente de mayor peso, O(n log n). En empate conserva más nodos cambiados
    // (BlockNote recrea el que mueve con el teclado); después, el final más temprano del orden anterior.
    const weights: number[] = [], changed: number[] = [], prev: number[] = [];
    const tree = Array<number>(newEnd - left + 1).fill(-1);
    const better = (a: number, b: number): number => {
      if (a < 0) return b;
      if (b < 0) return a;
      return weights[a] !== weights[b] ? (weights[a] > weights[b] ? a : b)
        : changed[a] !== changed[b] ? (changed[a] > changed[b] ? a : b) : Math.min(a, b);
    };
    let best = -1;
    for (let i = 0; i < common.length; i++) {
      const x = common[i];
      let p = -1;
      for (let k = x.at; k > 0; k -= k & -k) p = better(p, tree[k]);
      prev[i] = p;
      weights[i] = weight(x.node) + (p < 0 ? 0 : weights[p]);
      changed[i] = Number(x.node !== x.old) + (p < 0 ? 0 : changed[p]);
      for (let k = x.at + 1; k < tree.length; k += k & -k) tree[k] = better(tree[k], i);
      best = better(best, i);
    }
    const keep = new Set<number>();
    for (let k = best; k >= 0; k = prev[k]) keep.add(k);
    common.forEach((x, i) => { if (!keep.has(i)) drop.add(x.old); });
  }
  for (const x of common) {
    if (drop.has(x.old) || x.old === x.node) continue;
    const oldGroup = x.old.lastChild, newGroup = x.node.lastChild;
    if (oldGroup?.type.name === 'blockGroup' && newGroup?.type.name === 'blockGroup') collectDrops(oldGroup, newGroup, drop, groups, stats);
  }
}

interface GroupPlan {
  group: Y.XmlElement;
  remove: { type: Y.XmlElement; at: number }[];
  insert: { type: Y.XmlElement; at: number; layout: MappingLayout }[];
  clearMapping: (Y.XmlElement | Y.XmlText)[];
}

interface MappingLayout { name: string | null; mapped: boolean; value: unknown; children: MappingLayout[] }

/** Traslada las identidades PM del serializador oficial al árbol idéntico de su copia insertada. */
function bindCopy(type: Y.XmlElement | Y.XmlText, layout: MappingLayout, mapping: Binding['mapping']): void {
  if ((type instanceof Y.XmlElement ? type.nodeName : null) !== layout.name) throw new Error('el tipo de la copia no coincide con el serializado');
  if (layout.mapped) mapping.set(type, layout.value);
  if (!(type instanceof Y.XmlElement)) return;
  const children = type.toArray();
  if (children.length !== layout.children.length) throw new Error('la copia no coincide con el árbol serializado');
  children.forEach((child, i) => {
    if (!(child instanceof Y.XmlElement || child instanceof Y.XmlText)) throw new Error('tipo inesperado en la copia');
    bindCopy(child, layout.children[i], mapping);
  });
}

/** Valida y serializa TODO antes de borrar. Solo los grupos con inversión se reconcilian de esta forma. */
function preparePlans(binding: Binding, groups: Map<PMNode, PMNode>, drop: Set<PMNode>, doc: PMNode, stats?: BlockReorderStats): GroupPlan[] {
  const types = new Map<PMNode, Y.XmlElement>();
  for (const [type, node] of binding.mapping) {
    if (stats) stats.yVisits++;
    if (type instanceof Y.XmlElement && type.nodeName === 'blockGroup' && groups.has(node as PMNode)) types.set(node as PMNode, type);
  }
  const scratch = new Y.Doc();
  const plans: GroupPlan[] = [];
  let serial = 0;
  try {
    for (const [before, after] of groups) {
      const group = types.get(before);
      if (!group || group.doc !== binding.doc) throw new Error('el grupo anterior no está vinculado al documento');
      const oldTypes = group.toArray();
      if (stats) stats.yVisits += oldTypes.length;
      if (oldTypes.length !== before.childCount) throw new Error('el grupo cambió antes de preparar el mover');
      const finalIds = new Set<string>();
      after.forEach((node) => finalIds.add(String(node.attrs.id)));
      const keep = new Set<string>();
      const plan: GroupPlan = { group, remove: [], insert: [], clearMapping: [] };
      for (let i = 0; i < before.childCount; i++) {
        const old = before.child(i), type = oldTypes[i];
        // La caché del grupo y la de su hijo pueden tener nodos PM iguales con distinta referencia.
        const mapped = binding.mapping.get(type) as PMNode | undefined;
        if (!(type instanceof Y.XmlElement) || type.nodeName !== 'blockContainer' || !(mapped === old || mapped?.eq(old)) || type.getAttribute('id') !== old.attrs.id)
          throw new Error('la identidad del bloque anterior no coincide con su contenedor');
        if (!drop.has(old) && finalIds.has(String(old.attrs.id))) keep.add(String(old.attrs.id));
        else {
          plan.remove.push({ type, at: i });
          const clear = (child: Y.XmlElement | Y.XmlText) => {
            plan.clearMapping.push(child);
            if (stats) stats.yVisits++;
            if (child instanceof Y.XmlElement) for (const nested of child.toArray()) {
              if (!(nested instanceof Y.XmlElement || nested instanceof Y.XmlText)) throw new Error('contenido inesperado al preparar el mover');
              clear(nested);
            }
          };
          clear(type);
        }
      }
      const expected: string[] = [], simulated = [...keep];
      for (let i = 0; i < after.childCount; i++) {
        const node = after.child(i), id = String(node.attrs.id);
        expected.push(id);
        if (keep.has(id)) continue;
        // El serializador oficial escribe solo sobre un fragmento vacío. Nunca traduce un borrado
        // o una inserción dispersa sobre los contenedores conservados del documento vivo.
        const fragment = scratch.getXmlFragment(String(serial++));
        const metadata = { mapping: new Map<unknown, unknown>(), isOMark: new Map() };
        // Igual que prosemirrorToYXmlFragment, pero reteniendo su mapa: los hijos de un bloque
        // recién recreado deben poder moverse otra vez sin caer en la traducción habitual.
        updateYFragment(scratch, fragment, doc.copy(Fragment.from(node)) as never, metadata as never);
        const serialized = fragment.get(0);
        if (!(serialized instanceof Y.XmlElement) || serialized.nodeName !== 'blockContainer' || serialized.getAttribute('id') !== id)
          throw new Error('el bloque nuevo no pudo serializarse');
        const layoutOf = (type: Y.XmlElement | Y.XmlText): MappingLayout => ({
          name: type instanceof Y.XmlElement ? type.nodeName : null,
          mapped: metadata.mapping.has(type), value: metadata.mapping.get(type),
          children: type instanceof Y.XmlElement ? type.toArray().map((child) => {
            if (!(child instanceof Y.XmlElement || child instanceof Y.XmlText)) throw new Error('tipo inesperado al serializar');
            return layoutOf(child);
          }) : [],
        });
        plan.insert.push({ type: serialized.clone(), at: i, layout: layoutOf(serialized) });
        simulated.splice(i, 0, id);
      }
      if (simulated.length !== expected.length || simulated.some((id, i) => id !== expected[i])) throw new Error('el plan no conserva el orden final completo');
      plans.push(plan);
    }
    return plans;
  } finally { scratch.destroy(); }
}

const installed = new WeakMap<Binding, { wrapper: Binding['_prosemirrorChanged']; original: Binding['_prosemirrorChanged']; users: number }>();

/** Instalable también en los arneses. Cada instalación devuelve su propia liberación, idempotente. */
export function installBlockReorder(view: EditorView, stats?: BlockReorderStats): () => void {
  const binding = (ySyncPluginKey.getState(view.state as never) as { binding?: Binding } | undefined)?.binding;
  if (!binding) return () => {};
  let entry = installed.get(binding);
  if (!entry) {
    const original = binding._prosemirrorChanged;
    const wrapper = (doc: PMNode) => {
      const start = stats ? performance.now() : 0;
      if (stats) { stats.calls++; stats.yVisits++; }
      const root = binding.type.get(0);
      const beforeGroup = binding.mapping.get(root) as PMNode | undefined;
      const drop = new Set<PMNode>();
      const groups = new Map<PMNode, PMNode>();
      let before: PMNode | null = null, plans: GroupPlan[] | null = null;
      try {
        if (beforeGroup?.type.name === 'blockGroup' && doc.firstChild?.type.name === 'blockGroup') {
          collectDrops(beforeGroup, doc.firstChild, drop, groups, stats);
          if (drop.size) {
            before = doc.copy(Fragment.from(beforeGroup));
            plans = preparePlans(binding, groups, drop, doc, stats);
          }
        }
      } catch (err) {
        console.error('reordenar bloques: no se pudo preparar el borrado; se escribe el cambio habitual', err);
      }
      if (stats) stats.ms += performance.now() - start;
      if (!plans?.length || !before) return original.call(binding, doc);
      if (stats) stats.triggered++;
      const um = (yUndoPluginKey.getState(view.state as never) as { undoManager?: Y.UndoManager } | undefined)?.undoManager;
      const grouped = undoGroupingActive(view.state);
      if (!grouped) um?.stopCapturing();
      // y-prosemirror suele llamarnos dentro de SU transacción. Cortar al salir de la anidada sería
      // demasiado temprano: UndoManager todavía no capturó el mover y lo juntaría con la letra siguiente.
      const finish = () => {
        binding.doc.off('afterTransaction', finish);
        um?.stopCapturing();
      };
      // Una restauración o composición ya promete un único Undo para sus transacciones internas.
      if (!grouped) binding.doc.on('afterTransaction', finish);
      binding.doc.transact(() => {
        try {
          // Borrar e insertar directamente por identidad. Dos cambios dispersos nunca pasan por
          // updateYFragment: sus dos traducciones parciales también reutilizarían los vecinos.
          for (const plan of plans) {
            for (const type of plan.clearMapping) binding.mapping.delete(type);
            for (const removal of [...plan.remove].reverse()) plan.group.delete(removal.at, 1);
          }
          for (const plan of plans) for (const insertion of plan.insert) {
            plan.group.insert(insertion.at, [insertion.type]);
            bindCopy(insertion.type, insertion.layout, binding.mapping);
          }
          original.call(binding, doc);
        } catch (err) {
          console.error('reordenar bloques: las dos pasadas fallaron; se restaura antes de escribir el cambio', err);
          updateYFragment(binding.doc, binding.type, before as never, binding as never);
          original.call(binding, doc);
        }
      }, ySyncPluginKey);
    };
    entry = { wrapper, original, users: 0 };
    installed.set(binding, entry);
    binding._prosemirrorChanged = wrapper;
  }
  entry.users++;
  const owned = entry;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--owned.users > 0) return;
    if (binding._prosemirrorChanged === owned.wrapper) binding._prosemirrorChanged = owned.original;
    installed.delete(binding);
  };
}

export const blockReorderExtension = createExtension({
  key: 'shotdocs-block-reorder',
  prosemirrorPlugins: [new Plugin({
    key: new PluginKey('shotdocs-block-reorder'),
    view(view) { return { destroy: installBlockReorder(view) }; },
  })],
});
