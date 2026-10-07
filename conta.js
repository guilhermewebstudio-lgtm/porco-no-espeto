// Contas de cliente: registo, login, recuperar palavra-passe e "Os meus pedidos".
// Sem dependências novas: palavras-passe com scrypt (crypto) e sessão em cookie assinado.
const crypto = require('crypto');
const express = require('express');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

module.exports = function montarConta(d) {
  const { site, getPool, wrap, criarLimite, segredo, lerCookie, baseUrl, emailEmBackground, botao, esc, limpar, ESTADOS_CLIENTE } = d;
  const router = express.Router();

  const COOKIE = 'pe_cliente';
  const SESSAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
  const RESET_MS = 60 * 60 * 1000; // 1 hora
  const reEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const segredoDeArranque = crypto.randomBytes(32).toString('hex'); // só se não houver segredo configurado
  const chave = () => segredo() || segredoDeArranque;

  // ---------- Base de dados ----------
  async function iniciar(pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT NOT NULL,
      password TEXT NOT NULL,
      reset_hash TEXT,
      reset_exp BIGINT,
      criado_em TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS clientes_email_idx ON clientes (email)');
    await pool.query('ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_id INT');
  }

  // ---------- Palavras-passe ----------
  async function hashPassword(p) {
    const salt = crypto.randomBytes(16);
    const h = await scrypt(String(p), salt, 64);
    return salt.toString('hex') + ':' + h.toString('hex');
  }

  async function passwordCerta(p, guardado) {
    const [s, h] = String(guardado || '').split(':');
    if (!s || !h) return false;
    const calc = await scrypt(String(p), Buffer.from(s, 'hex'), 64);
    const esperado = Buffer.from(h, 'hex');
    return calc.length === esperado.length && crypto.timingSafeEqual(calc, esperado);
  }

  // ---------- Sessão (cookie assinado; mudar a palavra-passe termina as sessões antigas) ----------
  function assinar(valor) {
    return crypto.createHmac('sha256', chave()).update(valor).digest('hex');
  }

  function criarSessao(c) {
    const base = `${c.id}.${Date.now() + SESSAO_MS}`;
    return `${base}.${assinar(base + '.' + String(c.password).slice(-16))}`;
  }

  function definirCookie(req, res, valor, maxAgeSeg) {
    const partes = [`${COOKIE}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeg}`];
    if (req.secure) partes.push('Secure');
    res.setHeader('Set-Cookie', partes.join('; '));
  }

  async function clienteDaRequest(req) {
    if (req._cliente !== undefined) return req._cliente;
    req._cliente = null;
    const pool = getPool();
    const token = lerCookie(req, COOKIE);
    if (!pool || !token) return null;
    const [id, exp, sig] = token.split('.');
    if (!/^\d+$/.test(id || '') || !/^\d+$/.test(exp || '') || !sig || Number(exp) < Date.now()) return null;
    const r = await pool.query('SELECT id, nome, email, password FROM clientes WHERE id = $1', [Number(id)]);
    const c = r.rows[0];
    if (!c) return null;
    const esperado = Buffer.from(assinar(`${id}.${exp}.${String(c.password).slice(-16)}`));
    const recebido = Buffer.from(sig);
    if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null;
    req._cliente = { id: c.id, nome: c.nome, email: c.email };
    return req._cliente;
  }

  function iniciarSessao(req, res, c) {
    definirCookie(req, res, criarSessao(c), SESSAO_MS / 1000);
  }

  // Só aceita caminhos internos (evita redirecionar para sites de terceiros)
  function destinoSeguro(next, padrao) {
    const n = String(next || '');
    return n.startsWith('/') && !n.startsWith('//') && !n.includes('\\') && !/[\r\n]/.test(n) ? n : padrao;
  }

  const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const limparEmail = (e) => limpar(e, 200).toLowerCase();

  // ---------- Limites ----------
  const limiteEntrar = criarLimite(10, 10 * 60 * 1000, (req, res) =>
    res.status(429).render('conta-auth', vista(req, 'entrar', { erro: 'Demasiadas tentativas. Tenta novamente daqui a 10 minutos.' }))
  );
  const limiteCriar = criarLimite(6, 60 * 60 * 1000, (req, res) =>
    res.status(429).render('conta-auth', vista(req, 'criar', { erro: 'Demasiadas contas criadas a partir desta ligação. Tenta mais tarde.' }))
  );
  const limiteRecuperar = criarLimite(5, 60 * 60 * 1000, (req, res) =>
    res.status(429).render('conta-auth', vista(req, 'recuperar', { erro: 'Demasiados pedidos. Tenta novamente daqui a uma hora.' }))
  );

  function vista(req, modo, extra) {
    return Object.assign({ site, modo, erro: '', aviso: '', email: '', nome: '', next: destinoSeguro((req.body && req.body.next) || req.query.next, '') }, extra);
  }

  function semBase(req, res) {
    if (getPool()) return false;
    res.status(503).send('As contas de cliente precisam da base de dados (DATABASE_URL).');
    return true;
  }

  // ---------- Os meus pedidos ----------
  router.get('/conta', wrap(async (req, res) => {
    if (semBase(req, res)) return;
    const cliente = await clienteDaRequest(req);
    if (!cliente) return res.redirect('/conta/entrar?next=/conta');
    const pool = getPool();
    const pedidos = (await pool.query('SELECT * FROM orcamentos WHERE cliente_id = $1 ORDER BY criado_em DESC LIMIT 100', [cliente.id])).rows;
    const naoLidas = await pool.query("SELECT m.orcamento_id FROM mensagens m JOIN orcamentos o ON o.id = m.orcamento_id WHERE o.cliente_id = $1 AND m.autor = 'equipa' AND m.lida = FALSE", [cliente.id]);
    const mapa = {};
    naoLidas.rows.forEach((r) => { mapa[r.orcamento_id] = (mapa[r.orcamento_id] || 0) + 1; });
    pedidos.forEach((p) => { p.nao_lidas = mapa[p.id] || 0; });
    res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex').render('conta', { site, cliente, pedidos, ESTADOS_CLIENTE });
  }));

  // ---------- Entrar ----------
  router.get('/conta/entrar', wrap(async (req, res) => {
    if (semBase(req, res)) return;
    const next = destinoSeguro(req.query.next, '');
    if (await clienteDaRequest(req)) return res.redirect(next || '/');
    const aviso = next.startsWith('/conversa/') ? 'Esta conversa é privada. Entra na tua conta para a ver.' : '';
    res.set('Cache-Control', 'no-store').render('conta-auth', vista(req, 'entrar', { aviso }));
  }));

  router.post('/conta/entrar', limiteEntrar, wrap(async (req, res) => {
    if (semBase(req, res)) return;
    const email = limparEmail(req.body && req.body.email);
    const password = String((req.body && req.body.password) || '').slice(0, 200);
    const r = email ? await getPool().query('SELECT id, nome, email, password FROM clientes WHERE email = $1', [email]) : { rows: [] };
    const c = r.rows[0];
    const certa = c ? await passwordCerta(password, c.password) : (await passwordCerta(password, 'x:y'), false);
    if (!c || !certa) {
      return res.status(401).render('conta-auth', vista(req, 'entrar', { erro: 'Email ou palavra-passe incorretos.', email }));
    }
    iniciarSessao(req, res, c);
    res.redirect(destinoSeguro(req.body.next, '/'));
  }));

  // ---------- Criar conta ----------
  router.get('/conta/criar', wrap(async (req, res) => {
    if (semBase(req, res)) return;
    if (await clienteDaRequest(req)) return res.redirect(destinoSeguro(req.query.next, '/'));
    res.set('Cache-Control', 'no-store').render('conta-auth', vista(req, 'criar'));
  }));

  router.post('/conta/criar', limiteCriar, wrap(async (req, res) => {
    if (semBase(req, res)) return;
    const b = req.body || {};
    const nome = limpar(b.nome, 100);
    const email = limparEmail(b.email);
    const password = String(b.password || '').slice(0, 200);
    const falha = (erro) => res.status(400).render('conta-auth', vista(req, 'criar', { erro, nome, email }));

    if (!nome) return falha('Diz-nos o teu nome.');
    if (!reEmail.test(email)) return falha('Escreve um email válido.');
    if (password.length < 8) return falha('A palavra-passe tem de ter pelo menos 8 caracteres.');

    const pool = getPool();
    const existe = await pool.query('SELECT id FROM clientes WHERE email = $1', [email]);
    if (existe.rows.length) return falha('Já existe uma conta com este email. Entra ou recupera a palavra-passe.');

    const ins = await pool.query(
      'INSERT INTO clientes (nome, email, password) VALUES ($1,$2,$3) RETURNING id, nome, email, password',
      [nome, email, await hashPassword(password)]
    );
    iniciarSessao(req, res, ins.rows[0]);
    res.redirect(destinoSeguro(b.next, '/'));
  }));

  router.post('/conta/sair', (req, res) => {
    definirCookie(req, res, '', 0);
    res.redirect('/');
  });

  // ---------- Recuperar palavra-passe ----------
  router.get('/conta/recuperar', (req, res) => {
    if (semBase(req, res)) return;
    res.render('conta-auth', vista(req, 'recuperar'));
  });

  router.post('/conta/recuperar', limiteRecuperar, wrap(async (req, res) => {
    if (semBase(req, res)) return;
    const email = limparEmail(req.body && req.body.email);
    const pool = getPool();
    if (reEmail.test(email)) {
      const r = await pool.query('SELECT id, nome FROM clientes WHERE email = $1', [email]);
      const c = r.rows[0];
      if (c) {
        const token = crypto.randomBytes(32).toString('hex');
        await pool.query('UPDATE clientes SET reset_hash = $1, reset_exp = $2 WHERE id = $3', [sha(token), Date.now() + RESET_MS, c.id]);
        emailEmBackground({
          para: email,
          assunto: `Redefinir a palavra-passe - ${site.nome}`,
          html: `<p>Olá ${esc(c.nome)},</p>
            <p>Recebemos um pedido para redefinir a tua palavra-passe. O link é válido durante 1 hora.</p>
            ${botao(`${baseUrl(req)}/conta/redefinir/${token}`, 'Escolher nova palavra-passe')}
            <p style="color:#777;font-size:13px">Se não foste tu, ignora este email. A tua conta continua segura.</p>`
        });
      }
    }
    // Resposta igual exista ou não a conta (não revela quem tem conta)
    res.render('conta-auth', vista(req, 'recuperar', { aviso: 'Se existir uma conta com esse email, enviámos-lhe um link para redefinir a palavra-passe.' }));
  }));

  async function clienteDoReset(token) {
    if (!/^[a-f0-9]{64}$/.test(String(token))) return null;
    const r = await getPool().query('SELECT id, nome, email, password, reset_exp FROM clientes WHERE reset_hash = $1', [sha(token)]);
    const c = r.rows[0];
    return c && Number(c.reset_exp) > Date.now() ? c : null;
  }

  router.get('/conta/redefinir/:token', wrap(async (req, res) => {
    if (semBase(req, res)) return;
    const c = await clienteDoReset(req.params.token);
    if (!c) return res.status(400).render('conta-auth', vista(req, 'recuperar', { erro: 'Este link expirou ou já foi usado. Pede um novo.' }));
    res.set('Cache-Control', 'no-store').render('conta-auth', vista(req, 'redefinir', { token: req.params.token }));
  }));

  router.post('/conta/redefinir/:token', limiteEntrar, wrap(async (req, res) => {
    if (semBase(req, res)) return;
    const c = await clienteDoReset(req.params.token);
    if (!c) return res.status(400).render('conta-auth', vista(req, 'recuperar', { erro: 'Este link expirou ou já foi usado. Pede um novo.' }));
    const password = String((req.body && req.body.password) || '').slice(0, 200);
    if (password.length < 8) {
      return res.status(400).render('conta-auth', vista(req, 'redefinir', { token: req.params.token, erro: 'A palavra-passe tem de ter pelo menos 8 caracteres.' }));
    }
    const novo = await hashPassword(password);
    await getPool().query('UPDATE clientes SET password = $1, reset_hash = NULL, reset_exp = NULL WHERE id = $2', [novo, c.id]);
    iniciarSessao(req, res, { id: c.id, password: novo });
    res.redirect('/');
  }));

  return { router, iniciar, clienteDaRequest };
};
