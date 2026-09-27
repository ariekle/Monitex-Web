# Monitex VB6 → Web Migration — Project Status

_Last updated: 2026-09-16_

## How to resume this project in a new Claude session

Paste this file's path (or its contents) into a fresh conversation and say something like:
"Continue the Monitex migration — read PROGRESS.md in the WebCode folder for full context." Claude should then read this file plus the two source trees below before doing anything else.

## Project overview

Migrating VB6 taxi-dispatch software "Monitex" to a web app:
- **Backend**: FastAPI + SQLAlchemy + MSSQL — `WebCode/backend/app/`
- **Frontend**: React + TypeScript + Vite + Tailwind — `WebCode/frontend/src/`
- **Original VB6 source (read-only reference)**: `Code VB6/`
- **Web app root**: `WebCode/`

All paths below are relative to `/Users/arieklebaner/Desktop/Projects/Monitex/Monitex/`.

## Core project convention (read this before making any change)

Replicate the VB6 app's behavior **faithfully** by reading the actual VB6 source (`.frm`/`.bas` files) before porting any feature — never guess. When the original has a bug, an ambiguous rule, or something impossible to port exactly (e.g. Hebrew captions stored in binary `.frx` resources that can't be read), **flag it in a code comment** rather than silently "fixing" it — unless the user explicitly asks for a behavior change/fix. Verify every change before declaring it done:
- Backend: `python3 -m py_compile <file>` at minimum; for anything with real logic, a throwaway SQLite smoke test (pattern below).
- Frontend: `npx tsc --noEmit -p .` from `WebCode/frontend/`.

### SQLite smoke-test pattern (reusable)
Substitute `sys.modules["app.database"]` with an in-memory SQLite engine (`StaticPool`, `connect_args={"check_same_thread": False}`), `ModelsBase.metadata.create_all(engine)`, then drive the router via FastAPI's `TestClient`. Gotcha: `History.TransNr` is `BigInteger` PK — SQLite only auto-assigns rowid-alias values for `Integer` PKs, so in throwaway smoke tests only, add a `before_insert` SQLAlchemy event listener that assigns sequential `TransNr` values.

## Completed work (chronological, high level)

1. Bad checks (שיקים חוזרים): model, backend router (search/report/repay/lost), frontend screen — full round trip verified.
2. Invoice/reset fixes: consolidated print buttons, fixed bank-name label layout, fixed `ActiveReset.ResetNr` bug, auto-generated installment payments from multi-price items, cascaded first check's account/bank/branch/nr to other checks, validated payment sum vs invoice total before save.
3. Account lookup cascade on the main taxi-nr window: pressing Enter with no taxi nr moves focus to meter-nr box → Enter there looks up account by meter → Enter with no meter moves to family-name search → results list → double-click/Enter loads the account. Backend: `search_accounts_by_name`, `get_account_by_meter`, `get_history_by_meter` in `routers/account.py` (registered **before** the catch-all `/{taxi_nr}` route — route ordering matters in FastAPI/Starlette).
4. History modal (`components/HistoryModal.tsx`): shows the loaded taxi's history by default (no picker, per explicit user request), with a subtle "חיפוש לפי מספר מונה" text link in the header that reveals an inline meter-nr search box, switching to `fetchHistoryByMeter` — this by-meter capability doesn't exist in the original VB6 app at all.
5. "!לקוח לא נמצא" small modal (`components/MsgModal.tsx`) — ports `frmMsg.Show vbModal`, used for the account-not-found case.
6. Exit button (`components/ExitConfirmModal.tsx`) — ports `frmExit.frm`; web equivalent of VB6's `End` is `window.close()` (browsers usually block this for tabs not opened via script — falls back to a "you can close this tab" message).
7. Modem actions (`components/ModemActionModal.tsx`, backend `POST /{taxi_nr}/modem-action` in `routers/meter_actions.py`) — ports `cmdModem_Click`/`lstModemActions_DblClick`. Only install (action=0) and remove (action=1) are live in the original; DEPOSIT/STOLEN branches are dead/commented-out code in the VB6 source. `Account.Modem` reuses the same 1/2/3/4 status codes as `Meter.Status`. The modal now shows current status up front and disables whichever button doesn't apply (added after the user hit a confusing 409 error — this isn't a bug, it's the same guard the original enforces).
8. Expiry / תוקף (`components/ExpiryModal.tsx`, backend `POST /{taxi_nr}/expiry/reduce` and `/expiry/transfer`) — ports `frmChangeExp.frm`'s two modes: reduce this taxi's own service-credit months, or transfer months to another taxi. Password gate (`frmPasswordEnter`) intentionally not ported — no auth system exists anywhere in this app yet.
9. Account.Checks bug fix (`routers/bad_checks.py`) — the original's `cmdSave_Click` (repay path) never decremented `Accounts.checks`, only `cmdLost_Click` (write-off) did. This permanently blocked the meter-test-certificate print flow even after a check was fully repaid. Fixed as an **explicit, user-requested deviation** from the original (flagged in code comments, not silent).
10. Added a "מסופון" (modem) read-only status field to the account page, next to "אזור", showing live status via the existing `meterStatusLabel` helper.

