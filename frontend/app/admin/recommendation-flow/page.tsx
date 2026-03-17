'use client';

export default function RecommendationFlowPage() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Syne:wght@400;600;700;800&display=swap');
        .rf-root { --bg:#272a31;--s:#2e323b;--s2:#363a44;--b:rgba(255,255,255,0.09);--t:#e2e8f0;--m:#8994a7;--gold:#eab308;--gold-d:rgba(234,179,8,0.12);--cyan:#06b6d4;--cyan-d:rgba(6,182,212,0.12);--green:#22c55e;--green-d:rgba(34,197,94,0.12);--purple:#a855f7;--purple-d:rgba(168,85,247,0.12);--amber:#f59e0b;--amber-d:rgba(245,158,11,0.12);--red:#ef4444;--red-d:rgba(239,68,68,0.12);--blue:#3b82f6;--blue-d:rgba(59,130,246,0.12);--teal:#14b8a6;--teal-d:rgba(20,184,166,0.12); font-family:'JetBrains Mono',monospace;color:var(--t);min-height:100vh; }
        .rf-noise { position:fixed;inset:0;pointer-events:none;z-index:0;opacity:0.025; background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
        .rf-hdr { padding:2rem 3rem 1rem;border-bottom:1px solid var(--b);position:relative;z-index:1;display:flex;align-items:baseline;gap:1.5rem; }
        .rf-logo { font-family:'Syne',sans-serif;font-size:1.4rem;font-weight:800;color:var(--amber);letter-spacing:-0.02em; }
        .rf-sub { font-size:0.68rem;color:var(--m);letter-spacing:0.15em;text-transform:uppercase; }
        .rf-back { font-size:0.7rem;color:var(--m);text-decoration:none;transition:color 0.2s;margin-left:auto; }
        .rf-back:hover { color:var(--t); }
        .rf-body { padding:2rem 3rem 3rem;position:relative;z-index:1; }

        .rf-cols { display:grid;grid-template-columns:1fr 1fr;gap:2rem;max-width:1100px;margin:0 auto; }
        .rf-col { display:flex;flex-direction:column;gap:0; }
        .rf-col-hdr { font-family:'Syne',sans-serif;font-size:0.62rem;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;padding:0.4rem 0.75rem;border-radius:4px;margin-bottom:0.75rem; }

        .rf-card { border-radius:10px;border:1px solid var(--b);background:var(--s);padding:0.9rem 1.1rem;margin-bottom:0.75rem;animation:rf-in 0.4s ease both; }
        .rf-card:hover { border-color:rgba(255,255,255,0.18);box-shadow:0 0 20px rgba(255,255,255,0.03); }
        @keyframes rf-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .rf-card.gold { border-color:rgba(234,179,8,0.3);background:linear-gradient(135deg,var(--s) 0%,rgba(234,179,8,0.05) 100%); }
        .rf-card.cyan { border-color:rgba(6,182,212,0.3);background:linear-gradient(135deg,var(--s) 0%,rgba(6,182,212,0.05) 100%); }
        .rf-card.green { border-color:rgba(34,197,94,0.25);background:linear-gradient(135deg,var(--s) 0%,rgba(34,197,94,0.04) 100%); }
        .rf-card.purple { border-color:rgba(168,85,247,0.25);background:linear-gradient(135deg,var(--s) 0%,rgba(168,85,247,0.04) 100%); }
        .rf-card.amber { border-color:rgba(245,158,11,0.25);background:linear-gradient(135deg,var(--s) 0%,rgba(245,158,11,0.04) 100%); }
        .rf-card.red { border-color:rgba(239,68,68,0.25);background:linear-gradient(135deg,var(--s) 0%,rgba(239,68,68,0.04) 100%); }
        .rf-card.blue { border-color:rgba(59,130,246,0.25);background:linear-gradient(135deg,var(--s) 0%,rgba(59,130,246,0.04) 100%); }
        .rf-card.teal { border-color:rgba(20,184,166,0.25);background:linear-gradient(135deg,var(--s) 0%,rgba(20,184,166,0.04) 100%); }

        .rf-title { font-family:'Syne',sans-serif;font-size:0.82rem;font-weight:700;margin-bottom:0.25rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap; }
        .rf-desc { font-size:0.64rem;color:var(--m);line-height:1.65; }
        .rf-desc strong { color:var(--t);font-weight:500; }
        .rf-badge { display:inline-flex;align-items:center;font-size:0.56rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding:0.15rem 0.45rem;border-radius:100px;white-space:nowrap; }
        .rf-badge.gold{background:var(--gold-d);color:var(--gold);} .rf-badge.cyan{background:var(--cyan-d);color:var(--cyan);} .rf-badge.green{background:var(--green-d);color:var(--green);} .rf-badge.purple{background:var(--purple-d);color:var(--purple);} .rf-badge.amber{background:var(--amber-d);color:var(--amber);} .rf-badge.red{background:var(--red-d);color:var(--red);} .rf-badge.blue{background:var(--blue-d);color:var(--blue);} .rf-badge.teal{background:var(--teal-d);color:var(--teal);} .rf-badge.muted{background:rgba(100,116,139,0.15);color:var(--m);}

        .rf-arrow { text-align:center;padding:0.1rem 0;font-size:1.1rem;color:var(--m); }
        .rf-divider { border-top:1px dashed var(--b);margin:0.75rem 0; }

        .rf-grid { display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem; }
        .rf-cell { background:var(--s2);border:1px solid var(--b);border-radius:7px;padding:0.5rem 0.65rem; }
        .rf-cell-t { font-size:0.68rem;font-weight:600;color:var(--t);margin-bottom:0.15rem; }
        .rf-cell-b { font-size:0.6rem;color:var(--m);line-height:1.5; }

        .rf-metric-row { display:flex;justify-content:space-between;font-size:0.62rem;padding:0.2rem 0; }
        .rf-metric-row span:first-child { color:var(--m); }
        .rf-metric-row span:last-child { color:var(--t);font-weight:500; }
      `}</style>

      <div className="rf-root">
        <div className="rf-noise" />

        <header className="rf-hdr">
          <div className="rf-logo">aiMAIA</div>
          <div className="rf-sub">Recommendations &amp; Risk Model Flow</div>
          <a href="/admin/dashboard" className="rf-back">&larr; Admin</a>
          <a href="/admin/optimizer-flow" className="rf-back">Optimizer Flow &rarr;</a>
        </header>

        <div className="rf-body">
          <div className="rf-cols">

            {/* LEFT COLUMN: Daily Recommendation Pipeline */}
            <div className="rf-col">
              <div className="rf-col-hdr" style={{ color: 'var(--amber)', background: 'var(--amber-d)' }}>Daily Recommendation Pipeline</div>

              <div className="rf-card purple">
                <div className="rf-title">1. Load Portfolio State</div>
                <div className="rf-desc">
                  For each active portfolio: load <strong>positions</strong>, <strong>quantities</strong>, <strong>avg purchase prices</strong>, current market prices.<br />
                  Compute current weight per position: (qty &times; price) / totalValue<br />
                  Load <strong>cash_balance</strong> from portfolios table.
                </div>
              </div>

              <div className="rf-arrow">&darr;</div>

              <div className="rf-card red">
                <div className="rf-title">2. Drawdown Hard Stop <span className="rf-badge red">safety</span></div>
                <div className="rf-desc">
                  For each held position: compute unrealized P&amp;L %.<br />
                  If loss exceeds user&apos;s <strong>maxDrawdownLimitPct</strong>: force compositeScore = -1.<br />
                  This guarantees the optimizer will sell the position.
                </div>
              </div>

              <div className="rf-arrow">&darr;</div>

              <div className="rf-card gold">
                <div className="rf-title">3. Run Optimizer Core <span className="rf-badge gold">covariance-aware</span></div>
                <div className="rf-desc">
                  Loads <strong>covariance data</strong> (vols + pairwise correlations) from price_history.<br />
                  Loads <strong>calibration</strong> from score_calibration (live-eligible only).<br />
                  Runs iterative solver &rarr; target weights + actions.<br />
                  See <a href="/admin/optimizer-flow" style={{ color: 'var(--gold)', textDecoration: 'underline' }}>Optimizer Flow</a> for full detail.
                </div>
              </div>

              <div className="rf-arrow">&darr;</div>

              <div className="rf-card gold">
                <div className="rf-title">4. Deterministic Action Generation</div>
                <div className="rf-desc">
                  Compare <strong>target weights</strong> vs <strong>current weights</strong>:<br />
                  <strong>&bull; BUY:</strong> current &lt; 0.5%, target material<br />
                  <strong>&bull; SELL:</strong> target &lt; 0.5%, currently held<br />
                  <strong>&bull; ADD:</strong> delta &gt; hold threshold (rebalance band or min trade)<br />
                  <strong>&bull; REDUCE:</strong> delta &lt; -hold threshold<br />
                  <strong>&bull; HOLD:</strong> within tolerance band<br /><br />
                  Hold threshold = max(rebalanceBand, minTradePct)<br />
                  Max {5} daily changes enforced. Excess actions removed entirely.
                </div>
              </div>

              <div className="rf-arrow">&darr;</div>

              <div className="rf-card amber">
                <div className="rf-title">5. LLM Explanation <span className="rf-badge amber">Sonnet</span> <span className="rf-badge muted">explain-only</span></div>
                <div className="rf-desc">
                  LLM receives: optimizer actions + portfolio risk context (vol, diversification, correlation, crypto allocation) + macro events.<br />
                  Produces: <strong>portfolioNarrative</strong>, per-action <strong>explanations</strong>, <strong>goalStatus</strong>.<br />
                  If LLM fails: recommendations still persist from optimizer &mdash; only narrative degrades.
                </div>
              </div>

              <div className="rf-arrow">&darr;</div>

              <div className="rf-card green">
                <div className="rf-title">6. Persist Results</div>
                <div className="rf-desc">
                  <strong>recommendation_runs:</strong> one per portfolio per day (narrative, confidence, goal status)<br />
                  <strong>recommendation_items:</strong> one per action (ticker, action, target%, reasoning)<br />
                  <strong>portfolio_risk_metrics:</strong> daily risk snapshot (extended v2 fields)<br />
                  <strong>synthesis_runs + synthesis_raw_outputs:</strong> audit trail
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Risk Model */}
            <div className="rf-col">
              <div className="rf-col-hdr" style={{ color: 'var(--red)', background: 'var(--red-d)' }}>Portfolio Risk Model</div>

              <div className="rf-card teal">
                <div className="rf-title">Covariance Estimation</div>
                <div className="rf-desc">
                  <strong>Source:</strong> rolling daily log returns from price_history (~120 days)<br />
                  <strong>Per-asset volatility:</strong> annualized std dev of log returns (&radic;252)<br />
                  <strong>Pairwise correlations:</strong> computed from overlapping date returns (min 15 observations)<br />
                  <strong>Shrinkage:</strong> 30% blend toward asset-type-aware defaults
                </div>
                <div className="rf-grid">
                  <div className="rf-cell">
                    <div className="rf-cell-t">Default Correlations</div>
                    <div className="rf-cell-b">Crypto &harr; Crypto: 0.65<br />Crypto &harr; Equity: 0.15<br />Equity &harr; Equity: 0.30</div>
                  </div>
                  <div className="rf-cell">
                    <div className="rf-cell-t">Sparse Data Handling</div>
                    <div className="rf-cell-b">&lt;20 days: use default vol (25%)<br />&lt;15 overlap: use default corr<br />Never crashes on missing data</div>
                  </div>
                </div>
              </div>

              <div className="rf-divider" />

              <div className="rf-card red">
                <div className="rf-title">Risk Penalties in Objective</div>
                <div className="rf-desc">The optimizer penalizes risk through multiple channels:</div>
                <div className="rf-grid">
                  <div className="rf-cell">
                    <div className="rf-cell-t">&lambda;<sub>risk</sub> &times; Portfolio Variance</div>
                    <div className="rf-cell-b">Full covariance matrix: w&apos;&Sigma;w<br />Conservative: 6.0&ndash;7.8<br />Balanced: 2.1&ndash;3.9<br />Aggressive: 1.05&ndash;1.5</div>
                  </div>
                  <div className="rf-cell">
                    <div className="rf-cell-t">&lambda;<sub>conc</sub> &times; HHI</div>
                    <div className="rf-cell-b">Herfindahl-Hirschman Index<br />Conservative: 2.0<br />Balanced: 1.0<br />Aggressive: 0.4</div>
                  </div>
                  <div className="rf-cell">
                    <div className="rf-cell-t">&lambda;<sub>cluster</sub> &times; Overweight&sup2;</div>
                    <div className="rf-cell-b">9 theme clusters &middot; max 45% each<br />Quadratic penalty on excess<br />Conservative: 1.5 &middot; Aggressive: 0.8</div>
                  </div>
                  <div className="rf-cell">
                    <div className="rf-cell-t">Turnover + Friction</div>
                    <div className="rf-cell-b">~50bps per unit turnover<br />~10bps per trade (friction)<br />25% damping toward current weights</div>
                  </div>
                </div>
              </div>

              <div className="rf-divider" />

              <div className="rf-card blue">
                <div className="rf-title">Persisted Risk Metrics <span className="rf-badge blue">portfolio_risk_metrics</span></div>
                <div className="rf-desc">Written daily by synthesis job. Displayed on dashboard &ldquo;Portfolio Risk&rdquo; card.</div>
                <div style={{ marginTop: '0.5rem' }}>
                  <div className="rf-metric-row"><span>Volatility</span><span>annualized &radic;(w&apos;&Sigma;w)</span></div>
                  <div className="rf-metric-row"><span>Concentration Risk</span><span>normalized HHI [0,1]</span></div>
                  <div className="rf-metric-row"><span>Diversification Score</span><span>1 &minus; concentration</span></div>
                  <div className="rf-metric-row"><span>Max Drawdown Estimate</span><span>2.33 &times; vol (Cornish-Fisher 99%)</span></div>
                  <div className="rf-metric-row"><span>Avg Pairwise Correlation</span><span>weighted portfolio average</span></div>
                  <div className="rf-metric-row"><span>Crypto Allocation</span><span>sum of crypto weights</span></div>
                  <div className="rf-metric-row"><span>Largest Position</span><span>max single weight</span></div>
                  <div className="rf-metric-row"><span>Expected Return</span><span>weighted E[R] from optimizer</span></div>
                  <div className="rf-metric-row"><span>Tickers With Vol Data</span><span>count with real history</span></div>
                </div>
              </div>

              <div className="rf-divider" />

              <div className="rf-card cyan">
                <div className="rf-title">Recommendation Outcome Tracking</div>
                <div className="rf-desc">
                  Separate from score outcomes. Tracks how <strong>actual portfolio recommendations</strong> performed:<br />
                  <strong>&bull;</strong> Forward returns at 1d / 7d / 30d<br />
                  <strong>&bull;</strong> SPY benchmark comparison (action-direction-aware)<br />
                  <strong>&bull;</strong> BUY/ADD succeeds when asset outperforms benchmark<br />
                  <strong>&bull;</strong> SELL/REDUCE succeeds when asset underperforms benchmark<br />
                  Stored in <strong>recommendation_outcomes</strong> (separate from score_outcomes).
                </div>
              </div>

              <div className="rf-divider" />

              <div className="rf-card purple">
                <div className="rf-title">Action Rationale Generation</div>
                <div className="rf-desc">
                  Each action includes portfolio-level context:<br />
                  <strong>&bull; BUY:</strong> cluster exposure added, vol-adjusted sizing note<br />
                  <strong>&bull; SELL:</strong> risk/return balance improvement, low confidence warning<br />
                  <strong>&bull; REDUCE:</strong> ticker vol, overweight position, crypto exposure mgmt<br />
                  <strong>&bull; ADD:</strong> score confidence + cluster allocation context<br />
                  Passed to LLM for richer narrative explanations.
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
