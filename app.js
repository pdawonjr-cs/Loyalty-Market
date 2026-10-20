'use strict';

const categories = [
  { id: 'all', name: 'Everything', icon: '🧺' },
  { id: 'produce', name: 'Fresh produce', icon: '🥬' },
  { id: 'pantry', name: 'Pantry', icon: '🌾' },
  { id: 'crafts', name: 'Arts & crafts', icon: '🧵' },
  { id: 'fashion', name: 'Fashion', icon: '👗' },
  { id: 'home', name: 'Home & living', icon: '🏺' }
];

const loadCart = () => {
  try {
    const value = JSON.parse(localStorage.getItem('lm-cart') || '[]');
    return Array.isArray(value) ? value.filter(x => x && typeof x.id === 'string' && Number.isInteger(x.qty) && x.qty > 0 && x.qty <= 99) : [];
  } catch { return []; }
};
let products = [];
let cart = loadCart();
let activeCategory = 'all';
let adminTab = 'overview';
let csrfToken = '';
let verifiedVendors = [];
let marketplaceConfig = { mode: 'preview', intakeOpen: false, ordersOpen: false, publicContactEmail: '', dataRetentionDays: null };
const modal = document.getElementById('modal');
const backdrop = document.getElementById('modalBackdrop');

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  const request = { method, credentials: 'same-origin', cache: 'no-store', headers };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(options.body);
  }
  if (!['GET','HEAD'].includes(method) && csrfToken && path.startsWith('/api/admin/')) headers['X-CSRF-Token'] = csrfToken;
  let response;
  try { response = await fetch(path, request); }
  catch { throw new ApiError(0, 'Cannot reach LocalMarket right now. Check the server and try again.'); }
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new ApiError(response.status, data.error || 'The request could not be completed.');
  return data;
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
const money = value => '$LRD ' + Number(value).toLocaleString('en-US');
function saveCart() { localStorage.setItem('lm-cart', JSON.stringify(cart)); }
function toast(message) {
  const element = document.getElementById('toast');
  element.textContent = message;
  element.classList.add('show');
  setTimeout(() => element.classList.remove('show'), 2600);
}
function showModal(html, wide = false) {
  modal.className = 'modal' + (wide ? ' modal-wide' : '');
  modal.innerHTML = html;
  backdrop.classList.add('open');
  modal.querySelector('input,button,select,textarea')?.focus();
}
function closeModal() {
  backdrop.classList.remove('open');
  modal.innerHTML = '';
}
function updateCartCount() {
  document.getElementById('cartCount').textContent = cart.reduce((sum, item) => sum + item.qty, 0);
}

function renderCategories() {
  document.getElementById('categories').innerHTML = categories.map(category =>
    `<button class="category ${activeCategory === category.id ? 'active' : ''}" data-action="category" data-id="${category.id}"><span class="category-icon">${category.icon}</span><span class="category-name">${category.name}</span></button>`
  ).join('');
}

function renderProducts() {
  const query = document.getElementById('search').value.toLowerCase().trim();
  const list = products.filter(product => (activeCategory === 'all' || product.category === activeCategory) &&
    (!query || `${product.name} ${product.vendor} ${product.desc}`.toLowerCase().includes(query)));
  document.getElementById('productsHeading').textContent = activeCategory === 'all' ? 'Popular near you' : (categories.find(c => c.id === activeCategory)?.name || 'Popular near you');
  document.getElementById('products').innerHTML = list.map(product => {
    const check = product.verified ? '<span class="vendor-check">✓ Verified</span>' : '<span>Preview seller</span>';
    const rating = product.reviews ? `<div class="rating">★ ${esc(product.rating)} <span style="color:var(--muted)">(${esc(product.reviews)})</span></div>` : '<div class="rating">No reviews yet</div>';
    const add = marketplaceConfig.ordersOpen && product.verified
      ? `<button class="quick-add" data-action="add" data-id="${esc(product.id)}">+ Add</button>`
      : `<span class="quick-add" aria-label="Not available to order">${product.verified ? 'Orders soon' : 'Example'}</span>`;
    return `<article class="product" data-product-id="${esc(product.id)}" tabindex="0"><div class="product-photo" style="background:${esc(product.bg)}"><small>${esc(product.badge || 'Local listing')}</small><span>${esc(product.emoji)}</span><button class="heart" data-action="favorite" aria-label="Save ${esc(product.name)}">♡</button></div><div class="product-info"><div class="vendor-line">${esc(product.vendor)} ${check} <span>· ${esc(product.area)}</span></div><h3>${esc(product.name)}</h3><div class="product-foot"><div><div class="price">${money(product.price)}</div>${rating}</div>${add}</div></div></article>`;
  }).join('');
  document.getElementById('noProducts').hidden = list.length > 0;
  if (!list.length) {
    const noListings = marketplaceConfig.mode === 'pilot' && products.length === 0;
    document.getElementById('noProductsTitle').textContent = noListings ? 'First listings are on the way' : 'No matches yet';
    document.getElementById('noProductsMessage').textContent = noListings
      ? 'We are onboarding verified local vendors. Check back soon.'
      : 'Try another search or category.';
  }
}

