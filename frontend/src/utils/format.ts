/** For real date/datetime strings coming back from the API (e.g. Account.RemarkDate, History.Date). */
export function formatDate(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/** For SQL `time` strings ("HH:MM:SS") — just trims to HH:MM. */
export function formatTime(value: string | null): string {
  if (!value) return ''
  return value.slice(0, 5)
}

/**
 * For the month*10000+year encoded integer used by Meters.ExpDate and
 * History.ExpDate (e.g. 112016 = November 2016) — NOT a real date, do not
 * pass to `new Date(...)`. See backend app/models.py for the full story.
 */
export function formatMonthYear(value: number | null): string {
  if (value === null || value === undefined) return ''
  const month = Math.floor(value / 10000)
  const year = value % 10000
  if (month < 1 || month > 12) return String(value) // unexpected shape, show raw rather than guess
  return `${String(month).padStart(2, '0')}-${year}`
}
