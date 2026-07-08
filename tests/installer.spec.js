const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'devices.json'), 'utf8'));

test('hub renders a card for every registry device', async ({ page }) => {
  await page.goto('/');
  for (const d of registry.devices) {
    await expect(page.locator(`a.device-card[href="#/${d.id}"] h3`)).toHaveText(d.name);
  }
});

test('category filter narrows the grid', async ({ page }) => {
  await page.goto('/');
  const cat = registry.devices[0].category;
  const inCat = registry.devices.filter((d) => d.category === cat).length;
  await page.locator(`.filters button[data-cat="${cat}"]`).click();
  await expect(page.locator('a.device-card:visible')).toHaveCount(inCat);
  await page.locator('.filters button[data-cat="all"]').click();
  await expect(page.locator('a.device-card:visible')).toHaveCount(registry.devices.length);
});
