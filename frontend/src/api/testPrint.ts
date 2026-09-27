/** Ported from printTest(model As Integer) in Account.frm — see backend routers/test_print.py module docstring. */

export interface TestPrintResult {
  taxiNr: number
  carnr: number
  meterType: string
  vehicleModel: string
  testNr: number
}

export interface TestPrintInput {
  model: 0 | 1 // 0 = auto-detect (Alt+F1), 1 = manual meter-type entry (Shift+F1)
  meterTypeOverride?: string // required when model === 1
  vehicleModel: string // always required
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => null)
    const err = new Error(errBody?.detail || `Request failed: ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return res.json()
}

/** branchArea: this workstation's branch Area — see api/branch.ts. Required server-side (History.Area, and to look up Areas.PrintTestNr). */
export function submitTestPrint(taxiNr: number, payload: TestPrintInput, branchArea: number): Promise<TestPrintResult> {
  return postJson(`/api/account/${taxiNr}/test-print`, {
    branch_area: branchArea,
    model: payload.model,
    meter_type_override: payload.meterTypeOverride,
    vehicle_model: payload.vehicleModel,
  })
}
