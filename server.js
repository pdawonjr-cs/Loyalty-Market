'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const readline = require('node:readline');

const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'localmarket.sqlite');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8080);
const APP_ORIGIN = new URL(process.env.APP_ORIGIN || `http://localhost:${PORT}`).origin;
const COOKIE_NAME = APP_ORIGIN.startsWith('https://') ? '__Host-lm_session' : 'lm_session';
const SESSION_SECONDS = 4 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 5;
const MAX_BODY_BYTES = 16 * 1024;
const ALLOWED_CATEGORIES = new Set(['produce', 'pantry', 'crafts', 'fashion', 'home']);
const ALLOWED_PAYMENTS = new Set(['Mobile money — confirm with seller', 'Cash on delivery — confirm with seller']);
const ALLOWED_STATUSES = new Set(['Verified', 'Declined']);
const loginFailures = new Map();

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be a valid TCP port.');
if (!APP_ORIGIN.startsWith('https://') && !['localhost', '127.0.0.1'].includes(HOST)) {
  throw new Error('Non-local deployments must set APP_ORIGIN to an HTTPS origin.');
}
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE, { timeout: 5000 });
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA trusted_schema = OFF;
  CREATE TABLE IF NOT EXISTS admins (
    email TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    csrf_token TEXT NOT NULL,
    admin_email TEXT NOT NULL REFERENCES admins(email) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    phone TEXT NOT NULL,
    category TEXT NOT NULL,
    area TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending review' CHECK(status IN ('Pending review','Verified','Declined')),
    created_at INTEGER NOT NULL,
    reviewed_at INTEGER
  ) STRICT;
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price INTEGER NOT NULL CHECK(price >= 0),
    unit TEXT NOT NULL,
    vendor_id TEXT REFERENCES vendors(id) ON DELETE SET NULL,
    sample_vendor TEXT,
    rating REAL NOT NULL DEFAULT 0,
    reviews INTEGER NOT NULL DEFAULT 0,
    emoji TEXT NOT NULL,
    background TEXT NOT NULL,
    badge TEXT NOT NULL,
    description TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  ) STRICT;
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    area TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    items_json TEXT NOT NULL,
    total INTEGER NOT NULL CHECK(total >= 0),
    status TEXT NOT NULL DEFAULT 'New' CHECK(status IN ('New','Confirmed','Fulfilled','Cancelled')),
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS vendors_status_idx ON vendors(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS orders_created_idx ON orders(created_at DESC);
`);

function seedProducts() {
  if (db.prepare('SELECT COUNT(*) AS count FROM products').get().count > 0) return;
  const file = path.join(ROOT, 'seed-products.json');
  const seeds = JSON.parse(fs.readFileSync(file, 'utf8'));
  const insert = db.prepare(`INSERT INTO products
    (id,name,category,price,unit,sample_vendor,rating,reviews,emoji,background,badge,description)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const p of seeds) insert.run(p.id,p.name,p.category,p.price,p.unit,p.sampleVendor,p.rating,p.reviews,p.emoji,p.background,p.badge,p.description);
}
seedProducts();

function json(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(body);
}
function fail(res, status, message) { json(res, status, { error: message }); }
function text(value, max, required = true) {
  if (typeof value !== 'string') throw new HttpError(400, 'Invalid request data.');
  const result = value.trim();
  if ((required && !result) || result.length > max) throw new HttpError(400, 'Invalid request data.');
  return result;
}
function validPhone(value) {
  const v = text(value, 40);
  if (!/^\+?[0-9 ()-]{7,40}$/.test(v)) throw new HttpError(400, 'Enter a valid phone number.');
  return v;
}
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

