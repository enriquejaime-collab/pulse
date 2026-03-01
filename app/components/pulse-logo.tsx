export function PulseLogo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Pulse logo"
      className={className}
    >
      <rect x="6" y="6" width="52" height="52" rx="14" fill="#ecfdf5" stroke="#86efac" strokeWidth="1.5" />
      <path
        d="M14 34h10l5-12 8 22 5-10h8"
        fill="none"
        stroke="#059669"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
