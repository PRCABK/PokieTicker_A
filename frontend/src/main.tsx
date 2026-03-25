import { createRoot } from 'react-dom/client'
import axios from 'axios'
import './index.css'
import App from './App.tsx'

function normalizeApiBaseUrl(value?: string): string {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === '/') {
    return ''
  }
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

axios.defaults.baseURL = normalizeApiBaseUrl(
  import.meta.env.VITE_API_BASE_URL || import.meta.env.BASE_URL,
)

createRoot(document.getElementById('root')!).render(
  <App />,
)
