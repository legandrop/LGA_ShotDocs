import { useT } from '../i18n';
import { asAction, tipRows } from './tipRows';

// Dónde se busca: en la página o en todo el proyecto (Docs/Doc_Buscar.md, «Buscar en la página o en el proyecto»).
// Lo dibujan las dos búsquedas, la barra de la página (FindBar) y el panel del proyecto (ProjectSearch), con el mismo
// par de botones: el de la otra se lleva lo escrito. Así se puede elegir antes de escribir o cambiar después, cuando en
// la página no aparece nada.

export type SearchScopeValue = 'page' | 'project';

export function SearchScope({
  value,
  onChange,
  pageAvailable = true,
}: {
  value: SearchScopeValue;
  onChange: (next: SearchScopeValue) => void;
  /** Sin una página abierta (el panel desde el mapa o el *Overview*), *Page* no se ofrece. */
  pageAvailable?: boolean;
}) {
  const tr = useT();
  const option = (scope: SearchScopeValue) => {
    const on = scope === value;
    const label = tr(scope === 'page' ? 'scope.page' : 'scope.project');
    const off = scope === 'page' && !pageAvailable;
    // Como los demás segmentados de la app: botones con `aria-pressed`. El elegido no hace nada y sale del Tab.
    return (
      <button
        type="button"
        aria-pressed={on}
        tabIndex={on ? -1 : undefined}
        className={`search-scope-option${on ? ' on' : ''}`}
        disabled={off}
        data-tip={on || off ? undefined : tipRows([{ shortcut: scope === 'page' ? 'find' : 'search', action: asAction(tr(scope === 'page' ? 'scope.pageTip' : 'scope.projectTip')) }])}
        // El foco se queda en el campo de la búsqueda que se deja (así no salta antes de cambiar).
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!on) onChange(scope);
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="search-scope" role="group" aria-label={tr('scope.label')}>
      {option('page')}
      {option('project')}
    </div>
  );
}
