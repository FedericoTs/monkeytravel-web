// ============ Sub-Components ============

export function MetricCard({
  label,
  value,
  subtitle,
  color,
}: {
  label: string;
  value: string;
  subtitle: string;
  color: "primary" | "secondary" | "accent" | "warning" | "success";
}) {
  const colorStyles = {
    primary: {
      bg: "bg-gradient-to-br from-[var(--primary)]/10 to-[var(--primary)]/5",
      border: "border-[var(--primary)]/20",
      text: "text-[var(--primary-ink)]",
      icon: "bg-[var(--primary)]/20 text-[var(--primary-ink)]",
    },
    secondary: {
      bg: "bg-gradient-to-br from-[var(--secondary)]/10 to-[var(--secondary)]/5",
      border: "border-[var(--secondary)]/20",
      text: "text-[var(--secondary-ink)]",
      icon: "bg-[var(--secondary)]/20 text-[var(--secondary-ink)]",
    },
    accent: {
      bg: "bg-gradient-to-br from-[var(--accent)]/15 to-[var(--accent)]/5",
      border: "border-[var(--accent-dark)]/20",
      text: "text-[var(--accent-dark)]",
      icon: "bg-[var(--accent)]/30 text-[var(--accent-dark)]",
    },
    warning: {
      bg: "bg-gradient-to-br from-orange-100 to-orange-50",
      border: "border-orange-200",
      text: "text-orange-600",
      icon: "bg-orange-200 text-orange-600",
    },
    success: {
      bg: "bg-gradient-to-br from-[var(--success)]/10 to-[var(--success)]/5",
      border: "border-[var(--success)]/20",
      text: "text-[var(--success)]",
      icon: "bg-[var(--success)]/20 text-[var(--success)]",
    },
  };

  const styles = colorStyles[color];

  return (
    <div className={`${styles.bg} border ${styles.border} rounded-2xl p-4`}>
      <p className="text-xs font-medium text-[var(--foreground-muted)] uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className={`text-2xl font-bold ${styles.text}`}>{value}</p>
      <p className="text-xs text-[var(--foreground-muted)] mt-1">{subtitle}</p>
    </div>
  );
}
