// Browser tests run without a web server: requests to https://app.test/ are answered from the repo on disk.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const URL_ = 'https://app.test/';

function fromDisk(route) {
  let f = new URL(route.request().url()).pathname;
  if (f.endsWith('/')) f += 'index.html';
  const fp = path.join(ROOT, f);
  if (!fs.existsSync(fp)) return route.fulfill({ status: 404, body: 'not found' });
  route.fulfill({ status: 200, contentType: TYPES[path.extname(fp)] || 'application/octet-stream', body: fs.readFileSync(fp) });
}
const serveRepo = ctx => ctx.route(`${URL_}**`, fromDisk);
const check = (ok, msg) => { if (!ok) { console.error('FAIL', msg); process.exit(1); } console.log('ok  ', msg); };

module.exports = { serveRepo, check, URL: URL_ };
