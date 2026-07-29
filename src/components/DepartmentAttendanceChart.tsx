// Attendance breakdown per department. A meeting typically invites 8-10+
// learning-area groups — past the ~7-category point a one-row-per-department
// progress-bar list (the original design here) gets too tall to fit a fixed-
// height card without scrolling, especially in MeetingSummary's fullscreen
// layout (see round "การ์ดเดียวไม่ล้น"). A heatmap-style tile grid instead
// gives each department a fixed-size cell, using 2 dimensions of the card
// (columns AND rows) rather than 1, so the same 10 departments take a third
// of the vertical space. Magnitude now lives entirely in the horizontal
// gradient bar (round "เปอร์เซ็นเป็นหลอดเกรเดียนต์แนวนอน") rather than also
// tinting the tile background — one encoding for one measure, not two.
// Department names here run long (e.g. Thai learning-area group names),
// hence line-clamp-3 + a fixed min-height (see below) rather than trying to
// fit them on a chart axis or truncating them with an ellipsis.
export interface DepartmentAttendance {
  department: string
  present: number
  absent: number
  total: number
}

export default function DepartmentAttendanceChart({ data }: { data: DepartmentAttendance[] }) {
  return (
    // auto-fill (rather than a fixed breakpoint count) so this densifies on
    // its own in a narrow column (e.g. MeetingSummary fullscreen's 1/3-width
    // sidebar) instead of being stuck at whatever column count a sm:/md:
    // breakpoint assumed a full-width card.
    <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-1">
      {data.map(({ department, present, total }) => {
        const percent = total > 0 ? Math.round((present / total) * 100) : 0
        return (
          <div key={department} className="rounded-lg border border-border/70 bg-card p-1.5 shadow-soft">
            {/* min-h + line-clamp-3 (rather than truncate to 1 line) reserves
                the same 3-line slot for every tile whether a department's
                name is short (1 line) or long (the longest, "สังคมศึกษา
                ศาสนา และวัฒนธรรม", needs all 3 at this tile width) — full
                names stay readable AND every tile still comes out the same
                height, since this is the only variable-length text here. */}
            <p className="line-clamp-3 min-h-[39px] text-[11px] font-medium leading-tight text-foreground">{department}</p>
            <div className="mt-1 flex items-baseline justify-between gap-1">
              <span className="font-display text-base font-bold leading-none text-foreground">{percent}%</span>
              <span className="truncate text-[10px] text-muted-foreground">
                {present}/{total} คน
              </span>
            </div>
            {/* Same maroon->gold gradient as AttendanceDonut's ring, just as
                a horizontal bar here — keeps the "magnitude" color language
                consistent between the two attendance visualizations on this
                page rather than introducing a second, unrelated ramp. */}
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[hsl(350_62%_30%)] to-[hsl(43_74%_49%)] transition-[width] duration-500 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
