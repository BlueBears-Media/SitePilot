import { redirect } from 'next/navigation'

export default function StoragePage() {
  redirect('/settings?section=connections')
}
