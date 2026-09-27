import { HebrewCalendar, flags } from '@hebcal/core'

/**
 * Full-closure Israeli bank holidays — used to pick a sane default deposit
 * date for the reset screen (see ResetModal.tsx's nextBusinessDay()).
 *
 * "CHAG" events (Rosh Hashana I+II, Yom Kippur, Sukkot I, Shmini Atzeret,
 * Pesach I+VII, Shavuot) are exactly Bank of Israel's official bank-holiday
 * list ("ימים שבהם הבנקים אינם עובדים") — Chol HaMoed days and Erev/fast
 * days are deliberately excluded, since banks are open (often just shortened
 * hours) on those. Yom HaAtzma'ut (Independence Day) is also a full bank
 * closure but hebcal flags it MODERN_HOLIDAY rather than CHAG, so it's
 * matched by name instead — its description string ("Yom HaAtzma'ut") is
 * stable across years (checked 2024-2028).
 *
 * Deliberately not attempting the original's find_deposit_date()/
 * init_credit_deposit_dates() (Code VB6/frmReset1.frm) — that VB6 helper's
 * own holiday table only covered ~2005-2015 and was already a silent no-op
 * for any later date (`If year(checkDate) - 2005 > 10 Then holiday =
 * False`), so there was nothing faithful to port; this is a fresh,
 * actually-correct implementation instead.
 */

let cachedYear: number | null = null
let cachedDates: Set<string> = new Set()

function datesForYear(year: number): Set<string> {
  const events = HebrewCalendar.calendar({ year, isHebrewYear: false, il: true })
  const out = new Set<string>()
  for (const ev of events) {
    const isChag = (ev.getFlags() & flags.CHAG) !== 0
    const isIndependenceDay = ev.getDesc().includes("Atzma")
    if (isChag || isIndependenceDay) {
      out.add(ev.getDate().greg().toISOString().slice(0, 10))
    }
  }
  return out
}

/** Covers the (rare) case of checking a date that spans a Dec 31 -> Jan 1 boundary. */
function holidaySetSpanning(year: number): Set<string> {
  if (cachedYear === year) return cachedDates
  cachedDates = new Set([...datesForYear(year - 1), ...datesForYear(year), ...datesForYear(year + 1)])
  cachedYear = year
  return cachedDates
}

export function isIsraeliBankHoliday(d: Date): boolean {
  const iso = d.toISOString().slice(0, 10)
  return holidaySetSpanning(d.getFullYear()).has(iso)
}
