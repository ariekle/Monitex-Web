import { useEffect, useState } from 'react'
import { submitTestPrint, type TestPrintResult } from '../api/testPrint'
import { getStoredBranchArea } from '../api/branch'
import { isPrintBridgeAvailable, testPrintUrl } from '../api/printBridge'

/**
 * Web equivalent of printTest(model As Integer) in Account.frm — reached via
 * Alt+F1 (auto-detect meter type) / Shift+F1 (manual meter type entry) in
 * the original, with no visible button at all. This is the meter/vehicle
 * test certificate a driver presents to the licensing authority as proof
 * the taxi's meter is currently valid — an official document, so this
 * screen surfaces it as a normal button instead of a hidden shortcut.
 *
 * The backend (routers/test_print.py) runs all 5 preconditions, resolves
 * MeterType, writes the History row, and allocates/zeroes the testNr in one
 * atomic call — this modal is just the form in front of that call, plus (if
 * the local Crystal Reports print bridge is running on this branch PC) a
 * button to actually render+print the real testNew.rpt certificate with the
 * resolved values.
 */

export default function TestPrintModal({ taxiNr, onClose }: { taxiNr: number; onClose: () => void }) {
  const [model, setModel] = useState<0 | 1>(0)
  const [meterTypeOverride, setMeterTypeOverride] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<TestPrintResult | null>(null)
  const [bridgeAvailable, setBridgeAvailable] = useState(false)

  useEffect(() => {
    isPrintBridgeAvailable().then(setBridgeAvailable)
  }, [])

  async function handleSubmit() {
    setError(null)

    if (!vehicleModel.trim()) {
      setError('!!!הכנס מודל רכב')
      return
    }
    if (model === 1 && !meterTypeOverride.trim()) {
      setError('!!!הכנס דגם מונה')
      return
    }

    const branchArea = getStoredBranchArea()
    if (branchArea === null) {
      setError('לא הוגדר סניף למחשב זה')
      return
    }

    setSubmitting(true)
    try {
      const r = await submitTestPrint(
        taxiNr,
        {
          model,
          meterTypeOverride: model === 1 ? meterTypeOverride.trim() : undefined,
          vehicleModel: vehicleModel.trim(),
        },
        branchArea,
      )
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בהפקת אישור בדיקה')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        dir="rtl"
        className="flex max-h-[85vh] w-[90vw] max-w-lg flex-col border border-slate-500 bg-[#EFEDE6] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-yellow-400 px-4 py-2">
          <h2 className="text-[22px] font-bold text-slate-800">אישור בדיקת מונה — מונית {taxiNr}</h2>
          <button type="button" onClick={onClose} className="win-button px-2 py-0.5 text-lg">
            סגור
          </button>
        </div>

        <div className="overflow-auto p-4">
          {result === null ? (
            <div className="space-y-3">
              {error && (
                <div className="border border-red-300 bg-red-50 px-3 py-2 text-lg text-red-700">{error}</div>
              )}

              <div>
                <span className="mb-1 block text-lg text-slate-600">דגם מונה</span>
                <div className="flex flex-wrap gap-4 text-lg">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={model === 0}
                      onChange={() => setModel(0)}
                      disabled={submitting}
                    />
                    זיהוי אוטומטי
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={model === 1}
                      onChange={() => setModel(1)}
                      disabled={submitting}
                    />
                    הכנס דגם ידנית
                  </label>
                </div>
              </div>

              {model === 1 && (
                <label className="block">
                  <span className="block text-lg text-slate-600">דגם מונה</span>
                  <input
                    type="text"
                    value={meterTypeOverride}
                    onChange={(e) => setMeterTypeOverride(e.target.value)}
                    disabled={submitting}
                    className="h-7 w-56 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                  />
                </label>
              )}

              <label className="block">
                <span className="block text-lg text-slate-600">מודל רכב</span>
                <input
                  type="text"
                  value={vehicleModel}
                  onChange={(e) => setVehicleModel(e.target.value)}
                  disabled={submitting}
                  className="h-7 w-56 border border-slate-400 bg-white px-1 shadow-[inset_1px_1px_2px_rgba(0,0,0,0.15)] focus:outline-none"
                />
              </label>

              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={submitting}
                className="win-button disabled:opacity-50"
              >
                {submitting ? 'מפיק אישור...' : 'הפק אישור בדיקה'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-lg text-emerald-800">
                האישור הופק בהצלחה.
                {result.testNr > 0 && <> מס' בדיקה: {result.testNr}.</>}
              </div>

              <table className="w-full border-collapse text-lg">
                <tbody>
                  <tr className="border-b border-slate-200">
                    <td className="py-1 text-slate-600">מס' מונית</td>
                    <td className="py-1">{result.taxiNr}</td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <td className="py-1 text-slate-600">מס' רישוי</td>
                    <td className="py-1">{result.carnr}</td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <td className="py-1 text-slate-600">דגם מונה</td>
                    <td className="py-1">{result.meterType}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-slate-600">מודל רכב</td>
                    <td className="py-1">{result.vehicleModel}</td>
                  </tr>
                </tbody>
              </table>

              {bridgeAvailable ? (
                <button
                  type="button"
                  onClick={() => window.open(testPrintUrl(result), '_blank')}
                  className="win-button"
                >
                  הדפס אישור
                </button>
              ) : (
                <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-base text-amber-800">
                  שרת ההדפסה המקומי (Crystal Reports) אינו זמין במחשב זה — לא ניתן להדפיס את האישור מכאן.
                </div>
              )}

              <button type="button" onClick={onClose} className="win-button block">
                סגור
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
