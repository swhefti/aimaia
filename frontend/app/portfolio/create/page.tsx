'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { RecommendationCard } from '@/components/portfolio/recommendation-card';
import { ReasoningModal } from '@/components/portfolio/reasoning-modal';
import { createPortfolio, insertPortfolioPositions, submitUserDecision } from '@/lib/queries';
import type { RecommendationItem } from '@shared/types/recommendations';

interface RecommendationsResponse {
  status: 'ready' | 'processing' | 'unavailable';
  run?: {
    id: string;
    synthesisRunId: string;
    items: RecommendationItem[];
  };
}

export default function PortfolioCreatePage() {
  const { user, supabase } = useAuth();
  const router = useRouter();
  const [status, setStatus] = useState<'processing' | 'ready' | 'unavailable'>('processing');
  const [items, setItems] = useState<RecommendationItem[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [synthesisRunId, setSynthesisRunId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, 'approved' | 'dismissed'>>({});
  const [reasoningId, setReasoningId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pollCount, setPollCount] = useState(0);

  const pollRecommendations = useCallback(async () => {
    try {
      const res = await fetch('/api/portfolio/recommendations');
      const data: RecommendationsResponse = await res.json();
      setStatus(data.status);
      if (data.status === 'ready' && data.run) {
        setItems(data.run.items);
        setRunId(data.run.id);
        setSynthesisRunId(data.run.synthesisRunId);
      }
      setPollCount((c) => c + 1);
    } catch {
      // Retry on next poll
    }
  }, []);

  useEffect(() => {
    if (status !== 'processing') return;
    if (pollCount >= 12) {
      // After ~60 seconds of polling, stop and show unavailable
      setStatus('unavailable');
      return;
    }
    pollRecommendations();
    const interval = setInterval(pollRecommendations, 5000);
    return () => clearInterval(interval);
  }, [status, pollRecommendations, pollCount]);

  function handleApprove(id: string) {
    if (!user) return;
    setDecisions((prev) => ({ ...prev, [id]: 'approved' }));
    submitUserDecision(supabase, id, 'approved', user.id).catch(console.error);
  }

  function handleDismiss(id: string) {
    if (!user) return;
    setDecisions((prev) => ({ ...prev, [id]: 'dismissed' }));
    submitUserDecision(supabase, id, 'dismissed', user.id).catch(console.error);
  }

  async function handleCreatePortfolio() {
    if (!user) return;
    setCreating(true);
    try {
      const portfolioId = await createPortfolio(supabase, user.id, 'My Portfolio');
      const approvedItems = items.filter((i) => decisions[i.id] === 'approved');
      if (approvedItems.length > 0) {
        const positions = approvedItems.map((i) => ({
          ticker: i.ticker,
          quantity: 0, // Will be calculated by backend based on allocation
          avgPurchasePrice: 0,
        }));
        await insertPortfolioPositions(supabase, portfolioId, positions);
      }
      router.push('/dashboard');
    } catch (err) {
      console.error('Failed to create portfolio:', err);
    } finally {
      setCreating(false);
    }
  }

  const approvedCount = Object.values(decisions).filter((d) => d === 'approved').length;
  const allDecided = items.length > 0 && items.every((i) => decisions[i.id]);

  if (status === 'processing') {
    return (
      <main className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Spinner size="lg" message="Analyzing the market for your goals..." />
          <p className="text-sm text-gray-500 mt-4">This may take up to a minute.</p>
        </div>
      </main>
    );
  }

  if (status === 'unavailable') {
    return (
      <main className="flex items-center justify-center min-h-screen px-4">
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold text-white mb-2">No Recommendations Available</h2>
          <p className="text-gray-400">
            The system hasn&apos;t generated recommendations yet. This usually happens after the first daily analysis run completes.
          </p>
          <Button className="mt-6" onClick={() => router.push('/dashboard')}>
            Go to Dashboard
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Your Portfolio Recommendations</h1>
        <p className="text-gray-400 mt-1">
          Review each suggestion. Approve to include, dismiss to skip.
        </p>
      </div>

      <div className="space-y-4">
        {items.map((item) => (
          <RecommendationCard
            key={item.id}
            item={item}
            onApprove={handleApprove}
            onDismiss={handleDismiss}
            onShowReasoning={(id) => setReasoningId(id)}
          />
        ))}
      </div>

      {items.length > 0 && (
        <div className="mt-8 flex items-center justify-between">
          <span className="text-sm text-gray-400">
            {approvedCount} of {items.length} approved
          </span>
          <Button
            size="lg"
            onClick={handleCreatePortfolio}
            disabled={creating || approvedCount === 0}
          >
            {creating ? 'Creating...' : `Create my portfolio \u2192`}
          </Button>
        </div>
      )}

      <ReasoningModal
        open={!!reasoningId}
        onClose={() => setReasoningId(null)}
        recommendationId={reasoningId}
        synthesisRunId={synthesisRunId ?? undefined}
      />
    </main>
  );
}
