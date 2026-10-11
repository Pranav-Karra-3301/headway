// Small HTTP helpers shared by the routes.
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export function jsonError(c: Context, status: ContentfulStatusCode, error: string, details?: string[]): Response {
  return c.json(details && details.length > 0 ? { error, details } : { error }, status);
}

export type JsonBody = { ok: true; value: unknown } | { ok: false; status: 400 | 413; error: string };

/** Reads a JSON request body, refusing anything larger than `maxBytes`. */
export async function readJson(req: Request, maxBytes: number): Promise<JsonBody> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return { ok: false, status: 413, error: `body larger than ${maxBytes} bytes` };
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) return { ok: false, status: 413, error: `body larger than ${maxBytes} bytes` };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: 'body is not valid JSON' };
  }
}

export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

export async function sha256Hex(s: string): Promise<string> {
  return Array.from(await sha256(s), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison (compares SHA-256 digests, so lengths may differ). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Per-key fixed-window counter, in memory (per isolate; best effort). */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  hit(key: string): { ok: boolean; retryAfterS: number } {
    const t = this.now();
    if (this.windows.size > 10_000) {
      for (const [k, w] of this.windows) if (t - w.start >= this.windowMs) this.windows.delete(k);
    }
    let w = this.windows.get(key);
    if (!w || t - w.start >= this.windowMs) {
      w = { start: t, count: 0 };
      this.windows.set(key, w);
    }
    if (w.count >= this.limit) return { ok: false, retryAfterS: Math.max(1, Math.ceil((w.start + this.windowMs - t) / 1000)) };
    w.count++;
    return { ok: true, retryAfterS: 0 };
  }
}
