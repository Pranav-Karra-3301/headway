// Owner: T3d. "Evolve next generation": admin token → api.streamEvolve → live feed → refresh the Lab.
import { streamEvolve } from '../../api';
import { useApp } from '../../state/store';
import { refreshLab } from './data';
import { useLab } from './labStore';

const TOKEN_KEY = 'headway.adminToken';

export function savedToken(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}
function saveToken(t: string | null): void {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode */ }
}

/** The spec's Free-plan path: no live evolution on this deployment → say rounds run offline (spec §11). */
export function friendlyEvolveError(message: string): string {
  if (/token/i.test(message)) return 'The admin token was rejected.';
  if (/not available|does not provide|HTTP (404|405|501)|not implemented|offline|could not be reached|failed to fetch|networkerror/i.test(message)) {
    return 'Live evolution is not available on this deployment. Rounds run offline with pnpm evolve --publish and appear here once published.';
  }
  if (/409|already running|running round/i.test(message)) return 'A round is already running; try again in a minute.';
  return message;
}

export async function runEvolve(token: string): Promise<void> {
  const app = useApp.getState();
  if (app.lab.evolving) return;
  saveToken(token);
  app.setLab({ evolving: true, evolveEvents: [] });
  useLab.setState({ liveOpen: true, tokenOpen: false, focusRoundId: null, focusProposalId: null });
  let rejected = false;
  try {
    await streamEvolve(token, (e) => useApp.getState().appendEvolveEvent(e));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    rejected = /token/i.test(message);
    if (rejected) saveToken(null);
    useApp.getState().appendEvolveEvent({ type: 'error', message: friendlyEvolveError(message) });
  } finally {
    useApp.getState().setLab({ evolving: false });
  }
  if (rejected) return;
  const data = await refreshLab().catch(() => null);
  const decision = [...useApp.getState().lab.evolveEvents].reverse().find((e) => e.type === 'decision');
  if (decision?.type === 'decision' && decision.promoted && data?.generations.some((g) => g.id === decision.promoted)) {
    useApp.getState().setLab({ selectedGenerationId: decision.promoted });
  }
}
