import { Outlet } from 'react-router-dom'
import TopMenu from './TopMenu'
import StatusBar from './StatusBar'
import { useStatus } from '../context/StatusContext'

/**
 * Web equivalent of frmMain.frm.
 *
 * Not ported (no web equivalent / not needed):
 * - Form_Load / Form_Unload window position persistence (GetSetting/SaveSetting)
 *   — the browser owns window geometry.
 * - Form_Unload's "close all sub forms" loop — replaced by normal SPA routing,
 *   there's only ever one view mounted in the content area.
 *
 * Still pending (present in frmMain.frm but not yet wired up):
 * - dlgCommonDialog — the VB6 CommonDialog control for file open/save. Port this
 *   to a native <input type="file"> or the File System Access API once a menu
 *   action that needs it (e.g. Hashavshevet import/export) is migrated.
 */
export default function AppShell() {
  const { status } = useStatus()

  return (
    <div className="flex h-full flex-col">
      <TopMenu />
      <main className="flex-1 overflow-auto bg-white">
        <Outlet />
      </main>
      <StatusBar status={status} />
    </div>
  )
}
