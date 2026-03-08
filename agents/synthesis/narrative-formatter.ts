import type { SynthesisOutput } from '../../shared/types/synthesis.js';

export function formatNarrative(output: SynthesisOutput): string {
  let narrative = output.portfolioNarrative;

  // Ensure max 3 paragraphs
  const paragraphs = narrative.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length > 3) {
    narrative = paragraphs.slice(0, 3).join('\n\n');
  }

  // Trim to 1000 chars
  if (narrative.length > 1000) {
    narrative = narrative.slice(0, 997) + '...';
  }

  return narrative.trim();
}
