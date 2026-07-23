'use client'

import { TakenTable } from '@/components/TakenTable'
import { deleteTodaysBets } from '@/app/actions'

export function Dashboard() {
  const handleDeleteToday = async () => {
    if (!window.confirm("Delete all bets recorded today? This can't be undone.")) return
    await deleteTodaysBets()
  }

  return (
    <>
      <nav className="flex items-center gap-1 border-b border-white/5 px-6">
        <span className="px-4 py-2.5 text-sm font-medium text-white border-b-2 border-emerald-500 -mb-px">
          Taken Bets
        </span>
        <div className="ml-auto">
          <button
            onClick={handleDeleteToday}
            className="text-xs text-zinc-600 hover:text-red-400 transition-colors px-2 py-1"
          >
            Delete today's bets
          </button>
        </div>
      </nav>

      <main className="px-4 py-6 max-w-6xl mx-auto w-full">
        <TakenTable />
      </main>
    </>
  )
}
