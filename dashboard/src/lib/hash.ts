// Small, fast, stable string hash (FNV-1a, 32-bit) used to identify a request
// or a results snapshot, e.g. for caching LLM interpretations.

export function hashString(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function hashJson(value: unknown): string {
  return hashString(JSON.stringify(value));
}
