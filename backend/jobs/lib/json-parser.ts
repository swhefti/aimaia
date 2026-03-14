/**
 * Robust JSON extraction from LLM text output.
 * Handles fenced code blocks, leading/trailing commentary,
 * truncated output, and minor malformations.
 *
 * Shared across scoring and synthesis jobs.
 */

export function extractJson(raw: string): unknown {
  // Strip markdown fencing
  let text = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  // Try direct parse first
  try { return JSON.parse(text); } catch { /* continue */ }

  // Find the first '{' and try progressively shorter substrings
  const start = text.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in LLM output');
  text = text.slice(start);

  for (let end = text.length; end > start; end--) {
    if (text[end - 1] !== '}') continue;
    try { return JSON.parse(text.slice(0, end)); } catch { /* continue */ }
  }

  // Try to repair: remove trailing comma, close unclosed braces/brackets
  const fixed = text
    .replace(/,\s*$/, '')
    .replace(/"[^"]*$/, '"')
    + '}'.repeat(Math.max(0, (text.match(/{/g)?.length ?? 0) - (text.match(/}/g)?.length ?? 0)))
    + ']'.repeat(Math.max(0, (text.match(/\[/g)?.length ?? 0) - (text.match(/]/g)?.length ?? 0)));
  try { return JSON.parse(fixed); } catch { /* continue */ }

  throw new Error(`Could not extract valid JSON from LLM output (${text.length} chars)`);
}
