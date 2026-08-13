import { useEffect, useState } from 'react'
import { fetchAreas, getStoredBranchArea, setStoredBranchArea, type AreaOption } from '../api/branch'

/**
 * One-time-per-workstation branch picker — the web equivalent of setting up
 * c:\meesql.cfg on a new computer. Blocks the app until a branch is chosen,
 * then persists it in localStorage (see api/branch.ts) so every subsequent
 * visit on this browser/computer skips straight through. Reopen via the
 * "שנה סניף" control this component renders once a value is set (e.g. if a
 * shared computer moves branches).
 */
export default function BranchAreaGate({ children }: { children: React.ReactNode }) {
  const [branchArea, setBranchArea] = useState<number | null>(() => getStoredBranchArea())
  const [changing, setChanging] = useState(false)

  if (branchArea === null || changing) {
    return (
      <BranchAreaPicker
        current={branchArea}
        onChosen={(area) => {
          setStoredBranchArea(area)
          setBranchArea(area)
          setChanging(false)
        }}
        onCancel={changing ? () => setChanging(false) : undefined}
      />
    )
  }

  return (
    <>
      {children}
      <button
        type="button"
        onClick={() => setChanging(true)}
        className="fixed bottom-1 left-1 z-40 text-[11px] text-slate-400 underline hover:text-slate-600"
        title="שינוי סניף המחשב הזה"
      >
        שנה סניף
      </button>
    </>
  )
}

function BranchAreaPicker({
  current,
  onChosen,
  onCancel,
}: {
  current: number | null
  onChosen: (area: number) => void
  onCancel?: () => void
}) {
  const [areas, setAreas] = useState<AreaOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(current)

  useEffect(() => {
    fetchAreas()
      .then(setAreas)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex w-[90vw] max-w-md flex-col gap-4 border border-slate-500 bg-[#EFEDE6] p-5 shadow-xl">
        <h2 className="text-[19px] font-bold">הגדרת סניף למחשב זה</h2>
        <p className="text-[15px] text-slate-700">
          יש לבחור את הסניף המשויך למחשב זה. הבחירה נשמרת בדפדפן ומשמשת לחשבוניות, מחירון וטיפול במונים/כובעים —
          מקביל לקובץ meesql.cfg בגרסה המקורית.
        </p>
        {error && <p className="text-[15px] text-red-600">שגיאה בטעינת רשימת הסניפים: {error}</p>}
        {!areas && !error && <p className="text-[15px] text-slate-500">טוען...</p>}
        {areas && (
          <select
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value === '' ? null : Number(e.target.value))}
            className="h-9 border border-slate-400 bg-white px-2 text-[16px] shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
          >
            <option value="" disabled>
              בחר סניף...
            </option>
            {areas.map((a) => (
              <option key={a.area} value={a.area}>
                {(a.name ?? '').trim() || `אזור ${a.area}`}
              </option>
            ))}
          </select>
        )}
        <div className="flex justify-end gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} className="win-button">
              ביטול
            </button>
          )}
          <button
            type="button"
            disabled={selected === null}
            onClick={() => selected !== null && onChosen(selected)}
            className="win-button disabled:opacity-50"
          >
            אישור
          </button>
        </div>
      </div>
    </div>
  )
}
