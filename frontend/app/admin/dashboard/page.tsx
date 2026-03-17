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

import { CONFIG_GROUPS, CONFIG_MANIFEST, getManifestEntry, type ConfigStatus } from '@shared/lib/admin-config-manifest';

// Build lookups from manifest
const KEY_TO_FEATURE: Record<string, string> = {};
for (const entry of CONFIG_MANIFEST) {
  KEY_TO_FEATURE[entry.key] = entry.group;
}

const FEATURE_ORDER = CONFIG_GROUPS.map((g) => g.id);
const FEATURE_LABELS: Record<string, string> = Object.fromEntries(
  CONFIG_GROUPS.map((g) => [g.id, g.label])
);

// Weight validation groups from manifest
const WEIGHT_KEYS_BY_GROUP: Record<string, string[]> = {};
for (const g of CONFIG_GROUPS) {
  if (g.weightKeys) WEIGHT_KEYS_BY_GROUP[g.id] = g.weightKeys;
}

const STATUS_COLORS: Record<ConfigStatus, string> = {
  live: 'bg-green-500/20 text-green-400',
  manual_only: 'bg-amber-500/20 text-amber-400',
  legacy: 'bg-gray-500/20 text-gray-400',
  dead: 'bg-red-500/20 text-red-400',
};

const MODEL_OPTIONS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5-20251001',
];

function getNumberStep(key: string): string {
  const entry = getManifestEntry(key);
  if (entry?.max !== undefined && entry.max <= 1) return '0.01';
  if (key.startsWith('weight_') || key.startsWith('subweight_') || key.includes('decay')) return '0.01';
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

  // Group config items by feature group (using manifest key mapping)
  const groupedConfig = FEATURE_ORDER.reduce<Record<string, ConfigItem[]>>((acc, featureId) => {
    const groupKeys = CONFIG_MANIFEST.filter((e) => e.group === featureId).map((e) => e.key);
    acc[featureId] = groupKeys
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

  const computeWeightSum = (featureId: string): number => {
    const weightKeys = WEIGHT_KEYS_BY_GROUP[featureId];
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
          <div className="mt-6 pt-4 border-t border-gray-800">
            <div className="text-xs text-gray-600 uppercase tracking-wider px-3 mb-2">Documentation</div>
            <a href="/admin/data-flow" className="block w-full text-left px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
              Data Flow Diagram
            </a>
            <a href="/admin/optimizer-flow" className="block w-full text-left px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
              Optimizer &amp; Calibrator
            </a>
            <a href="/admin/recommendation-flow" className="block w-full text-left px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
              Recommendations &amp; Risk
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
              ) : WEIGHT_KEYS_BY_GROUP[activeGroup] ? (
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
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-white">{item.label}</label>
            {(() => {
              const meta = getManifestEntry(item.key);
              if (meta && meta.status !== 'live') {
                return <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold ${STATUS_COLORS[meta.status]}`}>{meta.status}</span>;
              }
              return null;
            })()}
          </div>
          {item.description && (
            <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
          )}
          {(() => {
            const meta = getManifestEntry(item.key);
            if (meta?.warning) return <p className="text-xs text-amber-400 mt-0.5">{meta.warning}</p>;
            return null;
          })()}
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
