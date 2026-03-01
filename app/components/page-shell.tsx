import type { ReactNode } from "react";

interface PageShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  showHeader?: boolean;
}

export function PageShell({ title, subtitle, children, showHeader = true }: PageShellProps) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-10 pt-8">
      {showHeader && (
        <section className="glass-panel rounded-3xl p-6 sm:p-8">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-3 max-w-3xl text-sm text-slate-600 sm:text-base">{subtitle}</p>
        </section>
      )}
      {children}
    </main>
  );
}
