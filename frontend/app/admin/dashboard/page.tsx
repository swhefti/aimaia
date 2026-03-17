'use client';

import { useState, useEffect, useCallback } from 'react';

interface ConfigItem {
  key: string;
  value: string;
  type: 'string' | 'number' | 'text';
  label: string;
  group_name: string;
  description: string | null;
  updated_at: string;
}

/* ──────────────────────────────────────────────
 * Feature-based grouping (overrides DB group_name)
 * Key → feature group mapping
 * ──────────────────────────────────────────────*/

const FEATURE_GROUPS: { id: string; label: string; keys: string[]; weightKeys?: string[] }[] = [
  {
    id: 'sentiment',
    label: 'Sentiment Agent',
    keys: [
      'model_sentiment',
      'model_sentiment_filter',
      'prompt_sentiment',
      'prompt_sentiment_filter',
      'max_tokens_sentiment',
      'sentiment_lookback_days',
      'sentiment_min_articles_crypto',
      'sentiment_decay_factor',
    ],
  },
  {
    id: 'technical',
    label: 'Technical Agent',
    keys: [
      'technical_lookback_days',
      'technical_min_rows_confidence_high',
      'technical_min_rows_confidence_low',
      'subweight_technical_macd',
      'subweight_technical_ema',
      'subweight_technical_rsi',
      'subweight_technical_bollinger',
      'subweight_technical_volume',
    ],
    weightKeys: [
      'subweight_technical_macd',
      'subweight_technical_ema',
      'subweight_technical_rsi',
      'subweight_technical_bollinger',
      'subweight_technical_volume',
    ],
  },
  {
    id: 'fundamental',
    label: 'Fundamental Agent',
    keys: [
      'subweight_fundamental_pe',
      'subweight_fundamental_revenue',
      'subweight_fundamental_margin',
      'subweight_fundamental_roe',
      'subweight_fundamental_debt',
    ],
    weightKeys: [
      'subweight_fundamental_pe',
      'subweight_fundamental_revenue',
      'subweight_fundamental_margin',
      'subweight_fundamental_roe',
      'subweight_fundamental_debt',
    ],
  },
  {
    id: 'conclusion',
    label: 'Conclusion Agent',
    keys: [
      'model_conclusion',
      'prompt_conclusion',
      'max_tokens_conclusion',
      'max_chars_conclusion',
    ],
  },
  {
    id: 'synthesis',
    label: 'Synthesis / Briefing',
    keys: [
      'model_synthesis',
      'prompt_synthesis_system',
      'max_tokens_synthesis',
      'max_chars_synthesis_narrative',
    ],
  },
  {
    id: 'ai_probability',
    label: 'AI Probability',
    keys: [
      'model_ai_probability_opus',
      'model_ai_probability_sonnet',
      'prompt_ai_probability',
      'max_tokens_ai_probability',
      'prob_sigmoid_steepness',
      'prob_sigmoid_midpoint',
      'prob_ai_score_weight',
      'prob_progress_bonus_max',
      'prob_diversification_bonus_max',
      'prob_time_bonus_max',
      'prob_no_positions_cap',
    ],
  },
  {
    id: 'risk_report',
    label: 'Risk Report',
    keys: [
      'model_risk_report',
      'prompt_risk_report',
      'max_tokens_risk_report',
    ],
  },
  {
    id: 'composite_weights',
    label: 'Composite Weights',
    keys: [
      'weight_stock_technical',
      'weight_stock_sentiment',
      'weight_stock_fundamental',
      'weight_stock_regime',
      'weight_crypto_technical',
      'weight_crypto_sentiment',
      'weight_crypto_fundamental',
      'weight_crypto_regime',
      'weight_crypto_sentiment_missing_technical',
      'weight_crypto_sentiment_missing_regime',
    ],
    // Multiple sub-groups that each must sum to 1.0
    weightKeys: [
      'weight_stock_technical',
      'weight_stock_sentiment',
      'weight_stock_fundamental',
      'weight_stock_regime',
    ],
  },
];

// Build a reverse lookup: key → feature group id
const KEY_TO_FEATURE: Record<string, string> = {};
for (const group of FEATURE_GROUPS) {
  for (const key of group.keys) {
    KEY_TO_FEATURE[key] = group.id;
  }
}

const FEATURE_ORDER = FEATURE_GROUPS.map((g) => g.id);
const FEATURE_LABELS: Record<string, string> = Object.fromEntries(
  FEATURE_GROUPS.map((g) => [g.id, g.label])
);

const MODEL_OPTIONS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5-20251001',
];

function getNumberStep(key: string): string {
  if (key.startsWith('weight_') || key.startsWith('subweight_') || key.includes('decay') || key.includes('midpoint') || key.includes('steepness')) return '0.01';
  return '1';
}

