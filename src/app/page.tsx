'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ShowcasePage from './showcase/page'
import { getSupabaseBrowserClient } from '@/lib/supabase-browser'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    getSupabaseBrowserClient()
      .then((client) => client.auth.getSession())
      .then(({ data: { session } }) => {
        if (session) {
          router.push('/home')
        }
      })
      .catch(() => {})
  }, [router])

  return <ShowcasePage />
}
