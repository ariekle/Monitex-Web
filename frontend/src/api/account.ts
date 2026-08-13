export interface Account {
  TaxiNr: number
  CarNr: number | null
  MeterNr: number | null

  FamilyName: string | null // max 12 chars in the DB — legacy limit, not a bug
  PrivatName: string | null // max 10 chars in the DB

  Street: string | null
  HomeNr: string | null
  Town: string | null
  ZipCode: number | null

  TelHome: string | null
  TelWork: string | null
  TelCell: string | null

  Station: string | null
  Area: number | null
  /** Joined from the real Areas DB lookup table — see backend routers/account.py. */
  AreaLabel: string | null

  /** Coded value, NOT a real date despite the name — see backend models.py. */
  CovaInsDate: number | null
  CovaType: number | null
  CovaStatus: number | null

  PaidMeters: number | null
  InsMeters: number | null
  PaidCovas: number | null
  InsCovas: number | null
  Checks: number | null
  Basis: number | null
  Bakar: number | null

  Msg: string | null
  RemarkDate: string | null

  Modem: number | null
  ModemPaid: boolean | null

  // Joined in from the Meters table via MeterNr (null if no meter assigned) —
  // Meters schema is partially unverified, see backend models.py.
  /** Encoded month*10000+year, e.g. 112016 = November 2016. NOT a real date. */
  MeterExpDate: number | null
  MeterType: number | null // int code, e.g. 2
  Insurance: boolean | null
  /** 1=פעיל, 2=גנוב, 3=מופקד, 4=מוסר (0/null=unset) — see backend models.py Meter.Status. */
  MeterStatus: number | null
}

/** Only the fields cmdUpdate_Click unlocks for editing in the VB6 form. */
export interface AccountEditableFields {
  FamilyName: string
  PrivatName: string
  Station: string
  Street: string
  HomeNr: string
  Town: string
  ZipCode: number | null
  TelHome: string
  TelWork: string
  TelCell: string
  CarNr: number | null
  Msg: string
}

export class AccountNotFoundError extends Error {}

export async function fetchAccount(taxiNr: number): Promise<Account> {
  const res = await fetch(`/api/account/${taxiNr}`)
  if (res.status === 404) {
    throw new AccountNotFoundError(`No account for taxi ${taxiNr}`)
  }
  if (!res.ok) {
    throw new Error(`Failed to load account ${taxiNr}: ${res.status}`)
  }
  return res.json()
}

export async function saveAccount(
  taxiNr: number,
  fields: Partial<AccountEditableFields>,
): Promise<Account> {
  const res = await fetch(`/api/account/${taxiNr}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const detail = body?.detail
    let detailText: string | null = null
    if (typeof detail === 'string') {
      detailText = detail
    } else if (Array.isArray(detail)) {
      // FastAPI/pydantic 422 shape: [{ loc: [...], msg: "...", ... }, ...]
      detailText = detail
        .map((d: { loc?: unknown[]; msg?: string }) => {
          const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : undefined
          return field ? `${field}: ${d.msg}` : d.msg
        })
        .filter(Boolean)
        .join('; ')
    }
    throw new Error(detailText || `Failed to save account ${taxiNr}: ${res.status}`)
  }
  return res.json()
}