async function loadProducts() {
  try {
    const [config, data] = await Promise.all([api('/api/config'), api('/api/products')]);
    marketplaceConfig = config;
    products = data.products;
    cart = marketplaceConfig.ordersOpen ? cart.filter(item => products.some(product => product.id === item.id && product.verified)) : [];
    saveCart();
    updateCartCount();
    document.getElementById('marketStatus').textContent = marketplaceConfig.mode === 'pilot' ? 'Community pilot' : 'Preview mode · sample listings';
    document.getElementById('previewHeroArt').hidden = marketplaceConfig.mode === 'pilot';
    document.getElementById('productsIntro').textContent = marketplaceConfig.mode === 'pilot'
      ? 'Listings from vendors reviewed by the LocalMarket team.'
      : 'Examples help illustrate the idea; they are not real offers and cannot be ordered.';
    document.getElementById('siteNotice').textContent = marketplaceConfig.ordersOpen
      ? 'Community pilot · order requests are confirmed by phone; no payment is collected here.'
      : 'Preview mode · example listings are not real offers and cannot be ordered.';
    renderProducts();
  } catch (error) {
    document.getElementById('products').innerHTML = '';
    document.getElementById('noProducts').hidden = false;
    document.getElementById('noProductsTitle').textContent = 'Marketplace is unavailable';
    document.getElementById('noProductsMessage').textContent = 'Start the server and refresh this page.';
    toast(error.message);
  }
}

function filterCategory(id) {
  activeCategory = categories.some(category => category.id === id) ? id : 'all';
  renderCategories();
  renderProducts();
  document.getElementById('shop').scrollIntoView({ behavior: 'smooth' });
}
function clearFilter() {
  activeCategory = 'all';
  document.getElementById('search').value = '';
  renderCategories();
  renderProducts();
}
function addToCart(id) {
  const product = products.find(item => item.id === id);
  if (!product || !marketplaceConfig.ordersOpen || !product.verified) return;
  const item = cart.find(entry => entry.id === id);
  if (item) item.qty = Math.min(99, item.qty + 1);
  else cart.push({ id, qty: 1 });
  saveCart();
  updateCartCount();
  toast('Added to your basket');
}

