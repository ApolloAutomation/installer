const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: 'http://localhost:8123',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'python -m http.server 8123 --directory ..',
    url: 'http://localhost:8123',
    // Locally a server you already run is reused; it must serve this checkout
    // (not another worktree), since the spec reads devices.json from disk.
    reuseExistingServer: !process.env.CI,
  },
});
