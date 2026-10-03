import { BlockNoteEditor } from '@blocknote/core';
import { blocksToYXmlFragment } from '@blocknote/core/yjs';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { t, useT } from '../i18n';
import '../i18n/lazy/tutorial';
import '../i18n/lazy/templates';
import '../templates/templates.css';
import { navigate, useSearchParam } from '../router';
import { ServicesContext, useServices, type Services } from '../services';
import { CONTENT_FRAGMENT } from '../sync/structure';
import { CommentsToggle } from '../ui/CommentsToggle';
import { clearCommentsTarget, closeComments, useCommentsUi } from '../ui/commentsUi';
import type { HeadingRecord } from '../ui/collapse';
import { schema } from '../ui/editorSchema';
import { FindBar, type FindEditor } from '../ui/FindBar';
import { closeFindBar, isFindShortcut, openFindBar, takesFindShortcut } from '../ui/findUi';
import { MoreIcon, PrintIcon, RestoreIcon, SearchIcon, SheetIcon, SignOutIcon } from '../ui/icons';
import { lazyPart, Part } from '../ui/lazyPart';
import { menuBelow, useFloating, type MenuPosition } from '../ui/menus';
import { NavMenuButton } from '../ui/NavMenuButton';
import { setNavOpen } from '../ui/navStore';
import { notify } from '../ui/notice';
import { BlockEditor } from '../ui/PageEditor';
import { mm, PAGE_SIZES, sheetSize, sizeLabel, SHEET_MARGIN_MM, type PageSize } from '../ui/pageFormat';
import { asAction, tipRows } from '../ui/tipRows';
import { SyncIcon } from '../ui/SyncBadge';
import { practiceEn } from './practice.en';
import { practiceEs } from './practice.es';
import { newPracticeSession, practiceFilesRejected, practiceSession, type PracticeSession } from './practiceServices';
import { usePracticeFresh } from './practiceUi';
import { practiceBlocks, PRACTICE_BLOCKS, PRACTICE_ID } from './practiceTemplate';
import { practiceHooks, tourSignal } from './tourState';
import { BUILTIN_KINDS, BUILTIN_SLUGS, builtinBlocks, builtinTexts, kindOfSlug, type BuiltinKind } from '../templates/builtin';

// La página de práctica (Docs/Doc_Tutorial.md, sección 3), en `/practice`: un documento de ejemplo en memoria con el
// editor de verdad, que no es una página del árbol, no se guarda en el dispositivo, no sube a ningún lado y no lo
// ve nadie más. Copia lo que hacen PageView y PageEditor (que no se usan acá: abren el documento con `docs.open`):
// la barra de buscar con Ctrl/⌘+F, el panel de comentarios, el `article.page[data-page-id]` y su `.page-header`
// (la impresión los busca). Todo lo que cuelga del editor usa los servicios de la práctica (practiceServices.ts).
//
// Con `?template=pre-production|on-set|shot-breakdown` (y `&lang=en|es`) es la vista previa de una plantilla de
// fábrica (Docs/Doc_Plantillas.md, entrega 0): el mismo documento en memoria, armado con la plantilla en vez del
// ejemplo, para mirarla y probarla sin crear ninguna página.

const CommentsPanel = lazyPart(() => import('../ui/CommentsPanel').then((m) => m.CommentsPanel));

/** Lo que se muestra: el ejemplo de la práctica, o una plantilla de fábrica en un idioma (la vista previa). */
interface Variant {
  template: BuiltinKind | null;
  lang: string;
}

/** Una por pantalla: el ejemplo (en el idioma de la interfaz) es `''`; una plantilla, `prepro:es`. */
const variantKey = (v: Variant) => (v.template ? `${v.template}:${v.lang}` : '');

/**
 * El documento de ejemplo: la plantilla del idioma de la interfaz, con los ids fijos que señala la recorrida; o la
 * plantilla de fábrica pedida, en su idioma.
 */
