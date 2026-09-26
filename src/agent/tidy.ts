/**
 * A finished reply with its repetition loop taken out.
 *
 * A 0.8B model that has said its answer sometimes says it again, and again,
 * until the token budget cuts it off mid-sentence — *Er ist 70 Jahre alt.*
 * six times over, the last one ending at *Er ist*. Only exact repeats go: a
 * paragraph already said, a sentence said twice in a row, or a trailing
 * fragment that is the start of an earlier paragraph. The words themselves are
 * never changed, and a reply with no repeat comes back untouched.
 */
export function collapseRepeats(text: string): string {
  const kept: string[] = []
  const seen: string[] = []
  let changed = false

  for (const paragraph of text.split(/\n{2,}/)) {
    const key = normalize(paragraph)
    if (!key) continue
    if (seen.includes(key)) {
      changed = true
      continue
    }
    const collapsed = collapseSentences(paragraph)
    if (collapsed !== paragraph) changed = true
    kept.push(collapsed)
    seen.push(key)
  }

  const last = seen.at(-1)
  if (last && kept.length > 1 && seen.slice(0, -1).some((earlier) => earlier.startsWith(last))) {
    kept.pop()
    changed = true
  }

  return changed ? kept.join('\n\n') : text
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** A sentence said twice in a row inside one paragraph, said once. Lists and verse are left alone. */
function collapseSentences(paragraph: string): string {
  if (paragraph.includes('\n')) return paragraph
  const sentences = paragraph.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)
  if (!sentences || sentences.length < 2) return paragraph
  const out: string[] = []
  for (const sentence of sentences) {
    if (out.length > 0 && normalize(out.at(-1) ?? '') === normalize(sentence)) continue
    out.push(sentence)
  }
  return out.length === sentences.length ? paragraph : out.join('').trimEnd()
}