function openCart() {
  if (!marketplaceConfig.ordersOpen) {
    showModal(`<div class="modal-head"><div><h2>Shopping basket</h2><p class="modal-sub">Order requests are not open yet.</p></div><button class="close" data-action="close">×</button></div><p class="notice">This is a preview. The example listings are not real offers and you cannot place an order yet.</p><button class="btn btn-primary wide" data-action="close">Keep browsing</button>`);
    return;
  }
  const rows = cart.map(item => ({ ...item, product: products.find(product => product.id === item.id) })).filter(item => item.product);
  const total = rows.reduce((sum, item) => sum + item.product.price * item.qty, 0);
  showModal(`<div class="modal-head"><div><h2>Your basket</h2><p class="modal-sub">${rows.reduce((sum, item) => sum + item.qty, 0)} item(s)</p></div><button class="close" data-action="close">×</button></div>${rows.length ? `<div class="cart-list">${rows.map(item => `<div class="cart-item"><span class="cart-emoji">${esc(item.product.emoji)}</span><div class="cart-item-info"><b>${esc(item.product.name)}</b><small>${money(item.product.price)} · ${esc(item.product.unit)}</small></div><div class="qty"><button data-action="quantity" data-id="${esc(item.id)}" data-delta="-1">−</button>${item.qty}<button data-action="quantity" data-id="${esc(item.id)}" data-delta="1">+</button></div></div>`).join('')}</div><div class="cart-total"><span>Subtotal</span><span>${money(total)}</span></div><p style="font-size:11px;color:var(--muted)">Delivery is arranged with the vendor and confirmed at checkout.</p><button class="btn btn-primary wide" data-action="checkout">Continue to checkout →</button>` : `<div class="empty"><div style="font-size:38px">🛍️</div><strong>Your basket is waiting</strong>Add something lovely from a local seller.</div><button class="btn btn-primary wide" data-action="close">Keep browsing</button>`}`);
}
function changeQty(id, delta) {
  const item = cart.find(row => row.id === id);
  if (item) {
    item.qty += delta;
    if (item.qty < 1) cart = cart.filter(row => row.id !== id);
  }
  saveCart();
  updateCartCount();
  openCart();
}
function checkout() {
  if (!marketplaceConfig.ordersOpen || !cart.length) return;
  const total = cart.reduce((sum, item) => sum + (products.find(product => product.id === item.id)?.price || 0) * item.qty, 0);
  showModal(`<div class="modal-head"><div><h2>Request this order</h2><p class="modal-sub">The LocalMarket team will contact you by phone to confirm availability, payment, and delivery.</p></div><button class="close" data-action="cart">×</button></div><form data-form="checkout"><div class="field"><label>Your name</label><input required name="name" autocomplete="name" maxlength="100" placeholder="Full name"></div><div class="form-row"><div class="field"><label>Phone number</label><input required name="phone" type="tel" maxlength="40" placeholder="+231 77…"></div><div class="field"><label>Delivery area</label><input required name="area" maxlength="140" placeholder="Paynesville, Monrovia…"></div></div><div class="field"><label>Payment preference</label><select name="payment"><option>Mobile money — confirm with seller</option><option>Cash on delivery — confirm with seller</option></select></div><div class="cart-total"><span>Order total</span><span>${money(total)}</span></div><div class="notice">Submitting sends your name, phone number, area, and order details to LocalMarket for manual confirmation. No payment is taken and delivery is not arranged here.</div><label class="privacy-consent"><input required type="checkbox" name="privacyAccepted"> I have read the <a href="privacy.html" target="_blank" rel="noopener">privacy policy</a> and agree to this information being used for my order request. It is deleted after ${esc(marketplaceConfig.dataRetentionDays)} days.</label><button class="btn btn-primary wide" type="submit">Send order request</button></form>`);
}
async function submitOrder(form) {
  const data = new FormData(form);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await api('/api/orders', { method: 'POST', body: {
      name: data.get('name'), phone: data.get('phone'), area: data.get('area'), payment: data.get('payment'),
      privacyAccepted: data.get('privacyAccepted') === 'on',
      items: cart.map(item => ({ id: item.id, qty: item.qty }))
    }});
    cart = [];
    saveCart();
    updateCartCount();
    showModal(`<div class="modal-head"><h2>Order request received 🎉</h2><button class="close" data-action="close">×</button></div><p class="modal-sub">Your request <b>${esc(result.id)}</b> is saved securely for the marketplace team. No payment was collected.</p><button class="btn btn-primary wide" data-action="close">Back to the market</button>`);
  } catch (error) {
    button.disabled = false;
    toast(error.message);
  }
}

