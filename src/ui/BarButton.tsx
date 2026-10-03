import { useComponentsContext } from '@blocknote/react';
import { forwardRef, type ReactNode } from 'react';

// Los botones de la barra de una foto (MediaBar.tsx, D-24): todos del mismo tamaño (styles.css, `.sd-bar-button`),
// con su nombre en `aria-label` y el tooltip en `data-tip` (Tooltip.tsx), y el separador entre sectores.

interface BarButtonProps {
  label: string;
  /** El tooltip; `null`, ninguno (el botón ya lo dice). Por defecto, el nombre. */
  tip?: string | null;
  icon?: ReactNode;
  children?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  className?: string;
  test?: string;
  onClick?: () => void;
}

/**
 * Un botón de la barra: ícono (o texto corto), con su nombre en `aria-label` y el tooltip en `data-tip`. Pasa la
 * referencia y lo demás al botón (un globo lo usa de disparador).
 */
export const BarButton = forwardRef<HTMLButtonElement, BarButtonProps>(function BarButton(props, ref) {
  // Lo que agrega un globo que lo usa de disparador (eventos, aria) pasa tal cual al botón.
  const { label, tip, icon, children, selected, disabled, className, test, onClick, ...rest } = props as BarButtonProps &
    Record<string, unknown>;
  const Components = useComponentsContext()!;
  const text = tip === null ? undefined : (tip ?? label);
  return (
    <Components.FormattingToolbar.Button
      {...(rest as object)}
      {...({ ref } as object)}
      className={`bn-button sd-bar-button${className ? ` ${className}` : ''}`}
      label={label}
      icon={icon}
      isSelected={selected}
      isDisabled={disabled}
      onClick={onClick}
      data-tip={text}
      data-test={test}
    >
      {children}
    </Components.FormattingToolbar.Button>
  );
});

/** El separador entre dos sectores de la barra. */
export function BarSep() {
  return <div className="sd-bar-sep" role="separator" aria-orientation="vertical" />;
}

