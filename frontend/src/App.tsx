import { Routes, Route } from 'react-router-dom'
import AppShell from './components/AppShell'
import BranchAreaGate from './components/BranchAreaGate'
import { StatusProvider } from './context/StatusContext'
import Home from './pages/Home'
import Account from './pages/Account'

export default function App() {
  return (
    <BranchAreaGate>
      <StatusProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Home />} />
            <Route path="/account" element={<Account />} />
          </Route>
        </Routes>
      </StatusProvider>
    </BranchAreaGate>
  )
}