async function readJson(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON is required.');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw new HttpError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Invalid JSON request.'); }
}
function enforceOrigin(req) {
  if (req.headers.origin !== APP_ORIGIN) throw new HttpError(403, 'Request origin was not accepted.');
}
function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return '';
}
function sessionFor(req) {
  const token = cookieValue(req, COOKIE_NAME);
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare(`SELECT s.token_hash,s.csrf_token,s.admin_email,s.expires_at,a.email
    FROM sessions s JOIN admins a ON a.email=s.admin_email WHERE s.token_hash=?`).get(tokenHash);
  if (!row) return null;
  if (row.expires_at <= Date.now()) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash); return null; }
  return row;
}
function requireAdmin(req) {
  const session = sessionFor(req);
  if (!session) throw new HttpError(401, 'Please sign in again.');
  if (['POST','PATCH','PUT','DELETE'].includes(req.method)) {
    enforceOrigin(req);
    if (req.headers['x-csrf-token'] !== session.csrf_token) throw new HttpError(403, 'Security token expired. Please sign in again.');
  }
  return session;
}
function createSession(res, email) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now);
  db.prepare('INSERT INTO sessions(token_hash,csrf_token,admin_email,created_at,expires_at) VALUES(?,?,?,?,?)')
    .run(crypto.createHash('sha256').update(token).digest('hex'), csrf, email, now, now + SESSION_SECONDS * 1000);
  const secure = APP_ORIGIN.startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`);
  return csrf;
}
function clearSession(res, tokenHash) {
  if (tokenHash) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
  const secure = APP_ORIGIN.startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => {
    if (error) return reject(error);
    resolve(`scrypt$131072$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`);
  }));
}
function verifyPassword(password, encoded) {
  const [kind,n,r,p,salt64,key64] = encoded.split('$');
  if (kind !== 'scrypt' || n !== '131072' || r !== '8' || p !== '1') return Promise.resolve(false);
  const salt = Buffer.from(salt64, 'base64url');
  const expected = Buffer.from(key64, 'base64url');
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, expected.length, { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, actual) => {
    if (error) return reject(error);
    resolve(actual.length === expected.length && crypto.timingSafeEqual(actual, expected));
  }));
}
function rateLimitKey(req) { return String(req.socket.remoteAddress || 'unknown').slice(0, 80); }
function checkLoginLimit(key) {
  const item = loginFailures.get(key);
  if (!item) return;
  if (Date.now() >= item.resetAt) { loginFailures.delete(key); return; }
  if (item.count >= LOGIN_LIMIT) throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
}
function countLoginFailure(key) {
  const now = Date.now();
  if (loginFailures.size > 5000) {
    for (const [storedKey, value] of loginFailures) if (now >= value.resetAt) loginFailures.delete(storedKey);
  }
  const prior = loginFailures.get(key);
  if (!prior || now >= prior.resetAt) loginFailures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else prior.count++;
}

function productRows() {
  return db.prepare(`SELECT p.id,p.name,p.category,p.price,p.unit,
    COALESCE(v.name,p.sample_vendor) AS vendor,
    CASE WHEN v.status='Verified' THEN 1 ELSE 0 END AS verified,
    p.rating,p.reviews,p.emoji,p.background AS bg,p.badge,p.description AS desc
    FROM products p LEFT JOIN vendors v ON v.id=p.vendor_id WHERE p.active=1 ORDER BY p.id`).all();
}
function adminProductRows() {
  return db.prepare(`SELECT p.id,p.name,p.category,p.price,p.unit,COALESCE(v.name,p.sample_vendor) AS vendor,
    p.vendor_id,p.rating,p.reviews,p.emoji,p.background AS bg,p.badge,p.description AS "desc",p.active
    FROM products p LEFT JOIN vendors v ON v.id=p.vendor_id ORDER BY p.id`).all();
}
function adminVendorRows() {
  return db.prepare('SELECT id,name,contact,phone,category,area,description,status,created_at AS createdAt FROM vendors ORDER BY created_at DESC').all();
}
function adminOrderRows() {
  return db.prepare('SELECT id,customer_name AS name,phone,area,payment_method AS payment,items_json,total,status,created_at AS createdAt FROM orders ORDER BY created_at DESC LIMIT 500')
    .all().map(o => ({ ...o, items: JSON.parse(o.items_json), date: new Date(o.createdAt).toLocaleDateString() }));
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (req.method === 'GET' && p === '/api/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && p === '/api/products') return json(res, 200, { products: productRows() });

  if (req.method === 'POST' && p === '/api/orders') {
    enforceOrigin(req);
    const body = await readJson(req);
    const customerName = text(body.name, 100);
    const phone = validPhone(body.phone);
    const area = text(body.area, 140);
    const payment = text(body.payment, 80);
    if (!ALLOWED_PAYMENTS.has(payment) || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) throw new HttpError(400, 'Invalid order details.');
    const normalized = [];
    let total = 0;
    const productQuery = db.prepare('SELECT id,name,price,unit FROM products WHERE id=? AND active=1');
    for (const line of body.items) {
      if (!line || typeof line.id !== 'string' || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > 99) throw new HttpError(400, 'Invalid order items.');
      const product = productQuery.get(line.id);
      if (!product) throw new HttpError(400, 'One or more listings are no longer available.');
      total += product.price * line.qty;
      if (!Number.isSafeInteger(total)) throw new HttpError(400, 'Order total is out of range.');
      normalized.push({ id: product.id, name: product.name, price: product.price, unit: product.unit, qty: line.qty });
    }
    const id = `LM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    db.prepare('INSERT INTO orders(id,customer_name,phone,area,payment_method,items_json,total,status,created_at) VALUES(?,?,?,?,?,?,?,\'New\',?)')
      .run(id, customerName, phone, area, payment, JSON.stringify(normalized), total, Date.now());
    return json(res, 201, { id, total, status: 'New' });
  }

  if (req.method === 'POST' && p === '/api/vendor-applications') {
    enforceOrigin(req);
    const body = await readJson(req);
    const category = text(body.category, 40);
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO vendors(id,name,contact,phone,category,area,description,status,created_at) VALUES(?,?,?,?,?,?,?,\'Pending review\',?)')
      .run(id, text(body.shop,100), text(body.owner,100), validPhone(body.phone), category, text(body.area,140), text(body.description,1000), Date.now());
    return json(res, 201, { id, status: 'Pending review' });
  }

  if (req.method === 'POST' && p === '/api/admin/login') {
    enforceOrigin(req);
    const key = rateLimitKey(req);
    checkLoginLimit(key);
    const body = await readJson(req);
    const email = text(body.email, 254).toLowerCase();
    const password = body.password;
    if (typeof password !== 'string' || Buffer.byteLength(password) > 128 || password.length === 0) throw new HttpError(400, 'Invalid sign-in details.');
    const adminCount = db.prepare('SELECT COUNT(*) AS count FROM admins').get().count;
    if (!adminCount) throw new HttpError(503, 'Admin setup is required on the server.');
    const admin = db.prepare('SELECT email,password_hash FROM admins WHERE email=?').get(email);
    const fallback = admin || db.prepare('SELECT email,password_hash FROM admins ORDER BY created_at LIMIT 1').get();
    const valid = await verifyPassword(password, fallback.password_hash);
    if (!admin || !valid) { countLoginFailure(key); throw new HttpError(401, 'Email or password is incorrect.'); }
    loginFailures.delete(key);
    const csrfToken = createSession(res, admin.email);
    return json(res, 200, { email: admin.email, csrfToken });
  }

  if (req.method === 'GET' && p === '/api/admin/session') {
    const session = sessionFor(req);
    if (!session) return fail(res, 401, 'Please sign in.');
    return json(res, 200, { email: session.admin_email, csrfToken: session.csrf_token });
  }
  if (p.startsWith('/api/admin/')) requireAdmin(req);

  if (req.method === 'POST' && p === '/api/admin/logout') {
    const token = cookieValue(req, COOKIE_NAME);
    const tokenHash = token ? crypto.createHash('sha256').update(token).digest('hex') : null;
    clearSession(res, tokenHash);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && p === '/api/admin/overview') {
    const stats = {
      products: db.prepare('SELECT COUNT(*) AS count FROM products WHERE active=1').get().count,
      pendingVendors: db.prepare("SELECT COUNT(*) AS count FROM vendors WHERE status='Pending review'").get().count,
      orders: db.prepare('SELECT COUNT(*) AS count FROM orders').get().count
    };
    return json(res, 200, { stats, pending: adminVendorRows().filter(v => v.status === 'Pending review').slice(0,4) });
  }
  if (req.method === 'GET' && p === '/api/admin/vendors') return json(res, 200, { vendors: adminVendorRows() });
  if (req.method === 'GET' && p === '/api/admin/orders') return json(res, 200, { orders: adminOrderRows() });
  if (req.method === 'GET' && p === '/api/admin/products') return json(res, 200, { products: adminProductRows() });

  let match = p.match(/^\/api\/admin\/vendors\/([0-9a-f-]{36})$/i);
  if (req.method === 'PATCH' && match) {
    const body = await readJson(req);
    if (!ALLOWED_STATUSES.has(body.status)) throw new HttpError(400, 'Invalid vendor status.');
    const result = db.prepare('UPDATE vendors SET status=?,reviewed_at=? WHERE id=?').run(body.status, Date.now(), match[1]);
    if (!result.changes) throw new HttpError(404, 'Vendor application not found.');
    return json(res, 200, { id: match[1], status: body.status });
  }
  match = p.match(/^\/api\/admin\/orders\/([A-Z0-9-]{6,40})$/);
  if (req.method === 'PATCH' && match) {
    const body = await readJson(req);
    if (!['Confirmed','Fulfilled','Cancelled'].includes(body.status)) throw new HttpError(400, 'Invalid order status.');
    const result = db.prepare("UPDATE orders SET status=? WHERE id=? AND status!='Cancelled'").run(body.status, match[1]);
    if (!result.changes) throw new HttpError(404, 'Order was not found or can no longer be changed.');
    return json(res, 200, { id: match[1], status: body.status });
  }
  if (req.method === 'DELETE' && p.startsWith('/api/admin/products/')) {
    const id = p.slice('/api/admin/products/'.length);
    if (!/^[A-Za-z0-9-]{1,60}$/.test(id)) throw new HttpError(400, 'Invalid listing identifier.');
    const result = db.prepare('UPDATE products SET active=0 WHERE id=? AND active=1').run(id);
    if (!result.changes) throw new HttpError(404, 'Listing not found.');
    return json(res, 200, { id, removed: true });
  }
  if (req.method === 'POST' && p === '/api/admin/products') {
    const body = await readJson(req);
    const name = text(body.name, 100);
    const category = text(body.category, 40);
    if (!ALLOWED_CATEGORIES.has(category)) throw new HttpError(400, 'Choose a valid category.');
    const price = Number(body.price);
    if (!Number.isSafeInteger(price) || price < 1 || price > 100000000) throw new HttpError(400, 'Enter a valid price in Liberian dollars.');
    const unit = text(body.unit, 40);
    const vendorId = text(body.vendorId, 60);
    const vendor = db.prepare("SELECT id FROM vendors WHERE id=? AND status='Verified'").get(vendorId);
    if (!vendor) throw new HttpError(400, 'Choose an approved vendor.');
    const emoji = text(body.emoji || '🧺', 8);
    const description = text(body.description, 500);
    const id = `l-${crypto.randomUUID()}`;
    const background = ({produce:'linear-gradient(145deg,#b9d58f,#679250)',pantry:'linear-gradient(145deg,#dfd8a2,#b2c879)',crafts:'linear-gradient(145deg,#e5bd83,#bb8054)',fashion:'linear-gradient(145deg,#a7cee1,#6465a6)',home:'linear-gradient(145deg,#c9dcaa,#789656)'})[category];
    db.prepare(`INSERT INTO products(id,name,category,price,unit,vendor_id,rating,reviews,emoji,background,badge,description)
      VALUES(?,?,?,?,?,?,0,0,?,?,?,?)`).run(id,name,category,price,unit,vendorId,emoji,background,'New listing',description);
    return json(res, 201, { id });
  }
  throw new HttpError(404, 'Not found.');
}

