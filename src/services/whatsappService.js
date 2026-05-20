const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, MessageType } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
const pino = require('pino');
const path = require('path');

let sock = null;
let qrCodeDataUrl = null;
let qrCodeRaw = null;
let connectionStatus = 'disconnected'; // 'disconnected' | 'qr_ready' | 'connected'
let lastConnectedAt = null;
const readyCallbacks = [];

const AUTH_FOLDER = path.join(__dirname, '../../.wwebjs_auth');

function onReady(callback) {
  if (typeof callback !== 'function') return;
  readyCallbacks.push(callback);
  // Se já está conectado, dispara imediatamente
  if (connectionStatus === 'connected') {
    Promise.resolve().then(() => callback()).catch(err => console.error('[WhatsApp onReady] callback error:', err.message));
  }
}

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }), // silencia logs internos do Baileys
    auth: state,
    printQRInTerminal: false, // Gerenciamos o QR manualmente
    browser: ['OffersBot', 'Chrome', '3.0'],
    connectTimeoutMs: 30000,
    keepAliveIntervalMs: 10000,
  });

  // Evento de credenciais (salva sessão automaticamente)
  sock.ev.on('creds.update', saveCreds);

  // Evento principal de conexão
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Novo QR Code gerado
    if (qr) {
      connectionStatus = 'qr_ready';
      qrCodeRaw = qr;
      console.log('\n[WhatsApp] 📱 Escaneie o QR Code abaixo com seu WhatsApp:');
      qrcodeTerminal.generate(qr, { small: true });

      // Gera versão em base64 para o painel web
      qrCodeDataUrl = await qrcode.toDataURL(qr);
      console.log('[WhatsApp] QR Code disponível em: http://localhost:3000/api/whatsapp/qr\n');
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      
      connectionStatus = 'disconnected';
      console.log(`[WhatsApp] Conexão encerrada. Motivo: ${statusCode}. Reconectando: ${shouldReconnect}`);
      
      if (shouldReconnect) {
        setTimeout(startWhatsApp, 5000); // Reconecta após 5 segundos
      } else {
        console.log('[WhatsApp] ⚠️ Sessão encerrada (logout). Apague a pasta .wwebjs_auth e reinicie para gerar novo QR Code.');
      }
    }

    if (connection === 'open') {
      connectionStatus = 'connected';
      qrCodeDataUrl = null;
      qrCodeRaw = null;
      lastConnectedAt = Date.now();
      console.log('[WhatsApp] ✅ Conectado com sucesso!');

      // Lista todos os grupos para mapeamento
      try { await listGroups(); } catch (e) {}

      // Aciona todos os callbacks registrados (ex: dispatcher imediato)
      for (const cb of readyCallbacks) {
        try {
          await cb();
        } catch (err) {
          console.error('[WhatsApp onReady] callback error:', err.message);
        }
      }
    }
  });
}

// Lista todos os grupos do WhatsApp com nome e ID
async function listGroups() {
  try {
    if (!sock) return [];
    const groups = await sock.groupFetchAllParticipating();

    console.log('\n[WhatsApp] 📋 LISTA DE GRUPOS (copie os IDs para cadastrar):');
    console.log('─'.repeat(60));
    const list = Object.values(groups).map(g => ({ id: g.id, name: g.subject }));
    list.forEach(g => {
      console.log(`Nome: ${g.name}`);
      console.log(`ID:   ${g.id}`);
      console.log('─'.repeat(60));
    });
    console.log('[WhatsApp] Total de grupos:', list.length, '\n');
    return list;
  } catch (err) {
    console.error('[WhatsApp] Erro ao listar grupos:', err.message);
    return [];
  }
}

// Envia mensagem de texto + imagem opcional para um grupo
async function sendWhatsAppMessage(groupId, text, imageUrl = null) {
  if (!sock || connectionStatus !== 'connected') {
    console.warn('[WhatsApp] ⚠️ Bot não está conectado. Mensagem ignorada.');
    return false;
  }

  try {
    const jid = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`;

    if (imageUrl && !imageUrl.startsWith('data:image')) {
      // Envia imagem com legenda (caption)
      await sock.sendMessage(jid, {
        image: { url: imageUrl },
        caption: text
      });
    } else {
      // Envia apenas texto
      await sock.sendMessage(jid, { text });
    }

    console.log(`[WhatsApp] ✅ Mensagem enviada para ${groupId}`);
    return true;
  } catch (err) {
    console.error(`[WhatsApp] ❌ Erro ao enviar para ${groupId}:`, err.message);
    return false;
  }
}

function getStatus() {
  return connectionStatus;
}

function getQrCode() {
  return qrCodeDataUrl;
}

function getQrCodeRaw() {
  return qrCodeRaw;
}

function getLastConnectedAt() {
  return lastConnectedAt;
}

module.exports = {
  startWhatsApp,
  sendWhatsAppMessage,
  listGroups,
  getStatus,
  getQrCode,
  getQrCodeRaw,
  getLastConnectedAt,
  onReady
};
