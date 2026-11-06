import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useT } from '../i18n';
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from '../lib/hexColor';
import { ChevronRightIcon, CollapseIcon, RestoreIcon } from './icons';

// El picker de color de la app (Docs/Doc_Navegacion.md, «Color del proyecto»), hecho como el de las apps de escritorio
// de LGA (LgaColorPickerDialog de LGA_Base_QT_C_Py): una fila de colores de fábrica, una de recientes y, plegable,
// *Custom* con el cuadrado de saturación y brillo, las barras de tono, saturación y brillo, y el hex con el botón que
// vuelve al color de fábrica. Cada cambio se avisa al momento (`onChange`, para la vista previa en vivo); *OK* lo
// confirma y *Cancel* lo descarta. No guarda nada: los recientes los maneja quien lo usa.

const SWATCHES = 8;

export interface ColorPickerProps {
  /** El color con el que abre (`#rrggbb`). */
  initial: string;
  /** A dónde vuelve el botón de reset. */
  defaultColor: string;
  presets: string[];
  recents: string[];
  /** Cada cambio, mientras se elige: la vista previa. */
  onChange: (color: string) => void;
  onAccept: (color: string) => void;
  onCancel: () => void;
}

export function ColorPicker(props: ColorPickerProps) {
  const tr = useT();
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(normalizeHex(props.initial) ?? props.defaultColor));
  // El hex que se ve: sigue al color salvo mientras la persona lo escribe (como `m_hexUserEditing` del de escritorio).
  const [hexText, setHexText] = useState(() => hsvToHex(hsv));
  const [typing, setTyping] = useState(false);
  const [custom, setCustom] = useState(true);
  const color = hsvToHex(hsv);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
  const first = useRef(true);

  useEffect(() => {
    if (!typing) setHexText(color);
    if (first.current) {
      first.current = false;
      return;
    }
    onChange.current(color);
  }, [color, typing]);

  // Saltar a un color (un swatch, el hex, el reset) conserva el tono si el nuevo es gris.
  const jump = (hex: string) => {
    const next = hexToHsv(hex);
    setHsv((prev) => (next.s === 0 || next.v === 0 ? { ...next, h: prev.h } : next));
    setTyping(false);
  };

  const commitHex = () => {
    if (!typing) return;
    const hex = normalizeHex(hexText);
    if (hex) jump(hex);
    else {
      setTyping(false);
      setHexText(color);
    }
  };

  const swatchRow = (label: string, colors: string[]) => (
    <div className="cp-section">
      <span className="cp-tag">{label}</span>
      <div className="cp-swatches" role="group" aria-label={label}>
        {Array.from({ length: SWATCHES }, (_, i) => {
          const c = colors[i];
          if (!c) return <span key={i} className="cp-swatch empty" aria-hidden="true" />;
          return (
            <button
              key={i}
              type="button"
              className={`cp-swatch${c === color ? ' selected' : ''}`}
              style={{ background: c }}
              aria-label={c}
              aria-pressed={c === color}
              onClick={() => jump(c)}
            />
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      className="color-picker"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          props.onCancel();
        } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          const hex = typing ? normalizeHex(hexText) : color;
          if (hex) props.onAccept(hex);
        }
      }}
    >
      {swatchRow(tr('color.presets'), props.presets)}
      {swatchRow(tr('color.recent'), props.recents)}
      <div className="cp-separator" />
      <button type="button" className="cp-custom-toggle" aria-expanded={custom} onClick={() => setCustom((v) => !v)}>
        {custom ? <CollapseIcon size={12} /> : <ChevronRightIcon size={12} />}
        <span className="cp-tag">{tr('color.custom')}</span>
      </button>
      {custom && (
        <div className="cp-custom">
          <SvSquare hsv={hsv} onChange={(s, v) => setHsv((p) => ({ ...p, s, v }))} label={tr('color.svSquare')} />
          <Bar
            label={tr('color.hue')}
            value={hsv.h / 360}
            background="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
            onChange={(x) => setHsv((p) => ({ ...p, h: Math.min(359.999, x * 360) }))}
            text={`${Math.round(hsv.h)}°`}
          />
          <Bar
            label={tr('color.saturation')}
            value={hsv.s}
            background={`linear-gradient(to right, ${hsvToHex({ ...hsv, s: 0 })}, ${hsvToHex({ ...hsv, s: 1 })})`}
            onChange={(x) => setHsv((p) => ({ ...p, s: x }))}
            text={`${Math.round(hsv.s * 100)}%`}
          />
          <Bar
            label={tr('color.brightness')}
            value={hsv.v}
            background={`linear-gradient(to right, #000, ${hsvToHex({ ...hsv, v: 1 })})`}
            onChange={(x) => setHsv((p) => ({ ...p, v: x }))}
            text={`${Math.round(hsv.v * 100)}%`}
          />
          <div className="cp-hex-row">
            <span className="cp-hex-swatch" style={{ background: color }} aria-hidden="true" />
            <input
              className="cp-hex"
              aria-label={tr('color.hex')}
              spellCheck={false}
              maxLength={7}
              value={hexText}
              onChange={(e) => {
                setTyping(true);
                setHexText(e.target.value);
              }}
              onBlur={commitHex}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitHex();
              }}
            />
            <button
              type="button"
              className="icon-button cp-reset"
              aria-label={tr('color.reset')}
              data-tip={tr('color.reset')}
              onClick={() => jump(props.defaultColor)}
            >
              <RestoreIcon size={16} />
            </button>
          </div>
        </div>
      )}
      <div className="cp-footer">
        <button type="button" onClick={props.onCancel}>
          {tr('common.cancel')}
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            const hex = typing ? (normalizeHex(hexText) ?? color) : color;
            props.onAccept(hex);
          }}
        >
          {tr('common.ok')}
        </button>
      </div>
    </div>
  );
}

