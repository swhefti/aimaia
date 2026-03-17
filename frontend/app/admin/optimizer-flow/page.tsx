'use client';

export default function OptimizerFlowPage() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Syne:wght@400;600;700;800&display=swap');
        .of-root { --bg:#272a31;--s:#2e323b;--s2:#363a44;--b:rgba(255,255,255,0.09);--t:#e2e8f0;--m:#8994a7;--gold:#eab308;--gold-d:rgba(234,179,8,0.12);--cyan:#06b6d4;--cyan-d:rgba(6,182,212,0.12);--green:#22c55e;--green-d:rgba(34,197,94,0.12);--purple:#a855f7;--purple-d:rgba(168,85,247,0.12);--amber:#f59e0b;--amber-d:rgba(245,158,11,0.12);--red:#ef4444;--red-d:rgba(239,68,68,0.12);--blue:#3b82f6;--blue-d:rgba(59,130,246,0.12); font-family:'JetBrains Mono',monospace;color:var(--t);min-height:100vh; }
        .of-noise { position:fixed;inset:0;pointer-events:none;z-index:0;opacity:0.025; background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
        .of-hdr { padding:2rem 3rem 1rem;border-bottom:1px solid var(--b);position:relative;z-index:1;display:flex;align-items:baseline;gap:1.5rem; }
        .of-logo { font-family:'Syne',sans-serif;font-size:1.4rem;font-weight:800;color:var(--gold);letter-spacing:-0.02em; }
        .of-sub { font-size:0.68rem;color:var(--m);letter-spacing:0.15em;text-transform:uppercase; }
        .of-back { font-size:0.7rem;color:var(--m);text-decoration:none;transition:color 0.2s;margin-left:auto; }
        .of-back:hover { color:var(--t); }
        .of-body { padding:2rem 3rem 3rem;position:relative;z-index:1; }

        .of-flow { display:flex;flex-direction:column;gap:0;max-width:900px;margin:0 auto; }
        .of-step { display:grid;grid-template-columns:140px 1fr;gap:1.5rem;align-items:start;padding:0.75rem 0; }
        .of-step-label { text-align:right;padding-top:0.6rem; }
        .of-step-tag { font-size:0.6rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:0.2rem 0.6rem;border-radius:4px;display:inline-block; }
        .of-step-sub { font-size:0.58rem;color:var(--m);margin-top:0.2rem; }

        .of-card { border-radius:10px;border:1px solid var(--b);background:var(--s);padding:0.9rem 1.1rem;animation:of-in 0.4s ease both; }
        .of-card:hover { border-color:rgba(255,255,255,0.18);box-shadow:0 0 20px rgba(255,255,255,0.03); }
        @keyframes of-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .of-card.gold { border-color:rgba(234,179,8,0.3);background:linear-gradient(135deg,var(--s) 0%,rgba(234,179,8,0.05) 100%); }
        .of-card.cyan { border-color:rgba(6,182,212,0.3);background:linear-gradient(135deg,var(--s) 0%,rgba(6,182,212,0.05) 100%); }
        .of-card.green { border-color:rgba(34,197,94,0.25);background:linear-gradient(135deg,var(--s) 0%,rgba(34,197,94,0.04) 100%); }
        .of-card.purple { border-color:rgba(168,85,247,0.25);background:linear-gradient(135deg,var(--s) 0%,rgba(168,85,247,0.04) 100%); }
        .of-card.amber { border-color:rgba(245,158,11,0.25);background:linear-gradient(135deg,var(--s) 0%,rgba(245,158,11,0.04) 100%); }
        .of-card.red { border-color:rgba(239,68,68,0.25);background:linear-gradient(135deg,var(--s) 0%,rgba(239,68,68,0.04) 100%); }
        .of-card.blue { border-color:rgba(59,130,246,0.25);background:linear-gradient(135deg,var(--s) 0%,rgba(59,130,246,0.04) 100%); }

        .of-title { font-family:'Syne',sans-serif;font-size:0.82rem;font-weight:700;margin-bottom:0.25rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap; }
        .of-desc { font-size:0.64rem;color:var(--m);line-height:1.65; }
        .of-desc strong { color:var(--t);font-weight:500; }
        .of-badge { display:inline-flex;align-items:center;font-size:0.56rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding:0.15rem 0.45rem;border-radius:100px;white-space:nowrap; }
        .of-badge.gold{background:var(--gold-d);color:var(--gold);} .of-badge.cyan{background:var(--cyan-d);color:var(--cyan);} .of-badge.green{background:var(--green-d);color:var(--green);} .of-badge.purple{background:var(--purple-d);color:var(--purple);} .of-badge.amber{background:var(--amber-d);color:var(--amber);} .of-badge.red{background:var(--red-d);color:var(--red);} .of-badge.blue{background:var(--blue-d);color:var(--blue);} .of-badge.muted{background:rgba(100,116,139,0.15);color:var(--m);}

        .of-arrow { text-align:center;padding:0.1rem 0;font-size:1.1rem;color:var(--m);grid-column:1/3; }
        .of-divider { grid-column:1/3;border-top:1px dashed var(--b);margin:0.5rem 0; }

        .of-grid { display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem; }
        .of-cell { background:var(--s2);border:1px solid var(--b);border-radius:7px;padding:0.5rem 0.65rem; }
        .of-cell-t { font-size:0.68rem;font-weight:600;color:var(--t);margin-bottom:0.15rem; }
        .of-cell-b { font-size:0.6rem;color:var(--m);line-height:1.5; }
      `}</style>

      <div className="of-root">
        <div className="of-noise" />

        <header className="of-hdr">
          <div className="of-logo">aiMAIA</div>
          <div className="of-sub">Optimizer &amp; Calibrator Flow</div>
          <a href="/admin/dashboard" className="of-back">&larr; Admin</a>
          <a href="/admin/data-flow" className="of-back">Full Data Flow &rarr;</a>
        </header>

        <div className="of-body">
          <div className="of-flow">

            {/* OPTIMIZER SECTION */}
            <div className="of-step">
              <div className="of-step-label">
                <span className="of-step-tag" style={{ background: 'var(--purple-d)', color: 'var(--purple)' }}>Input</span>
                <div className="of-step-sub">agent_scores</div>
              </div>
              <div className="of-card purple">
                <div className="of-title">Composite Score Computation</div>
                <div className="of-desc">
                  For each ticker: blend <strong>technical</strong> + <strong>sentiment</strong> + <strong>fundamental</strong> + <strong>regime</strong> scores using asset-type-aware weights.<br />
                  Crypto with missing sentiment: redistributes 25% sent &rarr; 15% tech + 10% regime.<br />
                  Output: <strong>compositeScore</strong> [-1, +1] + <strong>confidence</strong> [0, 1] + <strong>dataFreshness</strong>
                </div>
              </div>
            </div>

            <div className="of-arrow">&darr;</div>

            <div className="of-step">
              <div className="of-step-label">
                <span className="of-step-tag" style={{ background: 'var(--gold-d)', color: 'var(--gold)' }}>Core</span>
                <div className="of-step-sub">optimizer-core.ts</div>
              </div>
              <div className="of-card gold">
                <div className="of-title">Expected Return Mapping <span className="of-badge cyan">+ calibration</span></div>
                <div className="of-desc">
                  <strong>Heuristic:</strong> compositeScore &times; 0.30 (BASE_RETURN_SCALE)<br />
                  Damped by confidence multiplier (heavy shrinkage below 0.3 conf)<br />
                  Stale data &times;0.7 &middot; Missing data &times;0.3<br /><br />
                  <strong>Calibrated blend</strong> (if live-eligible): 60% calibrated + 40% heuristic<br />
                  7d-only calibration uses reduced weight (0.4 vs 0.7 for 30d-backed)
                </div>
              </div>
            </div>

            <div className="of-arrow">&darr;</div>

            <div className="of-step">
              <div className="of-step-label">
                <span className="of-step-tag" style={{ background: 'var(--gold-d)', color: 'var(--gold)' }}>Core</span>
                <div className="of-step-sub">runOptimizerCore()</div>
              </div>
              <div className="of-card gold">
                <div className="of-title">Covariance-Aware Portfolio Solver</div>
                <div className="of-desc">
                  <strong>Objective:</strong> maximize E[return] &minus; &lambda;<sub>risk</sub>&times;variance &minus; &lambda;<sub>conc</sub>&times;HHI &minus; &lambda;<sub>cluster</sub>&times;overweight&sup2; &minus; &lambda;<sub>turnover</sub>&times;turnover &minus; friction&times;trades
                </div>
                <div className="of-grid">
                  <div className="of-cell">
                    <div className="of-cell-t">Covariance Model</div>
                    <div className="of-cell-b">Pairwise correlations from price_history &middot; Shrinkage toward asset-type defaults &middot; Crypto pairs: 0.65 &middot; Cross-type: 0.15</div>
                  </div>
                  <div className="of-cell">
                    <div className="of-cell-t">Iterative Solver</div>
                    <div className="of-cell-b">Up to 60 rounds of pairwise weight shifts &middot; 0.5% step size &middot; Accepts only constraint-valid improvements</div>
                  </div>
                  <div className="of-cell">
                    <div className="of-cell-t">Cluster Controls</div>
                    <div className="of-cell-b">9 theme clusters: mega_tech, semis, fintech, EV, china, crypto_major/alt, equity ETFs, bond/commodity &middot; Max 45% per cluster</div>
                  </div>
                  <div className="of-cell">
                    <div className="of-cell-t">Hard Constraints</div>
                    <div className="of-cell-b">Max 30% per position &middot; Max 40% crypto &middot; Min 5% cash floor &middot; Max N positions &middot; Asset type filter</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="of-arrow">&darr;</div>

            <div className="of-step">
              <div className="of-step-label">
                <span className="of-step-tag" style={{ background: 'var(--gold-d)', color: 'var(--gold)' }}>Output</span>
                <div className="of-step-sub">OptimizerOutput</div>
              </div>
              <div className="of-card gold">
                <div className="of-title">Target Weights + Actions + Risk Summary</div>
                <div className="of-desc">
                  <strong>targetWeights:</strong> ticker &rarr; weightPct for each position<br />
                  <strong>actions:</strong> BUY / ADD / REDUCE / SELL / HOLD with delta, confidence, urgency, rationale<br />
                  <strong>riskSummary:</strong> portfolioVolatility, concentrationRisk, diversificationScore, maxDrawdownEstimate, avgPairwiseCorrelation, cryptoAllocationPct, largestPositionPct
                </div>
              </div>
            </div>

            <div className="of-divider" />

            {/* CALIBRATOR SECTION */}
            <div className="of-step">
              <div className="of-step-label">
                <span className="of-step-tag" style={{ background: 'var(--cyan-d)', color: 'var(--cyan)' }}>Eval</span>
                <div className="of-step-sub">--score-outcomes</div>
              </div>
              <div className="of-card cyan">
                <div className="of-title">All-Asset Score Outcome Tracking</div>
                <div className="of-desc">
                  For <strong>every scored ticker/date</strong>: look up forward prices at +1d, +7d, +30d.<br />
                  Compare against SPY benchmark. Store in <strong>score_outcomes</strong> table.<br />
                  Idempotent (unique on ticker+score_date). Skips completed dates.
                </div>
              </div>
            </div>

            <div className="of-arrow">&darr;</div>

            <div className="of-step">
              <div className="of-step-label">
                <span className="of-step-tag" style={{ background: 'var(--cyan-d)', color: 'var(--cyan)' }}>Eval</span>
                <div className="of-step-sub">--calibrate</div>
              </div>
              <div className="of-card cyan">
                <div className="of-title">Score &rarr; Expected Return Calibration</div>
                <div className="of-desc">
                  Reads from <strong>score_outcomes</strong> (50k row limit). Groups by score bucket.<br />
                  Annualizes observed 30d returns (preferred) or 7d returns (reduced weight).<br />
                  Blends: 70% observed + 30% heuristic (30d) or 40%/60% (7d-only).
                </div>
              </div>
            </div>

            <div className="of-arrow">&darr;</div>

            <div className="of-step">
              <div className="of-step-label">
                <span className="of-step-tag" style={{ background: 'var(--red-d)', color: 'var(--red)' }}>Gate</span>
                <div className="of-step-sub">calibration-config.ts</div>
              </div>
              <div className="of-card red">
                <div className="of-title">Live Eligibility Gating <span className="of-badge red">safety</span></div>
                <div className="of-desc">
                  Each bucket checked against rollout rules before live use:<br />
                  <strong>&bull; Global kill switch:</strong> CALIBRATION_LIVE_ENABLED (instant revert to heuristic)<br />
                  <strong>&bull; Min samples:</strong> &ge;20 per bucket (MIN_CALIBRATION_SAMPLES)<br />
                  <strong>&bull; 30d preferred:</strong> &ge;10 samples with 30d returns for full weight<br />
                  <strong>&bull; Staleness:</strong> reject if &gt;30 days old<br /><br />
                  Persists <strong>is_live_eligible</strong> + <strong>eligibility_reason</strong> per bucket.
                </div>
              </div>
            </div>

            <div className="of-arrow">&darr;</div>

            <div className="of-step">
              <div className="of-step-label">
                <span className="of-step-tag" style={{ background: 'var(--green-d)', color: 'var(--green)' }}>DB</span>
                <div className="of-step-sub">score_calibration</div>
              </div>
              <div className="of-card green">
                <div className="of-title">Calibration Table</div>
                <div className="of-desc">
                  Stores per-bucket: sample_count, sample_count_7d, sample_count_30d, avg_forward_return_7d/30d, hit_rate_7d/30d, calibrated_expected_return, is_live_eligible, eligibility_reason.<br />
                  Read by synthesis job + build route. Only <strong>is_live_eligible = true</strong> rows affect live optimizer.
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
