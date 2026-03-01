import { EmptyState } from "@/app/components/empty-state";
import { PageShell } from "@/app/components/page-shell";

export default function DashboardPage() {
  return (
    <PageShell
      title="Dashboard"
      subtitle="Your P&L analytics will appear here once transactions are imported and normalized."
    >
      <EmptyState
        title="No trade data yet"
        description="This dashboard will show key performance metrics like net P&L, win rate, drawdown, and cumulative trends after you import your first transaction batch."
        nextSteps={[
          "Go to Imports and add a CSV export from your broker or Polymarket.",
          "Review the preview/validation results before confirming import (Milestone 2).",
          "Return here to see your metrics and insights update automatically."
        ]}
      />
    </PageShell>
  );
}