function openProduct(id) {
  const product = products.find(item => item.id === id);
  if (!product) return;
  const verification = product.verified ? 'Verified local seller' : 'Preview sample — seller not verified';
  const rating = product.reviews ? `★ ${esc(product.rating)} (${esc(product.reviews)} reviews)` : 'No reviews yet';
  const orderAction = marketplaceConfig.ordersOpen && product.verified
    ? `<button class="btn btn-primary wide" data-action="add-close" data-id="${esc(product.id)}">Add to basket</button>`
    : '<p class="notice">Preview example only. This listing is not available to order.</p>';
  showModal(`<div class="modal-head"><span class="eyebrow" style="color:var(--green)">${esc(verification)}</span><button class="close" data-action="close">×</button></div><div class="detail-layout"><div class="detail-art" style="background:${esc(product.bg)}">${esc(product.emoji)}</div><div class="detail-copy"><div class="vendor-line">${esc(product.vendor)} · ${esc(product.area)}</div><h2>${esc(product.name)}</h2><div class="rating">${rating}</div><p>${esc(product.desc)}</p><div class="detail-price">${money(product.price)} <small style="font-size:12px;color:var(--muted);font-weight:500">/ ${esc(product.unit)}</small></div>${orderAction}</div></div>`, true);
}
function openVendor() {
  if (!marketplaceConfig.intakeOpen) {
    const contact = marketplaceConfig.publicContactEmail
      ? ` You can contact the team at <a href="mailto:${esc(marketplaceConfig.publicContactEmail)}">${esc(marketplaceConfig.publicContactEmail)}</a> to learn about the pilot.`
      : '';
    showModal(`<div class="modal-head"><div><h2>Vendor applications are opening soon</h2><p class="modal-sub">We are preparing the privacy, backup, and review process before collecting contact information.</p></div><button class="close" data-action="close">×</button></div><p class="notice">No application details are collected on this site right now.${contact}</p><button class="btn btn-primary wide" data-action="close">Close</button>`);
    return;
  }
  showModal(`<div class="modal-head"><div><h2>Sell with LocalMarket</h2><p class="modal-sub">Tell us about your business. Our team will review your application.</p></div><button class="close" data-action="close">×</button></div><form data-form="vendor"><div class="field"><label>Business or shop name</label><input name="shop" required maxlength="100" placeholder="Your business name"></div><div class="form-row"><div class="field"><label>Your name</label><input name="owner" required maxlength="100" placeholder="Full name"></div><div class="field"><label>Phone / WhatsApp</label><input name="phone" type="tel" maxlength="40" required placeholder="+231 …"></div></div><div class="form-row"><div class="field"><label>Category</label><select name="category"><option>Fresh produce</option><option>Pantry</option><option>Arts & crafts</option><option>Fashion</option><option>Home & living</option><option>Other</option></select></div><div class="field"><label>Town or community</label><input name="area" maxlength="140" required placeholder="e.g. Monrovia"></div></div><div class="field"><label>What do you sell?</label><textarea name="description" maxlength="1000" required placeholder="Briefly describe your products"></textarea></div><div class="notice">We use these details to review your application. Pending or declined applications are deleted after ${esc(marketplaceConfig.dataRetentionDays)} days.</div><label class="privacy-consent"><input required type="checkbox" name="privacyAccepted"> I have read the <a href="privacy.html" target="_blank" rel="noopener">privacy policy</a> and agree to my details being used for this application. Privacy contact: <a href="mailto:${esc(marketplaceConfig.publicContactEmail)}">${esc(marketplaceConfig.publicContactEmail)}</a>.</label><button class="btn btn-primary wide" type="submit">Submit vendor application</button></form>`);
}
async function submitVendorApplication(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  values.privacyAccepted = values.privacyAccepted === 'on';
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/vendor-applications', { method: 'POST', body: values });
    showModal(`<div class="modal-head"><h2>Application submitted</h2><button class="close" data-action="close">×</button></div><p class="modal-sub">Thanks, ${esc(values.owner)}. Your application for ${esc(values.shop)} is saved for staff review.</p><button class="btn btn-primary wide" data-action="close">Done</button>`);
  } catch (error) {
    button.disabled = false;
    toast(error.message);
  }
}

