import { ReactNode } from 'react';

interface FeatureCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  className?: string;
}

export default function FeatureCard({
  icon,
  title,
  description,
  className = '',
}: FeatureCardProps) {
  return (
    <div
      className={`group p-6 bg-white rounded-2xl border border-gray-100 hover:border-[var(--accent)] hover:shadow-xl transition-all duration-300 ${className}`}
    >
      <div className="w-14 h-14 rounded-xl bg-[var(--accent)]/20 flex items-center justify-center text-[var(--primary)] group-hover:bg-[var(--accent)] group-hover:text-[var(--primary-dark)] transition-colors mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-bold text-[var(--foreground)] mb-2">{title}</h3>
      <p className="text-[var(--foreground-muted)] leading-relaxed">{description}</p>
      <div className="mt-4 flex items-center text-[var(--primary)] font-medium group-hover:text-[var(--accent-dark)] transition-colors">
        <span>Learn more</span>
        <svg className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  );
}