function isModelKey(key: string): boolean {
  return key.startsWith('model_');
}

export default function AdminDashboardPage() {
  const [config, setConfig] = useState<ConfigItem[]>([]);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [activeGroup, setActiveGroup] = useState(FEATURE_ORDER[0]!);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<{ group: string; message: string; isError: boolean } | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/config');
      if (!res.ok) {
        if (res.status === 401) {
          window.location.href = '/admin';
          return;
        }
        return;
      }
      const data = await res.json() as { config: ConfigItem[] };
      setConfig(data.config);
    } catch {
      // Silently handle
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Group config items by feature group (using key mapping, not DB group_name)
  const groupedConfig = FEATURE_ORDER.reduce<Record<string, ConfigItem[]>>((acc, featureId) => {
    const group = FEATURE_GROUPS.find((g) => g.id === featureId)!;
    // Filter config items whose key belongs to this feature group
    acc[featureId] = group.keys
      .map((key) => config.find((c) => c.key === key))
      .filter((c): c is ConfigItem => c !== undefined);
    return acc;
  }, {});

  // Collect any config items not mapped to a feature group
  const unmapped = config.filter((c) => !KEY_TO_FEATURE[c.key]);

  const hasChanges = (featureId: string): boolean => {
    return (groupedConfig[featureId] ?? []).some((c) => editedValues[c.key] !== undefined && editedValues[c.key] !== c.value);
  };

  const getDisplayValue = (item: ConfigItem): string => {
    return editedValues[item.key] ?? item.value;
  };

  const handleChange = (key: string, value: string) => {
    setEditedValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (featureId: string) => {
    const items = groupedConfig[featureId] ?? [];
    const updates = items
      .filter((c) => editedValues[c.key] !== undefined && editedValues[c.key] !== c.value)
      .map((c) => ({ key: c.key, value: editedValues[c.key]! }));

    if (updates.length === 0) return;

    setSaving(featureId);
    setSaveMessage(null);

    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setSaveMessage({ group: featureId, message: data.error ?? 'Save failed', isError: true });
        return;
      }

      setEditedValues((prev) => {
        const next = { ...prev };
        for (const u of updates) delete next[u.key];
        return next;
      });

      await fetchConfig();
      setSaveMessage({ group: featureId, message: `Saved ${updates.length} change${updates.length > 1 ? 's' : ''}`, isError: false });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch {
      setSaveMessage({ group: featureId, message: 'Network error', isError: true });
    } finally {
      setSaving(null);
    }
  };

  const getWeightGroup = (featureId: string) => FEATURE_GROUPS.find((g) => g.id === featureId);

  const computeWeightSum = (featureId: string): number => {
    const group = getWeightGroup(featureId);
    const weightKeys = group?.weightKeys;
    if (!weightKeys) return 0;
    const items = (groupedConfig[featureId] ?? []).filter((c) => weightKeys.includes(c.key));
    return items.reduce((sum, c) => {
      const val = Number(getDisplayValue(c));
      return sum + (Number.isNaN(val) ? 0 : val);
    }, 0);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400">Loading configuration...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-56 border-r border-gray-800 p-4 flex-shrink-0">
        <h1 className="text-lg font-bold text-white mb-6">Admin</h1>
        <nav className="space-y-1">
          {FEATURE_ORDER.map((featureId) => {
            const items = groupedConfig[featureId] ?? [];
            if (items.length === 0) return null;
            return (
              <button
                key={featureId}
                onClick={() => setActiveGroup(featureId)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeGroup === featureId
                    ? 'bg-blue-600/20 text-blue-400'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                {FEATURE_LABELS[featureId] ?? featureId}
                {hasChanges(featureId) && (
                  <span className="ml-2 inline-block w-2 h-2 bg-amber-400 rounded-full" />
                )}
              </button>
            );
          })}
          {unmapped.length > 0 && (
            <button
              onClick={() => setActiveGroup('_other')}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                activeGroup === '_other'
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              Other
            </button>
          )}
          <div className="mt-6 pt-4 border-t border-gray-800 space-y-1">
            <a href="/admin/data-flow" className="block w-full text-left px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
              Data Flow Diagram
            </a>
            <a href="/admin/optimizer-flow" className="block w-full text-left px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors pl-6">
              Optimizer &amp; Calibrator
            </a>
            <a href="/admin/recommendation-flow" className="block w-full text-left px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors pl-6">
              Recommendations &amp; Risk Model
            </a>
          </div>
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6 overflow-y-auto max-h-screen">
        <div className="max-w-3xl">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white">
              {activeGroup === '_other' ? 'Other Settings' : (FEATURE_LABELS[activeGroup] ?? activeGroup)}
            </h2>
            <div className="flex items-center gap-3">
              {activeGroup === 'composite_weights' ? (
                <CompositeWeightSums items={groupedConfig['composite_weights'] ?? []} getDisplayValue={getDisplayValue} />
              ) : getWeightGroup(activeGroup)?.weightKeys ? (
                <WeightSumIndicator sum={computeWeightSum(activeGroup)} />
              ) : null}
              {activeGroup !== '_other' && (
                <button
                  onClick={() => handleSave(activeGroup)}
                  disabled={!hasChanges(activeGroup) || saving === activeGroup}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {saving === activeGroup ? 'Saving...' : 'Save Changes'}
                </button>
              )}
            </div>
          </div>

          {saveMessage?.group === activeGroup && (
            <div className={`mb-4 px-3 py-2 rounded-lg text-sm ${
              saveMessage.isError ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'
            }`}>
              {saveMessage.message}
            </div>
          )}

          <div className="space-y-4">
            {activeGroup === '_other'
              ? unmapped.map((item) => (
                  <ConfigField
                    key={item.key}
                    item={item}
                    displayValue={getDisplayValue(item)}
                    isChanged={editedValues[item.key] !== undefined && editedValues[item.key] !== item.value}
                    onChange={(val) => handleChange(item.key, val)}
                  />
                ))
              : (groupedConfig[activeGroup] ?? []).map((item) => (
                  <ConfigField
                    key={item.key}
                    item={item}
                    displayValue={getDisplayValue(item)}
                    isChanged={editedValues[item.key] !== undefined && editedValues[item.key] !== item.value}
                    onChange={(val) => handleChange(item.key, val)}
                  />
                ))}
          </div>
        </div>
      </main>
    </div>
  );
}

function ConfigField({
  item,
  displayValue,
  isChanged,
  onChange,
}: {
  item: ConfigItem;
  displayValue: string;
  isChanged: boolean;
  onChange: (value: string) => void;
}) {
  const updatedStr = new Date(item.updated_at).toLocaleString();

  return (
    <div className={`p-4 rounded-lg border ${isChanged ? 'border-amber-500/50 bg-amber-500/5' : 'border-gray-800 bg-[#282c35]'}`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <label className="text-sm font-medium text-white">{item.label}</label>
          {item.description && (
            <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
          )}
        </div>
        <span className="text-[10px] text-gray-600 whitespace-nowrap ml-4">{updatedStr}</span>
      </div>

      {isModelKey(item.key) ? (
        <select
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 bg-[#15171d] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        >
          {MODEL_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : item.type === 'text' ? (
        <textarea
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          rows={12}
          className="w-full px-3 py-2 bg-[#15171d] border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-blue-500 resize-y"
        />
      ) : item.type === 'number' ? (
        <input
          type="number"
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          step={getNumberStep(item.key)}
          className="w-full px-3 py-2 bg-[#15171d] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        />
      ) : (
        <input
          type="text"
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 bg-[#15171d] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        />
      )}

      <div className="flex items-center gap-2 mt-1">
        <span className="text-[10px] text-gray-600 font-mono">{item.key}</span>
        {isChanged && <span className="text-[10px] text-amber-400">unsaved</span>}
      </div>
    </div>
  );
}

function WeightSumIndicator({ sum }: { sum: number }) {
  const isValid = Math.abs(sum - 1.0) < 0.001;

  return (
    <span className={`text-xs font-mono ${isValid ? 'text-emerald-400' : 'text-red-400'}`}>
      Sum: {sum.toFixed(2)}
    </span>
  );
}

const COMPOSITE_SUBGROUPS: { label: string; keys: string[] }[] = [
  { label: 'Stock', keys: ['weight_stock_technical', 'weight_stock_sentiment', 'weight_stock_fundamental', 'weight_stock_regime'] },
  { label: 'Crypto', keys: ['weight_crypto_technical', 'weight_crypto_sentiment', 'weight_crypto_fundamental', 'weight_crypto_regime'] },
  { label: 'Crypto (no sent.)', keys: ['weight_crypto_sentiment_missing_technical', 'weight_crypto_sentiment_missing_regime'] },
];

function CompositeWeightSums({
  items,
  getDisplayValue,
}: {
  items: ConfigItem[];
  getDisplayValue: (item: ConfigItem) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      {COMPOSITE_SUBGROUPS.map((sg) => {
        const sum = sg.keys.reduce((s, k) => {
          const item = items.find((i) => i.key === k);
          const val = item ? Number(getDisplayValue(item)) : 0;
          return s + (Number.isNaN(val) ? 0 : val);
        }, 0);
        const isValid = Math.abs(sum - 1.0) < 0.001;
        return (
          <span key={sg.label} className={`text-[10px] font-mono ${isValid ? 'text-emerald-400' : 'text-red-400'}`}>
            {sg.label}: {sum.toFixed(2)}
          </span>
        );
      })}
    </div>
  );
}
