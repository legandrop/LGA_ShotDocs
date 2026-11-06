import { useT } from '../i18n';
import { useTree } from '../services';
import { EyeIcon } from './icons';
import { outsideRootOf, type OutsideReaders } from './outsideReaders';

// La marca del árbol en lo que ven personas de afuera (condición 8 de Docs/Doc_Compartir_Escenas.md): la página que tiene
// el permiso o la invitación, y lo de adentro, que también ven. Quien puede compartir el proyecto tiene la lista
// (`marks`) y el tooltip dice cuántos o por qué página; quien solo edita sabe sí o no de la página abierta (`seen`), sin
// quién ni cuántos.
export function OutsideTreeMark({ pageId, marks, seen = false }: { pageId: string; marks: OutsideReaders; seen?: boolean }) {
  const tree = useTree();
  const tr = useT();
  const root = outsideRootOf(tree, marks, pageId);
  if (!root && !seen) return null;
  const direct = root === pageId;
  const tip = !root
    ? tr('outside.tree.seen')
    : direct
      ? tr('outside.tree.direct', { count: marks.get(root) ?? 1 })
      : tr('outside.tree.inside', { title: tree.get(root)?.title || tr('common.untitled') });
  const kind = !root ? 'seen' : direct ? 'direct' : 'inside';
  return (
    <span className={`tree-outside${direct ? '' : ' inside'}`} role="img" aria-label={tip} data-tip={tip} data-outside={kind}>
      <EyeIcon size={13} />
    </span>
  );
}
