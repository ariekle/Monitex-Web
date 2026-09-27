/**
 * Ported verbatim from Public Function BankName(bankNr As Integer) in
 * Main.bas — a fixed lookup table, index 0-33 (anything outside that range
 * returns "" in the original, same here). Same array as
 * backend/app/routers/bad_checks.py's `_BANK_NAMES` — kept in sync by hand
 * since it's static VB6 source data, not something either side computes.
 */
const BANK_NAMES: string[] = [
  '       ', 'לאומי', 'הפועלים', 'איגוד', 'הבינלאומי', 'דיסקונט',
  'מזרחי', 'אמריקאי יש', 'הספנות', 'יהב', 'כללי לישר.',
  'למסחר', 'קונטיננטל', 'אוצר החייל', 'קופת העובד', 'מרכנתיל',
  'דואר', 'ערבי-ישראלי', 'הישיר', 'פועלי אג.',
  'ויזה', 'ישראכרד', 'דיינרס', 'אמקס',
  '', '', '', '', '', '',
  'בנק מסד', 'בנק עולמי להשקעות', 'בנק אדנים', 'בנק פלסטין', 'בנק ירושלים',
]

/** Empty string if out of range or the code maps to a blank slot (matches the original exactly). */
export function bankName(codeText: string): string {
  const code = Number(codeText)
  if (!Number.isInteger(code) || code < 0 || code >= BANK_NAMES.length) return ''
  return BANK_NAMES[code]
}
