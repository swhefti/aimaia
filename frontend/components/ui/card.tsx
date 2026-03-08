import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  header?: ReactNode;
  padding?: 'sm' | 'md' | 'lg';
}

const paddingStyles = {
  sm: 'p-3',
  md: 'p-4 sm:p-6',
  lg: 'p-6 sm:p-8',
};

export function Card({ children, className = '', header, padding = 'md' }: CardProps) {
  return (
    <div className={`bg-navy-800 border border-navy-600 rounded-xl ${className}`}>
      {header && (
        <div className="px-4 sm:px-6 py-3 border-b border-navy-600">
          {header}
        </div>
      )}
      <div className={paddingStyles[padding]}>{children}</div>
    </div>
  );
}
