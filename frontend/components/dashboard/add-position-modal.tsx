'use client';

import { useState, useMemo } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { AssetTypeBadge, SignalBadge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/formatters';
import { ASSET_UNIVERSE, ASSET_TYPE_MAP } from '@shared/lib/constants';
import { Search } from 'lucide-react';

interface AddPositionModalProps {
  open: boolean;
  onClose: () => void;
  onAdd: (ticker: string, quantity: number, pricePerUnit: number) => Promise<void>;
  existingTickers: string[];
  cashAvailable: number;
  latestScores: Record<string, number>;
  latestPrices: Record<string, number>;
}

export function AddPositionModal({
  open,
  onClose,
  onAdd,
  existingTickers,
  cashAvailable,
  latestScores,
  latestPrices,
}: AddPositionModalProps) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [adding, setAdding] = useState(false);

  const availableTickers = useMemo(() => {
    const existing = new Set(existingTickers);
    return ASSET_UNIVERSE.filter((t) => !existing.has(t));
  }, [existingTickers]);

  const filtered = useMemo(() => {
    if (!search) return availableTickers.slice(0, 20);
    const q = search.toUpperCase();
    return availableTickers.filter((t) => t.includes(q)).slice(0, 20);
  }, [search, availableTickers]);

  const selectedPrice = selected ? (latestPrices[selected] ?? 0) : 0;
  const amountNum = Number(amount) || 0;
  const totalCost = selectedPrice > 0 ? amountNum * selectedPrice : amountNum;
  const canAfford = totalCost <= cashAvailable && totalCost > 0;

  async function handleAdd() {
    if (!selected || !canAfford) return;
    setAdding(true);
    try {
      const qty = selectedPrice > 0 ? amountNum : 1;
      const price = selectedPrice > 0 ? selectedPrice : amountNum;
      await onAdd(selected, qty, price);
      setSelected(null);
      setAmount('');
      setSearch('');
      onClose();
    } catch (err) {
      console.error('Add position error:', err);
    } finally {
      setAdding(false);
    }
  }

  function handleClose() {
    setSelected(null);
    setAmount('');
    setSearch('');
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add Position">
      <div className="space-y-4">
        <p className="text-sm text-gray-400">
          Available cash: <span className="text-white font-medium">{formatCurrency(cashAvailable)}</span>
        </p>

        {!selected ? (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ticker (e.g. AAPL, SPY, BTC)"
                className="w-full pl-9 pr-3 py-2 bg-navy-700 border border-navy-500 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent-blue"
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {filtered.map((ticker) => {
                const type = ASSET_TYPE_MAP[ticker] || 'stock';
                const score = latestScores[ticker];
                const price = latestPrices[ticker];
                return (
                  <button
                    key={ticker}
                    onClick={() => setSelected(ticker)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-navy-700 transition-colors text-left"
                  >
                    <span className="text-white font-medium w-16">{ticker}</span>
                    <AssetTypeBadge type={type} />
                    {price !== undefined && (
                      <span className="text-xs text-gray-500">{formatCurrency(price)}</span>
                    )}
                    <span className="ml-auto">
                      {score !== undefined && <SignalBadge score={score} />}
                    </span>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-4">No matching tickers found.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 bg-navy-700 px-4 py-3 rounded-lg">
              <span className="text-lg font-semibold text-white">{selected}</span>
              <AssetTypeBadge type={ASSET_TYPE_MAP[selected] || 'stock'} />
              {selectedPrice > 0 && (
                <span className="text-sm text-gray-400">{formatCurrency(selectedPrice)} / unit</span>
              )}
              <button
                onClick={() => setSelected(null)}
                className="ml-auto text-xs text-gray-400 hover:text-white"
              >
                Change
              </button>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">
                {selectedPrice > 0 ? 'Quantity (shares/units)' : 'Investment amount ($)'}
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min={0}
                step={selectedPrice > 0 ? 1 : 100}
                placeholder={selectedPrice > 0 ? 'e.g. 10' : 'e.g. 1000'}
                className="w-full px-3 py-2 bg-navy-700 border border-navy-500 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent-blue"
                autoFocus
              />
            </div>

            {amountNum > 0 && (
              <div className="text-sm">
                <span className="text-gray-400">Total cost: </span>
                <span className={canAfford ? 'text-white' : 'text-red-400'}>
                  {formatCurrency(totalCost)}
                </span>
                {!canAfford && (
                  <span className="text-red-400 text-xs ml-2">Exceeds available cash</span>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleAdd} disabled={adding || !canAfford}>
                {adding ? 'Adding...' : 'Add to Portfolio'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
