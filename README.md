# Offers Workspace

Offers Workspace evolui o `offers-bot` para um workspace de operacao organica de grupos de desconto. O app preserva o fluxo existente de ofertas, Telegram, WhatsApp e painel web, e adiciona modulos para produtos, nichos, criativos, qualidade editorial, contas sociais, fila de publicacao, exportacao manual, tracking e analytics.

O sistema nao implementa bypass, evasao de ban, simulacao humana, automacao de login, manipulacao de sessao ou scraping agressivo de plataformas sociais. Publicacao social deve usar APIs oficiais, OAuth e aprovacao/autorizacao. Quando a API nao esta configurada, o fluxo cai para exportacao manual.

## Instalar

```bash
npm install
cp .env.example .env
npm start
```

Por padrao o servidor sobe em `http://localhost:3000`.

## Configurar `.env`

Principais variaveis:

```env
PORT=3000
DATABASE_PATH=./data/app.db
BASE_PUBLIC_URL=http://localhost:3000
ENCRYPTION_KEY=change_me_32_chars_minimum

OPENAI_API_KEY=
ELEVENLABS_API_KEY=
TELEGRAM_BOT_TOKEN=
```

O banco SQLite e criado automaticamente em `data/app.db`. Se um banco legado `data/database.sqlite` existir e `DATABASE_PATH` nao for definido, o app preserva esse banco.

Os fluxos legados de WhatsApp e scraper recorrente ficam desativados por padrao. Para usar o comportamento antigo, defina `ENABLE_LEGACY_WHATSAPP=true` e/ou `ENABLE_LEGACY_SCRAPER=true`.

O painel tambem permite iniciar o WhatsApp manualmente pela aba `WhatsApp`, sem precisar ativar auto-start no boot. Clique em `Iniciar WhatsApp`, aguarde o QR Code e escaneie pelo app oficial em Aparelhos conectados. A sessao fica salva em `WA_AUTH_FOLDER` (padrao `./.wwebjs_auth`).

## Estrutura

```text
data/app.db
modules/products
modules/niches
modules/creatives
modules/accounts
modules/publisher
modules/publishers
modules/tracking
modules/analytics
modules/quality-guard
modules/content-quality
modules/prompts
modules/security
public/index.html
public/app.js
public/styles.css
exports
output
uploads
campaigns
presets
```

## Fluxo de uso

1. Importe um produto em `POST /api/products/import` ou pelo painel Radar.
2. Gere a campanha em `POST /api/products/:id/generate-campaign`.
3. Avalie o criativo em `POST /api/content-quality/evaluate`.
4. Aprove ou ajuste o criativo no Creative Studio.
5. Renderize com `POST /api/creatives/:id/render`.
6. Cadastre contas no Account Hub.
7. Crie fila em `POST /api/publisher/queue`.
8. O Quality Guard roda antes de agendar, publicar ou exportar.
9. Publique agora ou exporte manualmente.
10. Use o tracking link `BASE_PUBLIC_URL/r/:tracking_code`.
11. Consulte resultados em `/api/analytics/summary` ou no painel Analytics.

## Publicacao manual

Contas com `posting_mode` `manual` ou `export_only` geram um pacote em:

```text
exports/YYYY-MM-DD/account_handle/creative_id/
```

O pacote contem `caption.txt`, `metadata.json`, `checklist.txt` e o video quando houver render.

## Telegram

Configure:

```env
TELEGRAM_BOT_TOKEN=...
```

Crie uma conta social:

```json
{
  "platform": "telegram",
  "handle": "@canal",
  "niche": "gamer_setup",
  "posting_mode": "api",
  "metadata": {
    "chat_id": "@canal"
  }
}
```

Quando `TELEGRAM_BOT_TOKEN` e `metadata.chat_id` estao configurados, o publisher usa a Telegram Bot API. Sem configuracao completa, use exportacao manual.

## WhatsApp legado

A aba `WhatsApp` do painel possui:

- iniciar conexao e gerar QR Code;
- visualizar status e detalhes da sessao salva;
- listar grupos do numero conectado;
- limpar sessao para trocar de numero.

A aba `Bot Legado` recupera as funcoes operacionais antigas:

- adicionar oferta por link ou manualmente;
- disparar ciclo manual;
- drenar fila WhatsApp;
- processar arquivos JSON/CSV;
- ver/copiar mensagens pendentes;
- marcar mensagem como enviada;
- cadastrar e remover mapeamentos de grupos/canais.

O envio usa a sessao autorizada pelo QR Code do proprio WhatsApp. Nao ha automacao de login, bypass ou manipulacao de sessao.

## APIs oficiais planejadas

- TikTok: OAuth, refresh token, creator_info, upload/init, direct post e status.
- Instagram: Meta OAuth, IG User ID, media container, publish container e Reels.
- YouTube: Google OAuth, refresh token e `videos.insert`.
- Kwai: exportacao manual ate existir integracao oficial adequada.

## Limitacoes atuais

- A geracao de criativos usa templates locais seguros como fallback.
- O render usa FFmpeg quando disponivel; sem FFmpeg, cria um placeholder explicito em `output/` para manter o fluxo testavel.
- TikTok, Instagram e YouTube estao como scaffolds oficiais e caem para exportacao manual no publisher.
- O Quality Guard e o Content Quality usam regras heuristicas locais.

## Rotas principais

- `POST /api/products/import`
- `GET /api/products`
- `POST /api/products/:id/generate-campaign`
- `GET /api/creatives`
- `POST /api/content-quality/evaluate`
- `POST /api/quality/check`
- `POST /api/accounts`
- `POST /api/publisher/queue`
- `POST /api/publisher/queue/:id/publish-now`
- `POST /api/publisher/export`
- `GET /r/:tracking_code`
- `GET /api/analytics/summary`

## Codigo legado preservado

As rotas antigas continuam disponiveis:

- `POST /offers`
- `POST /quick-offer`
- `GET /offers`
- `GET /whatsapp-queue`
- `POST /mark-whatsapp-sent`
- `GET /api/whatsapp/status`
- `POST /api/whatsapp/start`
- `GET /api/whatsapp/qr`
- `GET /api/whatsapp/groups`
- `POST /api/whatsapp/logout`
