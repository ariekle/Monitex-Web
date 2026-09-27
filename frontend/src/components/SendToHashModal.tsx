import { useEffect, useState } from 'react'
import { fetchPendingHashResets, markResetProcessed, type PendingHashReset } from '../api/reset'

/**
 * Web equivalent of frmSendtoHash.frm ("העברה לחשבשבת" / "Transfer to
 * Hashavshevת") — the original's screen for resending resets that haven't
 * been successfully transferred yet. Confirmed as a REAL, compiled part of
 * Monitex2000.vbp (not a dead prototype) — see backend/app/routers/reset.py's
 * list_pending_hash_resets()/mark_reset_processed() for the exact ported
 * query and the module-docstring note explaining why movein.dat is NOT also
 * generated automatically at reset-commit time (2026-09-27 change): the real
 * workflow only ever generates it here, on demand, never at commit.
 *
 * Ported flow (ResetsGrid_DblClick in the original):
 * 1. Double-click a pending row -> triggers movein.dat generation for that
 *    ResetNr (same GET .../movein.dat endpoint the past-reset lookup screen
 *    already uses) — the browser's own download IS the delivery, since this
 *    screen is always run from a browser already on the accounting PC; see
 *    movein_export.py's module docstring.
 * 2. Then asks "?האם האיפוס עבר בהצלחה לחשבשבת" (Did the reset transfer
 *    successfully to Hashavshevת?) — only on "כן" (yes) does it mark
 *    Resets.Processed=True (removing it from this list); "לא" (no) leaves
 *    it pending so it can be tried again later.
 *
 * No separate confirm-dialog component exists yet in this app (the
 * original's dlgContinue.frm), so this is a small inline two-button prompt
 * instead of a new shared component — same Hebrew wording as the original.
 */
export default function SendToHashModal({ onClose }: { onClose: () => void }) {
  const [resets, setResets] = useState<PendingHashReset[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<PendingHashReset | null>(null)
  const [busy, setBusy] = useState(false)

  function reload() {
    setError(null)
    fetchPendingHashResets()
      .then(setResets)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }

  useEffect(() => {
    reload()
  }, [])

  async function handleRowDoubleClick(row: PendingHashReset) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // Same download endpoint the past-reset lookup screen uses — generates
      // movein.dat fresh for this ResetNr; the browser's own download IS the
      // delivery (see movein_export.py's module docstring).
      window.open(`/api/reset/${row.resetNr}/movein.dat`, '_blank')
    } finally {
      setBusy(false)
      setConfirming(row)
    }
  }

  async function handleConfirm(yes: boolean) {
    if (!confirming) return
    if (!yes) {
      setConfirming(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await markResetProcessed(confirming.resetNr)
      setConfirming(null)
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        dir="rtl"
        className="flex max-h-[85vh] w-[95vw] max-w-3xl flex-col border border-slate-500 bg-[#EFEDE6] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-yellow-400 px-4 py-2">
          <h2 className="text-[22px] font-bold text-slate-800">העברה לחשבשבת</h2>
          <button type="button" onClick={onClose} className="win-button px-2 py-0.5 text-lg">
            יציאה
          </button>
        </div>

        <div className="overflow-auto p-4">
          {error && <div className="mb-3 border border-red-300 bg-red-50 px-3 py-2 text-xl text-red-700">{error}</div>}

          {!resets && !error && <p className="text-lg text-slate-500">טוען...</p>}

          {resets && resets.length === 0 && (
            <p className="text-lg text-slate-600">אין איפוסים הממתינים להעברה לחשבשבת</p>
          )}

          {resets && resets.length > 0 && (
            <table className="w-full border-collapse text-lg">
              <thead>
                <tr className="border-b border-slate-400 text-right">
                  <th className="py-1">אזור</th>
                  <th className="py-1">מספר עיבוד</th>
                  <th className="py-1">תאריך עיבוד</th>
                </tr>
              </thead>
              <tbody>
                {resets.map((r) => (
                  <tr
                    key={r.resetNr}
                    className="cursor-pointer border-b border-slate-200 hover:bg-yellow-100"
                    onDoubleClick={() => handleRowDoubleClick(r)}
                    title="לחיצה כפולה להעברה"
                  >
                    <td className="py-1">{r.areaName}</td>
                    <td className="py-1">{r.resetNr}</td>
                    <td className="py-1">{r.resetDate ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {confirming && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
            <div dir="rtl" className="w-[90vw] max-w-sm border border-slate-500 bg-[#EFEDE6] p-5 shadow-xl">
              <p className="mb-4 text-lg text-slate-800">האם האיפוס עבר בהצלחה לחשבשבת?</p>
              <div className="flex justify-center gap-3">
                <button type="button" disabled={busy} onClick={() => handleConfirm(true)} className="win-button disabled:opacity-50">
                  כן
                </button>
                <button type="button" disabled={busy} onClick={() => handleConfirm(false)} className="win-button disabled:opacity-50">
                  לא
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
