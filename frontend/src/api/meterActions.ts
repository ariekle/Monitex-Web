/** Ported from frmInstall.frm / lstMeterActions_DblClick — see backend routers/meter_actions.py module docstring. */

export interface MeterActionCheck {
  ok: boolean
  error: string | null
  warning: string | null
  actionLabel: string | null
  defaultName: string | null
}

export interface MeterNrCheck {
  ok: boolean
  error: string | null
  needsConfirm: boolean
  confirmMessage: string | null
  newMeter: boolean
  disconnectTaxi: number | null
}

export interface AccPaidCheck {
  ok: boolean
  error: string | null
  name: string | null
}

export interface MeterActionSaveResult {
  ok: boolean
  meterNr: number | null
  meterStatus: number | null
  covaStatus: number | null
}

export interface MeterActionSaveInput {
  action: number
  name: string
  actualDate: string // YYYY-MM-DD
  meterNr?: number
  carNr?: number
  accPaid?: number
  confirmDisconnect?: boolean
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

export function checkMeterAction(taxiNr: number, action: number): Promise<MeterActionCheck> {
  return postJson(`/api/account/${taxiNr}/meter-actions/check`, { action })
}

export function checkMeterNr(taxiNr: number, meterNr: number, confirm = false): Promise<MeterNrCheck> {
  return postJson(`/api/account/${taxiNr}/meter-actions/check-meter-nr`, { meterNr, confirm })
}

export function checkAccPaid(taxiNr: number, accPaid: number, meterCova: number): Promise<AccPaidCheck> {
  return postJson(`/api/account/${taxiNr}/meter-actions/check-acc-paid`, { accPaid, meterCova })
}

/** branchArea: this workstation's branch Area — see api/branch.ts. Required server-side (History.Area / Meter.DepositArea). */
export function saveMeterAction(
  taxiNr: number,
  payload: MeterActionSaveInput,
  branchArea: number,
): Promise<MeterActionSaveResult> {
  return postJson(`/api/account/${taxiNr}/meter-actions`, { ...payload, branch_area: branchArea })
}

/** branchArea: this workstation's branch Area — see api/branch.ts. Required server-side (History.Area). */
export function replaceMeter(
  taxiNr: number,
  newMeterNr: number,
  branchArea: number,
): Promise<{ ok: boolean; meterNr: number }> {
  return postJson(`/api/account/${taxiNr}/meter-actions/replace-meter`, { newMeterNr, branch_area: branchArea })
}

export function resetPoolBalances(taxiNr: number): Promise<{ ok: boolean }> {
  return postJson(`/api/account/${taxiNr}/meter-actions/reset-pool`, {})
}