/** Arrastrar dentro de un elemento: la posición, de 0 a 1 en cada eje, en cada movimiento. */
function useDrag(onMove: (x: number, y: number) => void) {
  const move = useRef(onMove);
  move.current = onMove;
  return (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    el.focus();
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      const clamp = (n: number) => Math.min(1, Math.max(0, n));
      move.current(clamp((ev.clientX - r.left) / (r.width || 1)), clamp((ev.clientY - r.top) / (r.height || 1)));
    };
    at(e);
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Sin captura (un puntero que ya se soltó): alcanza con el primer punto.
    }
    const onPointerMove = (ev: PointerEvent) => at(ev);
    const stop = () => {
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', stop);
      el.removeEventListener('pointercancel', stop);
    };
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    e.preventDefault();
  };
}

/** Las flechas mueven un 1 % (con Shift, un 10 %). */
function arrowStep(e: KeyboardEvent): number {
  return e.shiftKey ? 0.1 : 0.01;
}

function SvSquare(props: { hsv: Hsv; onChange: (s: number, v: number) => void; label: string }) {
  const { hsv } = props;
  const down = useDrag((x, y) => props.onChange(x, 1 - y));
  return (
    <div
      className="cp-sv"
      role="slider"
      tabIndex={0}
      aria-label={props.label}
      aria-valuetext={`${Math.round(hsv.s * 100)}%, ${Math.round(hsv.v * 100)}%`}
      style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex({ h: hsv.h, s: 1, v: 1 })})` }}
      onPointerDown={down}
      onKeyDown={(e) => {
        const step = arrowStep(e);
        const clamp = (n: number) => Math.min(1, Math.max(0, n));
        const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
        const m = moves[e.key];
        if (!m) return;
        e.preventDefault();
        props.onChange(clamp(hsv.s + m[0]), clamp(hsv.v + m[1]));
      }}
    >
      <span className="cp-sv-ring" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
    </div>
  );
}

function Bar(props: { label: string; value: number; background: string; text: string; onChange: (x: number) => void }) {
  const down = useDrag((x) => props.onChange(x));
  return (
    <div
      className="cp-bar"
      role="slider"
      tabIndex={0}
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(props.value * 100)}
      aria-valuetext={props.text}
      onPointerDown={down}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0;
        if (!d) return;
        e.preventDefault();
        props.onChange(Math.min(1, Math.max(0, props.value + d * arrowStep(e))));
      }}
    >
      <span className="cp-bar-track" style={{ background: props.background }} />
      <span className="cp-bar-marker" style={{ left: `${props.value * 100}%` }} />
    </div>
  );
}
