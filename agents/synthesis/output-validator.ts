import { z } from 'zod';
import type { SynthesisOutput } from '../../shared/types/synthesis.js';

export const SynthesisOutputSchema = z.object({
  weightRationale: z.object({
    technical: z.number().min(0).max(1),
    sentiment: z.number().min(0).max(1),
    fundamental: z.number().min(0).max(1),
    regime: z.number().min(0).max(1),
    reasoning: z.string(),
  }),
  portfolioAssessment: z.object({
    goalStatus: z.enum(['on_track', 'monitor', 'at_risk', 'off_track']),
    primaryRisk: z.string(),
    assessment: z.string(),
  }),
  recommendations: z.array(
    z.object({
      ticker: z.string(),
      action: z.enum(['BUY', 'SELL', 'REDUCE', 'ADD', 'HOLD']),
      urgency: z.enum(['high', 'medium', 'low']),
      targetAllocationPct: z.number().min(0).max(100),
      reasoning: z.string(),
      confidence: z.number().min(0).max(1),
    })
  ),
  portfolioNarrative: z.string().max(2000),
  overallConfidence: z.number().min(0).max(1),
  lowConfidenceReasons: z.array(z.string()),
});

export function validateSynthesisOutput(raw: unknown): SynthesisOutput | null {
  const result = SynthesisOutputSchema.safeParse(raw);
  if (result.success) {
    return result.data as SynthesisOutput;
  }
  console.error('[OutputValidator] Validation failed:', result.error.issues);
  return null;
}
