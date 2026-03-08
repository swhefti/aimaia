import type { Metadata } from 'next';
import { Inter, Montserrat, Playfair_Display } from 'next/font/google';
import { AuthProvider } from '@/components/auth-provider';
import { SimulationProvider } from '@/components/simulation-provider';
import { AgentLabelProvider } from '@/components/agent-label-provider';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const montserrat = Montserrat({ subsets: ['latin'], variable: '--font-montserrat', weight: ['400', '600', '700'] });
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair', weight: ['700', '800', '900'] });

export const metadata: Metadata = {
  title: 'aiMAIA — AI Multi-Agent Investment Advisor',
  description: 'Your AI Multi-Agent Investment Advisor',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${montserrat.variable} ${playfair.variable}`}>
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
