const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  use: { baseURL: 'http://localhost:8123' },
  webServer: {
    command: 'python -m http.server 8123 --directory ..',
    url: 'http://localhost:8123',
    reuseExistingServer: true,
  },
});
