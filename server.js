process.env.TZ = 'Europe/Lisbon';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');
const site = require('./data');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

// ---------- Estados dos pedidos ----------
const ESTADOS = {
  novo: 'Novo',
  em_conversa: 'Em conversa',
  confirmado: 'Confirmado',
  recusado: 'Recusado'
};
const ESTADOS_CLIENTE = {
  novo: 'Pedido recebido',
  em_conversa: 'Em conversa',
  confirmado: 'Evento confirmado',
  recusado: 'Sem disponibilidade'
};

// ---------- Base de dados (opcional) ----------
let pool = null;

async function iniciarDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS orcamentos (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    contacto TEXT NOT NULL,
    tipo TEXT,
    data_evento TEXT,
    convidados INT,
    localidade TEXT,
    mensagem TEXT,
    criado_em TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'novo'`);
  await pool.query(`ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS token TEXT`);
  await pool.query(`CREATE TABLE IF NOT EXISTS mensagens (
    id SERIAL PRIMARY KEY,
    orcamento_id INT NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
    autor TEXT NOT NULL,
    texto TEXT NOT NULL,
    lida BOOLEAN NOT NULL DEFAULT FALSE,
    criado_em TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS mensagens_orc_idx ON mensagens (orcamento_id)');
  // Pedidos antigos (antes do chat) ficam sem token: gerar agora
  const sem = await pool.query('SELECT id FROM orcamentos WHERE token IS NULL');
  for (const r of sem.rows) {
    await pool.query('UPDATE orcamentos SET token = $1 WHERE id = $2', [novoToken(), r.id]);
  }
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS orcamentos_token_idx ON orcamentos (token)');
}

function novoToken() {
  return crypto.randomBytes(16).toString('hex');
}

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  iniciarDb().catch((e) => console.error('Erro a preparar a base de dados:', e.message));
}

// ---------- Utilitários ----------
function wrap(fn) {
  return (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch((e) => {
      console.error('Erro:', e.message);
      if (res.headersSent) return;
      if (req.path.includes('/api/')) return res.status(500).json({ ok: false, erro: 'Erro no servidor.' });
      res.status(500).send('Erro no servidor. Tenta novamente.');
    });
}

function criarLimite(max, janelaMs, mensagem) {
  const mapa = new Map();
  return function (req, res, next) {
    const agora = Date.now();
    const lista = (mapa.get(req.ip) || []).filter((t) => agora - t < janelaMs);
    if (lista.length >= max) return mensagem(req, res);
    lista.push(agora);
    mapa.set(req.ip, lista);
    next();
  };
}

function limpar(v, max = 500) {
  return String(v || '').trim().slice(0, max);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const reEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const reToken = /^[a-f0-9]{32}$/;
const reData = /^\d{4}-\d{2}-\d{2}$/;

function baseUrl(req) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

async function enviarBrevo({ para, assunto, html }) {
  const key = process.env.BREVO_API_KEY;
  if (!key) {
    console.log(`[email não enviado, falta BREVO_API_KEY] para=${para} assunto=${assunto}`);
    return;
  }
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: site.nome, email: process.env.BREVO_SENDER || site.email },
      to: [{ email: para }],
      subject: assunto,
      htmlContent: html
    })
  });
  if (!resp.ok) console.error('Brevo erro:', resp.status, await resp.text());
}

function emailEmBackground(dados) {
  enviarBrevo(dados).catch((e) => console.error('Email falhou:', e.message));
}

function botao(url, texto) {
  return `<p><a href="${esc(url)}" style="display:inline-block;background:#e8571f;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:999px">${esc(texto)}</a></p>`;
}

// ---------- Rotas públicas ----------
function listarGaleria() {
  const dir = path.join(__dirname, 'public', 'galeria');
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.(jpe?g|png|webp|avif)$/i.test(f))
      .sort()
      .map((f) => '/galeria/' + f);
  } catch {
    return [];
  }
}

app.get('/', (req, res) => {
  res.render('index', { site, galeria: listarGaleria() });
});

app.get('/health', (req, res) => res.send('ok'));

