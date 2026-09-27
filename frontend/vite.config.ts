import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Listen on all network interfaces, not just localhost, so a browser on
    // another machine on the LAN (e.g. a Windows branch PC) can reach this
    // dev server via the Mac's LAN IP — needed to test anything, like the
    // print bridge, that depends on the browser actually running on that
    // remote machine. The /api proxy below still runs server-side on the
    // Mac regardless of which machine's browser is asking, so no CORS
    // changes are needed for this.
    host: true,
    // Vite rejects requests with an unrecognized Host header by default (DNS
    // rebinding protection) — needed here because the app is sometimes
    // reached through an ngrok tunnel (e.g. while debugging Tailscale
    // connectivity to a remote branch PC), which arrives with a
    // *.ngrok-free.app Host header instead of the Mac's own hostname/IP. A
    // leading "." allows the whole subdomain, so a fresh ngrok URL (a new
    // random subdomain every restart on the free tier) keeps working without
    // editing this file again.
    allowedHosts: ['.ngrok-free.app'],
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
