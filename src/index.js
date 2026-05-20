require('dotenv').config();
const app = require('./server');
const cron = require('node-cron');
const { runJobs, dispatchNextRound, queues } = require('./jobs/offerJob');
const { runAggregator } = require('./services/offerAggregator');
const {
  startWhatsApp,
  getStatus,
  getQrCode,
  getQrCodeRaw,
  getLastConnectedAt,
  listGroups,
  onReady,
  getSessionInfo,
  clearSession,
} = require('./services/whatsappService');
const { runWhatsAppWorker } = require('./jobs/whatsappJob');
const { exec } = require('child_process');

const PORT = process.env.PORT || 3000;

// ─── Trava de execução concorrente ────────────────────────────────────────────
let aggregatorRunning = false;
let dispatcherRunning = false;
let workerRunning = false;

async function safeRunAggregator() {
  if (aggregatorRunning) {
    console.log('[Aggregator] ⏸️  Já em execução. Pulando este tick.');
    return;
  }
  aggregatorRunning = true;
  try { await runAggregator(); } catch (e) { console.error('[Aggregator] ❌', e.message); }
  finally { aggregatorRunning = false; }
}

async function safeRunDispatcher() {
  if (dispatcherRunning) return;
  dispatcherRunning = true;
  try { await dispatchNextRound(); } catch (e) { console.error('[Dispatcher] ❌', e.message); }
  finally { dispatcherRunning = false; }
}

async function safeRunWorker() {
  if (workerRunning) return;
  workerRunning = true;
  try { await runWhatsAppWorker(); } catch (e) { console.error('[WhatsApp Worker] ❌', e.message); }
  finally { workerRunning = false; }
}

// ─── Rotas da API do WhatsApp ─────────────────────────────────────────────────

app.get('/api/whatsapp/status', (req, res) => {
  res.json({
    status: getStatus(),
    connectedAt: getLastConnectedAt(),
    hasQr: !!getQrCode(),
  });
});

app.get('/api/whatsapp/qr.json', (req, res) => {
  res.json({
    status: getStatus(),
    qr: getQrCode() || null,
    raw: getQrCodeRaw() || null,
  });
});

app.get('/api/whatsapp/qr', (req, res) => {
  const qr = getQrCode();
  if (!qr) {
    const status = getStatus();
    if (status === 'connected') {
      return res.send('<h2 style="font-family:sans-serif;color:green">✅ WhatsApp já está conectado!</h2>');
    }
    return res.send('<h2 style="font-family:sans-serif;color:orange">⏳ Aguardando QR Code... Recarregue a página em alguns segundos.</h2>');
  }
  res.send(`
    <html><body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#111;color:#fff">
      <h2>📱 Escaneie com seu WhatsApp</h2>
      <img src="${qr}" style="width:300px;border-radius:12px;border:4px solid #25D366"/>
      <p style="color:#aaa">Abra o WhatsApp > Menu > Aparelhos Conectados > Conectar um aparelho</p>
      <script>setTimeout(()=>location.reload(), 8000)</script>
    </body></html>
  `);
});

app.get('/api/whatsapp/groups', async (req, res) => {
  if (getStatus() !== 'connected') {
    return res.status(400).json({ error: 'WhatsApp não conectado ainda.' });
  }
  const list = await listGroups();
  res.json({ groups: list || [] });
});

// Informações sobre a sessão salva (debug + UI)
app.get('/api/whatsapp/session-info', (req, res) => {
  res.json(getSessionInfo());
});

// Limpa sessão manualmente (regera QR Code). Use só se quiser trocar de número.
app.post('/api/whatsapp/logout', async (req, res) => {
  const ok = await clearSession();
  res.json({ success: ok, message: ok ? 'Sessão limpa. Novo QR Code sendo gerado.' : 'Erro ao limpar sessão.' });
});

// Endpoints de controle manual a partir do dashboard
app.post('/api/dispatch-now', async (req, res) => {
  // Dispara aggregator (se a RAM estiver baixa) → dispatcher → worker em background
  res.json({ message: 'Ciclo manual iniciado: aggregator → dispatcher → worker.' });
  (async () => {
    await safeRunAggregator();
    await safeRunDispatcher();
    await safeRunWorker();
  })();
});

app.post('/api/aggregator-now', async (req, res) => {
  res.json({ message: 'Aggregator iniciado em background.' });
  safeRunAggregator();
});

app.post('/api/worker-now', async (req, res) => {
  res.json({ message: 'Worker WhatsApp iniciado em background.' });
  safeRunWorker();
});

app.get('/api/queues-status', (req, res) => {
  const snapshot = {};
  for (const cat of Object.keys(queues)) {
    snapshot[cat] = (queues[cat] || []).length;
  }
  res.json({ queues: snapshot, total: Object.values(snapshot).reduce((a, b) => a + b, 0) });
});

// Retorna todos os produtos atualmente nas gavetas RAM, com detalhes completos
app.get('/api/queues-detailed', (req, res) => {
  const detailed = {};
  for (const cat of Object.keys(queues)) {
    detailed[cat] = (queues[cat] || []).map(p => ({
      name: p.name,
      currentPrice: p.currentPrice,
      oldPrice: p.oldPrice,
      discount: p.discount,
      image: p.image,
      affiliateLink: p.affiliateLink,
      category: p.category,
      keywordSource: p.keywordSource,
      score: p.score,
    }));
  }
  res.json({ queues: detailed });
});

// ─── Inicialização do Servidor ─────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);

  // Abrir o painel no navegador automaticamente (Windows)
  if (process.platform === 'win32') {
    try { exec(`start http://localhost:${PORT}`); } catch (e) {}
  }

  // Agendamento opcional para checar arquivos em horários específicos
  cron.schedule('0 9,18 * * *', () => {
    console.log('Executando cronjob diário de leitura de ofertas locais...');
    runJobs();
  });

  // Aggregator: a cada 3 min, mantém as gavetas RAM cheias
  cron.schedule('*/3 * * * *', () => {
    console.log('Executando orquestrador de garimpo...');
    safeRunAggregator();
  });

  // Dispatcher: a cada 2 min, despacha 1 oferta por nicho (RAM → DB queue + Telegram)
  cron.schedule('*/2 * * * *', () => {
    safeRunDispatcher();
  });

  // WhatsApp Worker: a cada 2 min, drena DB queue → WhatsApp (se conectado)
  cron.schedule('*/2 * * * *', () => {
    safeRunWorker();
  });

  console.log('Sistema inicializado e aguardando ofertas.');

  // 1) Sempre dispara o aggregator para começar a encher as gavetas
  console.log('Iniciando a primeira orquestração para encher as gavetas imediatamente...');
  safeRunAggregator();

  // 2) Inicia WhatsApp (gera QR)
  console.log('[WhatsApp] Iniciando conexão... Acesse http://localhost:' + PORT + '/api/whatsapp/qr para escanear o QR Code.');
  startWhatsApp().catch(err => console.error('[WhatsApp] Erro ao iniciar:', err.message));

  // 3) Quando o WhatsApp conectar, força um ciclo completo de catch-up
  onReady(async () => {
    console.log('[Boot] 🚀 WhatsApp conectou. Disparando ciclo de catch-up...');
    // Garante que existem produtos nas gavetas RAM
    await safeRunAggregator();
    // Despacha 1 por nicho RAM→DB (e Telegram)
    await safeRunDispatcher();
    // Drena DB → WhatsApp
    await safeRunWorker();
    console.log('[Boot] ✅ Catch-up inicial concluído.');
  });
});
