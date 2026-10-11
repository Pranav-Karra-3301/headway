// Turn DevTools protocol events into console-error entries. Pure.

const MAX_TEXT = 1200;
/** Always ignored: browser-initiated favicon fetches. */
const BUILTIN_IGNORE = [/\/favicon\.ico(\?|$)/i];

const clip = (s) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT - 1) + '…' : s);

function remoteText(o) {
  if (!o) return '';
  if ('value' in o) return typeof o.value === 'string' ? o.value : JSON.stringify(o.value);
  if (o.unserializableValue) return o.unserializableValue;
  if (o.description) return o.description;
  return o.type ?? '';
}

/** console.* argument list -> text, applying printf-style specifiers in a leading string (%s %d %i %f %o %O %c %%). */
function formatArgs(args) {
  if (!args.length) return '';
  const [first, ...rest] = args;
  if (first.type !== 'string' || !/%[sdifoOc%]/.test(first.value)) return args.map(remoteText).join(' ');
  let i = 0;
  const head = first.value.replace(/%([sdifoOc%])/g, (m, k) => {
    if (k === '%') return '%';
    if (i >= rest.length) return m;
    const a = rest[i++];
    if (k === 'c') return '';
    if (k === 'd' || k === 'i') return String(Math.trunc(Number(a.value ?? a.description)));
    if (k === 'f') return String(Number(a.value ?? a.description));
    return remoteText(a);
  });
  return [head, ...rest.slice(i).map(remoteText)].join(' ');
}

const where = (url, line, col) => (url ? `${url}${line != null ? `:${line + 1}` : ''}${line != null && col != null ? `:${col + 1}` : ''}` : null);

/**
 * @param {{ method: string, params?: any }} msg a CDP event
 * @returns {{ kind: string, text: string, url: string | null } | null} null when the event is not an error
 */
export function consoleEntry(msg) {
  const p = msg.params ?? {};
  switch (msg.method) {
    case 'Runtime.consoleAPICalled': {
      if (p.type !== 'error' && p.type !== 'assert') return null;
      const f = p.stackTrace?.callFrames?.[0];
      return { kind: `console.${p.type}`, text: clip(formatArgs(p.args ?? [])), url: where(f?.url, f?.lineNumber, f?.columnNumber) };
    }
    case 'Runtime.exceptionThrown': {
      const d = p.exceptionDetails ?? {};
      const detail = remoteText(d.exception);
      const text = [d.text, detail].filter(Boolean).join(' ');
      const f = d.stackTrace?.callFrames?.[0];
      const url = d.url ? where(d.url, d.lineNumber, d.columnNumber) : where(f?.url, f?.lineNumber, f?.columnNumber);
      return { kind: 'exception', text: clip(text || 'uncaught exception'), url };
    }
    case 'Log.entryAdded': {
      const e = p.entry ?? {};
      if (e.level !== 'error') return null;
      return { kind: e.source ?? 'log', text: clip(e.text ?? ''), url: e.url ?? null };
    }
    default:
      return null;
  }
}

/** Browser noise that is never the app's fault (headless Chrome fetches /favicon.ico on its own). */
export function isNoise(entry) {
  return entry.url != null && BUILTIN_IGNORE.some((re) => re.test(entry.url));
}

/** True when the entry is noise or its text or url matches a user pattern. */
export function isIgnored(entry, patterns) {
  return isNoise(entry) || patterns.some((re) => re.test(entry.text) || (entry.url != null && re.test(entry.url)));
}
