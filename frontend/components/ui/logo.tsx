'use client';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  /** 'dark' = dark background (MAIA white), 'light' = light background (MAIA black) */
  variant?: 'dark' | 'light';
  showSubtitle?: boolean;
}

const sizes = {
  sm: { ai: 'text-lg', maia: 'text-xl', subtitle: 'text-[10px]' },
  md: { ai: 'text-2xl', maia: 'text-3xl', subtitle: 'text-xs' },
  lg: { ai: 'text-4xl', maia: 'text-5xl', subtitle: 'text-sm' },
};

export function Logo({ size = 'md', variant = 'dark', showSubtitle = false }: LogoProps) {
  const s = sizes[size];
  const maiaColor = variant === 'dark' ? 'text-white' : 'text-gray-900';

  return (
    <div className={showSubtitle ? 'flex flex-col items-center' : 'inline-flex items-baseline'}>
      <div className="inline-flex items-baseline leading-none">
        <span className={`font-montserrat font-semibold ${s.ai} text-teal-400`}>
          ai
        </span>
        <span className={`font-playfair font-black ${s.maia} ${maiaColor} tracking-wide`}>
          MAIA
        </span>
      </div>
      {showSubtitle && (
        <p className={`${s.subtitle} text-gray-400 mt-1 tracking-wide`}>
          Your AI Multi-Agent Investment Advisor
        </p>
      )}
    </div>
  );
}
