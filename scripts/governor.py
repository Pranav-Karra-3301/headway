#!/usr/bin/env python3
"""Headway compute governor (keeps agent tooling from swamping the machine).

- At most --max headless Chrome instances run at once; extras are paused (SIGSTOP on their process
  group) and resumed oldest-first as slots free up.
- Headless Chrome running longer than --kill-after seconds is killed (hung screenshot).
- Headless Chrome, Vite dev servers and vitest runs are reniced to +10.
- Vite dev servers older than --vite-max-age minutes are stopped, except the shared one on port 5173.
- Never touches non-headless Chrome (the user's own browser).
"""
import argparse, os, signal, subprocess, time

CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

def etime_s(e):
    d = 0
    if '-' in e:
        d, e = e.split('-', 1)
        d = int(d)
    p = [int(x) for x in e.split(':')]
    while len(p) < 3:
        p.insert(0, 0)
    return d * 86400 + p[0] * 3600 + p[1] * 60 + p[2]

def procs():
    out = subprocess.run(['ps', '-axo', 'pid=,pgid=,etime=,nice=,command='], capture_output=True, text=True).stdout
    for line in out.splitlines():
        parts = line.split(None, 4)
        if len(parts) < 5:
            continue
        pid, pgid, et, ni, cmd = parts
        try:
            yield int(pid), int(pgid), etime_s(et), int(ni), cmd
        except ValueError:
            continue

def is_headless_chrome(cmd):
    return 'Google Chrome' in cmd and ('--headless' in cmd or '/tmp/hw-chrome' in cmd or 'headway-shot-profile' in cmd)

def sig(pgid, s):
    try:
        os.killpg(pgid, s)
    except (ProcessLookupError, PermissionError):
        pass

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--max', type=int, default=2)
    ap.add_argument('--kill-after', type=int, default=150)
    ap.add_argument('--vite-max-age', type=int, default=25)
    a = ap.parse_args()
    stopped = set()
    me = os.getpgid(0)
    while True:
        ps = list(procs())
        mains = [(pid, pgid, age) for pid, pgid, age, ni, cmd in ps if cmd.startswith(CHROME + ' ') and '--headless' in cmd and pgid != me]
        for pid, pgid, age in mains:
            if age > a.kill_after:
                sig(pgid, signal.SIGCONT); sig(pgid, signal.SIGKILL); stopped.discard(pgid)
        live = sorted({(pgid, max(ag for _, g, ag in mains if g == pgid)) for _, pgid, _ in mains if _ is not None}, key=lambda x: -x[1])
        for i, (pgid, age) in enumerate(live):
            if age > a.kill_after:
                continue
            if i < a.max:
                if pgid in stopped:
                    sig(pgid, signal.SIGCONT); stopped.discard(pgid)
            elif pgid not in stopped:
                sig(pgid, signal.SIGSTOP); stopped.add(pgid)
        stopped &= {g for g, _ in live}
        for pid, pgid, age, ni, cmd in ps:
            heavy = is_headless_chrome(cmd) or ('vite' in cmd and '--port' in cmd) or 'vitest' in cmd
            if heavy and ni < 10:
                subprocess.run(['renice', '-n', '10', '-p', str(pid)], capture_output=True)
            if 'vite' in cmd and '--port' in cmd and '--port 5173' not in cmd and age > a.vite_max_age * 60 and 'node' in cmd:
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        time.sleep(1.5)

if __name__ == '__main__':
    main()
