'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { upsertUserProfile } from '@/lib/queries';
import { useAuth } from '@/components/auth-provider';
import type { UserProfile, VolatilityTolerance } from '@shared/types/portfolio';
import { formatCurrency, formatPct } from '@/lib/formatters';
import { Settings, Pencil } from 'lucide-react';

interface SettingsPanelProps {
  profile: UserProfile;
  onProfileUpdated: (p: UserProfile) => void;
}

const HORIZON_STEPS = [
  { label: '1 month', months: 1 },
  { label: '2 months', months: 2 },
  { label: '3 months', months: 3 },
  { label: '6 months', months: 6 },
  { label: '9 months', months: 9 },
  { label: '1 year', months: 12 },
  { label: '2 years', months: 24 },
  { label: '3 years', months: 36 },
  { label: '4 years', months: 48 },
  { label: '5+ years', months: 60 },
];

function monthsToIdx(months: number): number {
  const idx = HORIZON_STEPS.findIndex((s) => s.months === months);
  return idx >= 0 ? idx : HORIZON_STEPS.findIndex((s) => s.months >= months) ?? 5;
}

function deriveRiskProfile(goalPct: number): 'conservative' | 'balanced' | 'aggressive' {
  if (goalPct <= 0.05) return 'conservative';
  if (goalPct <= 0.12) return 'balanced';
  return 'aggressive';
}

const VOLATILITY_OPTIONS: { label: string; value: VolatilityTolerance; description: string }[] = [
  { label: 'Moderate', value: 'moderate', description: 'I prefer stability over returns' },
  { label: 'Balanced', value: 'balanced', description: 'Normal market swings are fine' },
  { label: 'Tolerant', value: 'tolerant', description: 'Large drawdowns OK for bigger upside' },
];