function seedDoc(session: PracticeSession, variant: Variant): void {
  // Un editor sin montar, solo para el esquema: la plantilla pasa al fragmento de siempre del documento.
  const editor = BlockNoteEditor.create({ schema });
  const blocks = variant.template ? builtinBlocks(variant.template, variant.lang) : practiceBlocks(variant.lang === 'es' ? practiceEs : practiceEn);
  blocksToYXmlFragment(editor as never, blocks as never, session.doc.getXmlFragment(CONTENT_FRAGMENT));
}

/** La práctica de esta sesión: la que había (se puede ir a otra página y volver), o una de cero si se pidió. */
function useSession(real: Services, variant: Variant): [PracticeSession, () => void] {
  const fresh = usePracticeFresh();
  const key = variantKey(variant);
  const { template, lang } = variant;
  const make = useCallback(() => {
    let session: PracticeSession;
    if (template) {
      // La vista previa: el nombre de la plantilla como título y sin el hilo de ejemplo (no tiene la pregunta).
      session = newPracticeSession(real, { title: builtinTexts(lang).names[template], lang, fresh, variant: key });
    } else {
      const texts = lang === 'es' ? practiceEs : practiceEn;
      session = newPracticeSession(real, { title: texts.title, lang, fresh, answer: texts.answer, reply: texts.answerReply });
    }
    seedDoc(session, { template, lang });
    return session;
  }, [real, fresh, key, template, lang]);
  // Idempotente: el modo estricto de React llama dos veces a lo que inicializa el estado, y las dos tienen que dar la
  // misma práctica (la segunda encuentra la que armó la primera).
  const [session, setSession] = useState<PracticeSession>(() => {
    const current = practiceSession(real);
    return current && current.fresh === fresh && current.variant === key ? current : make();
  });
  // *Practicar* en la ayuda con la práctica ya abierta, u otra plantilla o idioma en la vista previa: se arma de nuevo.
  useEffect(() => {
    if (session.fresh !== fresh || session.variant !== key || session.services.workspace !== real.workspace) setSession(make());
  }, [fresh, real, session, make, key]);
  return [session, () => setSession(make())];
}

/** Lo que pide la dirección: `?template=on-set&lang=es`. Sin `lang`, el idioma de la interfaz (PL9). */
function useVariant(): Variant {
  const tr = useT();
  const template = kindOfSlug(useSearchParam('template'));
  const lang = useSearchParam('lang');
  return { template, lang: template && (lang === 'es' || lang === 'en') ? lang : tr.lang };
}

export function PracticeView() {
  const real = useServices();
  const tr = useT();
  const variant = useVariant();
  const [session, startOver] = useSession(real, variant);
  const [menu, setMenu] = useState<{ position: MenuPosition; anchor: HTMLElement } | null>(null);
  const [, redraw] = useState(0);
  const crumb = variant.template ? tr('templates.previewCrumb') : tr('practice.crumb');

  useEffect(() => {
    document.title = `${crumb} · Shot Docs`;
  }, [crumb]);

  return (
    <>
      <header className="topbar">
        <NavMenuButton />
        <nav className="breadcrumbs" aria-label={tr('shell.location')}>
          <span className="crumb current" aria-current="page">
            {crumb}
          </span>
        </nav>
        <span className="only-mobile">
          <SyncIcon onClick={() => setNavOpen(true)} />
        </span>
        <ServicesContext.Provider value={session.services}>
          <button
            className="icon-button"
            data-tour="find"
            aria-label={tr('shell.findInPage')}
            data-tip={tipRows([{ shortcut: 'find', action: asAction(tr('shell.findInPage')) }])}
            onClick={() => openFindBar()}
          >
            <SearchIcon size={18} />
          </button>
          <CommentsToggle pageId={PRACTICE_ID} />
          <button
            className="icon-button"
            data-tour="page-menu"
            aria-label={tr('pageMenu.label')}
            aria-expanded={!!menu}
            onClick={(e) => {
              const anchor = e.currentTarget;
              setMenu(menu ? null : { position: menuBelow(anchor), anchor });
            }}
          >
            <MoreIcon />
          </button>
        </ServicesContext.Provider>
      </header>
      <ServicesContext.Provider value={session.services}>
        <PracticePage key={session.generation} session={session} variant={variant} onStartOver={startOver} />
        {menu && (
          <PracticeMenu
            session={session}
            position={menu.position}
            anchor={menu.anchor}
            onClose={() => setMenu(null)}
            onChange={() => redraw((n) => n + 1)}
            onStartOver={startOver}
          />
        )}
      </ServicesContext.Provider>
    </>
  );
}

