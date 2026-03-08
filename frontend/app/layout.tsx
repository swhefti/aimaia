import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/components/auth-provider';
import { SimulationProvider } from '@/components/simulation-provider';
import { AgentLabelProvider } from '@/components/agent-label-provider';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Portfolio Advisor',
  description: 'AI-powered investment portfolio advisor',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-navy-900 text-gray-100 font-sans antialiased">
        <AuthProvider>
          <SimulationProvider>
            <AgentLabelProvider>
              {children}
            </AgentLabelProvider>
          </SimulationProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
