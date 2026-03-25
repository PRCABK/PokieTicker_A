import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function normalizeBasePath(value?: string): string {
  const trimmed = value?.trim()
  if (!trimmed || trimmed === '/') {
    return '/'
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const appBase = normalizeBasePath(env.VITE_APP_BASE)
  const apiTarget = env.VITE_API_TARGET || 'http://127.0.0.1:8000'
  const prefixedApiPath = appBase === '/' ? '/api' : `${appBase.slice(0, -1)}/api`
  const proxy: Record<
    string,
    {
      target: string
      changeOrigin: boolean
      secure: boolean
      rewrite?: (path: string) => string
    }
  > = {
    '/api': {
      target: apiTarget,
      changeOrigin: true,
      secure: true,
    },
  }

  if (prefixedApiPath !== '/api') {
    proxy[prefixedApiPath] = {
      target: apiTarget,
      changeOrigin: true,
      secure: true,
      rewrite: (path) =>
        path.replace(new RegExp(`^${escapeRegex(appBase.slice(0, -1))}`), ''),
    }
  }

  return {
    base: appBase,
    plugins: [react()],
    server: {
      port: 7777,
      proxy,
    },
  }
})
