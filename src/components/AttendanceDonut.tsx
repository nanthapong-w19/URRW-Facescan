// Shared gradient-ring donut used by both Dashboard.tsx (today's overall
// rate) and MeetingSummary.tsx (per-meeting rate, windowed mode only —
// fullscreen mode uses a horizontal gradient bar instead, see
// MeetingSummary.tsx's attendanceDonutCard) — pure SVG rather than a
// charting lib since it's a single static ring with a center label, not
// worth pulling recharts in for.
export default function AttendanceDonut({
  percent,
  label,
}: {
  percent: number
  label: string
}) {
  const size = 168
  const stroke = 16
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - percent / 100)

  return (
    <div className="relative flex aspect-square h-full max-h-[168px] w-full max-w-[168px] items-center justify-center">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id="donutGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(350 62% 30%)" />
            <stop offset="100%" stopColor="hsl(43 74% 49%)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#donutGradient)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-display text-3xl font-bold text-foreground">{percent}%</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}
