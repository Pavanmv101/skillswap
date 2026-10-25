import { createContext, useContext, useState } from 'react'
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token') || null)
  const [user,  setUser]  = useState(localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')) : null)

  function login(t, u) { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); setToken(t); setUser(u) }
  function logout()     { localStorage.removeItem('token'); localStorage.removeItem('user'); setToken(null); setUser(null) }

  return <AuthContext.Provider value={{ token, user, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() { return useContext(AuthContext) }
