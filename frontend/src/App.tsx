import { Routes, Route } from 'react-router-dom'
import AppShell from './components/AppShell'
import BranchAreaGate from './components/BranchAreaGate'
import { StatusProvider } from './context/StatusContext'
import Account from './pages/Account'

// The real Monitex app is just Account.frm — a single button-driven screen
// with NO menu bar at all (0 `Begin VB.Menu` blocks, confirmed by reading
// the .frm — see WebCode/README.md). It's the app's only real screen, so
// it's what "/" renders directly now — no more landing/menu step in front
// of it. "/account" is kept as an alias in case anything still links there.
export default function App() {
  return (
    <BranchAreaGate>
      <StatusProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Account />} />
            <Route path="/account" element={<Account />} />
          </Route>
        </Routes>
      </StatusProvider>
    </BranchAreaGate>
  )
}
