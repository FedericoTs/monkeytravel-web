import { ReactNode } from 'react';

type BadgeVariant = 'default' | 'accent' | 'success' | 'outline' | 'accent-dark';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  icon?: ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/20',
  accent: 'bg-[var(--accent)]/20 text-[var(--primary-dark)] border-[var(--accent)]',
  'accent-dark': 'bg-[var(--accent)] text-[var(--primary-dark)] border-[var(--accent)]',
  success: 'bg-green-50 text-green-700 border-green-200',
  outline: 'bg-white text-[var(--foreground-muted)] border-gray-200',
};

export default function Badge({
  children,
  variant = 'default',
  icon,
  className = '',
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium border ${variantStyles[variant]} ${className}`}
    >
      {icon && <span className="w-4 h-4">{icon}</span>}
      {children}
    </span>
  );
}
