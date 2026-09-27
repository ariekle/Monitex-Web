import { useEffect } from 'react'

/**
 * Web equivalent of frmMsg.Show vbModal — the small one-line alert popup
 * (lblMsg + an OK button) used throughout the original VB6 app, e.g.
 * "!!!לקוח לא נמצא" style messages. This isn't a blanket replacement for
 * every inline error banner in this app — just a small reusable dialog for
 * cases that specifically call for the original's popup treatment (see
 * Account.tsx's "customer not found" case).
 */
export default function MsgModal({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter' || e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        dir="rtl"
        className="flex w-[90vw] max-w-xs flex-col items-center gap-4 border border-slate-500 bg-[#EFEDE6] px-6 py-5 text-center shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-lg font-bold text-slate-800">{message}</p>
        <button type="button" onClick={onClose} autoFocus className="win-button px-6">
          אישור
        </button>
      </div>
    </div>
  )
}
