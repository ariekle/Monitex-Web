import { useEffect, useState } from 'react'

interface StatusBarProps {
  /** Panel 1 text — left, fills remaining space. Mirrors sbStatusBar.Panel1 in frmMain.frm. */
  status?: string
}

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

// Panel2 (Style=6 in MSComctlLib) — date display
function formatDate(d: Date) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
}

// Panel3 (Style=5 in MSComctlLib) — time display
function formatTime(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export default function StatusBar({ status = 'Ready' }: StatusBarProps) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex h-[26px] items-stretch border-t border-shell-statusborder bg-shell-status text-lg text-slate-700">
      {/* Panel1 — AutoSize=1 (spring), takes remaining width */}
      <div className="flex flex-1 items-center truncate border-r border-shell-statusborder px-2">
        {status}
      </div>
      {/* Panel2 — date, AutoSize=2 (fit contents) */}
      <div className="flex items-center border-r border-shell-statusborder px-2 tabular-nums">
        {formatDate(now)}
      </div>
      {/* Panel3 — time, AutoSize=2 (fit contents) */}
      <div className="flex items-center px-2 tabular-nums">{formatTime(now)}</div>
    </div>
  )
}