function openAdmin() {
  csrfToken = '';
  showModal(`<div class="modal-head"><div><h2>Marketplace admin</h2><p class="modal-sub">Sign in to manage LocalMarket Liberia.</p></div><button class="close" data-action="close">×</button></div><form data-form="admin-login"><div class="field"><label>Admin email</label><input required type="email" name="email" autocomplete="username" maxlength="254" placeholder="Admin email"></div><div class="field"><label>Password</label><input required type="password" name="password" autocomplete="current-password" maxlength="128" placeholder="Enter password"></div><button class="btn btn-primary wide" type="submit">Sign in</button></form><div class="notice">The server stores a one-way password hash and issues a short-lived, HTTP-only session. Create the first admin from the server terminal.</div>`);
}
async function adminLogin(form) {
  const data = new FormData(form);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await api('/api/admin/login', { method: 'POST', body: { email: data.get('email'), password: data.get('password') }});
    csrfToken = result.csrfToken;
    adminTab = 'overview';
    await adminDashboard();
  } catch (error) {
    button.disabled = false;
    toast(error.message);
  }
}
function vendorRow(vendor) {
  const controls = vendor.status === 'Pending review'
    ? `<button class="mini-btn" data-action="vendor-status" data-id="${esc(vendor.id)}" data-status="Verified">Approve</button><button class="mini-btn danger" data-action="vendor-status" data-id="${esc(vendor.id)}" data-status="Declined">Decline</button>`
    : `<span class="mini-btn ${vendor.status === 'Declined' ? 'danger' : ''}">${esc(vendor.status)}</span>`;
  return `<div class="admin-row"><div><b>${esc(vendor.name)}</b><small>${esc(vendor.contact)} · ${esc(vendor.category)} · ${esc(vendor.phone)}</small><small>${esc(vendor.area)} · Status: ${esc(vendor.status)}</small></div><div class="admin-actions">${controls}</div></div>`;
}
function orderRow(order) {
  const next = order.status === 'New' ? 'Confirmed' : order.status === 'Confirmed' ? 'Fulfilled' : '';
  const action = next ? `<button class="mini-btn" data-action="order-status" data-id="${esc(order.id)}" data-status="${next}">Mark ${next}</button>` : '';
  return `<div class="admin-row"><div><b>${esc(order.id)} · ${esc(order.name)}</b><small>${esc(order.area)} · ${esc(order.phone)} · ${esc(order.items.map(item => `${item.qty}× ${item.name}`).join(', '))}</small><small>${money(order.total)} · ${esc(order.payment)} · ${esc(order.date)}</small></div><div class="admin-actions"><span class="mini-btn ${order.status === 'Cancelled' ? 'danger' : ''}">${esc(order.status)}</span>${action}</div></div>`;
}

async function adminDashboard() {
  try {
    const session = await api('/api/admin/session');
    csrfToken = session.csrfToken;
  } catch {
    openAdmin();
    return;
  }
  let content = '';
  try {
    if (adminTab === 'overview') {
      const data = await api('/api/admin/overview');
      content = `<div class="admin-stats"><div class="stat"><small>Active listings</small><b>${data.stats.products}</b></div><div class="stat"><small>Vendor applications</small><b>${data.stats.pendingVendors} pending</b></div><div class="stat"><small>Order requests</small><b>${data.stats.orders}</b></div></div><div class="notice">Data is stored on this server. Order requests are not payments; staff must confirm stock and delivery.</div><h3 style="color:var(--forest);font-size:14px;margin:18px 0 7px">Recent vendor applications</h3>${data.pending.length ? `<div class="admin-list">${data.pending.map(vendorRow).join('')}</div>` : '<div class="empty">No applications waiting for review.</div>'}`;
    } else if (adminTab === 'vendors') {
      const data = await api('/api/admin/vendors');
      verifiedVendors = data.vendors.filter(vendor => vendor.status === 'Verified');
      content = `<div class="admin-list">${data.vendors.map(vendorRow).join('') || '<div class="empty">No vendor applications yet.</div>'}</div>`;
    } else if (adminTab === 'orders') {
      const data = await api('/api/admin/orders');
      content = `<div class="admin-list">${data.orders.map(orderRow).join('') || '<div class="empty">No order requests yet.</div>'}</div>`;
    } else if (adminTab === 'products') {
      const [productData, vendorData] = await Promise.all([api('/api/admin/products'), api('/api/admin/vendors')]);
      verifiedVendors = vendorData.vendors.filter(vendor => vendor.status === 'Verified');
      content = `<form class="admin-shell" data-form="product"><h3 style="color:var(--forest);font-size:14px;margin:0 0 8px">Add a listing</h3>${verifiedVendors.length ? `<div class="form-row"><div class="field"><label>Product name</label><input name="name" required maxlength="100"></div><div class="field"><label>Approved vendor</label><select name="vendorId" required>${verifiedVendors.map(vendor => `<option value="${esc(vendor.id)}">${esc(vendor.name)}</option>`).join('')}</select></div></div><div class="form-row"><div class="field"><label>Category</label><select name="category"><option value="produce">Fresh produce</option><option value="pantry">Pantry</option><option value="crafts">Arts & crafts</option><option value="fashion">Fashion</option><option value="home">Home & living</option></select></div><div class="field"><label>Price in LRD</label><input name="price" type="number" min="1" max="100000000" required></div><div class="field"><label>Unit</label><input name="unit" maxlength="40" required placeholder="basket, each…"></div></div><div class="form-row"><div class="field"><label>Emoji</label><input name="emoji" maxlength="8" value="🧺"></div><div class="field"><label>Description</label><input name="description" maxlength="500" required></div></div><button class="btn btn-primary" type="submit">Add listing</button>` : '<div class="notice">Approve a vendor application before adding a live listing.</div>'}</form><div class="admin-list">${productData.products.filter(product => product.active).map(product => `<div class="admin-row"><div><b>${esc(product.emoji)} ${esc(product.name)}</b><small>${esc(product.vendor)} · ${money(product.price)}${product.verified ? ' · Verified seller' : ' · Preview sample'}</small></div><div class="admin-actions"><button class="mini-btn danger" data-action="remove-product" data-id="${esc(product.id)}">Remove</button></div></div>`).join('') || '<div class="empty">No active listings.</div>'}</div>`;
    }
  } catch (error) {
    if (error.status === 401) { openAdmin(); return; }
    toast(error.message);
    return;
  }
  showModal(`<div class="modal-head"><div><h2>Admin workspace</h2><p class="modal-sub">LocalMarket Liberia · Server-managed</p></div><button class="close" data-action="close">×</button></div><div class="admin-shell"><div class="admin-tabs">${[['overview','Overview'],['vendors','Vendors'],['orders','Orders'],['products','Products']].map(([id,label]) => `<button class="${adminTab === id ? 'active' : ''}" data-action="admin-tab" data-id="${id}">${label}</button>`).join('')}</div>${content}<button class="text-link" style="margin-top:15px" data-action="logout">Sign out</button></div>`, true);
}

