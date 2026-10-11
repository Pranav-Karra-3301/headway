// Owner: T1c. Canonical JSON and its FNV-1a hash (spec §12: RunResult.hash = FNV-1a over the canonical JSON of
// metrics, stops and findings). Canonical = object keys sorted (UTF-16 code unit order), numbers rounded to 3
// decimals, no whitespace, undefined/function properties dropped (as in JSON), non-finite numbers → null.

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

function enc(x: unknown): string | undefined {
  if (x === null) return 'null';
  switch (typeof x) {
    case 'number':
      return Number.isFinite(x) ? JSON.stringify(round3(x)) : 'null';
    case 'string':
      return JSON.stringify(x);
    case 'boolean':
      return x ? 'true' : 'false';
    case 'bigint':
      return JSON.stringify(x.toString());
    case 'object': {
      const withJson = x as { toJSON?: () => unknown };
      if (typeof withJson.toJSON === 'function') return enc(withJson.toJSON());
      if (Array.isArray(x)) return `[${x.map((v) => enc(v) ?? 'null').join(',')}]`;
      const rec = x as Record<string, unknown>;
      const parts: string[] = [];
      for (const k of Object.keys(rec).sort()) {
        const v = enc(rec[k]);
        if (v !== undefined) parts.push(`${JSON.stringify(k)}:${v}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      return undefined; // undefined, function, symbol
  }
}

/** Canonical JSON text of `x` (see the header). */
export function canonicalJson(x: unknown): string {
  return enc(x) ?? 'null';
}

/** FNV-1a 32-bit over the UTF-8 bytes of `s`, as 8 lowercase hex digits. Lone surrogates encode as U+FFFD. */
function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  const add = (b: number): void => {
    h = Math.imul(h ^ b, 0x01000193) >>> 0;
  };
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      add(c);
    } else if (c < 0x800) {
      add(0xc0 | (c >> 6));
      add(0x80 | (c & 63));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
      add(0xf0 | (c >> 18));
      add(0x80 | ((c >> 12) & 63));
      add(0x80 | ((c >> 6) & 63));
      add(0x80 | (c & 63));
    } else {
      if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
      add(0xe0 | (c >> 12));
      add(0x80 | ((c >> 6) & 63));
      add(0x80 | (c & 63));
    }
  }
  return h.toString(16).padStart(8, '0');
}

/** FNV-1a 32-bit hex over the canonical JSON of `x` — stable under key reordering and float noise below 1e-3. */
export function canonicalHash(x: unknown): string {
  return fnv1a32(canonicalJson(x));
}
