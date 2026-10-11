// Owner: T3b. Springy number ticker: React renders the first value once; a short rAF spring then writes
// text directly (no React state per frame). Reduced motion → values jump.
import { useEffect, useRef } from 'react';

const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Ticker({ value, format, className }: { value: number; format: (v: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = useRef(format);
  fmt.current = format;
  const initial = useRef(format(value)).current;
  const s = useRef({ x: value, v: 0, target: value, raf: 0, last: 0 });

  useEffect(() => {
    const st = s.current;
    const el = ref.current;
    st.target = value;
    if (!el) return;
    if (!Number.isFinite(value) || !Number.isFinite(st.x) || reducedMotion()) {
      cancelAnimationFrame(st.raf);
      st.raf = 0; st.x = value; st.v = 0;
      el.textContent = fmt.current(value);
      return;
    }
    if (st.raf) return; // already springing; it retargets
    if (st.x === value && st.v === 0) { el.textContent = fmt.current(value); return; }
    st.last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - st.last) / 1000));
      st.last = now;
      // Slightly under-damped spring (bounce ≈ 0.1): settles in ~350 ms.
      const a = 210 * (st.target - st.x) - 26 * st.v;
      st.v += a * dt;
      st.x += st.v * dt;
      const span = Math.max(1, Math.abs(st.target));
      if (Math.abs(st.target - st.x) < span * 1e-4 && Math.abs(st.v) < span * 1e-3) {
        st.x = st.target; st.v = 0; st.raf = 0;
        el.textContent = fmt.current(st.x);
        return;
      }
      el.textContent = fmt.current(st.x);
      st.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
  }, [value]);

  useEffect(() => () => {
    cancelAnimationFrame(s.current.raf);
    s.current.raf = 0; // StrictMode re-mounts must be able to restart the spring
  }, []);
  return <span ref={ref} className={className}>{initial}</span>;
}
