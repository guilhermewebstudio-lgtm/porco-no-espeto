(function () {
  var box = document.getElementById('chat');
  if (!box) return;

  var eu = box.getAttribute('data-eu');
  var urlGet = box.getAttribute('data-get');
  var urlPost = box.getAttribute('data-post');
  var lista = document.getElementById('msgs');
  var form = document.getElementById('chat-form');
  var texto = document.getElementById('chat-texto');
  var botao = document.getElementById('chat-enviar');
  var erro = document.getElementById('chat-erro');
  var badge = document.getElementById('estado-badge');

  var ultimo = 0;
  var vazio = null;
  var aBuscar = false;

  function hora(iso) {
    return new Date(iso).toLocaleString('pt-PT', {
      timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  }

  function mostrarVazio() {
    if (vazio || lista.children.length) return;
    vazio = document.createElement('p');
    vazio.className = 'vazio';
    vazio.textContent = eu === 'cliente'
      ? 'Ainda não há mensagens. Escreve a tua dúvida e respondemos assim que possível.'
      : 'Ainda não há mensagens neste pedido.';
    lista.appendChild(vazio);
  }

  function juntar(m) {
    if (vazio) { vazio.remove(); vazio = null; }
    var d = document.createElement('div');
    d.className = 'msg ' + (m.autor === eu ? 'minha' : 'outra');
    if (m.autor !== eu) {
      var a = document.createElement('span');
      a.className = 'autor';
      a.textContent = m.autor === 'equipa' ? 'Equipa' : 'Cliente';
      d.appendChild(a);
    }
    var p = document.createElement('p');
    p.textContent = m.texto; // textContent: seguro contra XSS
    var s = document.createElement('small');
    s.textContent = hora(m.quando);
    d.appendChild(p);
    d.appendChild(s);
    lista.appendChild(d);
    if (m.id > ultimo) ultimo = m.id;
  }

  function buscar(forcarScroll) {
    if (aBuscar) return;
    aBuscar = true;
    var perto = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 80;
    fetch(urlGet + '?depois=' + ultimo, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok) return;
        d.mensagens.forEach(juntar);
        if (!lista.children.length) mostrarVazio();
        if (d.mensagens.length && (perto || forcarScroll)) {
          lista.scrollTop = lista.scrollHeight;
        }
        if (badge && d.estado) {
          badge.className = 'estado ' + d.estado;
          badge.textContent = d.estado_label || d.estado;
        }
      })
      .catch(function () {})
      .then(function () { aBuscar = false; });
  }

  function enviar() {
    var t = texto.value.trim();
    if (!t) return;
    erro.textContent = '';
    botao.disabled = true;
    fetch(urlPost, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ texto: t })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j.ok) {
          texto.value = '';
          texto.style.height = '';
          buscar(true);
        } else {
          erro.textContent = res.j.erro || 'Não foi possível enviar. Tenta novamente.';
        }
      })
      .catch(function () { erro.textContent = 'Sem ligação. Tenta novamente.'; })
      .then(function () { botao.disabled = false; texto.focus(); });
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); enviar(); });
  texto.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
  });
  texto.addEventListener('input', function () {
    texto.style.height = 'auto';
    texto.style.height = Math.min(texto.scrollHeight, 140) + 'px';
  });

  buscar(true);
  setInterval(function () { if (!document.hidden) buscar(false); }, 4000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) buscar(false); });
})();
