interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
}

const sizeMap = {
  sm: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

export function Spinner({ size = 'md', message }: SpinnerProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`${sizeMap[size]} animate-spin rounded-full border-2 border-navy-600 border-t-accent-blue`}
      />
      {message && <p className="text-sm text-gray-400">{message}</p>}
    </div>
  );
}
