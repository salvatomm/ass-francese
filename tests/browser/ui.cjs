// UI walk-through on a phone viewport; screenshots go to the folder given as argument.
// usage: node tests/browser/ui.cjs /tmp/shots
const { chromium, devices } = require('playwright');
const { serveRepo, URL: U } = require('./serve.cjs');
const OUT = process.argv[2] || '.';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
  await serveRepo(ctx);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  const shot = n => p.screenshot({ path: `${OUT}/${n}.png` });
  await p.goto(U); await p.waitForSelector('.lesson');
  console.log('lessons on home:', await p.locator('.lesson').count());
  await shot('1-home');
  await p.click('a[href="#/lesson/1"]'); await p.waitForSelector('.tile'); await shot('2-lesson');
  await p.click('a[href="#/theory/1"]'); await p.waitForSelector('.theory'); await shot('3-theory');
  await p.goto(U + '#/lesson/1'); await p.waitForSelector('.tile');
  await p.click('button[data-level="2"]'); await p.waitForSelector('section.ex');
  const seen = {};
  for (let i = 0; i < 10; i++) {
    const type = await p.getAttribute('section.ex', 'data-type').catch(() => null);
    if (!type) break;
    seen[type] = (seen[type] || 0) + 1;
    if (type === 'mcq') await p.click('.opt >> nth=0');
    else if (type === 'flash') { await p.click('[data-act=reveal]'); await p.click('[data-act=self][data-s="0"]'); continue; }
    else if (type === 'order') { const n = await p.locator('.bank .tilew').count(); for (let k = 0; k < n; k++) await p.locator('.bank .tilew').first().click(); await p.click('[data-act=check]'); }
    else { await p.fill('#ans', i % 2 ? 'je ne sais pas' : 'bonjour'); await p.click('[data-act=check]'); }
    await p.waitForSelector('#fb:not([hidden])');
    if (i === 1) await shot('4-feedback');
    await p.click('#next');
  }
  console.log('types seen:', JSON.stringify(seen));
  await shot('5-after');
  await p.goto(U + '#/mistakes'); await p.waitForSelector('.mlist'); await shot('6-mistakes');
  console.log('mistakes listed:', await p.locator('.mlist li').count());
  await p.goto(U + '#/stats'); await p.waitForSelector('.stats'); await shot('7-stats');
  await p.goto(U + '#/'); await p.waitForSelector('.lesson');
  await p.click('[data-act=go][data-to="#/mistakes"]'); await p.waitForSelector('.mlist');
  await p.click('button[data-mode=mistakes]'); await p.waitForSelector('section.ex'); await shot('8-mistake-session');
  await p.goto(U + '#/lesson/1'); await p.waitForSelector('.tile');
  await p.click('button[data-level="flash"]'); await p.waitForSelector('section.ex'); await p.click('[data-act=reveal]'); await shot('9-flash');
  await p.goto(U + '#/settings'); await p.waitForSelector('.form'); await shot('10-settings');
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
  if (errs.length) process.exit(1);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
