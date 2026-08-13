import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface MenuItem {
  label: string
  onSelect: () => void
}

interface MenuDef {
  label: string
  items: MenuItem[]
}

export default function TopMenu() {
  const navigate = useNavigate()
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // VB6 source: Begin VB.Menu mnuData "&Data" > mnuDataAccount "Account"
  // Add new top-level menus / items here as more .frm menu blocks are ported.
  const menus: MenuDef[] = [
    {
      label: 'Data',
      items: [{ label: 'Account', onSelect: () => navigate('/account') }],
    },
  ]

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [])

  return (
    <div ref={rootRef} className="flex h-10 items-stretch bg-shell-bar text-xl text-slate-100 select-none">
      {menus.map((menu) => (
        <div key={menu.label} className="relative flex">
          <button
            type="button"
            className={`px-4 transition-colors hover:bg-shell-barhover focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sky-400 ${
              openMenu === menu.label ? 'bg-shell-barhover' : ''
            }`}
            aria-haspopup="menu"
            aria-expanded={openMenu === menu.label}
            onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
          >
            {menu.label}
          </button>

          {openMenu === menu.label && (
            <div
              role="menu"
              className="absolute left-0 top-full z-20 min-w-[10rem] border border-shell-statusborder bg-white py-1 text-slate-800 shadow-lg"
            >
              {menu.items.map((item) => (
                <button
                  key={item.label}
                  role="menuitem"
                  type="button"
                  className="block w-full px-4 py-1.5 text-left hover:bg-slate-100 focus:outline-none focus-visible:bg-slate-100"
                  onClick={() => {
                    item.onSelect()
                    setOpenMenu(null)
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
