'use client';

import { useState } from 'react';
import type { RecommendationItem } from '@shared/types/recommendations';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfidenceBadge, UrgencyBadge, AssetTypeBadge } from '@/components/ui/badge';
import { Labeled, LabeledBlock } from '@/components/ui/agent-badge';
import { ASSET_TYPE_MAP } from '@shared/lib/constants';

interface RecommendationCardProps {
  item: RecommendationItem;
  assetName?: string;
  onApprove?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onShowReasoning?: (id: string) => void;
  showActions?: boolean;
}

export function RecommendationCard({
  item,
  assetName,
  onApprove,
  onDismiss,
  onShowReasoning,
  showActions = true,
}: RecommendationCardProps) {
  const [decided, setDecided] = useState<'approved' | 'dismissed' | null>(null);
  const assetType = ASSET_TYPE_MAP[item.ticker] || 'stock';

  if (decided) return null;

  return (
    <Card>
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-white">{item.ticker}</span>
            {assetName && <span className="text-sm text-gray-400">{assetName}</span>}
            <AssetTypeBadge type={assetType} />
          </div>
          <div className="flex items-center gap-2">
            <UrgencyBadge urgency={item.urgency} />
            <ConfidenceBadge confidence={item.confidence} agent="recommendation" />
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <Labeled agent="recommendation">
            <span className={`font-medium ${
              item.action === 'BUY' || item.action === 'ADD' ? 'text-emerald-400' :
              item.action === 'SELL' || item.action === 'REDUCE' ? 'text-red-400' :
              'text-gray-400'
            }`}>
              {item.action}
            </span>
          </Labeled>
          <Labeled agent="recommendation">
            <span className="text-gray-400">
              {item.currentAllocationPct.toFixed(1)}% → {item.targetAllocationPct.toFixed(1)}%
            </span>
          </Labeled>
        </div>

        <LabeledBlock agent="synthesis">
          <p className="text-sm text-gray-300 leading-relaxed">{item.llmReasoning}</p>
        </LabeledBlock>

        {showActions && (
          <div className="flex items-center gap-3 pt-2">
            <Button
              size="sm"
              onClick={() => {
                setDecided('approved');
                onApprove?.(item.id);
              }}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDecided('dismissed');
                onDismiss?.(item.id);
              }}
            >
              Dismiss
            </Button>
            <button
              onClick={() => onShowReasoning?.(item.id)}
              className="text-sm text-accent-blue hover:underline ml-auto"
            >
              More details &rarr;
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}
