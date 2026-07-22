// Attendance breakdown per department — labelled progress bars rather than
// an SVG chart with an axis: department names here run long (e.g. Thai
// learning-area group names), and a fixed-width chart axis either wraps
// them onto a second line or clips them. A plain flex row keeps the name
// and count on one line (truncating with an ellipsis + title tooltip if it
// still doesn't fit) while the bar underneath shows the same proportion.
export interface DepartmentAttendance {
  department: string
  present: number
  absent: number
  total: number
}

export default function DepartmentAttendanceChart({ data }: { data: DepartmentAttendance[] }) {
  return (
    <div className="space-y-4">
      {data.map(({ department, present, total }) => {
        const percent = total > 0 ? Math.round((present / total) * 100) : 0
        return (
          <div key={department}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium text-foreground" title={department}>
                {department}
              </span>
              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                {present}/{total} คน · {percent}%
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
