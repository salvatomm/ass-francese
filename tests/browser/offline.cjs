// Offline: the service worker installs on the first visit (without reloading the page), then the app
// works with the network off. Routing must also answer the service worker's own requests:
// usage: PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node tests/browser/offline.cjs
const { chromium, devices } = require('playwright');
const { serveRepo, check, URL: U } = require('./serve.cjs');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], serviceWorkers: 'allow' });
  await serveRepo(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', e => check(false, `page error: ${e.message}`));
  let navs = 0;
  p.on('framenavigated', f => { if (f === p.mainFrame()) navs++; });
  await p.goto(U); await p.waitForSelector('.lesson');
  await p.evaluate(() => navigator.serviceWorker.ready);
  const [names, cached] = await p.evaluate(async () => {
    const ks = await caches.keys(); return [ks, (await (await caches.open(ks[0])).keys()).length]; });
  check(names.length === 1 && cached >= 11, `service worker active, ${cached} files in ${names[0]}`);
  await p.waitForTimeout(1500);
  check(navs === 1, 'first install did not reload the page');

  await ctx.unrouteAll(); await ctx.setOffline(true);
  await p.reload(); await p.waitForSelector('.lesson', { timeout: 8000 });
  check(await p.evaluate(() => !!navigator.serviceWorker.controller), `offline reload: ${await p.locator('.lesson').count()} lessons`);
  await p.goto(`${U}#/theory/1`); await p.waitForSelector('.theory', { timeout: 8000 });
  await p.goto(`${U}#/lesson/1`); await p.waitForSelector('.tile');
  await p.click('button[data-level="1"]'); await p.waitForSelector('section.ex');
  check(true, 'offline: theory page and an exercise session open');
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
