import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { localGtfsPlugin } from './server/gtfs/local.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localGtfsPlugin()],
  server: {
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.data/**', '**/GTFS_TCL.ZIP', '**/data/gtfs/**'] },
  },
})
