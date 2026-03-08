export type AgentType = 'technical' | 'sentiment' | 'fundamental' | 'market_regime';

export type DataFreshness = 'current' | 'stale' | 'missing';

/**
 * Score produced by one analysis agent for one asset on one date.
 * score and all component scores must be in range [-1.0, +1.0].
 * confidence must be in range [0.0, 1.0].
 */
export interface AgentScore {
  ticker: string;
  date: string;         // ISO 8601 date string
  agentType: AgentType;
  score: number;        // [-1.0, +1.0]
  confidence: number;   // [0.0, 1.0]
  componentScores: Record<string, number>; // named sub-scores, each [-1.0, +1.0]
  explanation: string;  // human-readable reasoning
  dataFreshness: DataFreshness;
  agentVersion: string; // semver string, e.g. "1.0.0"
}
