(function () {
  var sino = document.getElementById('sino');
  if (!sino) return;

  var painel = document.getElementById('sino-painel');
  var lista = document.getElementById('sino-lista');
  var bolaSino = document.getElementById('sino-bola');
  var bolaNav = document.getElementById('nav-bola');
  var toasts = document.getElementById('toasts');
  var optSom = document.getElementById('opt-som');
  var optBrowser = document.getElementById('opt-browser');

  var tituloBase = document.title.replace(/^\(\d+\)\s*/, '');
  var KP = 'pe_ult_pedido';
  var KM = 'pe_ult_msg';
  var KS = 'pe_som';
  var parado = false;
  var ctx = null;

  function ler(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function gravar(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }

  // ---------- Som (gerado no browser, sem ficheiros) ----------
  function garantirAudio() {
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      if (!ctx) ctx = new C();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {}
  }

  function beep() {
    if (ler(KS) !== '1') return;
    garantirAudio();
    if (!ctx) return;
    try {
      [660, 880].forEach(function (f, i) {
        var t = ctx.currentTime + i * 0.18;
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.17);
      });
    } catch (e) {}
  }

  optSom.checked = ler(KS) === '1';
  optSom.addEventListener('change', function () {
    gravar(KS, optSom.checked ? '1' : '0');
    if (optSom.checked) { garantirAudio(); beep(); }
  });
  // O browser só deixa tocar som depois de uma interação: prepara o áudio no 1.º clique
  document.addEventListener('click', function () { if (ler(KS) === '1') garantirAudio(); }, { once: true });

  // ---------- Avisos do browser ----------
  function estadoBrowser() {
    if (!('Notification' in window)) {
      optBrowser.hidden = true;
      return;
    }
    if (Notification.permission === 'granted') {
      optBrowser.textContent = 'Avisos do browser: ligados ✓';
      optBrowser.disabled = true;
    } else if (Notification.permission === 'denied') {
      optBrowser.textContent = 'Avisos bloqueados no browser';
      optBrowser.disabled = true;
    }
  }
  estadoBrowser();
  optBrowser.addEventListener('click', function () {
    try {
      Notification.requestPermission().then(estadoBrowser);
    } catch (e) { estadoBrowser(); }
  });

  function avisoBrowser(titulo, corpo, url) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
    try {
      var n = new Notification(titulo, { body: corpo, tag: url });
      n.onclick = function () { window.focus(); location.href = url; n.close(); };
    } catch (e) {}
  }

  // ---------- Pop-ups no ecrã ----------
  function toast(titulo, corpo, url) {
    var a = document.createElement('a');
    a.className = 'toast';
    a.href = url;
    var t = document.createElement('strong');
    t.textContent = titulo;
    var p = document.createElement('span');
    p.textContent = corpo;
    a.appendChild(t);
    a.appendChild(p);
    toasts.appendChild(a);
    while (toasts.children.length > 4) toasts.removeChild(toasts.firstChild);
    setTimeout(function () { a.classList.add('sai'); setTimeout(function () { a.remove(); }, 400); }, 8000);
  }

  // ---------- Contadores e lista do sino ----------
  var ESTADOS = { novo: 'Novo', em_conversa: 'Em conversa', confirmado: 'Confirmado', recusado: 'Recusado' };

  function mostrarContagem(n) {
    [bolaSino, bolaNav].forEach(function (b) {
      if (!b) return;
      b.textContent = n;
      b.hidden = !(n > 0);
    });
    document.title = (n > 0 ? '(' + n + ') ' : '') + tituloBase;
  }

  function desenharLista(pendentes) {
    lista.textContent = '';
    if (!pendentes.length) {
      var v = document.createElement('p');
      v.className = 'sino-vazio';
      v.textContent = 'Tudo em dia 🎉';
      lista.appendChild(v);
      return;
    }
    pendentes.forEach(function (o) {
      var a = document.createElement('a');
      a.className = 'sino-item';
      a.href = '/admin/pedido/' + o.id;
      var n = document.createElement('strong');
      n.textContent = o.nome;
      var s = document.createElement('span');
      s.textContent = o.tipo + ' · ' + (ESTADOS[o.estado] || o.estado) + (o.nao_lidas ? ' · ' + o.nao_lidas + ' por ler' : '');
      a.appendChild(n);
      a.appendChild(s);
      lista.appendChild(a);
    });
  }

  sino.addEventListener('click', function (e) {
    e.stopPropagation();
    var abrir = painel.hidden;
    painel.hidden = !abrir;
    sino.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  });
  document.addEventListener('click', function (e) {
    if (!painel.hidden && !painel.contains(e.target)) {
      painel.hidden = true;
      sino.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { painel.hidden = true; sino.setAttribute('aria-expanded', 'false'); }
  });

  // ---------- Consulta periódica ----------
  function aVerOPedido(id) {
    return location.pathname === '/admin/pedido/' + id && !document.hidden;
  }

  function verificar() {
    if (parado) return;
    var p = ler(KP);
    var m = ler(KM);
    var url = '/admin/api/notificacoes';
    if (p !== null && m !== null && /^\d+$/.test(p) && /^\d+$/.test(m)) url += '?p=' + p + '&m=' + m;

    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (r.status === 401) { parado = true; return null; }
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (!d || !d.ok) return;
        var houve = false;

        d.novos.forEach(function (o) {
          var link = '/admin/pedido/' + o.id;
          toast('Novo pedido de orçamento', o.nome + ' · ' + o.tipo, link);
          avisoBrowser('Novo pedido de orçamento', o.nome + ' · ' + o.tipo, link);
          houve = true;
        });
        d.mensagens.forEach(function (x) {
          if (aVerOPedido(x.pedido)) return; // o chat já está à vista
          var link = '/admin/pedido/' + x.pedido;
          toast('Nova mensagem de ' + x.nome, x.texto, link);
          avisoBrowser('Nova mensagem de ' + x.nome, x.texto, link);
          houve = true;
        });

        // Guarda o ponto de partida só depois de processar (outros separadores não repetem os avisos)
        gravar(KP, d.maxP);
        gravar(KM, d.maxM);

        if (houve) beep();
        mostrarContagem(d.atencao);
        desenharLista(d.pendentes);
      })
      .catch(function () {});
  }

  verificar();
  setInterval(function () { if (!document.hidden) verificar(); }, 8000);
  // Em segundo plano os browsers abrandam os temporizadores, por isso consulta menos vezes
  setInterval(function () { if (document.hidden) verificar(); }, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) verificar(); });
})();
