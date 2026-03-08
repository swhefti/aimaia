'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/formatters';
import type { PortfolioPositionWithScore } from '@/lib/queries';

interface SellPositionModalProps {
  open: boolean;
  onClose: () => void;
  positions: PortfolioPositionWithScore[];
  marketPrices: Record<string, number>;
  onSell: (positionId: string) => void;
}

export function SellPositionModal({ open, onClose, positions, marketPrices, onSell }: SellPositionModalProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function handleClose() {
    setSelected(null);
    setConfirming(false);
    onClose();
  }

  function handleSell() {
    if (!selected) return;
    onSell(selected);
    handleClose();
  }

  const selectedPos = positions.find((p) => p.id === selected);

  return (
    <Modal open={open} onClose={handleClose} title="Sell Position">
      {!confirming ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-400 mb-3">Select a position to sell entirely.</p>
          {positions.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No positions to sell.</p>
          ) : (
            positions.map((pos) => {
              const price = marketPrices[pos.ticker] ?? pos.avgPurchasePrice;
              const value = pos.quantity * price;
              const pnl = (price - pos.avgPurchasePrice) * pos.quantity;
              const pnlPct = pos.avgPurchasePrice > 0
                ? ((price - pos.avgPurchasePrice) / pos.avgPurchasePrice) * 100
                : 0;
              const isProfit = pnl >= 0;

              return (
                <button
                  key={pos.id}
                  onClick={() => setSelected(pos.id)}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                    selected === pos.id
                      ? 'border-red-500/50 bg-red-500/10'
                      : 'border-navy-500 bg-navy-700 hover:border-navy-400'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-white">
                        {pos.asset?.name || pos.ticker}
                      </span>
                      <span className="text-xs text-gray-500 block">{pos.ticker}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-white">{formatCurrency(value)}</div>
                      <div className={`text-xs ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isProfit ? '+' : ''}{formatCurrency(pnl)} ({isProfit ? '+' : ''}{pnlPct.toFixed(1)}%)
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {pos.quantity < 10 ? pos.quantity.toFixed(2) : pos.quantity.toFixed(0)} shares @ {formatCurrency(pos.avgPurchasePrice)} avg
                  </div>
                </button>
              );
            })
          )}

          <div className="flex justify-end gap-3 pt-3">
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button
              onClick={() => setConfirming(true)}
              disabled={!selected}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Continue
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-300">
            Are you sure you want to sell your entire position in{' '}
            <span className="text-white font-semibold">{selectedPos?.asset?.name || selectedPos?.ticker}</span>?
          </p>
          {selectedPos && (
            <div className="bg-navy-700 rounded-lg p-3 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>Shares</span>
                <span className="text-white">{selectedPos.quantity < 10 ? selectedPos.quantity.toFixed(2) : selectedPos.quantity.toFixed(0)}</span>
              </div>
              <div className="flex justify-between text-gray-400 mt-1">
                <span>Current Price</span>
                <span className="text-white">{formatCurrency(marketPrices[selectedPos.ticker] ?? selectedPos.avgPurchasePrice)}</span>
              </div>
              <div className="flex justify-between text-gray-400 mt-1">
                <span>Market Value</span>
                <span className="text-white">
                  {formatCurrency(selectedPos.quantity * (marketPrices[selectedPos.ticker] ?? selectedPos.avgPurchasePrice))}
                </span>
              </div>
            </div>
          )}
          <p className="text-xs text-gray-500">
            The proceeds will be returned to your cash balance.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirming(false)}>Back</Button>
            <Button
              onClick={handleSell}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Confirm Sell
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
