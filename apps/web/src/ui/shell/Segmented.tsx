// Segmented control with a sliding thumb (T3a; any track may use it).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface SegOption<T extends string> { value: T; label: ReactNode; title?: string; disabled?: boolean }

export function Segmented<T extends string>(p: {
  value: T | null; options: Array<SegOption<T>>; onChange(v: T): void;
  label: string; role?: 'tablist' | 'radiogroup'; className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const [animate, setAnimate] = useState(false);
  const role = p.role ?? 'radiogroup';
  const idx = p.options.findIndex((o) => o.value === p.value);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const btn = idx >= 0 ? (el.children[idx + 1] as HTMLElement | undefined) : undefined; // child 0 is the thumb
      setThumb(btn ? { x: btn.offsetLeft, w: btn.offsetWidth } : null);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    // Fonts swap in after first paint and change widths: re-measure once they are ready.
    void document.fonts?.ready.then(measure);
    const t = requestAnimationFrame(() => setAnimate(true));
    return () => { ro?.disconnect(); cancelAnimationFrame(t); };
  }, [idx, p.options.length]);

  return (
    <div ref={box} role={role} aria-label={p.label} className={`hw-seg ${p.className ?? ''}`} data-thumb="">
      <span
        className="hw-seg__thumb"
        aria-hidden="true"
        style={{
          width: thumb?.w ?? 0,
          transform: `translateX(${thumb?.x ?? 0}px)`,
          opacity: thumb ? 1 : 0,
          transition: animate ? undefined : 'none',
        }}
      />
      {p.options.map((o) => {
        const on = o.value === p.value;
        return (
          <button
            key={o.value}
            type="button"
            role={role === 'tablist' ? 'tab' : 'radio'}
            aria-selected={role === 'tablist' ? on : undefined}
            aria-checked={role === 'radiogroup' ? on : undefined}
            data-selected={on}
            title={o.title}
            disabled={o.disabled}
            onClick={() => { if (!on) p.onChange(o.value); }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
