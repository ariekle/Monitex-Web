"""
Print/PDF-equivalent output for an invoice, replacing Crystal Reports.

The original app printed invoices via Crystal Reports (Code VB6/Invoice.rpt,
Receipt.rpt, etc.), shown through frmInvoiceRpt2.frm. Those .rpt files are
Crystal Reports for Btrieve binary format from 2014 or earlier — there is no
Crystal Reports engine available in this stack (proprietary, Windows-only),
and the .rpt files themselves are not human-readable or parseable for layout
info (confirmed: dumped as opaque compressed binary, no extractable field/
label strings). This is a from-scratch reconstruction of a standard Israeli
tax-invoice/receipt layout using the data we do have, not a pixel port of
the original report. The business's own letterhead details (name, address,
phone, ע.מ./ח.פ number) are NOT in any confirmed table (CFG has no such
columns) — left as placeholders, clearly marked, rather than fabricated.
"""
import html
from datetime import date, time
from typing import Optional

from .schemas import InvoiceOut

_METHOD_LABELS = {"cash": "מזומן", "check": "שיק", "credit": "אשראי"}
_CREDIT_TYPE_LABELS = {"regular": "רגיל", "credit": "קרדיט", "installments": "תשלומים"}


def _esc(value: Optional[object]) -> str:
    return html.escape(str(value)) if value is not None else ""


def _fmt_date(d: Optional[date]) -> str:
    return d.strftime("%d/%m/%Y") if d else ""


def _fmt_time(t: Optional[time]) -> str:
    return t.strftime("%H:%M") if t else ""


def _fmt_money(n: Optional[float]) -> str:
    return f"{n:,.2f}" if n is not None else ""


def render_invoice_html(invoice: InvoiceOut, copy: bool = False) -> str:
    """
    `copy` mirrors the print-bridge's own convention (see api/printBridge.ts /
    routers/invoices.py's print_invoice()): True -> label "מקור" (original),
    False -> "העתק" (copy). The caller decides this from whether the invoice
    has ever been printed before (`not invoice.Printed`) — see print_invoice().
    """
    copy_label = "מקור" if copy else "העתק"
    lines_section = ""
    if invoice.Lines:
        lines_rows = "".join(
            f"""
            <tr>
              <td>{_esc(l.Code)}</td>
              <td>{_esc(l.Description)}</td>
              <td>{_esc(l.Amount)}</td>
              <td>{_fmt_money(l.UnitPrice)}</td>
              <td>{_fmt_money(l.SubTotal)}</td>
            </tr>"""
            for l in invoice.Lines
        )
        lines_section = f"""
        <table class="lines">
          <thead><tr><th>קוד</th><th>תיאור</th><th>כמות</th><th>מחיר יחידה</th><th>סה"כ שורה</th></tr></thead>
          <tbody>{lines_rows}</tbody>
        </table>"""

    payments_section = ""
    if invoice.Payments:
        payment_rows = "".join(
            f"""
            <tr>
              <td>{_METHOD_LABELS.get(p.method, p.method)}</td>
              <td>{_fmt_money(p.amount)}</td>
              <td>{_esc(p.checkNr or p.cardNr or '')}</td>
              <td>{_esc(_CREDIT_TYPE_LABELS.get(p.creditType or '', p.checkDate or p.cardExpDate or ''))}</td>
            </tr>"""
            for p in invoice.Payments
        )
        payments_section = f"""
        <h3>אמצעי תשלום</h3>
        <table class="lines">
          <thead><tr><th>אמצעי</th><th>סכום</th><th>מס' שיק/כרטיס</th><th>פרטים</th></tr></thead>
          <tbody>{payment_rows}</tbody>
        </table>"""

    tz_row = f'<div><span class="label">ת.ז.:</span> {_esc(invoice.Tz)}</div>' if invoice.Tz is not None else ""

    if invoice.Vat is not None:
        # Regular invoice/kabala: prices are VAT-inclusive, so break the total down.
        net_total = (invoice.Total or 0) - (invoice.TotalVat or 0)
        totals_section = f"""
        <div>סה"כ ללא מע"מ: {_fmt_money(net_total)}</div>
        <div>מע"מ ({_esc(invoice.Vat)}%): {_fmt_money(invoice.TotalVat)}</div>
        <div class="grand">לתשלום: {_fmt_money(invoice.Total)}</div>"""
    else:
        # Standalone קבלה: no VAT breakdown of its own (see invoices.py docstring).
        totals_section = f"""<div class="grand">סה"כ התקבל: {_fmt_money(invoice.Total)}</div>"""

    return f"""<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>{_esc(invoice.TypeLabel)} {_esc(invoice.DisplayNr)}</title>
<style>
  @media print {{
    @page {{ size: A4; margin: 16mm; }}
    .no-print {{ display: none; }}
  }}
  body {{ font-family: Arial, Tahoma, sans-serif; direction: rtl; color: #111; margin: 0; padding: 24px; }}
  .letterhead {{ text-align: center; color: #999; border: 1px dashed #ccc; padding: 8px; margin-bottom: 16px; font-size: 12px; }}
  h1 {{ font-size: 20px; margin: 0 0 4px; }}
  h3 {{ font-size: 14px; border-bottom: 1px solid #999; padding-bottom: 4px; margin-top: 24px; }}
  .doc-header {{ display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 16px; }}
  .doc-nr {{ font-size: 16px; font-weight: bold; }}
  .copy-label {{ font-size: 13px; font-weight: bold; color: #555; border: 1px solid #999; border-radius: 3px; padding: 2px 10px; }}
  .details {{ display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 16px; font-size: 13px; }}
  .label {{ color: #555; }}
  table.lines {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
  table.lines th, table.lines td {{ border: 1px solid #ccc; padding: 6px 8px; text-align: right; }}
  table.lines th {{ background: #eee; }}
  .totals {{ margin-top: 12px; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: 13px; }}
  .totals .grand {{ font-size: 16px; font-weight: bold; border-top: 1px solid #333; padding-top: 4px; margin-top: 4px; }}
  .footer {{ margin-top: 32px; font-size: 11px; color: #777; text-align: center; }}
  .print-btn {{ margin-bottom: 16px; }}
</style>
</head>
<body>
  <button class="no-print print-btn" onclick="window.print()">הדפס / שמור כ-PDF</button>

  <div class="letterhead">פרטי העסק (שם, כתובת, טלפון, מס' עוסק) — יתעדכן בהמשך</div>

  <div class="doc-header">
    <h1>{_esc(invoice.TypeLabel)}</h1>
    <div class="copy-label">{copy_label}</div>
    <div class="doc-nr">מס' {_esc(invoice.DisplayNr)}</div>
  </div>

  <div class="details">
    <div><span class="label">תאריך:</span> {_fmt_date(invoice.Date)}</div>
    <div><span class="label">שעה:</span> {_fmt_time(invoice.Time)}</div>
    <div><span class="label">שם:</span> {_esc(invoice.Name)}</div>
    {tz_row}
    <div><span class="label">מונית מס':</span> {_esc(invoice.TaxiNr)}</div>
    <div><span class="label">כתובת:</span> {_esc(invoice.Street)} {_esc(invoice.HomeNr)}, {_esc(invoice.Town)}</div>
  </div>

  {lines_section}

  <div class="totals">
    {totals_section}
  </div>

  {payments_section}

  <div class="footer">מסמך זה הופק במערכת ממוחשבת · הודפס בתאריך {_fmt_date(date.today())}</div>
</body>
</html>"""