const mimeTypes = new Map([['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.css','text/css; charset=utf-8'],['.json','application/json; charset=utf-8'],['.webmanifest','application/manifest+json; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png'],['.ico','image/x-icon']]);
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
}
async function serveStatic(req, res, url) {
  if (!['GET','HEAD'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');
  let requested;
  try { requested = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Invalid path.'); }
  if (requested === '/') requested = '/index.html';
  if (requested.startsWith('/api/') || requested.split('/').includes('data')) throw new HttpError(404, 'Not found.');
  const filePath = path.resolve(ROOT, `.${requested}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new HttpError(404, 'Not found.');
  const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}
const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);
  try {
    const url = new URL(req.url, APP_ORIGIN);
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error('Request failed:', error.message);
    json(res, status, { error: status === 500 ? 'The server could not complete that request.' : error.message });
  }
});

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}
function askSecret(question) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') throw new Error('Run this command in an interactive terminal so the password can be entered without echo.');
  return new Promise(resolve => {
    process.stdout.write(question);
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    let value = '';
    function finish(result) {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdout.write('\n');
      resolve(result);
    }
    function onKey(key, info) {
      if (info.name === 'return' || info.name === 'enter') return finish(value);
      if (info.name === 'c' && info.ctrl) { process.stdout.write('\n'); process.exit(130); }
      if (info.name === 'backspace') { value = value.slice(0, -1); return; }
      if (info.sequence && !info.ctrl && !info.meta && Buffer.byteLength(value + info.sequence) <= 128) value += info.sequence;
    }
    process.stdin.on('keypress', onKey);
    process.stdin.resume();
  });
}
async function adminCli(command) {
  const admins = db.prepare('SELECT COUNT(*) AS count FROM admins').get().count;
  if (command === 'create-admin' && admins) throw new Error('An admin already exists. Use reset-admin-password to change it.');
  if (command === 'reset-admin-password' && !admins) throw new Error('No admin exists. Run create-admin first.');
  const email = (admins ? db.prepare('SELECT email FROM admins ORDER BY created_at LIMIT 1').get().email : await ask('Admin email: ')).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.');
  const password = await askSecret('New admin password (minimum 14 characters): ');
  if (Buffer.byteLength(password) < 14 || Buffer.byteLength(password) > 128) throw new Error('Password must be 14 to 128 bytes.');
  const confirm = await askSecret('Confirm new admin password: ');
  if (password !== confirm) throw new Error('Passwords do not match.');
  const encoded = await passwordHash(password);
  const now = Date.now();
  if (admins) {
    db.prepare('UPDATE admins SET password_hash=? WHERE email=?').run(encoded,email);
    db.prepare('DELETE FROM sessions WHERE admin_email=?').run(email);
    console.log('Admin password updated. Existing sessions were signed out.');
  } else {
    db.prepare('INSERT INTO admins(email,password_hash,created_at) VALUES(?,?,?)').run(email,encoded,now);
    console.log('Admin account created.');
  }
}

const command = process.argv[2];
if (command === 'create-admin' || command === 'reset-admin-password') {
  adminCli(command).then(() => { db.close(); }).catch(error => { console.error(error.message); db.close(); process.exitCode = 1; });
} else if (command) {
  console.error('Usage: node server.js [create-admin|reset-admin-password]');
  db.close();
  process.exitCode = 2;
} else {
  server.listen(PORT, HOST, () => console.log(`LocalMarket server listening at ${APP_ORIGIN}`));
}
