import Link from "next/link";
import { PulseLogo } from "@/app/components/pulse-logo";

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/imports", label: "Imports" },
  { href: "/trades", label: "Trades" }
];

export function TopNav() {
  return (
    <header className="glass-panel sticky top-4 z-20 mx-auto w-full max-w-7xl rounded-2xl px-4 py-3 sm:px-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <PulseLogo className="h-9 w-9 shrink-0" />
          <div>
            <p className="text-lg font-semibold leading-tight text-slate-900">Pulse</p>
            <p className="text-xs text-slate-500">Your portfolio vitals.</p>
          </div>
        </div>
        <nav className="flex flex-wrap gap-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full border border-slate-200/80 bg-white/80 px-4 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