function PracticePage({ session, variant, onStartOver }: { session: PracticeSession; variant: Variant; onStartOver: () => void }) {
  const tr = useT();
  const [title, setTitle] = useState(session.title);
  const [findEditor, setFindEditor] = useState<FindEditor | null>(null);
  // Lo colapsado de la práctica: solo en memoria (la base local no se toca).
  const [collapse] = useState(() => new Map<string, HeadingRecord>());
  const sheet = sheetSize({ ...session.format, from: null });

  // Ctrl/⌘+F abre la barra de la app, como en una página (PageEditor.tsx).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isFindShortcut(e) || !takesFindShortcut(e.target)) return;
      e.preventDefault();
      openFindBar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => () => closeFindBar(), []);

  // La recorrida lleva el cursor al renglón vacío y avanza cuando se usó el menú "/": se abrió y se cerró (se eligió
  // algo o Esc), así la persona alcanza a usarlo. Se mira el estado de la extensión del menú de BlockNote, no su
  // clase de CSS (corrección 16).
  useEffect(() => {
    const editor = findEditor as unknown as {
      setTextCursorPosition?: (id: string, at: 'start' | 'end') => void;
      focus: () => void;
      getExtension?: (key: string) => { store?: { subscribe: (fn: (v: { prevVal: unknown; currentVal: unknown }) => void) => () => void } } | undefined;
    } | null;
    if (!editor?.setTextCursorPosition) return;
    const shown = (v: unknown) => !!v && (v as { show?: boolean }).show !== false && (v as { triggerCharacter?: string }).triggerCharacter === '/';
    let menuOpen = false;
    const stopMenu = editor.getExtension?.('suggestionMenu')?.store?.subscribe(({ prevVal, currentVal }) => {
      menuOpen = shown(currentVal);
      if (shown(prevVal) && !shown(currentVal)) tourSignal('slash');
    });
    // "Mostrame" (entrega 3): con el menú "/" abierto, Esc es del menú, no termina el paso.
    practiceHooks.slashMenuOpen = () => menuOpen;
    practiceHooks.focusEmptyLine = () => {
      try {
        editor.setTextCursorPosition!(PRACTICE_BLOCKS.empty, 'start');
        editor.focus();
      } catch {
        // El renglón ya no está (se borró practicando): el paso igual se muestra.
      }
    };
    return () => {
      practiceHooks.focusEmptyLine = null;
      practiceHooks.slashMenuOpen = null;
      stopMenu?.();
    };
  }, [findEditor]);

  return (
    <article
      className={`page practice${sheet ? ' sheet' : ''}`}
      style={
        sheet
          ? ({
              '--sheet-width': `${sheet.width}px`,
              '--sheet-height': `${sheet.height}px`,
              '--gutter': `${mm(SHEET_MARGIN_MM)}px`,
            } as CSSProperties)
          : undefined
      }
      data-format={session.format.size}
      data-page-id={PRACTICE_ID}
    >
      <div className="banner practice-banner" role="note">
        <span>{variant.template ? tr('templates.previewBanner') : tr('practice.banner')}</span>
        {variant.template && <PreviewPicker variant={variant} />}
        <span className="practice-banner-actions">
          <button className="link" onClick={onStartOver}>
            {tr('practice.startOver')}
          </button>
          <button className="link" onClick={() => navigate('/')}>
            {tr('practice.exit')}
          </button>
        </span>
      </div>
      {/* La impresión busca el encabezado de la página (printView.ts). */}
      <div className="page-header" />
      <PracticeTitle value={title} onChange={(v) => setTitle((session.title = v))} />
      <FindBar editor={findEditor} editable pageId={PRACTICE_ID} />
      {/* Cambiar el idioma vuelve a abrir el editor (sus textos se eligen al crearlo); el documento es el mismo. */}
      <BlockEditor
        key={tr.lang}
        doc={session.doc}
        collapse={collapse}
        pageId={PRACTICE_ID}
        editable
        // Colapsar para todos (Shift+clic) se puede probar: el mapa vive en el documento de la práctica, que no se
        // guarda ni se sincroniza.
        permsKnown
        canComment
        onEditor={setFindEditor}
        filesNotice={practiceFilesRejected().message}
      />
      <PracticeComments />
    </article>
  );
}

