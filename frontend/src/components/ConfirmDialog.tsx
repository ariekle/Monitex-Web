/**
 * In-app replacement for `window.confirm()` — styled to match the rest of
 * the app instead of the browser's generic native popup (which also exposes
 * the raw host:port in its title, e.g. "100.79.130.48:5173 אומר"). Renders
 * above whatever modal triggered it (z-[60] vs. the standard z-50 modal
 * overlay), so it works nested inside e.g. ResetModal.
 */
export default function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'אישור',
  cancelLabel = 'ביטול',
}: {
  message: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  cancelLabel?: string
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
      onClick={(e) => {
        // Stop here — this dialog is nested inside whatever modal triggered
        // it (see ResetModal.tsx), so without this a backdrop click would
        // also bubble up and close THAT modal's own backdrop handler, not
        // just dismiss this confirmation.
        e.stopPropagation()
        onCancel()
      }}
    >
      <div
        dir="rtl"
        className="w-[90vw] max-w-sm border border-slate-500 bg-[#EFEDE6] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 whitespace-pre-line text-lg text-slate-800">{message}</div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="win-button px-3 py-1 text-lg">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="win-button border-emerald-600 bg-emerald-50 px-3 py-1 text-lg text-emerald-800"
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
