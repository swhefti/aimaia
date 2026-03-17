'use client';

export default function DataFlowPage() {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Syne:wght@400;600;700;800&display=swap');

        .df-root {
          --bg: #272a31;
          --surface: #2e323b;
          --surface2: #363a44;
          --border: rgba(255,255,255,0.09);
          --text: #e2e8f0;
          --muted: #8994a7;
          --blue: #3b82f6;
          --blue-dim: rgba(59,130,246,0.12);
          --teal: #14b8a6;
          --teal-dim: rgba(20,184,166,0.12);
          --orange: #f97316;
          --orange-dim: rgba(249,115,22,0.12);
          --purple: #a855f7;
          --purple-dim: rgba(168,85,247,0.12);
          --green: #22c55e;
          --green-dim: rgba(34,197,94,0.12);
          --red: #ef4444;
          --red-dim: rgba(239,68,68,0.12);
          --amber: #f59e0b;
          --amber-dim: rgba(245,158,11,0.12);
          --gold: #eab308;
          --cyan: #06b6d4;
          --cyan-dim: rgba(6,182,212,0.12);
          font-family: 'JetBrains Mono', monospace;
          color: var(--text);
          min-height: 100vh;
          overflow-x: hidden;
        }

        .df-noise { position: fixed; inset: 0; pointer-events: none; z-index: 0; opacity: 0.025;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
        }

        .df-header { padding: 2.5rem 3rem 1.5rem; border-bottom: 1px solid var(--border); position: relative; z-index: 1; display: flex; align-items: baseline; gap: 1.5rem; }
        .df-logo { font-family: 'Syne', sans-serif; font-size: 1.5rem; font-weight: 800; color: var(--amber); letter-spacing: -0.02em; }
        .df-subtitle { font-size: 0.7rem; color: var(--muted); letter-spacing: 0.15em; text-transform: uppercase; }

        .df-diagram { padding: 2rem 2.5rem 3rem; display: grid; grid-template-columns: 220px 1fr 220px 1fr; gap: 0; min-height: calc(100vh - 90px); position: relative; z-index: 1; align-items: start; }
        .df-col { display: flex; flex-direction: column; gap: 0.75rem; padding: 0 0.75rem; }
        .df-col-header { font-family: 'Syne', sans-serif; font-size: 0.62rem; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; padding: 0.4rem 0.75rem; border-radius: 4px; margin-bottom: 0.25rem; }

        .df-card { border-radius: 10px; border: 1px solid var(--border); background: var(--surface); padding: 0.85rem 1rem; position: relative; transition: border-color 0.2s, box-shadow 0.2s; cursor: default; animation: df-fadeup 0.5s ease both; }
        .df-card:hover { border-color: rgba(255,255,255,0.18); box-shadow: 0 0 24px rgba(255,255,255,0.04); }
        .df-card:nth-child(1) { animation-delay: 0.05s; } .df-card:nth-child(2) { animation-delay: 0.1s; } .df-card:nth-child(3) { animation-delay: 0.15s; } .df-card:nth-child(4) { animation-delay: 0.2s; } .df-card:nth-child(5) { animation-delay: 0.25s; } .df-card:nth-child(6) { animation-delay: 0.3s; } .df-card:nth-child(7) { animation-delay: 0.35s; }
        @keyframes df-fadeup { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }

        .df-card-title { font-family: 'Syne', sans-serif; font-size: 0.82rem; font-weight: 700; margin-bottom: 0.3rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
        .df-card-body { font-size: 0.65rem; color: var(--muted); line-height: 1.6; }
        .df-card-body strong { color: var(--text); font-weight: 500; }

        .df-card.blue   { border-color: rgba(59,130,246,0.25);  background: linear-gradient(135deg, var(--surface) 0%, rgba(59,130,246,0.04) 100%); }
        .df-card.teal   { border-color: rgba(20,184,166,0.25);  background: linear-gradient(135deg, var(--surface) 0%, rgba(20,184,166,0.04) 100%); }
        .df-card.orange { border-color: rgba(249,115,22,0.25);  background: linear-gradient(135deg, var(--surface) 0%, rgba(249,115,22,0.04) 100%); }
        .df-card.purple { border-color: rgba(168,85,247,0.25);  background: linear-gradient(135deg, var(--surface) 0%, rgba(168,85,247,0.04) 100%); }
        .df-card.green  { border-color: rgba(34,197,94,0.25);   background: linear-gradient(135deg, var(--surface) 0%, rgba(34,197,94,0.04) 100%); }
        .df-card.red    { border-color: rgba(239,68,68,0.25);   background: linear-gradient(135deg, var(--surface) 0%, rgba(239,68,68,0.04) 100%); }
        .df-card.amber  { border-color: rgba(245,158,11,0.25);  background: linear-gradient(135deg, var(--surface) 0%, rgba(245,158,11,0.04) 100%); }
        .df-card.gold   { border-color: rgba(234,179,8,0.3);    background: linear-gradient(135deg, var(--surface) 0%, rgba(234,179,8,0.05) 100%); }
        .df-card.cyan   { border-color: rgba(6,182,212,0.25);   background: linear-gradient(135deg, var(--surface) 0%, rgba(6,182,212,0.04) 100%); }

        .df-badge { display: inline-flex; align-items: center; font-size: 0.58rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; padding: 0.18rem 0.5rem; border-radius: 100px; white-space: nowrap; }
        .df-badge.blue   { background: var(--blue-dim);   color: var(--blue); }
        .df-badge.teal   { background: var(--teal-dim);   color: var(--teal); }
        .df-badge.orange { background: var(--orange-dim); color: var(--orange); }
        .df-badge.purple { background: var(--purple-dim); color: var(--purple); }
        .df-badge.green  { background: var(--green-dim);  color: var(--green); }
        .df-badge.red    { background: var(--red-dim);    color: var(--red); }
        .df-badge.amber  { background: var(--amber-dim);  color: var(--amber); }
        .df-badge.cyan   { background: var(--cyan-dim);   color: var(--cyan); }
        .df-badge.muted  { background: rgba(100,116,139,0.15); color: var(--muted); }

        .df-agent-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.6rem; }
        .df-agent-cell { background: var(--surface2); border: 1px solid var(--border); border-radius: 7px; padding: 0.55rem 0.65rem; }
        .df-agent-cell-title { font-size: 0.68rem; font-weight: 600; color: var(--text); margin-bottom: 0.2rem; display: flex; justify-content: space-between; align-items: center; }
        .df-agent-cell-body { font-size: 0.6rem; color: var(--muted); line-height: 1.5; }

        .df-db-chips { display: flex; flex-direction: column; gap: 0.4rem; margin-top: 0.4rem; }
        .df-db-chip { background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; padding: 0.35rem 0.65rem; font-size: 0.65rem; display: flex; justify-content: space-between; align-items: center; transition: border-color 0.2s; }
        .df-db-chip:hover { border-color: rgba(255,255,255,0.18); }
        .df-db-chip-name { color: var(--text); font-weight: 500; }

        .df-bracket { border: 1.5px dashed; border-radius: 12px; padding: 0.75rem; margin-bottom: 0.5rem; position: relative; }
        .df-bracket-label { position: absolute; top: -0.65rem; left: 1rem; font-size: 0.6rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; padding: 0.1rem 0.5rem; border-radius: 4px; }
        .df-bracket.orange { border-color: rgba(249,115,22,0.3); }
        .df-bracket.orange .df-bracket-label { background: var(--bg); color: var(--orange); }
        .df-bracket.cyan { border-color: rgba(6,182,212,0.3); }
        .df-bracket.cyan .df-bracket-label { background: var(--bg); color: var(--cyan); }

        .df-schedule { font-size: 0.6rem; color: var(--orange); background: var(--orange-dim); border: 1px solid rgba(249,115,22,0.2); border-radius: 4px; padding: 0.1rem 0.4rem; display: inline-flex; align-items: center; gap: 0.3rem; margin-bottom: 0.4rem; }
        .df-pulse-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; flex-shrink: 0; animation: df-pulse 2s ease-in-out infinite; }
        @keyframes df-pulse { 0%,100% { opacity: 1; box-shadow: 0 0 0 0 currentColor; } 50% { opacity: 0.7; box-shadow: 0 0 0 4px transparent; } }

        .df-needs-arrow { text-align: center; padding: 0.2rem 0; }
        .df-needs-text { font-size: 0.58rem; color: var(--muted); background: var(--surface2); border: 1px solid var(--border); padding: 0.12rem 0.5rem; border-radius: 4px; display: inline-block; margin-bottom: 0.2rem; }

        .df-route-list { display: flex; flex-direction: column; gap: 0.4rem; margin-top: 0.5rem; }
        .df-route { background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; padding: 0.45rem 0.65rem; font-size: 0.62rem; transition: border-color 0.2s; }
        .df-route:hover { border-color: rgba(255,255,255,0.18); }
        .df-route-method { font-size: 0.58rem; font-weight: 700; margin-right: 0.3rem; }
        .df-route-path { color: var(--text); }
        .df-route-desc { color: var(--muted); font-size: 0.6rem; margin-top: 0.15rem; }

        .df-section-label { font-size: 0.58rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.1em; padding: 0.2rem 0; }

        .df-conclusion-box { margin-top: 0.5rem; background: var(--surface2); border: 1px solid var(--border); border-radius: 7px; padding: 0.5rem 0.65rem; }
        .df-conclusion-title { font-size: 0.65rem; color: var(--text); font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
        .df-conclusion-body { font-size: 0.6rem; color: var(--muted); margin-top: 0.15rem; }

        .df-legend { position: fixed; bottom: 1.5rem; right: 1.5rem; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 0.75rem 1rem; display: flex; flex-direction: column; gap: 0.35rem; z-index: 100; }
        .df-legend-title { font-size: 0.58rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 0.15rem; }
        .df-legend-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.62rem; color: var(--text); }
        .df-legend-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

        .df-back-link { font-size: 0.7rem; color: var(--muted); text-decoration: none; transition: color 0.2s; }
        .df-back-link:hover { color: var(--text); }
      `}</style>

      <div className="df-root">
        <div className="df-noise" />

        <header className="df-header">
          <div className="df-logo">aiMAIA</div>
          <div className="df-subtitle">Data Flow Architecture v0.74 &mdash; Optimizer-First Pipeline</div>
          <a href="/admin/dashboard" className="df-back-link" style={{ marginLeft: 'auto' }}>&larr; Back to Admin</a>
        </header>

        <div className="df-diagram">

          {/* COL 1: EXTERNAL DATA SOURCES */}
          <div className="df-col">
            <div className="df-col-header" style={{ color: 'var(--blue)', background: 'var(--blue-dim)' }}>&#x2B21; External APIs</div>

            <div className="df-card blue">
              <div className="df-card-title">
                <span className="df-pulse-dot" style={{ background: 'var(--blue)', color: 'var(--blue)' }} />
                Twelve Data
              </div>
              <div className="df-schedule">&#9201; 21:00 UTC daily</div>
              <div className="df-card-body">
                <strong>101 tickers</strong> &mdash; OHLCV 30-day history<br />
                Stocks + ETFs + Crypto on weekdays<br />
                Crypto-only on weekends
              </div>
            </div>

            <div className="df-card teal">
              <div className="df-card-title">
                <span className="df-pulse-dot" style={{ background: 'var(--teal)', color: 'var(--teal)' }} />
                Finnhub
              </div>
              <div className="df-schedule">&#9201; 21:00 + 3&times; intraday</div>
              <div className="df-card-body">
                <strong>Company news</strong> stocks + ETFs<br />
                Crypto matched via keyword map<br />
                Auth-failure detection (incl. HTTP 200 error bodies)
              </div>
            </div>

            <div className="df-card blue">
              <div className="df-card-title">
                <span className="df-pulse-dot" style={{ background: 'var(--blue)', color: 'var(--blue)' }} />
                Twelve Data (Crypto)
              </div>
              <div className="df-schedule">&#9201; 5&times; per day, 24/7</div>
              <div className="df-card-body">
                <strong>20 crypto tickers</strong> &mdash; 5-day window<br />
                BTC/USD &middot; ETH/USD &middot; SOL/USD&hellip;
              </div>
            </div>

            <div style={{ height: '0.75rem' }} />

            <div className="df-card amber">
              <div className="df-card-title">
                <span style={{ fontSize: '0.7rem' }}>&nearr;</span> On-Demand (User)
              </div>
              <div className="df-card-body">
                <strong>Claude Opus</strong> &mdash; risk reports<br />
                <strong>Opus + Sonnet</strong> &mdash; AI probability<br />
                Only called on user action
              </div>
            </div>
          </div>

          {/* COL 2: GITHUB ACTIONS BATCH ENGINE */}
          <div className="df-col">
            <div className="df-col-header" style={{ color: 'var(--orange)', background: 'var(--orange-dim)' }}>&#9881; GitHub Actions &mdash; Batch Pipeline</div>

            <div className="df-bracket orange" style={{ paddingTop: '1.2rem' }}>
              <div className="df-bracket-label">daily-batch.yml &middot; 21:00 UTC</div>

              <div className="df-card orange" style={{ marginBottom: '0.5rem' }}>
                <div className="df-card-title"><span className="df-badge orange">Job 1</span> prices.ts</div>
                <div className="df-card-body">Fetches OHLCV via Twelve Data &middot; Upserts on ticker+date</div>
              </div>

              <div className="df-card teal" style={{ marginBottom: '0.5rem' }}>
                <div className="df-card-title"><span className="df-badge orange">Job 2</span> news.ts <span className="df-badge muted">parallel</span></div>
                <div className="df-card-body">Finnhub company-news &middot; Crypto keyword matching &middot; &gt;30% failure rate &rarr; exit(1)</div>
              </div>

              <div className="df-needs-arrow">
                <div className="df-needs-text">needs: prices + news</div>
                <div style={{ fontSize: '1rem', color: 'var(--muted)' }}>&darr;</div>
              </div>

              <div className="df-card purple" style={{ marginBottom: '0.5rem' }}>
                <div className="df-card-title"><span className="df-badge orange">Job 3</span> scores.ts &mdash; 4 Agents</div>
                <div className="df-agent-grid">
                  <div className="df-agent-cell">
                    <div className="df-agent-cell-title">Technical <span className="df-badge muted">Math</span></div>
                    <div className="df-agent-cell-body">RSI &middot; MACD &middot; EMA &middot; Bollinger &middot; Volume</div>
                  </div>
                  <div className="df-agent-cell">
                    <div className="df-agent-cell-title">Fundamental <span className="df-badge muted">Math</span></div>
                    <div className="df-agent-cell-body">PE &middot; Revenue &middot; Margin &middot; ROE &middot; Debt</div>
                  </div>
                  <div className="df-agent-cell">
                    <div className="df-agent-cell-title">Sentiment <span className="df-badge purple">Haiku</span></div>
                    <div className="df-agent-cell-body">News &rarr; score [-1,+1] &middot; Crypto filter &middot; Decay</div>
                  </div>
                  <div className="df-agent-cell">
                    <div className="df-agent-cell-title">Regime <span className="df-badge muted">Math</span></div>
                    <div className="df-agent-cell-body">SPY/BTC trend &middot; Vol regime &middot; Sector rotation</div>
                  </div>
                </div>
                <div className="df-conclusion-box">
                  <div className="df-conclusion-title">Conclusion Generator <span className="df-badge green">Sonnet</span></div>
                  <div className="df-conclusion-body">450-char outlook per ticker &middot; cached daily</div>
                </div>
              </div>

              <div className="df-needs-arrow">
                <div className="df-needs-text">needs: scores</div>
                <div style={{ fontSize: '1rem', color: 'var(--muted)' }}>&darr;</div>
              </div>

              <div className="df-card gold" style={{ marginBottom: '0.5rem' }}>
                <div className="df-card-title"><span className="df-badge orange">Job 4</span> synthesis.ts <span className="df-badge gold">Optimizer-First</span></div>
                <div className="df-card-body" style={{ lineHeight: 1.8 }}>
                  Per active portfolio:<br />
                  1. Load scores + prices + covariance data<br />
                  2. <strong>Optimizer core</strong> &rarr; target weights (covariance-aware, iterative solver)<br />
                  3. Deterministic actions: BUY/ADD/REDUCE/SELL/HOLD from deltas<br />
                  4. <strong>LLM explains</strong> actions (not invents them) <span className="df-badge amber">Sonnet</span><br />
                  5. Persist: recommendation_runs + items + portfolio_risk_metrics<br />
                  6. Loads <strong>calibration</strong> from score_calibration (if live-eligible)
                </div>
              </div>
            </div>

            <div className="df-card blue">
              <div className="df-card-title">
                <span className="df-pulse-dot" style={{ background: 'var(--blue)', color: 'var(--blue)' }} />
                crypto-prices.ts <span className="df-badge blue">5&times; daily</span>
              </div>
              <div className="df-card-body">Independent crypto refresh every ~4h via crypto-refresh.yml</div>
            </div>

            <div style={{ height: '0.5rem' }} />

            <div className="df-bracket cyan" style={{ paddingTop: '1.2rem' }}>
              <div className="df-bracket-label">evaluate-optimizer.ts &middot; Weekly / Manual</div>
              <div className="df-card cyan" style={{ marginBottom: '0.5rem' }}>
                <div className="df-card-title">Evaluation &amp; Calibration</div>
                <div className="df-card-body" style={{ lineHeight: 1.8 }}>
                  <strong>--score-outcomes</strong> All-asset forward returns (1d/7d/30d vs SPY)<br />
                  <strong>--outcomes</strong> Recommendation-level outcome tracking<br />
                  <strong>--backtest</strong> Walk-forward simulation with optimizer core<br />
                  <strong>--calibrate</strong> Score-bucket &rarr; expected-return mapping<br />
                  &middot; Eligibility gating: &ge;20 samples, 30d preferred, staleness check<br />
                  &middot; Global kill switch in calibration-config.ts
                </div>
              </div>
            </div>
          </div>

          {/* COL 3: SUPABASE DB */}
          <div className="df-col">
            <div className="df-col-header" style={{ color: 'var(--green)', background: 'var(--green-dim)' }}>&#x2B21; Supabase DB</div>

            <div className="df-card green">
              <div className="df-card-title" style={{ fontSize: '0.72rem' }}>PostgreSQL + RLS</div>
              <div className="df-card-body" style={{ marginBottom: '0.5rem' }}>Central truth. All reads + writes flow through here.</div>
              <div className="df-db-chips">
                <div className="df-section-label">Price Data</div>
                <div className="df-db-chip"><span className="df-db-chip-name">price_history</span> <span className="df-badge blue" style={{ fontSize: '0.54rem' }}>OHLCV</span></div>
                <div className="df-db-chip"><span className="df-db-chip-name">market_quotes</span> <span className="df-badge blue" style={{ fontSize: '0.54rem' }}>latest</span></div>

                <div className="df-section-label">News</div>
                <div className="df-db-chip"><span className="df-db-chip-name">news_data</span> <span className="df-badge teal" style={{ fontSize: '0.54rem' }}>headlines</span></div>

                <div className="df-section-label">Intelligence</div>
                <div className="df-db-chip"><span className="df-db-chip-name">agent_scores</span> <span className="df-badge purple" style={{ fontSize: '0.54rem' }}>4 agents</span></div>
                <div className="df-db-chip"><span className="df-db-chip-name">ticker_conclusions</span> <span className="df-badge green" style={{ fontSize: '0.54rem' }}>text</span></div>

                <div className="df-section-label">Optimizer &amp; Recommendations</div>
                <div className="df-db-chip"><span className="df-db-chip-name">synthesis_runs</span> <span className="df-badge amber" style={{ fontSize: '0.54rem' }}>meta</span></div>
                <div className="df-db-chip"><span className="df-db-chip-name">recommendation_runs</span> <span className="df-badge amber" style={{ fontSize: '0.54rem' }}>runs</span></div>
                <div className="df-db-chip"><span className="df-db-chip-name">recommendation_items</span> <span className="df-badge amber" style={{ fontSize: '0.54rem' }}>actions</span></div>

                <div className="df-section-label">Portfolio</div>
                <div className="df-db-chip"><span className="df-db-chip-name">portfolios</span> <span className="df-badge muted" style={{ fontSize: '0.54rem' }}>strategy_mode</span></div>
                <div className="df-db-chip"><span className="df-db-chip-name">portfolio_positions</span> <span className="df-badge muted" style={{ fontSize: '0.54rem' }}>holdings</span></div>
                <div className="df-db-chip"><span className="df-db-chip-name">portfolio_valuations</span> <span className="df-badge muted" style={{ fontSize: '0.54rem' }}>daily</span></div>
                <div className="df-db-chip"><span className="df-db-chip-name">portfolio_risk_metrics</span> <span className="df-badge red" style={{ fontSize: '0.54rem' }}>risk v2</span></div>

                <div className="df-section-label">Evaluation &amp; Calibration</div>
                <div className="df-db-chip"><span className="df-db-chip-name">score_outcomes</span> <span className="df-badge cyan" style={{ fontSize: '0.54rem' }}>all-asset</span></div>
                <div className="df-db-chip"><span className="df-db-chip-name">recommendation_outcomes</span> <span className="df-badge cyan" style={{ fontSize: '0.54rem' }}>rec-level</span></div>
                <div className="df-db-chip"><span className="df-db-chip-name">score_calibration</span> <span className="df-badge cyan" style={{ fontSize: '0.54rem' }}>E[R] map</span></div>
                <div className="df-db-chip"><span className="df-db-chip-name">optimizer_backtest_runs</span> <span className="df-badge cyan" style={{ fontSize: '0.54rem' }}>backtest</span></div>

                <div className="df-section-label">User &amp; Config</div>
                <div className="df-db-chip"><span className="df-db-chip-name">user_profiles</span> <span className="df-badge muted" style={{ fontSize: '0.54rem' }}>goals</span></div>
                <div className="df-db-chip"><span className="df-db-chip-name">system_config</span> <span className="df-badge muted" style={{ fontSize: '0.54rem' }}>tunable</span></div>
              </div>
            </div>
          </div>

          {/* COL 4: VERCEL — USER LAYER */}
          <div className="df-col">
            <div className="df-col-header" style={{ color: 'var(--blue)', background: 'var(--blue-dim)' }}>&#x2B21; Vercel &mdash; User Layer</div>

            <div className="df-card blue">
              <div className="df-card-title">Next.js Frontend Pages <span className="df-badge muted">reads DB</span></div>
              <div className="df-route-list">
                <div className="df-route">
                  <div className="df-route-path">&#128202; /dashboard</div>
                  <div className="df-route-desc">Positions &middot; Recs &middot; Goal tracker &middot; Briefing &middot; <strong>Risk metrics panel</strong></div>
                </div>
                <div className="df-route">
                  <div className="df-route-path">&#128200; /market</div>
                  <div className="df-route-desc">100 tickers &middot; Quotes &middot; Agent scores &middot; Conclusions</div>
                </div>
                <div className="df-route">
                  <div className="df-route-path">&#128640; /onboarding</div>
                  <div className="df-route-desc">Questionnaire &rarr; <strong>Optimizer draft</strong> &rarr; Approve &rarr; Finalize</div>
                </div>
                <div className="df-route">
                  <div className="df-route-path">&#9881; /settings &middot; /admin</div>
                  <div className="df-route-desc">Config editor &middot; Data flow viz &middot; Account management</div>
                </div>
              </div>
            </div>

            <div className="df-card gold">
              <div className="df-card-title">Optimizer API Routes <span className="df-badge gold">core engine</span></div>
              <div className="df-route-list">
                <div className="df-route">
                  <span className="df-route-method" style={{ color: 'var(--green)' }}>POST</span>
                  <span className="df-route-path">/api/optimizer/build</span>
                  <div className="df-route-desc">
                    Scores &rarr; covariance data &rarr; calibration &rarr; <strong>optimizer core</strong> &rarr; target weights<br />
                    Used by onboarding. Loads pairwise correlations from price_history.
                  </div>
                </div>
                <div className="df-route">
                  <span className="df-route-method" style={{ color: 'var(--green)' }}>POST</span>
                  <span className="df-route-path">/api/optimizer/finalize</span>
                  <div className="df-route-desc">
                    Creates portfolio + positions + valuation + goal probability.<br />
                    Insert-before-delete safety: old positions preserved until new ones succeed.
                  </div>
                </div>
              </div>
            </div>

            <div className="df-card amber">
              <div className="df-card-title">On-Demand API Routes <span className="df-badge muted">user-triggered</span></div>
              <div className="df-route-list">
                <div className="df-route">
                  <span className="df-route-method" style={{ color: 'var(--green)' }}>POST</span>
                  <span className="df-route-path">/api/portfolio/positions</span>
                  <div className="df-route-desc">Service-role position save (bypasses RLS)</div>
                </div>
                <div className="df-route">
                  <span className="df-route-method" style={{ color: 'var(--blue)' }}>GET</span>
                  <span className="df-route-path">/api/portfolio/risk-report</span>
                  <div className="df-route-desc"><span className="df-badge red" style={{ fontSize: '0.54rem' }}>Opus</span> Cached risk report</div>
                </div>
                <div className="df-route">
                  <span className="df-route-method" style={{ color: 'var(--green)' }}>POST</span>
                  <span className="df-route-path">/api/portfolio/ai-probability</span>
                  <div className="df-route-desc"><span className="df-badge red" style={{ fontSize: '0.54rem' }}>Opus</span> + <span className="df-badge amber" style={{ fontSize: '0.54rem' }}>Sonnet</span> dual estimate</div>
                </div>
              </div>
            </div>

            <div className="df-card" style={{ borderColor: 'rgba(100,116,139,0.25)' }}>
              <div className="df-card-title" style={{ color: 'var(--muted)' }}>Shared Modules <span className="df-badge muted">shared/lib/</span></div>
              <div className="df-card-body">
                <strong>optimizer-core.ts</strong> &mdash; Covariance-aware solver, action gen, risk summary<br />
                <strong>calibration-config.ts</strong> &mdash; Rollout thresholds, eligibility rules, kill switch<br />
                <strong>constants.ts</strong> &mdash; Asset universe, weights, score thresholds
              </div>
            </div>
          </div>

        </div>

        {/* LEGEND */}
        <div className="df-legend">
          <div className="df-legend-title">Architecture Legend</div>
          <div className="df-legend-row"><div className="df-legend-dot" style={{ background: 'var(--gold)' }} />Optimizer Core &mdash; Target weights + actions</div>
          <div className="df-legend-row"><div className="df-legend-dot" style={{ background: 'var(--purple)' }} />Claude Haiku &mdash; Sentiment scoring</div>
          <div className="df-legend-row"><div className="df-legend-dot" style={{ background: 'var(--amber)' }} />Claude Sonnet &mdash; Explanation-only synthesis</div>
          <div className="df-legend-row"><div className="df-legend-dot" style={{ background: 'var(--red)' }} />Claude Opus &mdash; Risk report + AI probability</div>
          <div className="df-legend-row"><div className="df-legend-dot" style={{ background: 'var(--cyan)' }} />Evaluation &mdash; Outcomes + Calibration</div>
          <div className="df-legend-row"><div className="df-legend-dot" style={{ background: 'var(--muted)' }} />Pure Math &mdash; Technical &middot; Fundamental &middot; Regime</div>
        </div>
      </div>
    </>
  );
}
