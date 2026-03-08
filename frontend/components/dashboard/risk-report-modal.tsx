'use client';

import { useEffect, useState, useCallback } from 'react';
import { Modal } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { RefreshCw } from 'lucide-react';

interface RiskReport {
  id?: string;
  report: string;
  model_used: string;
  generated_at: string;
}

interface Position {
  ticker: string;
  quantity: number;
  avgPurchasePrice: number;
  marketValue: number;
  allocationPct: number;
}

interface RiskReportModalProps {
  open: boolean;
  onClose: () => void;
  portfolioId: string;
  positions: Position[];
}

export function RiskReportModal({ open, onClose, portfolioId, positions }: RiskReportModalProps) {
  const [report, setReport] = useState<RiskReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchExisting = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portfolio/risk-report?portfolioId=${portfolioId}`);
      const data = await res.json();
      if (data.report) {
        setReport(data.report);
      } else {
        // No existing report — generate one
        await generate();
      }
    } catch {
      setError('Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [portfolioId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/portfolio/risk-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolioId, positions }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else if (data.report) {
        setReport(data.report);
      }
    } catch {
      setError('Failed to generate report');
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    if (open && portfolioId) {
      fetchExisting();
    }
    if (!open) {
      setError(null);
    }
  }, [open, portfolioId, fetchExisting]);

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  // Parse markdown-like formatting: **bold**, headers, bullet points
  function renderReport(text: string) {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      if (!trimmed) {
        elements.push(<div key={i} className="h-2" />);
        continue;
      }

      // Headers (### or ** at start)
      if (trimmed.startsWith('###')) {
        elements.push(
          <h4 key={i} className="text-sm font-semibold text-white mt-3 mb-1">
            {trimmed.replace(/^#+\s*/, '').replace(/\*\*/g, '')}
          </h4>
        );
        continue;
      }
      if (trimmed.startsWith('##')) {
        elements.push(
          <h3 key={i} className="text-sm font-bold text-white mt-4 mb-1.5">
            {trimmed.replace(/^#+\s*/, '').replace(/\*\*/g, '')}
          </h3>
        );
        continue;
      }
      if (trimmed.startsWith('#')) {
        elements.push(
          <h2 key={i} className="text-base font-bold text-white mt-4 mb-2">
            {trimmed.replace(/^#+\s*/, '').replace(/\*\*/g, '')}
          </h2>
        );
        continue;
      }

      // Bullet points
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
        const content = trimmed.replace(/^[-*•]\s+/, '');
        elements.push(
          <div key={i} className="flex gap-2 text-sm text-gray-300 leading-relaxed pl-2">
            <span className="text-gray-500 shrink-0">&#8226;</span>
            <span dangerouslySetInnerHTML={{ __html: inlineBold(content) }} />
          </div>
        );
        continue;
      }

      // Regular paragraph — handle inline **bold**
      elements.push(
        <p
          key={i}
          className="text-sm text-gray-300 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: inlineBold(trimmed) }}
        />
      );
    }

    return elements;
  }

  function inlineBold(text: string): string {
    return text.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-medium">$1</strong>');
  }

  return (
    <Modal open={open} onClose={onClose} title="Portfolio Risk Analysis" maxWidth="max-w-2xl">
      {(loading || generating) && !report ? (
        <div className="py-16">
          <Spinner message={generating ? 'Generating risk analysis with Claude Opus...' : 'Loading report...'} />
        </div>
      ) : error && !report ? (
        <div className="py-8 text-center">
          <p className="text-red-400 text-sm mb-3">{error}</p>
          <button
            onClick={generate}
            className="text-sm text-accent-blue hover:text-accent-blue/80 transition-colors"
          >
            Try again
          </button>
        </div>
      ) : report ? (
        <div className="space-y-4">
          {/* Meta + Regenerate */}
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Generated on {formatDate(report.generated_at)}</span>
            <button
              onClick={generate}
              disabled={generating}
              className="flex items-center gap-1 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${generating ? 'animate-spin' : ''}`} />
              {generating ? 'Regenerating...' : 'Regenerate'}
            </button>
          </div>

          {/* Report body */}
          <div className="bg-navy-700/30 rounded-lg px-5 py-4 space-y-1">
            {renderReport(report.report)}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
