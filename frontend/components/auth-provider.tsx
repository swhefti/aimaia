'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase-browser';
import type { User, SupabaseClient } from '@supabase/supabase-js';

interface AuthContextValue {
  user: User | null;
  supabase: SupabaseClient;
  loading: boolean;
  isGuest: boolean;
  enterGuestMode: () => void;
  exitGuestMode: () => void;
  enterSimulationMode: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const GUEST_USER: User = {
  id: 'guest-local',
  app_metadata: {},
  user_metadata: { display_name: 'Guest' },
  aud: 'authenticated',
  created_at: new Date().toISOString(),
} as User;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    // Check if guest mode or simulation mode was active (both use guest user)
    if (typeof window !== 'undefined' &&
        (sessionStorage.getItem('guest_mode') === '1' || sessionStorage.getItem('simulation_mode') === '1')) {
      setUser(GUEST_USER);
      setIsGuest(true);
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isGuest) {
        setUser(session?.user ?? null);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase, isGuest]);

  const enterGuestMode = useCallback(() => {
    // Clear any stale simulation flags first
    sessionStorage.removeItem('simulation_mode');
    sessionStorage.removeItem('simulation_date');
    sessionStorage.removeItem('simulation_valuations');
    document.cookie = 'simulation_mode=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    window.dispatchEvent(new Event('simulation-exit'));
    // Set guest mode
    sessionStorage.setItem('guest_mode', '1');
    document.cookie = 'guest_mode=1; path=/; SameSite=Lax';
    setUser(GUEST_USER);
    setIsGuest(true);
    setLoading(false);
  }, []);

  const enterSimulationMode = useCallback(() => {
    // Simulation uses guest auth (no credentials) but with simulation flag
    sessionStorage.setItem('guest_mode', '1');
    sessionStorage.setItem('simulation_mode', '1');
    document.cookie = 'guest_mode=1; path=/; SameSite=Lax';
    document.cookie = 'simulation_mode=1; path=/; SameSite=Lax';
    setUser(GUEST_USER);
    setIsGuest(true);
    setLoading(false);
  }, []);

  const exitGuestMode = useCallback(() => {
    sessionStorage.removeItem('guest_mode');
    sessionStorage.removeItem('simulation_mode');
    sessionStorage.removeItem('simulation_date');
    document.cookie = 'guest_mode=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = 'simulation_mode=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    window.dispatchEvent(new Event('simulation-exit'));
    setUser(null);
    setIsGuest(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, supabase, loading, isGuest, enterGuestMode, exitGuestMode, enterSimulationMode }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
