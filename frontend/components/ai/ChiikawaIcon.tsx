import React from 'react';

interface ChiikawaIconProps {
  className?: string;
  size?: number | string;
  expression?: 'happy' | 'thinking' | 'excited' | 'sleepy';
  withBadge?: boolean;
}

export function ChiikawaIcon({
  className = '',
  size = 48,
  expression = 'happy',
  withBadge = false
}: ChiikawaIconProps) {
  const pixelSize = typeof size === 'number' ? `${size}px` : size;

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 select-none ${className}`}
      style={{ width: pixelSize, height: pixelSize }}
    >
      <img
        src="/chiikawa.png"
        alt="Chiikawa AI"
        className={`w-full h-full object-cover rounded-full border border-slate-200/60 dark:border-slate-700/60 shadow-xs transition-transform ${
          expression === 'thinking' ? 'animate-pulse scale-95' : 'hover:scale-105'
        }`}
      />

      {/* Online indicator dot only when withBadge is true */}
      {withBadge && (
        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 sm:w-3 sm:h-3 bg-emerald-500 border-2 border-white dark:border-slate-900 rounded-full animate-pulse shadow-sm pointer-events-none" />
      )}
    </div>
  );
}
