// Owner: T3c. Dispatcher dock: fleet strip, selected-vehicle summary, the four controls (enabled only when legal, with the
// reason on hover/click), reassign + train pickers, Finish. Rendered into the HUD's bottom area when it exists.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Observation, RouteId } from '@headway/sim';
import { useApp } from '../../state/store';
import { act, currentLegality, finish, trainPlan } from './game';
import { badgeFor } from './intents';
import { clock, fmtMMSS, ROUTES, TRAIN_ID, type Gate } from './logic';
import { usePlay } from './playStore';
import { FastIcon, routeName, stationName, stopName } from './ui';

type Bus = Observation['buses'][number];

function busLine(b: Bus, t: number): string {
  const load = `${b.onboard}/${b.capacity} aboard`;
  const route = `${b.routeId} ${routeName(b.routeId)}`;
  let state = '';
  switch (b.state) {
    case 'moving': state = b.nextStopId ? `next ${stopName(b.nextStopId)}${b.etaNextStopS !== null ? ` in ${fmtMMSS(b.etaNextStopS)}` : ''}` : 'on the move'; break;
    case 'dwelling': state = 'boarding'; break;
    case 'holding': state = b.holdUntil !== null ? `holding, ${fmtMMSS(b.holdUntil - t)} left` : 'holding'; break;
    case 'layover': state = b.headwayAheadS !== null && b.headwayAheadS < 3600 ? `at the terminal, last bus left ${fmtMMSS(b.headwayAheadS)} ago` : 'at the terminal'; break;
    case 'deadhead': state = 'deadheading to its new route'; break;
  }
  return `${b.id} · ${route} · ${load} · ${state}`;
}

function trainLine(o: Observation): string {
  const tr = o.train;
  const load = `${tr.onboard}/${tr.capacity} aboard`;
  const transfers = Object.values(tr.transfersNext).reduce((n, x) => n + (x ?? 0), 0);
  const where = tr.state === 'dwelling' || tr.state === 'holding'
    ? `at ${stationName(tr.stationId)}${tr.departAt !== null ? `, departs ${clock(o.scenario.clockStart, tr.departAt)}` : ''}`
    : `next ${stationName(tr.stationId)} in ${fmtMMSS(tr.etaS)}`;
  return `Train · ${load} · ${where}${transfers > 0 ? ` · ${transfers} transferring to buses` : ''}`;
}

function Action(p: { k: string; label: string; gate: Gate; onClick: () => void; caret?: boolean; pressed?: boolean; coach?: string; mini?: boolean }) {
  return (
    <button
      type="button"
      className={p.mini ? 'pl-act pl-act--mini' : 'pl-act'}
      aria-disabled={!p.gate.ok}
      aria-pressed={p.pressed ?? undefined}
      aria-label={p.gate.ok ? undefined : `${p.label}: ${p.gate.why}`}
      data-tip={p.gate.ok ? undefined : p.gate.why}
      data-coach={p.coach}
      onClick={p.onClick}
    >
      <span className="pl-act__label">{p.label}{p.caret && <i className="pl-caret" aria-hidden="true" />}</span>
      {p.k && <span className="pl-kbd pl-kbd--sm">{p.k}</span>}
    </button>
  );
}

function ReassignPicker({ busId, legalTo, obs }: { busId: string; legalTo: Record<RouteId, Gate>; obs: Observation }) {
  const set = usePlay((s) => s.set);
  return (
    <div className="pl-pop" role="menu" aria-label={`Move ${busId} to another route`}>
      <div className="pl-pop__head"><span className="hw-label">Move {busId} to</span><span>at its next terminal</span></div>
      {ROUTES.map((r, i) => {
        const g = legalTo[r];
        const info = obs.routes.find((x) => x.id === r);
        return (
          <button
            key={r} type="button" role="menuitem" className="pl-pop__row" aria-disabled={!g.ok}
            onMouseEnter={() => set({ preview: r })} onMouseLeave={() => set({ preview: null })}
            onFocus={() => set({ preview: r })} onBlur={() => set({ preview: null })}
            onClick={() => act({ kind: 'reassign', to: r })}
          >
            <span className="hw-route-dot" data-route={r} />
            <span className="pl-pop__name"><b>{r}</b> {routeName(r)}</span>
            <span className="pl-pop__meta">{g.ok ? `${info?.buses.length ?? 0} buses · ${info?.queue ?? 0} waiting` : g.why}</span>
            <span className="pl-kbd pl-kbd--sm">{i + 1}</span>
          </button>
        );
      })}
    </div>
  );
}

function TrainPicker({ obs }: { obs: Observation }) {
  const ext = trainPlan('extend');
  const now = trainPlan('now');
  const at = ext?.immediate ? `at ${stationName(obs.train.stationId)}` : `next stop ${stationName(obs.train.stationId)}`;
  const when = (p: typeof ext) => (p && p.departAt !== null ? `departs ${clock(obs.scenario.clockStart, p.departAt)}` : p ? `waits ${p.dwellS} s there` : '');
  return (
    <div className="pl-pop" role="menu" aria-label="Set the train departure">
      <div className="pl-pop__head"><span className="hw-label">Train {at}</span></div>
      <button type="button" role="menuitem" className="pl-pop__row" aria-disabled={!ext || (ext.capped && ext.immediate && obs.train.departAt !== null && ext.departAt !== null && ext.departAt <= obs.train.departAt)}
        onClick={() => act({ kind: 'train', mode: 'extend' })}>
        <span className="pl-pop__name"><b>+30 s</b> hold for connections</span>
        <span className="pl-pop__meta">{when(ext)}</span>
        <span className="pl-kbd pl-kbd--sm">T</span>
      </button>
      <button type="button" role="menuitem" className="pl-pop__row" onClick={() => act({ kind: 'train', mode: 'now' })}>
        <span className="pl-pop__name"><b>Depart now</b> 30 s minimum dwell</span>
        <span className="pl-pop__meta">{now?.immediate ? when(now) : 'leaves after 30 s'}</span>
        <span className="pl-kbd pl-kbd--sm">{'⇧T'}</span>
      </button>
    </div>
  );
}

