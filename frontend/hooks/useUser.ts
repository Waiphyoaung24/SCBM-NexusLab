import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'

export interface User {
  id: string
  name: string
}

export function useUser() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check localStorage on load
    const storedId = localStorage.getItem('bill_splitter_user_id')
    const storedName = localStorage.getItem('bill_splitter_user_name')

    if (storedId && storedName) {
      setUser({ id: storedId, name: storedName })
    }
    setLoading(false)
  }, [])

  const registerUser = (name: string) => {
    const newId = uuidv4()
    localStorage.setItem('bill_splitter_user_id', newId)
    localStorage.setItem('bill_splitter_user_name', name)
    setUser({ id: newId, name })
  }

  return { user, loading, registerUser }
}