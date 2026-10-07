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

// ---------- Base de dados (opcional) ----------
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  pool
    .query(`CREATE TABLE IF NOT EXISTS orcamentos (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      contacto TEXT NOT NULL,
      tipo TEXT,
      data_evento TEXT,
      convidados INT,
      localidade TEXT,
      mensagem TEXT,
      criado_em TIMESTAMPTZ DEFAULT NOW()
    )`)
    .catch((e) => console.error('Erro a criar tabela:', e.message));
}

// ---------- Galeria: lê fotos de public/galeria ----------
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

// ---------- Rotas ----------
app.get('/', (req, res) => {
  res.render('index', { site, galeria: listarGaleria() });
});

app.get('/health', (req, res) => res.send('ok'));

// Rate limit simples em memória (5 pedidos por IP / 10 min)
const tentativas = new Map();
function limite(req, res, next) {
  const ip = req.ip;
  const agora = Date.now();
  const lista = (tentativas.get(ip) || []).filter((t) => agora - t < 10 * 60 * 1000);
  if (lista.length >= 5) {
    return res.status(429).json({ ok: false, erro: 'Demasiados pedidos. Tenta mais tarde ou fala connosco por WhatsApp.' });
  }
  lista.push(agora);
  tentativas.set(ip, lista);
  next();
}

function limpar(v, max = 500) {
  return String(v || '').trim().slice(0, max);
}

async function enviarEmail(o) {
  const key = process.env.BREVO_API_KEY;
  if (!key) {
    console.log('[orçamento] BREVO_API_KEY não definida, email não enviado:', o);
    return;
  }
  const html = `
    <h2>Novo pedido de orçamento</h2>
    <p><b>Nome:</b> ${esc(o.nome)}</p>
    <p><b>Contacto:</b> ${esc(o.contacto)}</p>
    <p><b>Evento:</b> ${esc(o.tipo)}</p>
    <p><b>Data:</b> ${esc(o.data_evento)}</p>
    <p><b>Convidados:</b> ${esc(o.convidados)}</p>
    <p><b>Localidade:</b> ${esc(o.localidade)}</p>
    <p><b>Mensagem:</b><br>${esc(o.mensagem).replace(/\n/g, '<br>')}</p>`;
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: site.nome, email: process.env.BREVO_SENDER || site.email },
      to: [{ email: site.email }],
      subject: `Novo orçamento: ${o.tipo || 'Evento'} - ${o.nome}`,
      htmlContent: html
    })
  });
  if (!resp.ok) console.error('Brevo erro:', resp.status, await resp.text());
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

app.post('/orcamento', limite, async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot

  const o = {
    nome: limpar(b.nome, 100),
    contacto: limpar(b.contacto, 120),
    tipo: limpar(b.tipo, 60),
    data_evento: limpar(b.data_evento, 30),
    convidados: parseInt(b.convidados, 10) || null,
    localidade: limpar(b.localidade, 100),
    mensagem: limpar(b.mensagem, 1500)
  };

  if (!o.nome || !o.contacto) {
    return res.status(400).json({ ok: false, erro: 'Preenche o nome e um contacto (email ou telemóvel).' });
  }

  try {
    if (pool) {
      await pool.query(
        `INSERT INTO orcamentos (nome, contacto, tipo, data_evento, convidados, localidade, mensagem)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [o.nome, o.contacto, o.tipo, o.data_evento, o.convidados, o.localidade, o.mensagem]
      );
    }
    await enviarEmail(o);
    res.json({ ok: true });
  } catch (e) {
    console.error('Erro no orçamento:', e.message);
    res.status(500).json({ ok: false, erro: 'Não foi possível enviar agora. Tenta por WhatsApp ou email.' });
  }
});

// ---------- Admin simples (lista de pedidos) ----------
function auth(req, res, next) {
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) return res.status(404).send('Not found');
  const h = req.headers.authorization || '';
  const [tipo, cred] = h.split(' ');
  if (tipo === 'Basic' && cred) {
    const [, p] = Buffer.from(cred, 'base64').toString().split(/:(.*)/s);
    const a = Buffer.from(p || '');
    const b = Buffer.from(pass);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin"').status(401).send('Autenticação necessária');
}

app.get('/admin', auth, async (req, res) => {
  let pedidos = [];
  if (pool) {
    try {
      pedidos = (await pool.query('SELECT * FROM orcamentos ORDER BY criado_em DESC LIMIT 100')).rows;
    } catch (e) {
      console.error(e.message);
    }
  }
  res.render('admin', { site, pedidos, temDb: !!pool });
});

app.use((req, res) => res.status(404).render('404', { site }));

app.listen(PORT, () => console.log(`Site a correr na porta ${PORT}`));
