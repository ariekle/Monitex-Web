import { useState } from 'react'

/**
 * Web equivalent of cmdExit_Click -> frmExit.Show vbModal in Account.frm — a
 * small "?האם לצאת" confirm dialog (button captions reconstructed; frmExit's
 * exact text lives in a legacy binary .frx resource this port can't read).
 *
 * The original's own cmdExit on frmExit does a plain `End` — it terminates
 * the whole VB6 process outright. Browsers don't allow a script to close a
 * tab it didn't itself open, so `window.close()` here is usually a silent
 * no-op; if that happens this falls back to telling the user it's safe to
 * close the tab themselves, rather than leaving an unresponsive button.
 */
export default function ExitConfirmModal({ onClose }: { onClose: () => void }) {
  const [closeAttempted, setCloseAttempted] = useState(false)

  function handleExit() {
    window.close()
    setTimeout(() => setCloseAttempted(true), 150)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        dir="rtl"
        className="flex w-[90vw] max-w-sm flex-col items-center gap-4 border border-slate-500 bg-[#EFEDE6] px-6 py-5 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {closeAttempted ? (
          <>
            <p className="text-lg text-slate-800">ניתן כעת לסגור את חלון הדפדפן.</p>
            <button type="button" onClick={onClose} autoFocus className="win-button px-6">
              חזרה
            </button>
          </>
        ) : (
          <>
            <p className="text-lg font-bold text-slate-800">?האם לצאת</p>
            <div className="flex gap-3">
              <button type="button" onClick={handleExit} className="win-button px-6">
                יציאה
              </button>
              <button type="button" onClick={onClose} autoFocus className="win-button px-6">
                ביטול
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
