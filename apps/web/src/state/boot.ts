// Startup (T3a): view overrides from the URL (?palette=b&light=dusk&detail=min&quality=low&speed=16, handy for
// screenshots and the art-direction loop) and the champion fetch for Watch.
import { fetchChampion } from '../api';
import type { Speed } from '../sim/runner';
import { useApp } from './store';
import type { AppState } from './store';

export function viewFromQuery(search: string): Partial<AppState> {
  const q = new URLSearchParams(search);
  const out: Partial<AppState> = {};
  const palette = q.get('palette');
  if (palette === 'a' || palette === 'b' || palette === 'c') out.palette = palette;
  const light = q.get('light');
  if (light === 'day' || light === 'dusk') out.light = light;
  const detail = q.get('detail');
  if (detail === 'min' || detail === 'toy') out.detail = detail;
  const quality = q.get('quality');
  if (quality === 'high' || quality === 'low') out.quality = quality;
  const speed = Number(q.get('speed'));
  if (speed === 1 || speed === 4 || speed === 8 || speed === 16) out.speed = speed as Speed;
  const ctl = q.get('controller');
  if (ctl === 'g0' || ctl === 'ref' || ctl === 'champion') out.watchController = ctl;
  return out;
}

let booted = false;

export function bootstrap(win: Window = window): void {
  if (booted) return;
  booted = true;
  const view = viewFromQuery(win.location.search);
  if (Object.keys(view).length) useApp.setState(view);
  void fetchChampion().then((c) => useApp.getState().setChampion(c));
}
