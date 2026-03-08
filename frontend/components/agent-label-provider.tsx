'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

interface AgentLabelContextValue {
  showLabels: boolean;
  toggleLabels: () => void;
}

const AgentLabelContext = createContext<AgentLabelContextValue>({
  showLabels: false,
  toggleLabels: () => {},
});

const STORAGE_KEY = 'maipa_label_agent_work';

export function AgentLabelProvider({ children }: { children: ReactNode }) {
  const [showLabels, setShowLabels] = useState(false);

  useEffect(() => {
    setShowLabels(localStorage.getItem(STORAGE_KEY) === 'true');
  }, []);

  const toggleLabels = useCallback(() => {
    setShowLabels((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
      return next;
    });
  }, []);

  return (
    <AgentLabelContext.Provider value={{ showLabels, toggleLabels }}>
      {children}
    </AgentLabelContext.Provider>
  );
}

export function useAgentLabels() {
  return useContext(AgentLabelContext);
}