// Aviso de data ocupada (só diz sim/não, não expõe dados de clientes)
const limiteData = criarLimite(60, 10 * 60 * 1000, (req, res) => res.status(429).json({ ocupada: false }));
app.get('/api/data-ocupada', limiteData, wrap(async (req, res) => {
  const data = String(req.query.data || '');
  if (!pool || !reData.test(data)) return res.json({ ocupada: false });
  const r = await pool.query("SELECT id FROM orcamentos WHERE data_evento = $1 AND estado = 'confirmado' LIMIT 1", [data]);
  res.json({ ocupada: r.rows.length > 0 });
}));

// Novo pedido de orçamento (abre também a conversa)
const limiteOrcamento = criarLimite(5, 10 * 60 * 1000, (req, res) =>
  res.status(429).json({ ok: false, erro: 'Demasiados pedidos. Tenta mais tarde ou fala connosco por WhatsApp.' })
);

app.post('/orcamento', limiteOrcamento, wrap(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot

  const o = {
    nome: limpar(b.nome, 100),
    contacto: limpar(b.contacto, 120),
    tipo: limpar(b.tipo, 60),
    data_evento: reData.test(String(b.data_evento || '')) ? String(b.data_evento) : '',
    convidados: parseInt(b.convidados, 10) || null,
    localidade: limpar(b.localidade, 100),
    mensagem: limpar(b.mensagem, 1500)
  };

  if (!o.nome || !o.contacto) {
    return res.status(400).json({ ok: false, erro: 'Preenche o nome e um contacto (email ou telemóvel).' });
  }

  let id = null;
  let token = null;
  if (pool) {
    token = novoToken();
    const ins = await pool.query(
      `INSERT INTO orcamentos (nome, contacto, tipo, data_evento, convidados, localidade, mensagem, token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [o.nome, o.contacto, o.tipo, o.data_evento, o.convidados, o.localidade, o.mensagem, token]
    );
    id = ins.rows[0].id;
    if (o.mensagem) {
      await pool.query('INSERT INTO mensagens (orcamento_id, autor, texto) VALUES ($1,$2,$3)', [id, 'cliente', o.mensagem]);
    }
  }

  const base = baseUrl(req);
  const linkAdmin = id ? `${base}/admin/pedido/${id}` : `${base}/admin`;
  emailEmBackground({
    para: site.email,
    assunto: `Novo orçamento: ${o.tipo || 'Evento'} - ${o.nome}`,
    html: `<h2>Novo pedido de orçamento</h2>
      <p><b>Nome:</b> ${esc(o.nome)}</p>
      <p><b>Contacto:</b> ${esc(o.contacto)}</p>
      <p><b>Evento:</b> ${esc(o.tipo)}</p>
      <p><b>Data:</b> ${esc(o.data_evento)}</p>
      <p><b>Convidados:</b> ${esc(o.convidados)}</p>
      <p><b>Localidade:</b> ${esc(o.localidade)}</p>
      <p><b>Mensagem:</b><br>${esc(o.mensagem).replace(/\n/g, '<br>')}</p>
      ${pool ? botao(linkAdmin, 'Abrir pedido e responder') : ''}`
  });

  if (token && reEmail.test(o.contacto)) {
    emailEmBackground({
      para: o.contacto,
      assunto: `Recebemos o teu pedido - ${site.nome}`,
      html: `<p>Olá ${esc(o.nome)},</p>
        <p>Recebemos o teu pedido de orçamento. Respondemos o mais depressa possível.</p>
        <p>Podes falar connosco e acompanhar o pedido neste link privado:</p>
        ${botao(`${base}/conversa/${token}`, 'Abrir a minha conversa')}
        <p style="color:#777;font-size:13px">${esc(site.nome)} · ${esc(site.local)}</p>`
    });
  }

  res.json({ ok: true, link: token ? `/conversa/${token}` : null });
}));

// ---------- Conversa do cliente (link privado com token) ----------
async function pedidoPorToken(token) {
  if (!pool || !reToken.test(String(token))) return null;
  const r = await pool.query('SELECT * FROM orcamentos WHERE token = $1', [token]);
  return r.rows[0] || null;
}

async function listarMensagens(pedidoId, depois) {
  const r = await pool.query(
    'SELECT id, autor, texto, criado_em FROM mensagens WHERE orcamento_id = $1 AND id > $2 ORDER BY id',
    [pedidoId, depois]
  );
  return r.rows.map((m) => ({ id: m.id, autor: m.autor, texto: m.texto, quando: new Date(m.criado_em).toISOString() }));
}

// Guarda a mensagem e avisa a outra parte (só no 1.º aviso de cada "rajada", para não encher a caixa de email)
async function guardarMensagem(req, p, autor, texto) {
  const pendentes = await pool.query(
    'SELECT id FROM mensagens WHERE orcamento_id = $1 AND autor = $2 AND lida = FALSE LIMIT 1',
    [p.id, autor]
  );
  await pool.query('INSERT INTO mensagens (orcamento_id, autor, texto) VALUES ($1,$2,$3)', [p.id, autor, texto]);

  if (autor === 'equipa' && p.estado === 'novo') {
    await pool.query("UPDATE orcamentos SET estado = 'em_conversa' WHERE id = $1", [p.id]);
  }
  if (pendentes.rows.length) return;

  const base = baseUrl(req);
  if (autor === 'cliente') {
    emailEmBackground({
      para: site.email,
      assunto: `Nova mensagem de ${p.nome}`,
      html: `<p><b>${esc(p.nome)}</b> escreveu:</p>
        <blockquote style="border-left:4px solid #e8571f;margin:0;padding:6px 14px;color:#333">${esc(texto).replace(/\n/g, '<br>')}</blockquote>
        ${botao(`${base}/admin/pedido/${p.id}`, 'Abrir e responder')}`
    });
  } else if (reEmail.test(p.contacto)) {
    emailEmBackground({
      para: p.contacto,
      assunto: `Resposta ao teu pedido - ${site.nome}`,
      html: `<p>Olá ${esc(p.nome)},</p>
        <p>Tens uma nova mensagem da nossa equipa:</p>
        <blockquote style="border-left:4px solid #e8571f;margin:0;padding:6px 14px;color:#333">${esc(texto).replace(/\n/g, '<br>')}</blockquote>
        ${botao(`${base}/conversa/${p.token}`, 'Abrir a conversa')}`
    });
  }
}

app.get('/conversa/:token', wrap(async (req, res) => {
  const p = await pedidoPorToken(req.params.token);
  if (!p) return res.status(404).render('404', { site });
  res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex').render('conversa', {
    site,
    p,
    estadoLabel: ESTADOS_CLIENTE[p.estado] || p.estado
  });
}));

app.get('/api/conversa/:token/mensagens', wrap(async (req, res) => {
  const p = await pedidoPorToken(req.params.token);
  if (!p) return res.status(404).json({ ok: false });
  const depois = parseInt(req.query.depois, 10) || 0;
  const mensagens = await listarMensagens(p.id, depois);
  await pool.query("UPDATE mensagens SET lida = TRUE WHERE orcamento_id = $1 AND autor = 'equipa' AND lida = FALSE", [p.id]);
  res.set('Cache-Control', 'no-store').json({ ok: true, mensagens, estado: p.estado, estado_label: ESTADOS_CLIENTE[p.estado] || p.estado });
}));

const limiteMsgCliente = criarLimite(30, 10 * 60 * 1000, (req, res) =>
  res.status(429).json({ ok: false, erro: 'Muitas mensagens seguidas. Aguarda um pouco.' })
);

app.post('/api/conversa/:token/mensagem', limiteMsgCliente, wrap(async (req, res) => {
  const p = await pedidoPorToken(req.params.token);
  if (!p) return res.status(404).json({ ok: false });
  const texto = limpar(req.body && req.body.texto, 1000);
  if (!texto) return res.status(400).json({ ok: false, erro: 'Escreve uma mensagem.' });
  await guardarMensagem(req, p, 'cliente', texto);
  res.json({ ok: true });
}));

// ---------- Admin: login com palavra-passe + cookie assinado ----------
const COOKIE = 'pe_admin';
const SESSAO_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

function segredo() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
}

function assinar(valor) {
  return crypto.createHmac('sha256', segredo()).update(valor).digest('hex');
}

function criarToken() {
  const exp = String(Date.now() + SESSAO_MS);
  return exp + '.' + assinar(exp);
}

function tokenValido(token) {
  if (!token || !segredo()) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const esperado = Buffer.from(assinar(exp));
  const recebido = Buffer.from(sig);
  return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);
}

function lerCookie(req, nome) {
  const h = req.headers.cookie || '';
  for (const parte of h.split(';')) {
    const i = parte.indexOf('=');
    if (i > -1 && parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return '';
}

function passwordCorreta(tentativa) {
  const real = process.env.ADMIN_PASSWORD || '';
  if (!real) return false;
  const a = crypto.createHash('sha256').update(String(tentativa)).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

function definirCookie(req, res, valor, maxAgeSeg) {
  const partes = [`${COOKIE}=${encodeURIComponent(valor)}`, 'Path=/admin', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeg}`];
  if (req.secure) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}

// Pedidos que precisam de atenção: estado "novo" ou com mensagens do cliente por ler
async function idsComAtencao() {
  const ids = new Set();
  if (!pool) return ids;
  const novos = await pool.query("SELECT id FROM orcamentos WHERE estado = 'novo'");
  novos.rows.forEach((r) => ids.add(r.id));
  const naoLidas = await pool.query("SELECT DISTINCT orcamento_id FROM mensagens WHERE autor = 'cliente' AND lida = FALSE");
  naoLidas.rows.forEach((r) => ids.add(r.orcamento_id));
  return ids;
}

const exigirAdmin = wrap(async (req, res, next) => {
  if (!process.env.ADMIN_PASSWORD) return res.status(404).render('404', { site });
  if (!tokenValido(lerCookie(req, COOKIE))) return res.redirect('/admin/login');
  res.locals.atencaoTotal = (await idsComAtencao()).size;
  next();
});

function exigirAdminApi(req, res, next) {
  if (!process.env.ADMIN_PASSWORD || !tokenValido(lerCookie(req, COOKIE))) {
    return res.status(401).json({ ok: false, erro: 'Sessão expirada. Entra novamente.' });
  }
  next();
}

const limiteLogin = criarLimite(8, 10 * 60 * 1000, (req, res) =>
  res.status(429).render('login', { site, erro: 'Demasiadas tentativas. Tenta novamente daqui a 10 minutos.' })
);

app.get('/admin/login', (req, res) => {
  if (!process.env.ADMIN_PASSWORD) return res.status(404).render('404', { site });
  if (tokenValido(lerCookie(req, COOKIE))) return res.redirect('/admin');
  res.set('Cache-Control', 'no-store').render('login', { site, erro: '' });
});

app.post('/admin/login', limiteLogin, (req, res) => {
  if (!process.env.ADMIN_PASSWORD) return res.status(404).render('404', { site });
  if (passwordCorreta(req.body && req.body.password)) {
    definirCookie(req, res, criarToken(), SESSAO_MS / 1000);
    return res.redirect('/admin');
  }
  res.status(401).render('login', { site, erro: 'Palavra-passe incorreta.' });
});

app.post('/admin/logout', (req, res) => {
  definirCookie(req, res, '', 0);
  res.redirect('/admin/login');
});

// ---------- Admin: notificações (consultadas de poucos em poucos segundos pelo painel) ----------
function resumo(texto, max) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

app.get('/admin/api/notificacoes', exigirAdminApi, wrap(async (req, res) => {
  const vazio = { ok: true, atencao: 0, pendentes: [], novos: [], mensagens: [], maxP: 0, maxM: 0 };
  if (!pool) return res.json(vazio);

  const maxP = Number((await pool.query('SELECT MAX(id) AS m FROM orcamentos')).rows[0].m) || 0;
  const maxM = Number((await pool.query("SELECT MAX(id) AS m FROM mensagens WHERE autor = 'cliente'")).rows[0].m) || 0;

  // Só devolve eventos se o painel já souber de onde parte (1.ª vez: só regista o ponto de partida)
  const temP = req.query.p !== undefined && /^\d+$/.test(String(req.query.p));
  const temM = req.query.m !== undefined && /^\d+$/.test(String(req.query.m));
  let novos = [];
  let mensagens = [];
  if (temP) {
    novos = (await pool.query('SELECT id, nome, tipo FROM orcamentos WHERE id > $1 ORDER BY id LIMIT 10', [Number(req.query.p)])).rows
      .map((o) => ({ id: o.id, nome: o.nome, tipo: o.tipo || 'Evento' }));
  }
  if (temM) {
    const ids = new Set(novos.map((o) => o.id)); // a 1.ª mensagem de um pedido novo já vai no aviso do pedido
    mensagens = (await pool.query(
      "SELECT m.id, m.orcamento_id, m.texto, o.nome FROM mensagens m JOIN orcamentos o ON o.id = m.orcamento_id WHERE m.autor = 'cliente' AND m.id > $1 ORDER BY m.id LIMIT 10",
      [Number(req.query.m)]
    )).rows
      .filter((x) => !ids.has(x.orcamento_id))
      .map((x) => ({ id: x.id, pedido: x.orcamento_id, nome: x.nome, texto: resumo(x.texto, 120) }));
  }

  // Lista "a precisar de resposta" para o sino
  const atencao = await idsComAtencao();
  const naoLidas = await pool.query("SELECT orcamento_id FROM mensagens WHERE autor = 'cliente' AND lida = FALSE");
  const mapa = {};
  naoLidas.rows.forEach((r) => { mapa[r.orcamento_id] = (mapa[r.orcamento_id] || 0) + 1; });
  const recentes = (await pool.query('SELECT id, nome, tipo, estado FROM orcamentos ORDER BY criado_em DESC LIMIT 200')).rows;
  const pendentes = recentes
    .filter((o) => atencao.has(o.id))
    .slice(0, 8)
    .map((o) => ({ id: o.id, nome: o.nome, tipo: o.tipo || 'Evento', estado: o.estado, nao_lidas: mapa[o.id] || 0 }));

  res.set('Cache-Control', 'no-store').json({ ok: true, atencao: atencao.size, pendentes, novos, mensagens, maxP, maxM });
}));

// ---------- Admin: lista de pedidos ----------
app.get('/admin', exigirAdmin, wrap(async (req, res) => {
  const filtro = Object.prototype.hasOwnProperty.call(ESTADOS, req.query.estado) ? req.query.estado : '';
  let pedidos = [];
  const contagens = { todos: 0, novo: 0, em_conversa: 0, confirmado: 0, recusado: 0 };
  if (pool) {
    const todos = (await pool.query('SELECT * FROM orcamentos ORDER BY criado_em DESC LIMIT 300')).rows;
    const naoLidas = await pool.query("SELECT orcamento_id FROM mensagens WHERE autor = 'cliente' AND lida = FALSE");
    const mapa = {};
    naoLidas.rows.forEach((r) => { mapa[r.orcamento_id] = (mapa[r.orcamento_id] || 0) + 1; });
    todos.forEach((p) => {
      p.nao_lidas = mapa[p.id] || 0;
      p.atencao = p.estado === 'novo' || p.nao_lidas > 0;
      contagens.todos += 1;
      if (contagens[p.estado] !== undefined) contagens[p.estado] += 1;
    });
    pedidos = filtro ? todos.filter((p) => p.estado === filtro) : todos;
  }
  res.set('Cache-Control', 'no-store').render('admin', { site, pedidos, temDb: !!pool, filtro, contagens, ESTADOS });
}));

// ---------- Admin: pedido + chat ----------
function idPedido(req) {
  const id = parseInt(req.params.id, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function pedidoPorId(id) {
  if (!pool || !id) return null;
  const r = await pool.query('SELECT * FROM orcamentos WHERE id = $1', [id]);
  return r.rows[0] || null;
}

app.get('/admin/pedido/:id', exigirAdmin, wrap(async (req, res) => {
  const p = await pedidoPorId(idPedido(req));
  if (!p) return res.status(404).render('404', { site });
  let ocupada = false;
  if (p.data_evento && p.estado !== 'confirmado') {
    const r = await pool.query(
      "SELECT id FROM orcamentos WHERE data_evento = $1 AND estado = 'confirmado' AND id <> $2 LIMIT 1",
      [p.data_evento, p.id]
    );
    ocupada = r.rows.length > 0;
  }
  res.set('Cache-Control', 'no-store').render('pedido', {
    site,
    p,
    ESTADOS,
    aviso: req.query.aviso || '',
    ocupada,
    linkConversa: `${baseUrl(req)}/conversa/${p.token}`
  });
}));

app.get('/admin/api/pedido/:id/mensagens', exigirAdminApi, wrap(async (req, res) => {
  const p = await pedidoPorId(idPedido(req));
  if (!p) return res.status(404).json({ ok: false });
  const depois = parseInt(req.query.depois, 10) || 0;
  const mensagens = await listarMensagens(p.id, depois);
  await pool.query("UPDATE mensagens SET lida = TRUE WHERE orcamento_id = $1 AND autor = 'cliente' AND lida = FALSE", [p.id]);
  res.set('Cache-Control', 'no-store').json({ ok: true, mensagens, estado: p.estado, estado_label: ESTADOS[p.estado] || p.estado });
}));

app.post('/admin/api/pedido/:id/mensagem', exigirAdminApi, wrap(async (req, res) => {
  const p = await pedidoPorId(idPedido(req));
  if (!p) return res.status(404).json({ ok: false });
  const texto = limpar(req.body && req.body.texto, 1000);
  if (!texto) return res.status(400).json({ ok: false, erro: 'Escreve uma mensagem.' });
  await guardarMensagem(req, p, 'equipa', texto);
  res.json({ ok: true });
}));

app.post('/admin/pedido/:id/estado', exigirAdmin, wrap(async (req, res) => {
  const p = await pedidoPorId(idPedido(req));
  if (!p) return res.status(404).render('404', { site });
  const estado = String((req.body && req.body.estado) || '');
  if (!Object.prototype.hasOwnProperty.call(ESTADOS, estado)) return res.redirect(`/admin/pedido/${p.id}`);
  await pool.query('UPDATE orcamentos SET estado = $1 WHERE id = $2', [estado, p.id]);

  let aviso = '';
  if (estado === 'confirmado' && p.data_evento) {
    const r = await pool.query(
      "SELECT id FROM orcamentos WHERE data_evento = $1 AND estado = 'confirmado' AND id <> $2 LIMIT 1",
      [p.data_evento, p.id]
    );
    if (r.rows.length) aviso = '?aviso=conflito';
  }
  res.redirect(`/admin/pedido/${p.id}${aviso}`);
}));

// ---------- Admin: calendário ----------
app.get('/admin/calendario', exigirAdmin, wrap(async (req, res) => {
  const hoje = new Date();
  const hojeISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(req.query.mes || '')) ? String(req.query.mes) : hojeISO.slice(0, 7);
  const [ano, m] = mes.split('-').map(Number);

  const dias = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(ano, m - 1, 1)).getUTCDay() + 6) % 7; // segunda = 0

  const eventos = {};
  if (pool) {
    const r = await pool.query(
      "SELECT id, nome, tipo, convidados, estado, data_evento FROM orcamentos WHERE data_evento >= $1 AND data_evento <= $2 AND estado <> 'recusado' ORDER BY data_evento, id",
      [`${mes}-01`, `${mes}-31`]
    );
    r.rows.forEach((e) => {
      (eventos[e.data_evento] = eventos[e.data_evento] || []).push(e);
    });
  }

  const celulas = [];
  for (let i = 0; i < offset; i++) celulas.push(null);
  for (let d = 1; d <= dias; d++) {
    const iso = `${mes}-${String(d).padStart(2, '0')}`;
    celulas.push({ dia: d, iso, hoje: iso === hojeISO, eventos: eventos[iso] || [] });
  }
  while (celulas.length % 7) celulas.push(null);
  const semanas = [];
  for (let i = 0; i < celulas.length; i += 7) semanas.push(celulas.slice(i, i + 7));

  const prev = new Date(Date.UTC(ano, m - 2, 1));
  const next = new Date(Date.UTC(ano, m, 1));
  const fmt = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

  res.set('Cache-Control', 'no-store').render('calendario', {
    site,
    semanas,
    temDb: !!pool,
    mesLabel: new Date(Date.UTC(ano, m - 1, 1)).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    prev: fmt(prev),
    next: fmt(next),
    mesAtual: hojeISO.slice(0, 7)
  });
}));

app.use((req, res) => res.status(404).render('404', { site }));

app.listen(PORT, () => console.log(`Site a correr na porta ${PORT}`));
