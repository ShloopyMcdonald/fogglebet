'use client'

import { useFormStatus } from 'react-dom'
import { deleteArb } from '@/app/actions'

function DeleteButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-40 transition-colors px-2 py-1"
    >
      {pending ? '...' : 'Delete'}
    </button>
  )
}

export function DeleteArbButton({ arbId }: { arbId: string }) {
  const action = deleteArb.bind(null, arbId)
  return (
    <form action={action}>
      <DeleteButton />
    </form>
  )
}
