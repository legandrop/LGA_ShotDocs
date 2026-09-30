// Two-device concurrency lab (Yjs 14 prototype). Not part of `npm test`: npx vitest run -c vitest.ylab.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['src/ylab/**/*.lab.ts'], testTimeout: 600000 },
});
