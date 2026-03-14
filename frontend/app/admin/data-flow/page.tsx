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
          font-family: 'JetBrains Mono', monospace;
          color: var(--text);
          min-height: 100vh;
          overflow-x: hidden;
        }

        .df-noise {
          position: fixed; inset: 0; pointer-events: none; z-index: 0;
          opacity: 0.025;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
        }

        .df-header {
          padding: 2.5rem 3rem 1.5rem;
          border-bottom: 1px solid var(--border);
          position: relative; z-index: 1;
          display: flex; align-items: baseline; gap: 1.5rem;
        }

        .df-logo {
          font-family: 'Syne', sans-serif;
          font-size: 1.5rem; font-weight: 800;
          color: var(--amber);
          letter-spacing: -0.02em;
        }

        .df-subtitle {
          font-size: 0.7rem; color: var(--muted);
          letter-spacing: 0.15em; text-transform: uppercase;
        }

        .df-diagram {
          padding: 2rem 2.5rem 3rem;
          display: grid;
          grid-template-columns: 220px 1fr 200px 1fr;
          gap: 0;
          min-height: calc(100vh - 90px);
          position: relative; z-index: 1;
          align-items: start;
        }

        .df-col {
          display: flex; flex-direction: column; gap: 0.75rem;
          padding: 0 0.75rem;
        }

        .df-col-header {
          font-family: 'Syne', sans-serif;
          font-size: 0.62rem; font-weight: 700;
          letter-spacing: 0.18em; text-transform: uppercase;
          padding: 0.4rem 0.75rem;
          border-radius: 4px;
          margin-bottom: 0.25rem;
        }

        .df-card {
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--surface);
          padding: 0.85rem 1rem;
          position: relative;
          transition: border-color 0.2s, box-shadow 0.2s;
          cursor: default;
          animation: df-fadeup 0.5s ease both;
        }

        .df-card:hover {
          border-color: rgba(255,255,255,0.18);
          box-shadow: 0 0 24px rgba(255,255,255,0.04);
        }

        .df-card:nth-child(1) { animation-delay: 0.05s; }
        .df-card:nth-child(2) { animation-delay: 0.1s; }
        .df-card:nth-child(3) { animation-delay: 0.15s; }
        .df-card:nth-child(4) { animation-delay: 0.2s; }
        .df-card:nth-child(5) { animation-delay: 0.25s; }
        .df-card:nth-child(6) { animation-delay: 0.3s; }

        @keyframes df-fadeup {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .df-card-title {
          font-family: 'Syne', sans-serif;
          font-size: 0.82rem; font-weight: 700;
          margin-bottom: 0.3rem;
          display: flex; align-items: center; gap: 0.5rem;
        }

        .df-card-body {
          font-size: 0.65rem; color: var(--muted);
          line-height: 1.6;
        }

        .df-card-body strong { color: var(--text); font-weight: 500; }

        .df-card.blue  { border-color: rgba(59,130,246,0.25);  background: linear-gradient(135deg, var(--surface) 0%, rgba(59,130,246,0.04) 100%); }
        .df-card.teal  { border-color: rgba(20,184,166,0.25);  background: linear-gradient(135deg, var(--surface) 0%, rgba(20,184,166,0.04) 100%); }
        .df-card.orange{ border-color: rgba(249,115,22,0.25);  background: linear-gradient(135deg, var(--surface) 0%, rgba(249,115,22,0.04) 100%); }
        .df-card.purple{ border-color: rgba(168,85,247,0.25);  background: linear-gradient(135deg, var(--surface) 0%, rgba(168,85,247,0.04) 100%); }
        .df-card.green { border-color: rgba(34,197,94,0.25);   background: linear-gradient(135deg, var(--surface) 0%, rgba(34,197,94,0.04) 100%); }
        .df-card.red   { border-color: rgba(239,68,68,0.25);   background: linear-gradient(135deg, var(--surface) 0%, rgba(239,68,68,0.04) 100%); }
        .df-card.amber { border-color: rgba(245,158,11,0.25);  background: linear-gradient(135deg, var(--surface) 0%, rgba(245,158,11,0.04) 100%); }
        .df-card.gold  { border-color: rgba(234,179,8,0.3);    background: linear-gradient(135deg, var(--surface) 0%, rgba(234,179,8,0.05) 100%); }

        .df-badge {
          display: inline-flex; align-items: center;
          font-size: 0.58rem; font-weight: 600;
          letter-spacing: 0.08em; text-transform: uppercase;
          padding: 0.18rem 0.5rem;
          border-radius: 100px;
          white-space: nowrap;
        }

        .df-badge.blue   { background: var(--blue-dim);   color: var(--blue); }
        .df-badge.teal   { background: var(--teal-dim);   color: var(--teal); }
        .df-badge.orange { background: var(--orange-dim); color: var(--orange); }
        .df-badge.purple { background: var(--purple-dim); color: var(--purple); }
        .df-badge.green  { background: var(--green-dim);  color: var(--green); }
        .df-badge.red    { background: var(--red-dim);    color: var(--red); }
        .df-badge.amber  { background: var(--amber-dim);  color: var(--amber); }
        .df-badge.muted  { background: rgba(100,116,139,0.15); color: var(--muted); }

        .df-agent-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.5rem;
          margin-top: 0.6rem;
        }

        .df-agent-cell {
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: 7px;
          padding: 0.55rem 0.65rem;
        }

        .df-agent-cell-title {
          font-size: 0.68rem; font-weight: 600; color: var(--text);
          margin-bottom: 0.2rem; display: flex; justify-content: space-between; align-items: center;
        }

        .df-agent-cell-body {
          font-size: 0.6rem; color: var(--muted); line-height: 1.5;
        }

        .df-db-chips {
          display: flex; flex-direction: column; gap: 0.4rem;
          margin-top: 0.4rem;
        }

        .df-db-chip {
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.35rem 0.65rem;
          font-size: 0.65rem;
          display: flex; justify-content: space-between; align-items: center;
          transition: border-color 0.2s;
        }

        .df-db-chip:hover { border-color: rgba(255,255,255,0.18); }
        .df-db-chip-name { color: var(--text); font-weight: 500; }
        .df-db-chip-desc { color: var(--muted); font-size: 0.58rem; }

        .df-bracket {
          border: 1.5px dashed;
          border-radius: 12px;
          padding: 0.75rem;
          margin-bottom: 0.5rem;
          position: relative;
        }

        .df-bracket-label {
          position: absolute;
          top: -0.65rem; left: 1rem;
          font-size: 0.6rem; font-weight: 700;
          letter-spacing: 0.12em; text-transform: uppercase;
          padding: 0.1rem 0.5rem;
          border-radius: 4px;
        }

        .df-bracket.orange { border-color: rgba(249,115,22,0.3); }
        .df-bracket.orange .df-bracket-label { background: var(--bg); color: var(--orange); }

        .df-schedule {
          font-size: 0.6rem; color: var(--orange);
          background: var(--orange-dim);
          border: 1px solid rgba(249,115,22,0.2);
          border-radius: 4px;
          padding: 0.1rem 0.4rem;
          display: inline-flex; align-items: center; gap: 0.3rem;
          margin-bottom: 0.4rem;
        }

        .df-pulse-dot {
          width: 6px; height: 6px; border-radius: 50%;
          display: inline-block;
          flex-shrink: 0;
          animation: df-pulse 2s ease-in-out infinite;
        }

        @keyframes df-pulse {
          0%,100% { opacity: 1; box-shadow: 0 0 0 0 currentColor; }
          50% { opacity: 0.7; box-shadow: 0 0 0 4px transparent; }
        }

        .df-needs-arrow {
          text-align: center;
          padding: 0.2rem 0;
        }

        .df-needs-text {
          font-size: 0.58rem; color: var(--muted);
          background: var(--surface2); border: 1px solid var(--border);
          padding: 0.12rem 0.5rem; border-radius: 4px;
          display: inline-block; margin-bottom: 0.2rem;
        }

        .df-route-list {
          display: flex; flex-direction: column; gap: 0.4rem;
          margin-top: 0.5rem;
        }

        .df-route {
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.45rem 0.65rem;
          font-size: 0.62rem;
          transition: border-color 0.2s;
        }

        .df-route:hover { border-color: rgba(255,255,255,0.18); }

        .df-route-method {
          font-size: 0.58rem; font-weight: 700;
          margin-right: 0.3rem;
        }

        .df-route-path { color: var(--text); }
        .df-route-desc { color: var(--muted); font-size: 0.6rem; margin-top: 0.15rem; }

        .df-section-label {
          font-size: 0.58rem; color: var(--muted);
          text-transform: uppercase; letter-spacing: 0.1em;
          padding: 0.2rem 0;
        }

        .df-conclusion-box {
          margin-top: 0.5rem;
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: 7px;
          padding: 0.5rem 0.65rem;
        }

        .df-conclusion-title {
          font-size: 0.65rem; color: var(--text); font-weight: 600;
          display: flex; justify-content: space-between; align-items: center;
        }

        .df-conclusion-body {
          font-size: 0.6rem; color: var(--muted); margin-top: 0.15rem;
        }

        .df-legend {
          position: fixed; bottom: 1.5rem; right: 1.5rem;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 0.75rem 1rem;
          display: flex; flex-direction: column; gap: 0.35rem;
          z-index: 100;
        }

        .df-legend-title {
          font-size: 0.58rem; color: var(--muted);
          text-transform: uppercase; letter-spacing: 0.12em;
          margin-bottom: 0.15rem;
        }

        .df-legend-row {
          display: flex; align-items: center; gap: 0.5rem;
          font-size: 0.62rem; color: var(--text);
        }

        .df-legend-dot {
          width: 8px; height: 8px; border-radius: 50%;
          flex-shrink: 0;
        }

        .df-back-link {
          font-size: 0.7rem; color: var(--muted);
          text-decoration: none;
          transition: color 0.2s;
        }
        .df-back-link:hover { color: var(--text); }
      `}</style>

      <div className="df-root">
        <div className="df-noise" />

        <header className="df-header">
          <div className="df-logo">aiMAIA</div>
          <div className="df-subtitle">Data Flow Architecture &mdash; Batch Pipeline &times; User Layer</div>
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
                350ms delay between requests
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
                Markets never close &rarr; continuous refresh<br />
                BTC/USD &middot; ETH/USD &middot; SOL/USD&hellip;
              </div>
            </div>

            <div style={{ height: '1rem' }} />

            <div className="df-card amber">
              <div className="df-card-title">
                <span style={{ fontSize: '0.7rem' }}>&nearr;</span> On-Demand (User)
              </div>
              <div className="df-card-body">
                <strong>Claude Opus</strong> &mdash; risk reports<br />
                <strong>Opus + Sonnet</strong> &mdash; AI probability<br />
                <strong>GPT-4o mini</strong> &mdash; ticker refresh<br />
                Only called on user action
              </div>
            </div>
          </div>

          {/* COL 2: GITHUB ACTIONS BATCH ENGINE */}
          <div className="df-col">
            <div className="df-col-header" style={{ color: 'var(--orange)', background: 'var(--orange-dim)' }}>&#9881; GitHub Actions &mdash; Batch Pipeline</div>

            <div className="df-bracket orange" style={{ paddingTop: '1.2rem' }}>
              <div className="df-bracket-label">daily-batch.yml &middot; 21:00 UTC</div>

              {/* Job 1: prices */}
              <div className="df-card orange" style={{ marginBottom: '0.5rem' }}>
                <div className="df-card-title">
                  <span className="df-badge orange">Job 1</span>
                  prices.ts
                </div>
                <div className="df-card-body">
                  Fetches time-series OHLCV via Twelve Data REST API<br />
                  Rate-limited with sleep() between calls<br />
                  Upserts on <strong>ticker + date</strong> conflict key
                </div>
              </div>

              {/* Job 2: news (parallel) */}
              <div className="df-card teal" style={{ marginBottom: '0.5rem' }}>
                <div className="df-card-title">
                  <span className="df-badge orange">Job 2</span>
                  news.ts <span style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>(parallel)</span>
                </div>
                <div className="df-card-body">
                  Calls Finnhub company-news endpoint per ticker<br />
                  Keyword-matches crypto in general market feed<br />
                  350ms delay between requests
                </div>
              </div>

              {/* NEEDS arrow */}
              <div className="df-needs-arrow">
                <div className="df-needs-text">needs: prices + news complete</div>
                <div style={{ fontSize: '1rem', color: 'var(--muted)' }}>&darr;</div>
              </div>

              {/* Job 3: scores */}
              <div className="df-card purple" style={{ marginBottom: '0.5rem' }}>
                <div className="df-card-title">
                  <span className="df-badge orange">Job 3</span>
                  scores.ts &mdash; 4 Agents
                </div>
                <div className="df-agent-grid">
                  <div className="df-agent-cell">
                    <div className="df-agent-cell-title">
                      Technical <span className="df-badge muted">Math</span>
                    </div>
                    <div className="df-agent-cell-body">RSI &middot; MACD &middot; EMA &middot; Bollinger &middot; Volume anomaly</div>
                  </div>
                  <div className="df-agent-cell">
                    <div className="df-agent-cell-title">
                      Fundamental <span className="df-badge muted">Math</span>
                    </div>
                    <div className="df-agent-cell-body">PE &middot; Revenue growth &middot; Margin &middot; ROE &middot; Debt ratio</div>
                  </div>
                  <div className="df-agent-cell">
                    <div className="df-agent-cell-title">
                      Sentiment <span className="df-badge purple">Haiku</span>
                    </div>
                    <div className="df-agent-cell-body">News &rarr; score -1&rarr;+1 &middot; Crypto relevance filter &middot; Confidence</div>
                  </div>
                  <div className="df-agent-cell">
                    <div className="df-agent-cell-title">
                      Regime <span className="df-badge muted">Math</span>
                    </div>
                    <div className="df-agent-cell-body">Market-wide conditions &middot; VIX-like signals &middot; MA regime</div>
                  </div>
                </div>
                <div className="df-conclusion-box">
                  <div className="df-conclusion-title">
                    Conclusion Generator
                    <span className="df-badge green">Sonnet</span>
                  </div>
                  <div className="df-conclusion-body">300-char outlook per ticker &middot; cached daily</div>
                </div>
              </div>

              {/* NEEDS arrow */}
              <div className="df-needs-arrow">
                <div className="df-needs-text">needs: scores complete</div>
                <div style={{ fontSize: '1rem', color: 'var(--muted)' }}>&darr;</div>
              </div>

              {/* Job 4: synthesis */}
              <div className="df-card amber">
                <div className="df-card-title">
                  <span className="df-badge orange">Job 4</span>
                  synthesis.ts
                  <span className="df-badge amber">Claude Sonnet</span>
                </div>
                <div className="df-card-body" style={{ lineHeight: 1.8 }}>
                  Per active portfolio: loads positions + user goals + agent scores<br />
                  &rarr; Context package &rarr; LLM call &rarr; Structured JSON output<br />
                  &rarr; Rules Engine validates (max position %, cash floor, drawdown)<br />
                  <strong>Output:</strong> BUY/SELL/HOLD recs &middot; narrative &middot; goal assessment &middot; confidence
                </div>
              </div>

            </div>

            {/* crypto-prices outside main pipeline */}
            <div className="df-card blue">
              <div className="df-card-title">
                <span className="df-pulse-dot" style={{ background: 'var(--blue)', color: 'var(--blue)' }} />
                crypto-prices.ts
                <span className="df-badge blue">5&times; daily</span>
              </div>
              <div className="df-card-body">
                Runs <strong>independently</strong> every ~4h via crypto-refresh.yml<br />
                Keeps crypto quotes fresh throughout the 24/7 market cycle
              </div>
            </div>

          </div>

          {/* COL 3: SUPABASE DB */}
          <div className="df-col">
            <div className="df-col-header" style={{ color: 'var(--green)', background: 'var(--green-dim)' }}>&#x2B21; Supabase DB</div>

            <div className="df-card green">
              <div className="df-card-title" style={{ fontSize: '0.72rem' }}>
                PostgreSQL + RLS
              </div>
              <div className="df-card-body" style={{ marginBottom: '0.5rem' }}>Central truth. All reads + writes flow through here.</div>
              <div className="df-db-chips">
                <div className="df-section-label">Price Data</div>
                <div className="df-db-chip">
                  <span className="df-db-chip-name">price_history</span>
                  <span className="df-badge blue" style={{ fontSize: '0.54rem' }}>OHLCV</span>
                </div>
                <div className="df-db-chip">
                  <span className="df-db-chip-name">market_quotes</span>
                  <span className="df-badge blue" style={{ fontSize: '0.54rem' }}>latest</span>
                </div>

                <div className="df-section-label">News</div>
                <div className="df-db-chip">
                  <span className="df-db-chip-name">news_data</span>
                  <span className="df-badge teal" style={{ fontSize: '0.54rem' }}>headlines</span>
                </div>

                <div className="df-section-label">Intelligence</div>
                <div className="df-db-chip">
                  <span className="df-db-chip-name">agent_scores</span>
                  <span className="df-badge purple" style={{ fontSize: '0.54rem' }}>4 agents</span>
                </div>
                <div className="df-db-chip">
                  <span className="df-db-chip-name">ticker_conclusions</span>
                  <span className="df-badge green" style={{ fontSize: '0.54rem' }}>text</span>
                </div>

                <div className="df-section-label">Synthesis</div>
                <div className="df-db-chip">
                  <span className="df-db-chip-name">synthesis_runs</span>
                  <span className="df-badge amber" style={{ fontSize: '0.54rem' }}>meta</span>
                </div>
                <div className="df-db-chip">
                  <span className="df-db-chip-name">recommendation_items</span>
                  <span className="df-badge amber" style={{ fontSize: '0.54rem' }}>recs</span>
                </div>
                <div className="df-db-chip">
                  <span className="df-db-chip-name">synthesis_raw_outputs</span>
                  <span className="df-badge amber" style={{ fontSize: '0.54rem' }}>LLM</span>
                </div>

                <div className="df-section-label">User / Portfolio</div>
                <div className="df-db-chip">
                  <span className="df-db-chip-name">user_profiles</span>
                  <span className="df-badge muted" style={{ fontSize: '0.54rem' }}>goals</span>
                </div>
                <div className="df-db-chip">
                  <span className="df-db-chip-name">portfolios</span>
                  <span className="df-badge muted" style={{ fontSize: '0.54rem' }}>active</span>
                </div>
                <div className="df-db-chip">
                  <span className="df-db-chip-name">portfolio_positions</span>
                  <span className="df-badge muted" style={{ fontSize: '0.54rem' }}>holdings</span>
                </div>
                <div className="df-db-chip">
                  <span className="df-db-chip-name">portfolio_risk_reports</span>
                  <span className="df-badge red" style={{ fontSize: '0.54rem' }}>cached</span>
                </div>
              </div>
            </div>
          </div>

          {/* COL 4: VERCEL — USER LAYER */}
          <div className="df-col">
            <div className="df-col-header" style={{ color: 'var(--blue)', background: 'var(--blue-dim)' }}>&#x2B21; Vercel &mdash; User Layer</div>

            {/* Pages */}
            <div className="df-card blue">
              <div className="df-card-title">
                Next.js Frontend Pages
                <span className="df-badge muted">reads DB</span>
              </div>
              <div className="df-route-list">
                <div className="df-route">
                  <div className="df-route-path">&#128202; /dashboard</div>
                  <div className="df-route-desc">Positions &middot; Recs &middot; Goal tracker &middot; Daily briefing &middot; Narrative</div>
                </div>
                <div className="df-route">
                  <div className="df-route-path">&#128200; /market</div>
                  <div className="df-route-desc">101 tickers &middot; Quotes &middot; Agent scores &middot; Conclusions</div>
                </div>
                <div className="df-route">
                  <div className="df-route-path">&#128640; /onboarding</div>
                  <div className="df-route-desc">Risk profile &middot; Goal setup &middot; Initial positions</div>
                </div>
                <div className="df-route">
                  <div className="df-route-path">&#9881; /settings &middot; /portfolio</div>
                  <div className="df-route-desc">Reset &middot; Archive &middot; Account management</div>
                </div>
              </div>
            </div>

            {/* On-demand API routes */}
            <div className="df-card amber">
              <div className="df-card-title">
                On-Demand API Routes
                <span className="df-badge muted">user-triggered</span>
              </div>
              <div style={{ fontSize: '0.6rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>Only called by explicit user action &mdash; no scheduled jobs</div>
              <div className="df-route-list">
                <div className="df-route">
                  <span className="df-route-method" style={{ color: 'var(--green)' }}>POST</span>
                  <span className="df-route-path">/api/portfolio/positions</span>
                  <div className="df-route-desc">Saves positions via service role (bypasses RLS). Triggered on onboarding save.</div>
                </div>
                <div className="df-route">
                  <span className="df-route-method" style={{ color: 'var(--blue)' }}>GET</span>
                  <span className="df-route-path">/api/portfolio/risk-report</span>
                  <div className="df-route-desc">
                    Returns cached report or generates new one.<br />
                    <span className="df-badge red" style={{ fontSize: '0.54rem' }}>Claude Opus</span> 1024 tokens &middot; cached after 1st click
                  </div>
                </div>
                <div className="df-route">
                  <span className="df-route-method" style={{ color: 'var(--green)' }}>POST</span>
                  <span className="df-route-path">/api/portfolio/ai-probability</span>
                  <div className="df-route-desc">
                    Dual LLM estimate per click.<br />
                    <span className="df-badge red" style={{ fontSize: '0.54rem' }}>Opus</span>
                    {' '}<span className="df-badge amber" style={{ fontSize: '0.54rem' }}>Sonnet</span> called separately for timeout safety
                  </div>
                </div>
                <div className="df-route">
                  <span className="df-route-method" style={{ color: 'var(--green)' }}>POST</span>
                  <span className="df-route-path">/api/ticker/conclusion</span>
                  <div className="df-route-desc">
                    On-demand ticker refresh.<br />
                    <span className="df-badge green" style={{ fontSize: '0.54rem' }}>Sonnet</span> 300 chars per ticker
                  </div>
                </div>
                <div className="df-route">
                  <span className="df-route-method" style={{ color: 'var(--blue)' }}>GET</span>
                  <span className="df-route-path">/api/ticker/price-history</span>
                  <div className="df-route-desc">Serves price data for charts in ticker detail modal</div>
                </div>
                <div className="df-route">
                  <span className="df-route-method" style={{ color: 'var(--blue)' }}>GET</span>
                  <span className="df-route-path">/api/config/weights</span>
                  <div className="df-route-desc">Reads agent weight config from system_config table</div>
                </div>
              </div>
            </div>

            {/* Admin */}
            <div className="df-card" style={{ borderColor: 'rgba(100,116,139,0.25)' }}>
              <div className="df-card-title" style={{ color: 'var(--muted)' }}>
                Admin Panel
                <span className="df-badge muted">protected</span>
              </div>
              <div className="df-card-body">
                /admin &mdash; Config editor for models, prompts, weights<br />
                Writes to <strong>system_config</strong> table &middot; ADMIN_SECRET auth
              </div>
            </div>
          </div>

        </div>

        {/* LEGEND */}
        <div className="df-legend">
          <div className="df-legend-title">Model Legend</div>
          <div className="df-legend-row"><div className="df-legend-dot" style={{ background: 'var(--purple)' }} />Claude Haiku 4.5 &mdash; Sentiment scoring</div>
          <div className="df-legend-row"><div className="df-legend-dot" style={{ background: 'var(--amber)' }} />Claude Sonnet &mdash; Synthesis (nightly)</div>
          <div className="df-legend-row"><div className="df-legend-dot" style={{ background: 'var(--red)' }} />Claude Opus &mdash; Risk report + AI probability</div>
          <div className="df-legend-row"><div className="df-legend-dot" style={{ background: 'var(--green)' }} />Claude Sonnet &mdash; Conclusions + Ticker refresh</div>
          <div className="df-legend-row"><div className="df-legend-dot" style={{ background: 'var(--muted)' }} />Pure Math &mdash; Technical &middot; Fundamental &middot; Regime</div>
        </div>
      </div>
    </>
  );
}
