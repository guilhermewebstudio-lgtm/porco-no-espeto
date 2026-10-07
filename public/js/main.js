(function () {
  // Remove a intro do DOM depois da animação
  var intro = document.getElementById('intro');
  if (intro) setTimeout(function () { intro.remove(); }, 2900);

  // Nav: fundo ao fazer scroll
  var nav = document.getElementById('nav');
  function onScroll() { nav.classList.toggle('scrolled', window.scrollY > 40); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Menu mobile
  var burger = document.getElementById('burger');
  var links = document.getElementById('links');
  burger.addEventListener('click', function () {
    var open = links.classList.toggle('open');
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  links.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') {
      links.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    }
  });

  // Brasas no hero
  var embers = document.querySelector('.embers');
  if (embers && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (var i = 0; i < 22; i++) {
      var s = document.createElement('span');
      s.className = 'ember';
      s.style.left = Math.random() * 100 + '%';
      s.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
      s.style.animationDuration = (6 + Math.random() * 8) + 's';
      s.style.animationDelay = (Math.random() * 8) + 's';
      s.style.transform = 'scale(' + (0.6 + Math.random() * 0.9) + ')';
      embers.appendChild(s);
    }
  }

  // Reveal ao scroll (começa depois da intro)
  var items = document.querySelectorAll('.reveal');
  function startReveal() {
    if (!('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12 });
    items.forEach(function (el) { io.observe(el); });
  }
  setTimeout(startReveal, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1700);

  // Lightbox da galeria
  var lb = document.getElementById('lightbox');
  var lbImg = lb.querySelector('img');
  document.querySelectorAll('.shot[data-src]').forEach(function (b) {
    b.addEventListener('click', function () {
      lbImg.src = b.getAttribute('data-src');
      lb.hidden = false;
    });
  });
  lb.addEventListener('click', function () { lb.hidden = true; lbImg.src = ''; });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { lb.hidden = true; }
  });

  // Formulário de orçamento
  var form = document.getElementById('form');
  var msg = document.getElementById('msg');
  var btn = document.getElementById('enviar');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    msg.className = 'form-msg';
    msg.textContent = '';

    var data = Object.fromEntries(new FormData(form).entries());
    if (!data.nome.trim() || !data.contacto.trim()) {
      msg.classList.add('err');
      msg.textContent = 'Preenche o nome e um contacto (email ou telemóvel).';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'A enviar...';
    fetch('/orcamento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j.ok) {
          msg.classList.add('ok');
          msg.textContent = 'Pedido enviado! Respondemos em menos de 24 horas.';
          form.reset();
        } else {
          msg.classList.add('err');
          msg.textContent = res.j.erro || 'Ocorreu um erro. Tenta novamente.';
        }
      })
      .catch(function () {
        msg.classList.add('err');
        msg.textContent = 'Sem ligação. Tenta novamente ou contacta-nos por email.';
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Enviar pedido de orçamento';
      });
  });
})();
