import { Outlet } from 'react-router-dom'
import StatusBar from './StatusBar'
import { useStatus } from '../context/StatusContext'

/**
 * Hosts the status bar around whichever screen is routed in — no top menu
 * bar. frmMain.frm (Caption "Project1", the file this shell used to be
 * modeled on) is dead/unused template code never compiled into
 * Monitex2000.vbp (see WebCode/README.md) — its `mnuData > Account` menu
 * item is not real Monitex behavior, just a two-click detour to the app's
 * one real screen. Removed rather than kept as harmless chrome, since the
 * real Account.frm has no menu bar at all (0 `Begin VB.Menu` blocks) and
 * App.tsx now routes straight to it.
 *
 * Not ported (no web equivalent / not needed):
 * - Form_Load / Form_Unload window position persistence (GetSetting/SaveSetting)
 *   — the browser owns window geometry.
 * - Form_Unload's "close all sub forms" loop — replaced by normal SPA routing,
 *   there's only ever one view mounted in the content area.
 */
export default function AppShell() {
  const { status } = useStatus()

  return (
    <div className="flex h-full flex-col">
      <main className="flex-1 overflow-auto bg-white">
        <Outlet />
      </main>
      <StatusBar status={status} />
    </div>
  )
}