function Nudge() {
  const nudge = usePlay((s) => s.nudge);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!nudge) return;
    setShown(nudge.n);
    const id = setTimeout(() => setShown((n) => (n === nudge.n ? null : n)), 2400);
    return () => clearTimeout(id);
  }, [nudge]);
  if (!nudge || shown !== nudge.n) return null;
  return <div className="pl-nudge" data-tone={nudge.tone} role="status" key={nudge.n}>{nudge.text}</div>;
}

function DockBody() {
  const obs = usePlay((s) => s.obs);
  const picker = usePlay((s) => s.picker);
  const tracked = usePlay((s) => s.tracked);
  const selection = useApp((s) => s.selection);
  const paused = useApp((s) => s.paused);
  const select = useApp((s) => s.select);
  const legal = currentLegality();
  const t = obs?.t ?? 0;
  const buses = obs ? [...obs.buses].sort((a, b) => (a.id < b.id ? -1 : 1)) : [];
  const sel = selection?.id ?? null;
  const selBus = obs?.buses.find((b) => b.id === sel) ?? null;
  const summary = !obs ? 'Waiting for the town…'
    : selBus ? busLine(selBus, t)
    : selection?.kind === 'train' ? trainLine(obs)
    : 'Pick a bus to dispatch, hold or reassign it, or time the train.';

  return (
    <div className="pl-dock hw-card" role="region" aria-label="Dispatcher controls">
      <Nudge />
      <div className="pl-dock__row">
        <div className="pl-fleet" data-coach="fleet" role="listbox" aria-label="Vehicles">
          {buses.map((b) => {
            const badge = badgeFor(tracked, b.id);
            return (
              <button key={b.id} type="button" role="option" aria-selected={sel === b.id} className="pl-veh" data-state={b.state}
                onClick={() => select(sel === b.id ? null : { kind: 'bus', id: b.id })}
                title={busLine(b, t)}>
                <span className="hw-route-dot" data-route={b.routeId} />
                <span className="pl-veh__id">{b.id}</span>
                {b.state === 'holding' && b.holdUntil !== null
                  ? <span className="pl-veh__tag hw-num">{fmtMMSS(b.holdUntil - t)}</span>
                  : <span className="pl-veh__load" aria-hidden="true"><i style={{ transform: `scaleX(${Math.min(1, b.onboard / Math.max(1, b.capacity))})` }} /></span>}
                {badge && <span className="pl-veh__badge">{badge}</span>}
              </button>
            );
          })}
          {obs && (
            <button type="button" role="option" aria-selected={sel === TRAIN_ID} className="pl-veh pl-veh--train" data-state={obs.train.state}
              onClick={() => select(sel === TRAIN_ID ? null : { kind: 'train', id: TRAIN_ID })} title={trainLine(obs)}>
              <span className="pl-veh__id">Train</span>
              <span className="pl-veh__load" aria-hidden="true"><i style={{ transform: `scaleX(${Math.min(1, obs.train.onboard / Math.max(1, obs.train.capacity))})` }} /></span>
              {badgeFor(tracked, TRAIN_ID) && <span className="pl-veh__badge">{badgeFor(tracked, TRAIN_ID)}</span>}
            </button>
          )}
        </div>
        <button type="button" className="hw-btn pl-finish" onClick={() => finish()} data-tip="Fast-forward to the end and see your score">
          <FastIcon /> Finish
        </button>
      </div>
      <div className="pl-dock__summary">
        <span className="pl-dock__text">{summary}</span>
        {paused && <span className="pl-paused">Paused <span className="pl-kbd pl-kbd--sm">Space</span></span>}
      </div>
      <div className="pl-actions">
        <Action k="D" label="Dispatch" gate={legal.dispatch} onClick={() => act({ kind: 'dispatch' })} />
        <div className="pl-split">
          <Action k="H" label="Hold 30 s" gate={legal.hold} onClick={() => act({ kind: 'hold', seconds: 30 })} />
          <Action k="" label="60" mini gate={legal.hold} onClick={() => act({ kind: 'hold', seconds: 60 })} />
        </div>
        <div className="pl-anchor">
          <Action k="R" label="Reassign" caret gate={legal.reassign} pressed={picker === 'reassign'} onClick={() => act({ kind: 'reassign-open' })} />
          {picker === 'reassign' && selBus && obs && <ReassignPicker busId={selBus.id} legalTo={legal.reassignTo} obs={obs} />}
        </div>
        <div className="pl-anchor">
          <Action k="T" label="Train" caret coach="train" gate={legal.train} pressed={picker === 'train'}
            onClick={() => usePlay.getState().set({ picker: picker === 'train' ? null : 'train', preview: null })} />
          {picker === 'train' && obs && <TrainPicker obs={obs} />}
        </div>
      </div>
    </div>
  );
}

/** The dock sits in the HUD grid's bottom area (between the legend and the toasts) when the shell provides one. */
export function Dock() {
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => { setHost(document.querySelector('.hw-area--bottom')); }, []);
  if (!host) return <div className="pl-dock-float"><DockBody /></div>;
  return createPortal(<DockBody />, host);
}
