// Botão "Mostrar/Esconder" das palavras-passe
(function () {
  document.querySelectorAll('.ver[data-alvo]').forEach(function (b) {
    b.addEventListener('click', function () {
      var i = document.getElementById(b.getAttribute('data-alvo'));
      if (!i) return;
      var mostrar = i.type === 'password';
      i.type = mostrar ? 'text' : 'password';
      b.textContent = mostrar ? 'Esconder' : 'Mostrar';
      b.setAttribute('aria-label', mostrar ? 'Esconder palavra-passe' : 'Mostrar palavra-passe');
      i.focus();
    });
  });
})();