/** La vista previa: qué plantilla y en qué idioma (cambian la dirección; el documento se arma de nuevo). */
function PreviewPicker({ variant }: { variant: Variant }) {
  const tr = useT();
  const names = builtinTexts(tr.lang).names;
  const go = (template: BuiltinKind, lang: string) => navigate(`/practice?template=${BUILTIN_SLUGS[template]}&lang=${lang}`, true);
  return (
    <span className="template-preview-picker">
      <span className="segmented" role="group" aria-label={tr('templates.previewWhich')}>
        {BUILTIN_KINDS.map((kind) => (
          <button key={kind} aria-pressed={variant.template === kind} onClick={() => go(kind, variant.lang)}>
            {names[kind]}
          </button>
        ))}
      </span>
      <span className="segmented" role="group" aria-label={tr('templates.previewLanguage')}>
        {(['en', 'es'] as const).map((lang) => (
          <button key={lang} aria-pressed={variant.lang === lang} onClick={() => go(variant.template!, lang)}>
            {lang === 'en' ? 'English' : 'Español'}
          </button>
        ))}
      </span>
    </span>
  );
}

/** El título, solo en memoria; Enter pasa al texto (como en una página). */
function PracticeTitle({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const tr = useT();
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="page-title"
      rows={1}
      value={value}
      placeholder={tr('common.untitled')}
      aria-label={tr('page.title')}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          window.dispatchEvent(new Event('shotdocs:focus-editor'));
        }
      }}
    />
  );
}

/** El panel de comentarios de la práctica (con los comentarios en memoria). */
function PracticeComments() {
  const { open } = useCommentsUi();
  useEffect(() => () => clearCommentsTarget(), []);
  if (!open) return null;
  return (
    <Part onClose={closeComments}>
      <CommentsPanel pageId={PRACTICE_ID} />
    </Part>
  );
}

const SIZES: PageSize[] = ['free', 'A5', 'A4', 'A3', 'Letter'];

/** El "⋯" de la práctica: solo lo que no toca nada real (Docs/Doc_Tutorial.md, sección 3). */
function PracticeMenu({
  session,
  position,
  anchor,
  onClose,
  onChange,
  onStartOver,
}: {
  session: PracticeSession;
  position: MenuPosition;
  anchor: HTMLElement | null;
  onClose: () => void;
  onChange: () => void;
  onStartOver: () => void;
}) {
  const tr = useT();
  const ref = useRef<HTMLDivElement>(null);
  useFloating(ref, onClose, anchor, true);
  return (
    <div ref={ref} className="menu" role="menu" aria-label={tr('pageMenu.label')} style={position}>
      <p className="menu-label mono-label">
        <SheetIcon size={14} /> {tr('pageMenu.pageSize')}
      </p>
      <div className="segmented practice-sizes" role="group" aria-label={tr('pageMenu.pageSize')}>
        {SIZES.map((size) => (
          <button
            key={size}
            aria-pressed={session.format.size === size}
            onClick={() => {
              session.format = { size, landscape: false };
              onChange();
            }}
          >
            {sizeLabel(size, tr)}
          </button>
        ))}
      </div>
      <hr />
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          const format = session.format.size in PAGE_SIZES || session.format.size === 'free' ? session.format : { size: 'free' as const, landscape: false };
          void import('../ui/printPage').then((m) => m.printPage(PRACTICE_ID, { format, media: null })).catch(() => notify(t('pageMenu.printFailed')));
        }}
      >
        <PrintIcon />
        {tr('pageMenu.print')}
      </button>
      <hr />
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          onStartOver();
        }}
      >
        <RestoreIcon />
        {tr('practice.startOver')}
      </button>
      <button
        role="menuitem"
        onClick={() => {
          onClose();
          navigate('/');
        }}
      >
        <SignOutIcon />
        {tr('practice.exitLong')}
      </button>
    </div>
  );
}
