'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

interface SimulationContextValue {
  isSimulation: boolean;
  simulationDate: string | null; // YYYY-MM-DD
  isAdvancing: boolean;
  setAdvancing: (v: boolean) => void;
  enterSimulation: () => void;
  exitSimulation: () => void;
  advanceDay: () => void;
}

const SimulationContext = createContext<SimulationContextValue>({
  isSimulation: false,
  simulationDate: null,
  isAdvancing: false,
  setAdvancing: () => {},
  enterSimulation: () => {},
  exitSimulation: () => {},
  advanceDay: () => {},
});

export function SimulationProvider({ children }: { children: ReactNode }) {
  const [isSimulation, setIsSimulation] = useState(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem('simulation_mode') === '1';
  });

  const [simulationDate, setSimulationDate] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem('simulation_date');
  });

  const [isAdvancing, setAdvancing] = useState(false);

  // Sync state when simulation is cleared externally (e.g. on login or guest mode entry)
  useEffect(() => {
    function handleSimulationExit() {
      setIsSimulation(false);
      setSimulationDate(null);
    }
    window.addEventListener('simulation-exit', handleSimulationExit);
    return () => window.removeEventListener('simulation-exit', handleSimulationExit);
  }, []);

  const enterSimulation = useCallback(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    const dateStr = date.toISOString().split('T')[0]!;
    sessionStorage.setItem('simulation_mode', '1');
    sessionStorage.setItem('simulation_date', dateStr);
    // Clear any previous valuation history
    sessionStorage.removeItem('simulation_valuations');
    document.cookie = 'simulation_mode=1; path=/; SameSite=Lax';
    setIsSimulation(true);
    setSimulationDate(dateStr);
  }, []);

  const exitSimulation = useCallback(() => {
    sessionStorage.removeItem('simulation_mode');
    sessionStorage.removeItem('simulation_date');
    sessionStorage.removeItem('simulation_valuations');
    document.cookie = 'simulation_mode=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    setIsSimulation(false);
    setSimulationDate(null);
  }, []);

  const advanceDay = useCallback(() => {
    if (!simulationDate || isAdvancing) return;
    const date = new Date(simulationDate + 'T12:00:00');
    date.setDate(date.getDate() + 1);
    const today = new Date().toISOString().split('T')[0]!;
    const newDate = date.toISOString().split('T')[0]!;
    if (newDate > today) return;
    setAdvancing(true);
    sessionStorage.setItem('simulation_date', newDate);
    setSimulationDate(newDate);
  }, [simulationDate, isAdvancing]);

  return (
    <SimulationContext.Provider value={{ isSimulation, simulationDate, isAdvancing, setAdvancing, enterSimulation, exitSimulation, advanceDay }}>
      {children}
    </SimulationContext.Provider>
  );
}

export function useSimulation() {
  return useContext(SimulationContext);
}
