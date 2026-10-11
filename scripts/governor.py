#!/usr/bin/env python3
"""Headway compute governor: keeps agents' headless Chrome from swamping the machine.

- Caps concurrently *running* headless Chrome instances (adaptive by load: 3 if load < 18, 2 if < 32, else 1,
  or a fixed --max). Extras are paused with SIGSTOP on the Chrome process tree only (main + helpers),
  never on the agent's shell or dev server, and resumed oldest-first.
- Kills a Chrome tree only after it has actually been *running* (not paused) longer than --kill-after.
- Renices headless Chrome, Vite and vitest to +10. Never touches non-headless Chrome.
"""
import argparse, os, signal, subprocess, time

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

def snapshot():
    out = subprocess.run(['ps', '-axo', 'pid=,ppid=,nice=,command='], capture_output=True, text=True).stdout
    rows = []
    for line in out.splitlines():
        p = line.split(None, 3)
        if len(p) == 4:
            try:
                rows.append((int(p[0]), int(p[1]), int(p[2]), p[3]))
            except ValueError:
                pass
    return rows

def tree(root, children):
    out, stack = [], [root]
    while stack:
        p = stack.pop(); out.append(p); stack.extend(children.get(p, []))
    return out

def signal_all(pids, s):
    for p in pids:
        try:
            os.kill(p, s)
        except (ProcessLookupError, PermissionError):
            pass

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--max', type=int, default=0)
    ap.add_argument('--kill-after', type=int, default=120)
    a = ap.parse_args()
    first_seen, run_time, paused = {}, {}, set()
    last = time.time()
    while True:
        now = time.time(); dt = now - last; last = now
        rows = snapshot()
        children = {}
        for pid, ppid, _, _ in rows:
            children.setdefault(ppid, []).append(pid)
        mains = [pid for pid, _, _, cmd in rows if cmd.startswith(CHROME + ' ') and '--headless' in cmd]
        for m in mains:
            first_seen.setdefault(m, now)
            if m not in paused:
                run_time[m] = run_time.get(m, 0.0) + dt
        load1 = os.getloadavg()[0]
        cap = a.max if a.max > 0 else (3 if load1 < 18 else 2 if load1 < 32 else 1)
        for m in mains:
            if run_time.get(m, 0) > a.kill_after:
                signal_all(tree(m, children), signal.SIGCONT); signal_all(tree(m, children), signal.SIGKILL); paused.discard(m)
        alive = sorted((m for m in mains if run_time.get(m, 0) <= a.kill_after), key=lambda m: first_seen[m])
        for i, m in enumerate(alive):
            if i < cap and m in paused:
                signal_all(tree(m, children), signal.SIGCONT); paused.discard(m)
            elif i >= cap and m not in paused:
                signal_all(tree(m, children), signal.SIGSTOP); paused.add(m)
        live = set(mains)
        for d in (first_seen, run_time):
            for k in [k for k in d if k not in live]:
                del d[k]
        paused &= live
        for pid, _, ni, cmd in rows:
            heavy = ('Google Chrome' in cmd and '--headless' in cmd) or ('vite' in cmd and '--port' in cmd) or 'vitest' in cmd
            if heavy and ni < 10:
                subprocess.run(['renice', '-n', '10', '-p', str(pid)], capture_output=True)
        time.sleep(1.5)

if __name__ == '__main__':
    main()
