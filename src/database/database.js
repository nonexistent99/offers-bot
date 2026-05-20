const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

let dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/database.sqlite');
if (!path.isAbsolute(dbPath)) {
  dbPath = path.resolve(__dirname, '../../', dbPath);
}
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Promise externa que só resolve quando o DB está pronto + tabelas criadas + migrações aplicadas
let resolveReady;
let rejectReady;
const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao conectar ao banco de dados:', err.message);
    rejectReady(err);
  } else {
    console.log('Conectado ao banco de dados SQLite.');
    initDb()
      .then(() => {
        console.log('[SQLite] ✅ Inicialização completa (tabelas + migrações + seed).');
        resolveReady();
      })
      .catch(err => {
        console.error('[SQLite] ❌ Falha na inicialização:', err.message);
        rejectReady(err);
      });
  }
});

function runSync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err); else resolve(this);
    });
  });
}

function getSync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err); else resolve(rows);
    });
  });
}

async function initDb() {
  // 1. CREATE TABLEs — tudo em sequência via await pra garantir ordem
  await runSync(`CREATE TABLE IF NOT EXISTS sent_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    affiliate_link TEXT NOT NULL,
    niche TEXT,
    asin TEXT,
    title_hash TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await runSync(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    niche TEXT NOT NULL,
    platform TEXT NOT NULL,
    target_id TEXT NOT NULL
  )`);

  await runSync(`CREATE TABLE IF NOT EXISTS whatsapp_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT NOT NULL,
    message TEXT NOT NULL,
    niche TEXT NOT NULL,
    image_url TEXT,
    status TEXT DEFAULT 'pending',
    retries INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 2. MIGRAÇÕES defensivas para DBs antigos que não têm asin/title_hash
  await safeAddColumn('sent_products', 'asin', 'TEXT');
  await safeAddColumn('sent_products', 'title_hash', 'TEXT');
  await safeAddColumn('whatsapp_queue', 'retries', 'INTEGER DEFAULT 0');

  // 3. ÍNDICES compostos (asin+niche, title_hash+niche) para dedup
  // Tem que ser depois das migrações pra garantir que as colunas existem
  try {
    await runSync('DROP INDEX IF EXISTS idx_sent_products_asin');
    await runSync('DROP INDEX IF EXISTS idx_sent_products_title_hash');
    await runSync('DROP INDEX IF EXISTS idx_sent_products_affiliate_link');
  } catch (e) {}

  try {
    await runSync('CREATE INDEX IF NOT EXISTS idx_sent_products_asin_niche ON sent_products(asin, niche)');
    await runSync('CREATE INDEX IF NOT EXISTS idx_sent_products_title_hash_niche ON sent_products(title_hash, niche)');
    await runSync('CREATE INDEX IF NOT EXISTS idx_sent_products_sent_at ON sent_products(sent_at)');
    await runSync('CREATE INDEX IF NOT EXISTS idx_wa_queue_status ON whatsapp_queue(status, created_at)');
  } catch (err) {
    console.error('[SQLite] Aviso ao criar índices:', err.message);
  }

  // 4. Seeder de grupos default (só se a tabela groups estiver vazia)
  const row = await new Promise((resolve) => {
    db.get('SELECT COUNT(*) as count FROM groups', (err, r) => resolve(r || { count: -1 }));
  });

  if (row.count === 0) {
    console.log('[SQLite Seeder] 🌱 Semeando canais e grupos padrão no banco de dados...');
    const defaults = [
      ['Cozinha', 'telegram', '@garimpodigitalprimehub'],
      ['Beleza feminina', 'telegram', '@ofertasvaultbrasil247'],
      ['Eletrônicos', 'telegram', '@primeachadosxbrasil'],
      ['Gamer', 'telegram', '@descontosecretoshubbr'],
      ['Pet', 'telegram', '@garimpoeliteoficialbr'],
      ['Leitura', 'telegram', '@ofertasquanticasprime'],
      ['Academia_Fitness', 'telegram', '@achadosblackvaultbr'],
      ['Mobile_Games', 'telegram', '@primeimpulsodealsbr'],
      ['Gamer', 'whatsapp', '120363408801824800@g.us'],
      ['Cozinha', 'whatsapp', '120363427235389022@g.us'],
      ['Eletrônicos', 'whatsapp', '120363407495964635@g.us'],
      ['Beleza feminina', 'whatsapp', '120363427802091162@g.us'],
      ['Pet', 'whatsapp', '120363410226131492@g.us'],
      ['Leitura', 'whatsapp', '120363426209729628@g.us'],
      ['Academia_Fitness', 'whatsapp', '120363426157432603@g.us'],
      ['Mobile_Games', 'whatsapp', '120363427376215727@g.us'],
    ];
    for (const [niche, platform, target_id] of defaults) {
      await runSync('INSERT INTO groups (niche, platform, target_id) VALUES (?, ?, ?)', [niche, platform, target_id]);
    }
    console.log('[SQLite Seeder] ✅ Canais e grupos padrão semeados.');
  }
}

// Adiciona coluna apenas se ela ainda não existir (idempotente, sem race)
async function safeAddColumn(table, column, definition) {
  try {
    // PRAGMA é seguro de chamar; retorna info de cada coluna
    const rows = await getSync(`PRAGMA table_info(${table})`);
    const exists = rows.some(r => r.name === column);
    if (exists) return false;

    await runSync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[SQLite Migração] Coluna "${column}" adicionada em ${table}.`);
    return true;
  } catch (err) {
    // "duplicate column name" = corrida em runs paralelos. Ignorável.
    if (err.message && /duplicate column/i.test(err.message)) return false;
    console.error(`[SQLite Migração] Falha ao adicionar ${column} em ${table}:`, err.message);
    return false;
  }
}

function runQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getQuery(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = {
  db,
  runQuery,
  getQuery,
  ready,         // Promise que resolve quando todas as tabelas estão prontas
  safeAddColumn,
};
