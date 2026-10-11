// Owner: T4. Pull the first JSON object out of an LLM reply (spec §8.3).
// Strips <think> blocks and code fences, then parses the first balanced {...} that is valid JSON.

/** Index of the brace closing the object that opens at `start`, or -1 if the text ends first. */
function closingBrace(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

function parseObject(candidate: string): Record<string, unknown> | null {
  for (const text of [candidate, candidate.replace(/,(\s*[}\]])/g, '$1')]) {
    try {
      const v: unknown = JSON.parse(text);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // try the lenient variant, then give up on this candidate
    }
  }
  return null;
}

export function extractJson(text: string): unknown | null {
  if (typeof text !== 'string') return null;
  const s = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```[\w-]*/g, '');
  let i = s.indexOf('{');
  while (i >= 0) {
    const end = closingBrace(s, i);
    if (end < 0) return null; // truncated: anything later is inside the broken object
    const obj = parseObject(s.slice(i, end + 1));
    if (obj) return obj;
    i = s.indexOf('{', end + 1);
  }
  return null;
}
