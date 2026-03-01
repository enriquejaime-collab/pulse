interface EmptyStateProps {
  title: string;
  description: string;
  nextSteps: string[];
}

export function EmptyState({ title, description, nextSteps }: EmptyStateProps) {
  return (
    <section className="glass-panel rounded-3xl p-6 sm:p-8">
      <h2 className="text-2xl font-semibold text-slate-900">{title}</h2>
      <p className="mt-3 max-w-2xl text-sm text-slate-600 sm:text-base">{description}</p>
      <ul className="mt-6 space-y-2 text-sm text-slate-700">
        {nextSteps.map((step) => (
          <li key={step} className="rounded-xl border border-slate-200/80 bg-white/80 px-4 py-3">
            {step}
          </li>
        ))}
      </ul>
    </section>
  );
}
