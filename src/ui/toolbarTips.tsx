import { ComponentsContext, LinkToolbar, LinkToolbarController, useComponentsContext, type Components } from '@blocknote/react';
import { forwardRef, useMemo, type ComponentType, type ReactNode, type Ref } from 'react';
import { asAction, tipRows, type TipEnv } from './tipRows';

// Los botones propios de BlockNote en la barra de formato (Bold, Italic, Underline, Strike, alinear, Colors, Nest, Link,
// Merge cells…) traen su globo (`mainTooltip` con el nombre y `secondaryTooltip` con el atajo escrito por BlockNote:
// "Mod+B"). La app los pasa a su tooltip (D226, roadmap B.25a): `data-tip` con un renglón «**atajo**: acción» y el atajo
// del registro (shortcuts.ts), o solo el nombre si el botón no tiene atajo (es un ícono: el nombre no se ve). No se
// reemplaza cada botón: se cambia el `FormattingToolbar.Button` que BlockNote toma del contexto de componentes, así
// cada botón conserva lo que hace, su estado (marcado, apagado) y lo que BlockNote le sume en una versión nueva.
// La barra de los links (Edit link, Open in new tab, Remove link) hace lo mismo con su propio botón (`LinkToolbar.Button`):
// `LinkToolbarTips`.

/** El atajo del registro de cada botón de BlockNote, por su `data-test`. */
export const TOOLBAR_SHORTCUTS: Record<string, string> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strike',
  code: 'code',
  createLink: 'link',
  nestBlock: 'indent',
  unnestBlock: 'outdent',
};

interface ButtonTipProps {
  'data-test'?: string;
  'data-tip'?: string;
  label?: string;
  mainTooltip?: string;
  secondaryTooltip?: string;
}

/**
 * El `data-test` que BlockNote (su versión de Mantine) le pone a un botón sin uno propio: el nombre en camelCase
 * ("Merge cells" → "mergecells"). Se conserva al sacarle el `mainTooltip`, del que sale.
 */
export function defaultDataTest(mainTooltip: string): string {
  return mainTooltip.slice(0, 1).toLowerCase() + mainTooltip.replace(/\s+/g, '').slice(1);
}

/**
 * El tooltip de un botón de BlockNote en la barra: con atajo, «**⌘B**: bold» (sin atajos en una pantalla táctil: sin
 * tooltip, como Comment y Assistant); sin atajo, su nombre. Un botón que ya trae `data-tip` (los de la app) queda igual,
 * también sin tooltip si lo trae vacío.
 */
export function toolbarTip(props: ButtonTipProps, env: TipEnv = {}): string | undefined {
  // Un botón de la app trae su `data-tip`, aunque sea `undefined` (Comment en una pantalla táctil: sin tooltip).
  if ('data-tip' in props) return props['data-tip'];
  const name = props.mainTooltip ?? props.label;
  if (!name) return undefined;
  const id = props['data-test'] ? TOOLBAR_SHORTCUTS[props['data-test']] : undefined;
  if (id) return tipRows([{ shortcut: id, action: asAction(name) }], env);
  return name;
}

/**
 * El tooltip de un botón de la barra de los links. Es un botón de ícono (Open in new tab, Remove link: el nombre no se
 * ve, y no tienen atajo) o el de texto («Edit link», que BlockNote rotula "Edit": repetiría lo que el botón ya dice, así
 * que sin tooltip). Sin atajos que mostrar, no hay renglón «atajo: acción»: el nombre solo.
 */
export function linkToolbarTip(props: ButtonTipProps & { children?: ReactNode }): string | undefined {
  if ('data-tip' in props) return props['data-tip'];
  if (typeof props.children === 'string' && props.children) return undefined;
  return props.mainTooltip ?? props.label;
}

type ButtonProps = Components['FormattingToolbar']['Button'] extends ComponentType<infer P> ? P : never;
type TipOf = (props: ButtonTipProps & { children?: ReactNode }) => string | undefined;

const wrapped = new WeakMap<ComponentType<ButtonProps>, Map<TipOf, ComponentType<ButtonProps>>>();

/** El botón de BlockNote con el tooltip de la app en vez del suyo (uno por botón original, para no remontar). */
function tipButton(Base: ComponentType<ButtonProps>, tipOf: TipOf = toolbarTip): ComponentType<ButtonProps> {
  const known = wrapped.get(Base)?.get(tipOf);
  if (known) return known;
  const TipButton = forwardRef(function TipButton(props: ButtonProps, ref: Ref<HTMLButtonElement>) {
    const { mainTooltip, secondaryTooltip, ...rest } = props as ButtonProps & ButtonTipProps;
    const test = (rest as ButtonTipProps)['data-test'] ?? (mainTooltip ? defaultDataTest(mainTooltip) : undefined);
    const tip = tipOf({ ...(rest as ButtonTipProps & { children?: ReactNode }), 'data-test': test, mainTooltip, secondaryTooltip });
    const Inner = Base as ComponentType<ButtonProps & { ref?: Ref<HTMLButtonElement>; 'data-test'?: string; 'data-tip'?: string }>;
    return <Inner ref={ref} {...(rest as ButtonProps)} data-test={test} data-tip={tip} />;
  }) as unknown as ComponentType<ButtonProps>;
  if (!wrapped.has(Base)) wrapped.set(Base, new Map());
  wrapped.get(Base)!.set(tipOf, TipButton);
  return TipButton;
}

/** Lo de adentro (la barra de formato) usa el botón de BlockNote con el tooltip de la app. */
export function ToolbarTips({ children }: { children: ReactNode }) {
  const outer = useComponentsContext()!;
  const components = useMemo<Components>(
    () => ({ ...outer, FormattingToolbar: { ...outer.FormattingToolbar, Button: tipButton(outer.FormattingToolbar.Button) } }),
    [outer],
  );
  return <ComponentsContext.Provider value={components}>{children}</ComponentsContext.Provider>;
}

/** Lo de adentro (la barra de los links) usa el botón de BlockNote con el tooltip de la app. */
export function LinkToolbarTips({ children }: { children: ReactNode }) {
  const outer = useComponentsContext()!;
  const components = useMemo<Components>(
    () => ({ ...outer, LinkToolbar: { ...outer.LinkToolbar, Button: tipButton(outer.LinkToolbar.Button, linkToolbarTip) } }),
    [outer],
  );
  return <ComponentsContext.Provider value={components}>{children}</ComponentsContext.Provider>;
}

type LinkToolbarProps = Parameters<typeof LinkToolbar>[0];

function PageLinkToolbar(props: LinkToolbarProps) {
  return (
    <LinkToolbarTips>
      <LinkToolbar {...props} />
    </LinkToolbarTips>
  );
}

/** La barra de los links de la página (al pasar el mouse o el cursor por un link): los botones con el tooltip de la app. */
export function PageLinkToolbarController() {
  return <LinkToolbarController linkToolbar={PageLinkToolbar} />;
}
