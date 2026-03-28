'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { label: 'Taken Bets', href: '/' },
  { label: 'Training Data', href: '/training' },
]

export function TabNav() {
  const pathname = usePathname()

  return (
    <nav className="flex gap-1 border-b border-white/5 px-6">
      {TABS.map(({ label, href }) => {
        const active = pathname === href
        return (
          <Link
            key={href}
            href={href}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              active
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
