'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ShowcasePage from './showcase/page'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    // 检查是否已登录，如果已登录则直接跳转到 /home
    const accessCode = localStorage.getItem('access_code')
    if (accessCode) {
      router.push('/home')
    }
  }, [router])

  return <ShowcasePage />
}
