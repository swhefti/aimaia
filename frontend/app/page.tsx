'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Spinner } from '@/components/ui/spinner';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (user) {
      router.replace('/dashboard');
    } else {
      router.replace('/login');
    }
  }, [user, loading, router]);

  return (
    <main className="flex items-center justify-center min-h-screen">
      <Spinner size="lg" message="Loading Portfolio Advisor..." />
    </main>
  );
}
