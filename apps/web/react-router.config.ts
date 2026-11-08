import type { Config } from '@react-router/dev/config';

// Every screen is drawn on the server from the current release (docs/adr/0002-react-router-ssr.md): nothing is prerendered at build time.
export default {
  ssr: true,
  appDirectory: 'app',
  buildDirectory: 'build',
  future: { v8_viteEnvironmentApi: true },
} satisfies Config;
