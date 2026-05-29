const state = {
  niches: [],
  products: [],
  creatives: [],
  accounts: [],
  queue: [],
};

const $ = (selector) => document.querySelector(selector);

function toast(message, type = 'default') {
  const el = $('#toast');
  el.textContent = message;
  el.style.background = type === 'error' ? 'var(--danger)' : type === 'ok' ? 'var(--primary)' : 'var(--secondary)';
  el.classList.add('is-visible');
  setTimeout(() => el.classList.remove('is-visible'), 2400);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const error = new Error(data.error || `HTTP ${res.status}`);
    error.details = data.details;
    throw error;
  }
  return data;
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function badge(value) {
  const text = String(value || '-');
  const cls = /approved|published|rendered|active|scheduled|exported/.test(text)
    ? 'good'
    : /blocked|rejected|failed|disabled/.test(text)
      ? 'bad'
      : /revision|warming|waiting|draft/.test(text)
        ? 'warn'
        : '';
  return `<span class="badge ${cls}">${esc(text)}</span>`;
}

function fillNicheSelect(select, includeAll = false) {
  const options = includeAll ? '<option value="">Todos nichos</option>' : '<option value="">Sem nicho</option>';
  select.innerHTML = options + state.niches.map(n => `<option value="${esc(n.slug)}">${esc(n.name)}</option>`).join('');
}

async function loadNiches() {
  const data = await api('/api/niches');
  state.niches = data.niches || [];
  ['productNiche', 'accountNiche'].forEach(id => fillNicheSelect($(`#${id}`)));
  ['filterNiche'].forEach(id => fillNicheSelect($(`#${id}`), true));
}

async function loadProducts() {
  const params = new URLSearchParams();
  if ($('#filterNiche').value) params.set('niche', $('#filterNiche').value);
  if ($('#filterStatus').value) params.set('status', $('#filterStatus').value);
  if ($('#filterMinScore').value) params.set('min_score', $('#filterMinScore').value);
  params.set('sort', $('#filterSort').value || 'score');
  const data = await api(`/api/products?${params.toString()}`);
  state.products = data.products || [];
  renderProducts();
  renderProductCreativeFilter();
  renderPublisherOptions();
}

