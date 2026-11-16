import type { InputHTMLAttributes, ReactNode } from "react";
import Image from "next/image";
import { Link } from "@/lib/i18n/routing";
import { Spinner } from "@/components/ui/Spinner";

/**
 * The frame of the sign-in pages (login, signup, forgot and reset password):
 * the logo, linking home, above one white card.
 */
export function AuthPage({ centered = false, children }: { centered?: boolean; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex flex-col">
      <header className="p-4">
        <Link href="/" className="flex items-center gap-2">
          {/* Decoration: the name beside it already names the link. */}
          <Image src="/images/logo.png" alt="" width={40} height={40} className="rounded-lg" />
          <span className="font-bold text-xl text-[var(--primary-ink)]">MonkeyTravel</span>
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div
            className={
              centered
                ? "bg-white rounded-2xl shadow-xl p-8 border border-slate-200 text-center"
                : "bg-white rounded-2xl shadow-xl p-8 border border-slate-200"
            }
          >
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

/** A sign-in page while it waits: for its URL, or for the session a link brings. */
export function AuthPageLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex items-center justify-center">
      <div className="animate-spin h-8 w-8 border-2 border-[var(--primary)] border-t-transparent rounded-full" />
    </div>
  );
}

/** The card's form button: a spinner and `loadingLabel` while `loading`. */
export function AuthSubmitButton({
  loading,
  loadingLabel,
  children,
}: {
  loading: boolean;
  loadingLabel: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full bg-[var(--primary)] text-white py-3 rounded-lg font-medium hover:bg-[var(--primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
    >
      {loading ? (
        <>
          <Spinner className="w-5 h-5" />
          {loadingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * A labelled input of the card, red while `invalid`. `labelAside` sits
 * beside the label (the "Forgot password?" link), `hint` under the input.
 * The input is named after its id unless `name` is given.
 */
export function AuthField({
  id,
  label,
  invalid = false,
  labelAside,
  hint,
  ...input
}: {
  id: string;
  label: ReactNode;
  invalid?: boolean;
  labelAside?: ReactNode;
  hint?: ReactNode;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">) {
  const labelColor = invalid ? "text-red-600" : "text-slate-700";
  return (
    <div>
      {labelAside ? (
        <div className="flex items-center justify-between mb-1">
          <label htmlFor={id} className={`block text-sm font-medium ${labelColor}`}>
            {label}
          </label>
          {labelAside}
        </div>
      ) : (
        <label htmlFor={id} className={`block text-sm font-medium mb-1 ${labelColor}`}>
          {label}
        </label>
      )}
      <input
        id={id}
        name={id}
        {...input}
        className={`w-full px-4 py-2.5 rounded-lg border outline-none transition-colors ${
          invalid
            ? "border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-200"
            : "border-slate-300 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
        }`}
      />
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

const STATUS = {
  done: { circle: "bg-green-100", icon: "text-green-600", d: "M5 13l4 4L19 7" },
  emailed: {
    circle: "bg-blue-100",
    icon: "text-blue-600",
    d: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  },
  broken: {
    circle: "bg-red-100",
    icon: "text-red-600",
    d: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  },
};

/** The round icon above a result card's title: done, emailed, or a broken link. */
export function AuthStatusIcon({ status }: { status: keyof typeof STATUS }) {
  const { circle, icon, d } = STATUS[status];
  return (
    <div className={`w-16 h-16 ${circle} rounded-full flex items-center justify-center mx-auto mb-4`}>
      <svg className={`w-8 h-8 ${icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
      </svg>
    </div>
  );
}