async function runAdminAction(button) {
  const action = button.dataset.action;
  const id = button.dataset.id;
  button.disabled = true;
  try {
    if (action === 'vendor-status') await api(`/api/admin/vendors/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: button.dataset.status } });
    if (action === 'order-status') await api(`/api/admin/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: button.dataset.status } });
    if (action === 'remove-product') await api(`/api/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await adminDashboard();
  } catch (error) {
    if (error.status === 401) { openAdmin(); return; }
    button.disabled = false;
    toast(error.message);
  }
}
async function addProduct(form) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form).entries());
    values.price = Number(values.price);
    await api('/api/admin/products', { method: 'POST', body: values });
    adminTab = 'products';
    await loadProducts();
    await adminDashboard();
    toast('Listing added');
  } catch (error) {
    button.disabled = false;
    toast(error.message);
  }
}
async function logout() {
  try { await api('/api/admin/logout', { method: 'POST', body: {} }); }
  catch (error) { if (error.status !== 401) toast(error.message); }
  csrfToken = '';
  closeModal();
}

function onClick(event) {
  const control = event.target.closest('[data-action]');
  if (control) {
    const action = control.dataset.action;
    if (action === 'home') return window.scrollTo({ top: 0, behavior: 'smooth' });
    if (action === 'shop') return document.getElementById('shop').scrollIntoView({ behavior: 'smooth' });
    if (action === 'sell') return openVendor();
    if (action === 'cart') return openCart();
    if (action === 'admin') return openAdmin();
    if (action === 'close') return closeModal();
    if (action === 'clear') return clearFilter();
    if (action === 'category') return filterCategory(control.dataset.id);
    if (action === 'add') return addToCart(control.dataset.id);
    if (action === 'add-close') { addToCart(control.dataset.id); return closeModal(); }
    if (action === 'favorite') { control.textContent = control.textContent === '♡' ? '♥' : '♡'; return; }
    if (action === 'quantity') return changeQty(control.dataset.id, Number(control.dataset.delta));
    if (action === 'checkout') return checkout();
    if (action === 'admin-tab') { adminTab = control.dataset.id; return adminDashboard(); }
    if (action === 'logout') return logout();
    if (['vendor-status','order-status','remove-product'].includes(action)) return runAdminAction(control);
  }
  if (event.target === backdrop) return closeModal();
  const product = event.target.closest('[data-product-id]');
  if (product) openProduct(product.dataset.productId);
}

async function onSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  if (form.dataset.form === 'checkout') await submitOrder(form);
  else if (form.dataset.form === 'vendor') await submitVendorApplication(form);
  else if (form.dataset.form === 'admin-login') await adminLogin(form);
  else if (form.dataset.form === 'product') await addProduct(form);
}

document.addEventListener('click', onClick);
document.addEventListener('submit', onSubmit);
document.getElementById('search').addEventListener('input', renderProducts);
document.getElementById('logo')?.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') window.scrollTo({ top: 0, behavior: 'smooth' });
});
renderCategories();
updateCartCount();
loadProducts();

