'use client'

import { useState } from 'react'
import type { Bet } from '@/lib/supabase'
import { BetTable } from '@/components/BetTable'
import { TrainingTable } from '@/components/TrainingTable'

type Tab = 'taken' | 'training'

const TABS: { label: string; value: Tab }[] = [
  { label: 'Taken Bets', value: 'taken' },
  { label: 'Training Data', value: 'training' },
]

export function Dashboard({ takenBets }: { takenBets: Bet[] }) {
  const [tab, setTab] = useState<Tab>('taken')
  const [trainingEverOpened, setTrainingEverOpened] = useState(false)

  const handleTabClick = (value: Tab) => {
    setTab(value)
    if (value === 'training') setTrainingEverOpened(true)
  }

  return (
    <>
      <nav className="flex gap-1 border-b border-white/5 px-6">
        {TABS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => handleTabClick(value)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === value
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="px-4 py-6 max-w-6xl mx-auto w-full">
        <div className={tab === 'taken' ? '' : 'hidden'}>
          {takenBets.length === 0 ? (
            <div className="text-center py-24 text-zinc-500 text-sm">
              No taken bets yet. Use the Chrome extension on picktheodds.app to log your first bet.
            </div>
          ) : (
            <BetTable bets={takenBets} />
          )}
        </div>

        {trainingEverOpened && (
          <div className={tab === 'training' ? '' : 'hidden'}>
            <TrainingTable />
          </div>
        )}
      </main>
    </>
  )
}