function renderProducts() {
  $('#productsTable').innerHTML = state.products.map(p => `
    <tr>
      <td><strong>${esc(p.name)}</strong><br><span class="muted">${esc(p.source || 'manual')}</span></td>
      <td>${esc(p.niche || '-')}</td>
      <td>${esc(money(p.old_price))}<br><strong>${esc(money(p.current_price))}</strong></td>
      <td>${Number(p.discount_pct || 0).toFixed(1)}%</td>
      <td><strong>${Number(p.score || 0).toFixed(1)}</strong></td>
      <td>${badge(p.status)}</td>
      <td>
        <div class="button-row">
          <button class="secondary" onclick="generateCampaign('${p.id}')">Gerar videos</button>
          <button class="secondary" onclick="setProductStatus('${p.id}', 'approved')">Aprovar</button>
          <button class="danger" onclick="setProductStatus('${p.id}', 'rejected')">Rejeitar</button>
        </div>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7">Nenhum produto importado.</td></tr>';
}

function renderProductCreativeFilter() {
  $('#creativeProductFilter').innerHTML = '<option value="">Todos produtos</option>' + state.products
    .map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
    .join('');
}

async function loadCreatives() {
  const productId = $('#creativeProductFilter').value;
  const query = productId ? `?product_id=${encodeURIComponent(productId)}` : '';
  const data = await api(`/api/creatives${query}`);
  state.creatives = data.creatives || [];
  renderCreatives();
  renderPublisherOptions();
}

function renderCreatives() {
  $('#creativesGrid').innerHTML = state.creatives.map(c => `
    <article class="creative-card">
      <h3>${esc(c.angle || 'Criativo')}</h3>
      <p><strong>Hook:</strong> ${esc(c.hook)}</p>
      <p>${esc(c.script)}</p>
      <p><strong>CTA:</strong> ${esc(c.cta || '-')}</p>
      <p>${badge(c.status)} ${badge(c.quality_status || 'quality pendente')} <span class="badge">${Number(c.quality_score || 0).toFixed(1)}</span></p>
      <div class="button-row">
        <button class="secondary" onclick="evaluateCreative('${c.id}')">Avaliar</button>
        <button class="secondary" onclick="improveCreative('${c.id}')">Melhorar</button>
        <button class="secondary" onclick="renderCreative('${c.id}')">Renderizar</button>
        <button class="primary" onclick="approveCreative('${c.id}')">Aprovar</button>
        <button class="danger" onclick="rejectCreative('${c.id}')">Rejeitar</button>
      </div>
    </article>
  `).join('') || '<div class="panel">Nenhum criativo gerado ainda.</div>';
}

async function loadAccounts() {
  const data = await api('/api/accounts');
  state.accounts = data.accounts || [];
  renderAccounts();
  renderPublisherOptions();
}

function renderAccounts() {
  $('#accountsTable').innerHTML = state.accounts.map(a => `
    <tr>
      <td>${esc(a.platform)}</td>
      <td><strong>${esc(a.handle)}</strong><br><span class="muted">${esc(a.display_name || '')}</span></td>
      <td>${esc(a.niche || '-')}</td>
      <td>${badge(a.status)}</td>
      <td>${Number(a.daily_limit || 0)}</td>
      <td>${esc(a.posting_mode)}</td>
      <td>
        <div class="button-row">
          <button class="secondary" onclick="pauseAccount('${a.id}')">Pausar</button>
          <button class="danger" onclick="deleteAccount('${a.id}')">Excluir</button>
        </div>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7">Nenhuma conta cadastrada.</td></tr>';
}

async function loadQueue() {
  const data = await api('/api/publisher/queue');
  state.queue = data.queue || [];
  $('#metricQueue').textContent = state.queue.length;
  renderQueue();
}

function renderPublisherOptions() {
  $('#publisherCreative').innerHTML = state.creatives.map(c => `<option value="${esc(c.id)}">${esc(c.hook || c.id)}</option>`).join('');
  $('#publisherAccount').innerHTML = state.accounts.map(a => `<option value="${esc(a.id)}">${esc(a.platform)} ${esc(a.handle)}</option>`).join('');
  const selected = state.creatives.find(c => c.id === $('#publisherCreative').value);
  if (selected) $('#publisherCaption').value = selected.caption || '';
}

function renderQueue() {
  $('#queueList').innerHTML = state.queue.map(q => `
    <div class="list-item">
      <strong>${esc(q.product_name || q.creative_id)}</strong>
      <span>${esc(q.platform || '')} ${esc(q.handle || '')} · ${badge(q.status)}</span>
      <div class="button-row">
        <button class="secondary" onclick="approveQueue('${q.id}')">Aprovar</button>
        <button class="primary" onclick="publishNow('${q.id}')">Publicar agora</button>
        <button class="danger" onclick="cancelQueue('${q.id}')">Cancelar</button>
      </div>
      ${q.error_message ? `<p class="muted">${esc(q.error_message)}</p>` : ''}
    </div>
  `).join('') || '<div class="list-item">Fila vazia.</div>';
}

async function loadSummary() {
  const data = await api('/api/analytics/summary');
  $('#metricProducts').textContent = data.total_products || 0;
  $('#metricCreatives').textContent = data.total_creatives || 0;
  $('#metricPosts').textContent = data.total_posts || 0;
  $('#metricClicks').textContent = data.total_clicks || 0;
  $('#metricBlocked').textContent = data.blocked_low_value_count || 0;
  $('#topCreativesList').innerHTML = (data.top_creatives || []).map(item => `
    <div class="list-item"><strong>${esc(item.hook || item.id)}</strong><span>${item.clicks || 0} cliques · score ${Number(item.quality_score || 0).toFixed(1)}</span></div>
  `).join('') || '<div class="list-item">Sem dados ainda.</div>';
  $('#clicksByNicheList').innerHTML = (data.clicks_by_niche || []).map(item => `
    <div class="list-item"><strong>${esc(item.niche || '-')}</strong><span>${item.clicks || 0} cliques</span></div>
  `).join('') || '<div class="list-item">Sem cliques ainda.</div>';
}

async function loadAnalyticsDetails() {
  const [products, accounts, creatives, niches] = await Promise.all([
    api('/api/analytics/products'),
    api('/api/analytics/accounts'),
    api('/api/analytics/creatives'),
    api('/api/analytics/niches'),
  ]);
  $('#analyticsProducts').innerHTML = (products.products || []).map(p => `<div class="list-item"><strong>${esc(p.name)}</strong><span>${p.clicks || 0} cliques · ${p.posts || 0} posts</span></div>`).join('') || '<div class="list-item">Sem dados.</div>';
  $('#analyticsAccounts').innerHTML = (accounts.accounts || []).map(a => `<div class="list-item"><strong>${esc(a.handle)}</strong><span>${a.platform} · ${a.clicks || 0} cliques</span></div>`).join('') || '<div class="list-item">Sem dados.</div>';
  $('#analyticsCreatives').innerHTML = (creatives.creatives || []).map(c => `<div class="list-item"><strong>${esc(c.hook || c.id)}</strong><span>${c.clicks || 0} cliques · ${c.quality_status || '-'}</span></div>`).join('') || '<div class="list-item">Sem dados.</div>';
  $('#analyticsNiches').innerHTML = (niches.niches || []).map(n => `<div class="list-item"><strong>${esc(n.niche || '-')}</strong><span>${n.products || 0} produtos · ${n.clicks || 0} cliques</span></div>`).join('') || '<div class="list-item">Sem dados.</div>';
}

async function refreshAll() {
  await loadNiches();
  await loadProducts();
  await loadCreatives();
  await loadAccounts();
  await loadQueue();
  await loadSummary();
}

window.generateCampaign = async (id) => {
  try {
    await api(`/api/products/${id}/generate-campaign`, { method: 'POST', body: JSON.stringify({ count: 7 }) });
    toast('Criativos gerados.', 'ok');
    await loadProducts();
    await loadCreatives();
    await loadSummary();
  } catch (error) { toast(error.message, 'error'); }
};

window.setProductStatus = async (id, status) => {
  try {
    await api(`/api/products/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    await loadProducts();
  } catch (error) { toast(error.message, 'error'); }
};

window.evaluateCreative = async (id) => {
  try {
    const accountId = state.accounts[0] && state.accounts[0].id;
    const result = await api('/api/content-quality/evaluate', { method: 'POST', body: JSON.stringify({ creative_id: id, account_id: accountId }) });
    toast(`Quality: ${result.status} ${result.final_score}`, result.status === 'blocked' ? 'error' : 'ok');
    await loadCreatives();
    await loadSummary();
  } catch (error) { toast(error.message, 'error'); }
};

window.improveCreative = async (id) => {
  try {
    await api(`/api/creatives/${id}/improve`, { method: 'POST', body: JSON.stringify({}) });
    toast('Rewrite aplicado.', 'ok');
    await loadCreatives();
  } catch (error) { toast(error.message, 'error'); }
};

window.renderCreative = async (id) => {
  try {
    await api(`/api/creatives/${id}/render`, { method: 'POST', body: JSON.stringify({}) });
    toast('Render concluido.', 'ok');
    await loadCreatives();
  } catch (error) { toast(error.message, 'error'); }
};

window.approveCreative = async (id) => {
  await api(`/api/creatives/${id}/approve`, { method: 'POST', body: JSON.stringify({}) });
  await loadCreatives();
};

window.rejectCreative = async (id) => {
  await api(`/api/creatives/${id}/reject`, { method: 'POST', body: JSON.stringify({}) });
  await loadCreatives();
};

window.pauseAccount = async (id) => {
  await api(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'paused' }) });
  await loadAccounts();
};

window.deleteAccount = async (id) => {
  await api(`/api/accounts/${id}`, { method: 'DELETE' });
  await loadAccounts();
};

window.approveQueue = async (id) => {
  await api(`/api/publisher/queue/${id}/approve`, { method: 'POST', body: JSON.stringify({}) });
  await loadQueue();
};

window.publishNow = async (id) => {
  try {
    const result = await api(`/api/publisher/queue/${id}/publish-now`, { method: 'POST', body: JSON.stringify({}) });
    toast(`Publicado/exportado: ${result.tracking_url}`, 'ok');
    await loadQueue();
    await loadSummary();
  } catch (error) { toast(error.message, 'error'); }
};

window.cancelQueue = async (id) => {
  await api(`/api/publisher/queue/${id}/cancel`, { method: 'POST', body: JSON.stringify({}) });
  await loadQueue();
};

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-button').forEach(button => {
    button.addEventListener('click', async () => {
      document.querySelectorAll('.nav-button').forEach(b => b.classList.remove('is-active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('is-active'));
      button.classList.add('is-active');
      $(`#${button.dataset.tab}`).classList.add('is-active');
      if (button.dataset.tab === 'analytics') await loadAnalyticsDetails();
      if (button.dataset.tab === 'publisher') await loadQueue();
    });
  });

  $('[data-action="refresh"]').addEventListener('click', refreshAll);
  $('#filterProductsBtn').addEventListener('click', (event) => { event.preventDefault(); loadProducts(); });
  $('#creativeProductFilter').addEventListener('change', loadCreatives);
  $('#publisherCreative').addEventListener('change', renderPublisherOptions);
  $('#refreshPublisherBtn').addEventListener('click', loadQueue);
  $('#refreshAnalyticsBtn').addEventListener('click', loadAnalyticsDetails);

  $('#importProductForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/products/import', {
        method: 'POST',
        body: JSON.stringify({
          name: $('#productName').value,
          niche: $('#productNiche').value,
          old_price: $('#productOldPrice').value,
          current_price: $('#productCurrentPrice').value,
          image_url: $('#productImage').value,
          affiliate_url: $('#productAffiliate').value,
          source: 'manual',
          metadata: {},
        }),
      });
      event.target.reset();
      toast('Produto importado.', 'ok');
      await loadProducts();
      await loadSummary();
    } catch (error) { toast(error.message, 'error'); }
  });

  $('#importProductBtn').addEventListener('click', () => $('#importProductForm').requestSubmit());

  $('#accountForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/accounts', {
        method: 'POST',
        body: JSON.stringify({
          platform: $('#accountPlatform').value,
          handle: $('#accountHandle').value,
          niche: $('#accountNiche').value,
          status: $('#accountStatus').value,
          daily_limit: $('#accountLimit').value,
          posting_mode: $('#accountMode').value,
          default_cta: $('#accountCta').value,
          style_prompt: $('#accountStyle').value,
        }),
      });
      event.target.reset();
      toast('Conta criada.', 'ok');
      await loadAccounts();
    } catch (error) { toast(error.message, 'error'); }
  });

  $('#createAccountBtn').addEventListener('click', () => $('#accountForm').requestSubmit());

  $('#qualityCheckBtn').addEventListener('click', async () => {
    try {
      const result = await api('/api/quality/check', {
        method: 'POST',
        body: JSON.stringify({
          creative_id: $('#publisherCreative').value,
          account_id: $('#publisherAccount').value,
          scheduled_at: $('#publisherScheduled').value,
          caption: $('#publisherCaption').value,
        }),
      });
      $('#qualityResult').textContent = JSON.stringify(result, null, 2);
    } catch (error) {
      $('#qualityResult').textContent = JSON.stringify({ error: error.message, details: error.details }, null, 2);
    }
  });

  $('#publisherForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/publisher/queue', {
        method: 'POST',
        body: JSON.stringify({
          creative_id: $('#publisherCreative').value,
          account_id: $('#publisherAccount').value,
          scheduled_at: $('#publisherScheduled').value,
          caption: $('#publisherCaption').value,
        }),
      });
      $('#qualityResult').textContent = JSON.stringify(result.guard, null, 2);
      toast('Item criado na fila.', 'ok');
      await loadQueue();
    } catch (error) {
      $('#qualityResult').textContent = JSON.stringify({ error: error.message, details: error.details }, null, 2);
      toast(error.message, 'error');
    }
  });

  $('#exportManualBtn').addEventListener('click', async () => {
    try {
      const result = await api('/api/publisher/export', {
        method: 'POST',
        body: JSON.stringify({
          creative_id: $('#publisherCreative').value,
          account_id: $('#publisherAccount').value,
        }),
      });
      $('#qualityResult').textContent = JSON.stringify(result, null, 2);
      toast('Pacote manual exportado.', 'ok');
    } catch (error) {
      $('#qualityResult').textContent = JSON.stringify({ error: error.message, details: error.details }, null, 2);
      toast(error.message, 'error');
    }
  });

  refreshAll().catch(error => toast(error.message, 'error'));
});