export function SettingsPanel({ profile, onProfileUpdated }: SettingsPanelProps) {
  const { user, supabase, isGuest } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [capitalInput, setCapitalInput] = useState(String(profile.investmentCapital));
  const [horizonIdx, setHorizonIdx] = useState(monthsToIdx(profile.timeHorizonMonths));
  const [returnGoalPct, setReturnGoalPct] = useState(Math.round(profile.goalReturnPct * 100));
  const [volatility, setVolatility] = useState<VolatilityTolerance>(profile.volatilityTolerance);
  const [maxDrawdown, setMaxDrawdown] = useState(profile.maxDrawdownLimitPct);

  useEffect(() => {
    if (open) {
      setCapitalInput(String(profile.investmentCapital));
      setHorizonIdx(monthsToIdx(profile.timeHorizonMonths));
      setReturnGoalPct(Math.round(profile.goalReturnPct * 100));
      setVolatility(profile.volatilityTolerance);
      setMaxDrawdown(profile.maxDrawdownLimitPct);
    }
  }, [open, profile]);

  const effectiveCapital = Number(capitalInput) || 0;
  const horizonMonths = HORIZON_STEPS[horizonIdx]!.months;
  const horizonLabel = HORIZON_STEPS[horizonIdx]!.label;

  async function handleSave() {
    if (!user || effectiveCapital <= 0) return;
    setSaving(true);
    try {
      const goalDecimal = returnGoalPct / 100;
      const riskProfile = deriveRiskProfile(goalDecimal);
      const updated: Omit<UserProfile, 'userId'> = {
        investmentCapital: effectiveCapital,
        timeHorizonMonths: horizonMonths,
        riskProfile,
        goalReturnPct: goalDecimal,
        maxDrawdownLimitPct: maxDrawdown,
        volatilityTolerance: volatility,
        assetTypes: profile.assetTypes,
        maxPositions: profile.maxPositions,
      };
      if (!isGuest) {
        await upsertUserProfile(supabase, user.id, updated);
      }
      onProfileUpdated({ userId: user.id, ...updated });
      setOpen(false);
    } catch (err) {
      console.error('Settings save error:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card padding="sm">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-medium text-gray-400 flex items-center gap-1.5">
            <Settings className="h-3 w-3" /> Investment Settings
          </h3>
          <button
            onClick={() => setOpen(true)}
            className="text-accent-blue hover:text-accent-blue/80 text-xs flex items-center gap-1"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        </div>
        <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-xs">
          <div>
            <span className="text-gray-500">Capital</span>
            <p className="text-white font-medium">{formatCurrency(profile.investmentCapital)}</p>
          </div>
          <div>
            <span className="text-gray-500">Horizon</span>
            <p className="text-white font-medium">{profile.timeHorizonMonths}mo</p>
          </div>
          <div>
            <span className="text-gray-500">Goal</span>
            <p className="text-white font-medium">{formatPct(profile.goalReturnPct)}</p>
          </div>
          <div>
            <span className="text-gray-500">Risk</span>
            <p className="text-white font-medium capitalize">{profile.riskProfile}</p>
          </div>
          <div>
            <span className="text-gray-500">Max Drawdown</span>
            <p className="text-white font-medium">{(profile.maxDrawdownLimitPct * 100).toFixed(0)}%</p>
          </div>
          <div>
            <span className="text-gray-500">Volatility</span>
            <p className="text-white font-medium capitalize">{profile.volatilityTolerance}</p>
          </div>
        </div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Edit Investment Settings" maxWidth="max-w-sm">
        <div className="space-y-5 max-h-[65vh] overflow-y-auto pr-1">
          {/* Investment Capital */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Investment Capital</label>
            <div className="relative w-40">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number"
                value={capitalInput}
                onChange={(e) => setCapitalInput(e.target.value)}
                min={100}
                className="w-full pl-7 pr-3 py-2 bg-navy-700 border border-navy-500 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent-blue"
              />
            </div>
          </div>

          {/* Time Horizon — Slider */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Time Horizon: <span className="text-white">{horizonLabel}</span>
            </label>
            <input
              type="range"
              min={0}
              max={HORIZON_STEPS.length - 1}
              step={1}
              value={horizonIdx}
              onChange={(e) => setHorizonIdx(Number(e.target.value))}
              className="w-full accent-accent-blue"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1mo</span>
              <span>5+ yrs</span>
            </div>
          </div>

          {/* Return Goal — Slider */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Return Goal: <span className="text-white">{returnGoalPct >= 25 ? `${returnGoalPct}%+` : `${returnGoalPct}%`}</span>
            </label>
            <input
              type="range"
              min={1}
              max={25}
              step={1}
              value={returnGoalPct}
              onChange={(e) => setReturnGoalPct(Number(e.target.value))}
              className="w-full accent-accent-blue"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1%</span>
              <span>25%+</span>
            </div>
          </div>

          {/* Max Drawdown */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Maximum Drawdown</label>
            <div className="flex gap-1.5">
              {[
                { label: '5%', value: 0.05 },
                { label: '10%', value: 0.10 },
                { label: '15%', value: 0.15 },
                { label: '20%', value: 0.20 },
                { label: '30%', value: 0.30 },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setMaxDrawdown(opt.value)}
                  className={`flex-1 px-1.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    maxDrawdown === opt.value
                      ? 'border-accent-blue bg-accent-blue/10 text-white'
                      : 'border-navy-500 bg-navy-700 text-gray-300 hover:border-navy-400'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Volatility Tolerance */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Volatility Tolerance</label>
            <div className="space-y-1">
              {VOLATILITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setVolatility(opt.value)}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-xs transition-colors ${
                    volatility === opt.value
                      ? 'border-accent-blue bg-accent-blue/10 text-white'
                      : 'border-navy-500 bg-navy-700 text-gray-300 hover:border-navy-400'
                  }`}
                >
                  <span className="font-medium">{opt.label}</span>
                  <span className="text-gray-400 ml-1.5">— {opt.description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-5 pt-3 border-t border-navy-600/50">
          <Button variant="ghost" onClick={() => setOpen(false)} size="sm">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || effectiveCapital <= 0} size="sm">
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </Modal>
    </>
  );
}
