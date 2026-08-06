'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ShowcasePage from './showcase/page'
import { getSupabaseBrowserClient } from '@/lib/supabase-browser'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    // 检查是否已登录，如果已登录则直接跳转到 /home
    const accessCode = localStorage.getItem('access_code')
    if (accessCode) {
      router.push('/home')
      return
    }
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
