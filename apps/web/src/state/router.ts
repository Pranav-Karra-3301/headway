// URL ↔ store sync (T3a). Routes: `/` Watch, `/play`, `/lab`, `/lab/:generationId`.
import type { Mode } from './store';

export interface Route { mode: Mode; generationId: string | null }

export function parsePath(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
  if (parts[0] === 'play') return { mode: 'play', generationId: null };
  if (parts[0] === 'lab') return { mode: 'lab', generationId: parts[1] ?? null };
  return { mode: 'watch', generationId: null };
}

export function pathFor(r: Route): string {
  if (r.mode === 'play') return '/play';
  if (r.mode === 'lab') return r.generationId ? `/lab/${encodeURIComponent(r.generationId)}` : '/lab';
  return '/';
}

interface RouterStore {
  getState(): { mode: Mode; lab: { selectedGenerationId: string | null } };
  setState(p: Record<string, unknown>): void;
  subscribe(fn: (s: { mode: Mode; lab: { selectedGenerationId: string | null } }) => void): () => void;
}

/** Keeps `location` and the store in step: store changes push history entries; back/forward update the store. */
export function startRouter(store: RouterStore, win: Window = window): () => void {
  const apply = (r: Route) => {
    const s = store.getState();
    const lab = r.mode === 'lab' && r.generationId !== s.lab.selectedGenerationId
      ? { lab: { ...s.lab, selectedGenerationId: r.generationId } } : {};
    if (s.mode !== r.mode) store.setState({ mode: r.mode, selection: null, ...lab });
    else if ('lab' in lab) store.setState(lab);
  };
  apply(parsePath(win.location.pathname));

  const routeOf = (s: { mode: Mode; lab: { selectedGenerationId: string | null } }): Route =>
    ({ mode: s.mode, generationId: s.mode === 'lab' ? s.lab.selectedGenerationId : null });
  const unsub = store.subscribe((s) => {
    const want = pathFor(routeOf(s));
    if (want !== win.location.pathname) win.history.pushState(null, '', want + win.location.search);
  });
  const onPop = () => apply(parsePath(win.location.pathname));
  win.addEventListener('popstate', onPop);
  return () => { unsub(); win.removeEventListener('popstate', onPop); };
}
