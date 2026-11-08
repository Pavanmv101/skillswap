import axios from 'axios'

// In production, uses VITE_API_URL (e.g. https://skillswap-backend.onrender.com/api)
// In local development, falls back to '/api' handled by Vite dev proxy
const baseURL = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({
  baseURL,
  timeout: 15000, // 15-second request timeout to prevent indefinite hangs
})

api.interceptors.request.use(c => {
  const t = localStorage.getItem('token')
  if (t) c.headers.Authorization = `Bearer ${t}`
  return c
})

api.interceptors.response.use(
  r => r,
  err => {
    // Produce a user-friendly message for timeout and network errors
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      err.message = 'Request timed out. The server may be starting up — please try again in a moment.'
    } else if (!err.response && err.message === 'Network Error') {
      err.message = 'Unable to reach the server. Please check your connection and try again.'
    }

    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

export default api
