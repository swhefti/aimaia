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

const GROUP_LABELS: Record<string, string> = {
  models: 'Models',
  prompts: 'Prompts',
  scoring_weights: 'Scoring Weights',
  technical_sub_weights: 'Technical Sub-weights',
  output_limits: 'Output Limits',
  data_windows: 'Data Windows',
  probability_math: 'Probability Math',
};

const GROUP_ORDER = ['models', 'prompts', 'scoring_weights', 'technical_sub_weights', 'output_limits', 'data_windows', 'probability_math'];

const MODEL_OPTIONS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5-20251001',
];

function getNumberStep(key: string): string {
  if (key.startsWith('weight_') || key.startsWith('subweight_') || key.includes('decay') || key.includes('midpoint')) return '0.01';
  return '1';
}

export default function AdminDashboardPage() {
  const [config, setConfig] = useState<ConfigItem[]>([]);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [activeGroup, setActiveGroup] = useState('models');
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

  const groupedConfig = GROUP_ORDER.reduce<Record<string, ConfigItem[]>>((acc, group) => {
    acc[group] = config.filter((c) => c.group_name === group);
    return acc;
  }, {});

  const hasChanges = (group: string): boolean => {
    return (groupedConfig[group] ?? []).some((c) => editedValues[c.key] !== undefined && editedValues[c.key] !== c.value);
  };

  const getDisplayValue = (item: ConfigItem): string => {
    return editedValues[item.key] ?? item.value;
  };

  const handleChange = (key: string, value: string) => {
    setEditedValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (group: string) => {
    const items = groupedConfig[group] ?? [];
    const updates = items
      .filter((c) => editedValues[c.key] !== undefined && editedValues[c.key] !== c.value)
      .map((c) => ({ key: c.key, value: editedValues[c.key]! }));

    if (updates.length === 0) return;

    setSaving(group);
    setSaveMessage(null);

    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setSaveMessage({ group, message: data.error ?? 'Save failed', isError: true });
        return;
      }

      // Clear edited values for saved items and refresh
      setEditedValues((prev) => {
        const next = { ...prev };
        for (const u of updates) delete next[u.key];
        return next;
      });

      await fetchConfig();
      setSaveMessage({ group, message: `Saved ${updates.length} change${updates.length > 1 ? 's' : ''}`, isError: false });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch {
      setSaveMessage({ group, message: 'Network error', isError: true });
    } finally {
      setSaving(null);
    }
  };

  const computeWeightSum = (group: string): number => {
    const items = groupedConfig[group] ?? [];
    return items.reduce((sum, c) => {
      const val = Number(getDisplayValue(c));
      return sum + (Number.isNaN(val) ? 0 : val);
    }, 0);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <p className="text-gray-400">Loading configuration...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex">
      {/* Sidebar */}
      <aside className="w-56 border-r border-gray-800 p-4 flex-shrink-0">
        <h1 className="text-lg font-bold text-white mb-6">Admin</h1>
        <nav className="space-y-1">
          {GROUP_ORDER.map((group) => (
            <button
              key={group}
              onClick={() => setActiveGroup(group)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                activeGroup === group
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {GROUP_LABELS[group] ?? group}
              {hasChanges(group) && (
                <span className="ml-2 inline-block w-2 h-2 bg-amber-400 rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6 overflow-y-auto max-h-screen">
        <div className="max-w-3xl">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white">
              {GROUP_LABELS[activeGroup] ?? activeGroup}
            </h2>
            <div className="flex items-center gap-3">
              {(activeGroup === 'scoring_weights' || activeGroup === 'technical_sub_weights') && (
                <WeightSumIndicator sum={computeWeightSum(activeGroup)} group={activeGroup} />
              )}
              <button
                onClick={() => handleSave(activeGroup)}
                disabled={!hasChanges(activeGroup) || saving === activeGroup}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {saving === activeGroup ? 'Saving...' : 'Save Changes'}
              </button>
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
            {(groupedConfig[activeGroup] ?? []).map((item) => (
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
    <div className={`p-4 rounded-lg border ${isChanged ? 'border-amber-500/50 bg-amber-500/5' : 'border-gray-800 bg-[#131825]'}`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <label className="text-sm font-medium text-white">{item.label}</label>
          {item.description && (
            <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>
          )}
        </div>
        <span className="text-[10px] text-gray-600 whitespace-nowrap ml-4">{updatedStr}</span>
      </div>

      {item.type === 'string' && item.group_name === 'models' ? (
        <select
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 bg-[#0a0e1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
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
          className="w-full px-3 py-2 bg-[#0a0e1a] border border-gray-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-blue-500 resize-y"
        />
      ) : item.type === 'number' ? (
        <input
          type="number"
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          step={getNumberStep(item.key)}
          className="w-full px-3 py-2 bg-[#0a0e1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        />
      ) : (
        <input
          type="text"
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 bg-[#0a0e1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        />
      )}

      <div className="flex items-center gap-2 mt-1">
        <span className="text-[10px] text-gray-600 font-mono">{item.key}</span>
        {isChanged && <span className="text-[10px] text-amber-400">unsaved</span>}
      </div>
    </div>
  );
}

function WeightSumIndicator({ sum, group }: { sum: number; group: string }) {
  // For scoring_weights, we have two sets: stock (4 weights) and crypto (4 weights) + 2 override weights
  // For technical_sub_weights, all 5 should sum to 1.0
  const isValid = group === 'technical_sub_weights'
    ? Math.abs(sum - 1.0) < 0.001
    : true; // scoring_weights has multiple sets, hard to validate as a single sum

  // For scoring_weights, just show the raw sum
  const label = group === 'technical_sub_weights' ? 'Sum' : 'Total';

  return (
    <span className={`text-xs font-mono ${
      group === 'technical_sub_weights'
        ? (isValid ? 'text-emerald-400' : 'text-red-400')
        : 'text-gray-400'
    }`}>
      {label}: {sum.toFixed(2)}
    </span>
  );
}
