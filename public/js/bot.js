(function () {
  var btn = document.getElementById('bot-btn');
  var painel = document.getElementById('bot-panel');
  if (!btn || !painel) return;

  var lista = document.getElementById('bot-msgs');
  var chips = document.getElementById('bot-chips');
  var form = document.getElementById('bot-form');
  var campo = document.getElementById('bot-input');
  var fechar = document.getElementById('bot-fechar');
  var iniciou = false;
  var aEnviar = false;

  var SUGESTOES = ['Quanto custa?', 'Como peço orçamento?', 'Que eventos fazem?', 'Onde ficam?', 'Falar com a equipa'];

  function descer() { lista.scrollTop = lista.scrollHeight; }

  function bolha(texto, quem) {
    var d = document.createElement('div');
    d.className = 'bot-m ' + quem;
    d.textContent = texto; // textContent: seguro contra XSS
    lista.appendChild(d);
    descer();
    return d;
  }

  function ligacoes(links) {
    if (!links || !links.length) return;
    var box = document.createElement('div');
    box.className = 'bot-links';
    links.forEach(function (l) {
      var a = document.createElement('a');
      a.textContent = l.rotulo;
      a.href = l.href;
      if (/^https?:/i.test(l.href)) { a.target = '_blank'; a.rel = 'noopener'; }
      // Ligações para secções do site fecham o painel para se ver a secção
      if (l.href.charAt(0) === '#') a.addEventListener('click', function () { abrir(false); });
      box.appendChild(a);
    });
    lista.appendChild(box);
    descer();
  }

  function sugerir(lista2) {
    chips.innerHTML = '';
    (lista2 && lista2.length ? lista2 : SUGESTOES).forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = t;
      b.addEventListener('click', function () { perguntar(t); });
      chips.appendChild(b);
    });
    descer();
  }

  function digitar() {
    var d = document.createElement('div');
    d.className = 'bot-m bot digita';
    d.setAttribute('aria-label', 'A escrever');
    d.innerHTML = '<span></span><span></span><span></span>';
    lista.appendChild(d);
    descer();
    return d;
  }

  function perguntar(texto) {
    texto = String(texto || '').trim();
    if (!texto || aEnviar) return;
    aEnviar = true;
    bolha(texto, 'eu');
    campo.value = '';
    chips.innerHTML = '';
    var espera = digitar();
    var inicio = Date.now();

    fetch('/api/bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ texto: texto })
    })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (j) {
        if (!j || !j.texto) throw new Error('resposta vazia');
        return j;
      })
      .catch(function () {
        return { texto: 'Não consegui responder agora. Fala diretamente com a equipa:', links: [{ rotulo: 'Ver contactos', href: '#contacto' }], sugestoes: [] };
      })
      .then(function (j) {
        // Pequena pausa para a resposta não parecer instantânea demais
        var resta = Math.max(0, 450 - (Date.now() - inicio));
        setTimeout(function () {
          espera.remove();
          bolha(j.texto, 'bot');
          ligacoes(j.links);
          sugerir(j.sugestoes);
          aEnviar = false;
          campo.focus();
        }, resta);
      });
  }

  function abrir(estado) {
    painel.hidden = !estado;
    btn.setAttribute('aria-expanded', estado ? 'true' : 'false');
    btn.hidden = false;
    if (estado) {
      btn.classList.add('aberto');
      if (!iniciou) {
        iniciou = true;
        bolha('Olá! Sou o assistente virtual do Porco no Espeto à Bronze. Posso ajudar com preços, eventos, orçamentos e a tua conta. Se eu não souber, indico-te como falar com a equipa.', 'bot');
        sugerir(SUGESTOES);
      }
      setTimeout(function () { campo.focus(); }, 50);
    } else {
      btn.classList.remove('aberto');
    }
  }

  btn.addEventListener('click', function () { abrir(painel.hidden); });
  fechar.addEventListener('click', function () { abrir(false); btn.focus(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !painel.hidden) { abrir(false); btn.focus(); }
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); perguntar(campo.value); });
})();
