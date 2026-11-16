/** Step 1 of the pipeline: undo everything copy and paste does to a tab (docs/tab-formats.md 7.1). */

export interface Normalised {
  lines: string[];
  /** A `>` quote prefix was removed. */
  quoted: boolean;
  /** A column of leading line numbers was removed. */
  numbered: boolean;
}

const MAX_CHARS = 200_000;

const ENTITIES: Record<string, string> = { gt: '>', lt: '<', amp: '&', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#\d{1,5}|#x[0-9a-f]{1,4}|[a-z]{2,5});/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code < 0x10000 ? String.fromCharCode(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const BB_WRAPPER = /^\s*(?:\[\/?(?:code|tab|tabs|pre|quote(?:=[^\]]*)?|php|font[^\]]*|size[^\]]*|color[^\]]*|b|i|u)\]\s*)+$|^\s*(?:```|~~~)\w*\s*$/i;
const BB_INLINE = /\[\/?(?:code|tab|tabs|pre|quote(?:=[^\]]*)?|b|i|u)\]/gi;

export function normalise(input: string): Normalised {
  let text = String(input ?? '');
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
  text = decodeEntities(text);
  try {
    text = text.normalize('NFKC');
  } catch {
    /* keep as is */
  }
  text = text
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u2010-\u2015\u2212\u2500\u2501\u2043\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/[\u2016\u2551]/g, '||')
    .replace(/[\u2502\u2503\u00A6\uFE31\uFF5C\u2223\u2758\u254E]/g, '|')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\t/g, '    ');
  let lines = text.split(/\r\n|\r|\n|[\u2028\u2029]/).map((l) => l.replace(BB_INLINE, '').replace(/\s+$/, ''));
  lines = lines.map((l) => (BB_WRAPPER.test(l) ? '' : l));

  // Quote prefix ("> ") on at least half of the lines.
  let quoted = false;
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  const quotedCount = nonEmpty.filter((l) => /^\s*>/.test(l)).length;
  if (quotedCount >= 2 && quotedCount >= nonEmpty.length / 2) {
    lines = lines.map((l) => l.replace(/^\s*(?:>\s?)+/, '').replace(/\s+$/, ''));
    quoted = true;
  }

  // Leading line numbers ("01 ", "12: ") on nearly every line, counting up.
  let numbered = false;
  const nonEmpty2 = lines.filter((l) => l.trim() !== '');
  const num = /^\s*(\d{1,3})(?:[.:)]\s*|\s+)(?=\S)/;
  const nums = nonEmpty2.map((l) => num.exec(l)).filter((m): m is RegExpExecArray => !!m);
  if (nums.length >= 3 && nums.length >= nonEmpty2.length * 0.8) {
    let ok = true;
    for (let i = 1; i < nums.length; i++) if (Number(nums[i]![1]) < Number(nums[i - 1]![1])) ok = false;
    if (ok) {
      lines = lines.map((l) => l.replace(num, ''));
      numbered = true;
    }
  }
  return { lines, quoted, numbered };
}