Full itemized task list (26 items, #17 still open) is tracked in this session's task list — ask Claude to show it if picking this up fresh.

## Pending / open items

### #17 — Port Hashavshevet `movein.dat` export from reset (IN PROGRESS, blocked)
Needs correctly column-labeled real DB data for `ResetNr=33836` (Resets/Invoices/Checks/BadChecks rows) from the user — e.g. a "Copy with Headers" export or a `FOR JSON AUTO` query result, since a previous raw/unlabeled row sample was ambiguous. **No update from the user on this yet** — fully paused until that data arrives.

### Current live debugging thread — modem-action "not found" error
User reported: pressing "דיווח על התקנת מסופון" (install modem) returns "not found". Investigated thoroughly (routing, models, schemas, frontend request construction) — everything checks out identically to the working GET endpoint. Leading hypothesis: **the backend process running on the user's machine hasn't been restarted since the `/modem-action` and `/expiry/...` routes were added to `meter_actions.py` this session**, so it's a stale-server 404 (`{"detail":"Not Found"}`), not a code bug. Told the user to fully restart their uvicorn process and retry. **Waiting on confirmation** — if it still 404s after a clean restart, need the exact response body from the browser Network tab to dig further.

## Key technical reference (for the next session)

- **VB6 FindMode state machine**: `Account.frm`'s `txtTaxiNr_KeyPress` → `initTaxiWindow()` → FindMode cascade through meter-nr → family-name search. See `Account.tsx`'s `handleLookup`/`handleMeterLookup`/`handleNameSearch`.
- **`Expired(ExpiredDate)`** (`Main.bas`): ported as `_is_expired()` in `routers/invoices.py`.
- **`leftMonths`/`addMonths`/`reduceMonths`** (`frmChangeExp.frm`): `_left_months()` new in `routers/meter_actions.py`; `addMonths`/`reduceMonths` confirmed identical to pre-existing `_advance_exp_date()`/`_reduce_exp_date()` in `routers/invoices.py` — reused, not reimplemented.
- **Meter/Modem/Cova status codes**: ACTIVE=1, STOLEN=2, DEPOSIT=3, REMOVED=4 (`Main.bas`) — shared across `Meter.Status`, `Account.CovaStatus`, and `Account.Modem`. Frontend label helper: `meterStatusLabel()` in `Account.tsx`.
- **No auth system** anywhere in the web app yet — every VB6 password gate (`frmPasswordEnter`) is intentionally skipped, consistently flagged in docstrings.
- **Route ordering**: literal-path routes must be registered before single-dynamic-segment catch-all routes (`/{taxi_nr}`) in the same router, or the dynamic route swallows them first.

## Verification checklist before calling anything "done"

- [ ] Read the actual VB6 source for the feature being ported (don't guess)
- [ ] Backend: `py_compile` + SQLite smoke test for real logic
- [ ] Frontend: `npx tsc --noEmit -p .` clean
- [ ] Deviations/bugs/unrecoverable-content flagged in code comments, not silently changed
- [ ] Update the task list (#N) to completed
