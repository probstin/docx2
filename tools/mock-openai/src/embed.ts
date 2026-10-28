/** Deterministic feature-hashing bag-of-words embeddings: real lexical similarity, no model needed. */

const STOPWORDS = new Set(
  (
    "a an and are as at be but by do does for from how i if in is it its of on or so that the " +
    "their then there these this to was we what when where which who why will with you your can"
  ).split(" "),
);

export function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && /(?:ss|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .map(stem);
}

function fnv1a(s: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function embedText(text: string, dimensions: number): number[] {
  const vec = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(text);
  const add = (feature: string, weight: number): void => {
    const bucket = fnv1a(feature, 0) % dimensions;
    const sign = fnv1a(feature, 0x9e3779b9) & 1 ? 1 : -1;
    vec[bucket]! += sign * weight;
  };
  for (const t of tokens) add(t, 1);
  for (let i = 0; i + 1 < tokens.length; i++) add(`${tokens[i]} ${tokens[i + 1]}`, 0.7);
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) {
    // Empty/stopword-only input: a fixed unit vector keeps the output valid for cosine search.
    vec[0] = 1;
    return vec;
  }
  return vec.map((v) => v / norm);
}
