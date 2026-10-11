// Owner: T3c. Play mode overlay: goal card + tour, dispatcher dock, vehicle badges and hold rings (the live pace chip is
// T3b's top-bar MetricsCluster, fed by play.pace from game.ts),
// Finish fast-forward, results (You / AI / Baseline) with the leaderboard, and "watch the AI on this crowd".
import { useEffect } from 'react';
import { useApp } from '../../state/store';
import { CoachMarks } from './CoachMarks';
import { Dock } from './Dock';
import { FinishOverlay } from './FinishOverlay';
import { GoalCard } from './GoalCard';
import { Results } from './Results';
import { SpectateBanner } from './SpectateBanner';
import { VehicleOverlays } from './VehicleOverlays';
import { enterPlay, handleKey, leavePlay, resetLocal, tick } from './game';
import { usePlay } from './playStore';
import './play.css';

export function PlayMode() {
  const phase = useApp((s) => s.play.phase);
  const spectating = usePlay((s) => s.spectating);
  const tour = usePlay((s) => s.tour);
  const restarting = usePlay((s) => s.restarting);

  useEffect(() => {
    enterPlay();
    const unsub = useApp.subscribe((s, prev) => {
      if (s.play.phase === 'intro' && prev.play.phase !== 'intro') resetLocal();
    });
    let raf = 0;
    const loop = (now: number) => { tick(now); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    window.addEventListener('keydown', handleKey, true);
    return () => {
      unsub();
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', handleKey, true);
      leavePlay();
    };
  }, []);

  const live = phase === 'playing' && !spectating;
  return (
    <div className="pl" data-phase={phase}>
      {(live || phase === 'finishing') && <VehicleOverlays />}
      {live && <Dock />}
      {live && tour !== null && <CoachMarks step={tour} />}
      {phase === 'intro' && !restarting && <GoalCard />}
      {phase === 'finishing' && <FinishOverlay />}
      {phase === 'results' && !spectating && <Results />}
      {spectating && <SpectateBanner />}
    </div>
  );
}
