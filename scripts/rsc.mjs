// Helpers for pulling structured JSON out of a Next.js App Router (RSC) page.

/** Concatenate and decode every self.__next_f.push([1,"..."]) chunk in the HTML. */
export function rscPayload(html) {
  let payload = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    payload += JSON.parse(m[1]);
  }
  return payload;
}

/** Return the balanced {...} JSON object that follows `"key":` (first occurrence whose value is an object). */
export function grabObject(payload, key) {
  const needle = `"${key}":{`;
  let i = payload.indexOf(needle);
  if (i < 0) return null;
  const start = payload.indexOf('{', i + key.length + 2);
  let depth = 0;
  let inStr = false;
  for (let j = start; j < payload.length; j++) {
    const c = payload[j];
    if (inStr) {
      if (c === '\\') j++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(payload.slice(start, j + 1));
  }
  return null;
}
