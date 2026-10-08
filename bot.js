// Assistente virtual do site: responde com base no conteúdo de data.js (preços, eventos, contactos...).
// Não usa IA externa: é um motor de perguntas e respostas por palavras-chave. Por isso:
//  - não custa nada por mensagem e nunca inventa informação;
//  - quando não sabe, manda a pessoa falar com a equipa (telefone, WhatsApp, email);
//  - quando mudares textos/preços em data.js, o assistente atualiza sozinho.
// Para ensinar coisas novas, acrescenta um tópico em montarTopicos().

const PARAR = new Set((
  'a o as os um uma uns umas de do da dos das em no na nos nas ao aos ' +
  'e ou que para por com se me te vos eu tu voce voces nos ele ela eles elas ' +
  'meu minha meus minhas seu sua teu tua vosso nosso ' +
  'ser sao era foi ha tem tenho ter tinha vai vou posso podem pode ' +
  'isso isto aquilo esse essa este esta mais muito pouco ja so tambem como quando onde qual quais'
).split(' '));

function normalizar(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/€/g, ' euro ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(t) {
  return normalizar(t).split(' ').filter(Boolean);
}

// Pontuação de uma chave contra a pergunta: frase inteira vale 3, palavra isolada vale 2.
// Palavras com 4+ letras também casam por início ("casamentos" ~ "casamento").
function pontuarChave(chave, norm, toks) {
  const k = normalizar(chave);
  if (!k) return 0;
  if (k.includes(' ')) return (' ' + norm + ' ').includes(' ' + k + ' ') ? 3 : 0;
  for (const t of toks) {
    if (t === k) return 2;
    if (k.length >= 4 && t.length >= 4 && Math.abs(t.length - k.length) <= 2 && (t.startsWith(k) || k.startsWith(t))) return 2;
  }
  return 0;
}

function contactos(site) {
  const links = [];
  if (site.telefone) links.push({ rotulo: 'Ligar ' + site.telefone, href: 'tel:' + site.telefone.replace(/[^\d+]/g, '') });
  if (site.whatsapp) links.push({ rotulo: 'WhatsApp', href: 'https://wa.me/' + site.whatsapp });
  if (site.email) links.push({ rotulo: 'Enviar email', href: 'mailto:' + site.email });
  return links;
}

const LINK_ORCAMENTO = { rotulo: 'Pedir orçamento', href: '#orcamento' };
const SUGESTOES_BASE = ['Quanto custa?', 'Como peço orçamento?', 'Que eventos fazem?', 'Onde ficam?', 'Falar com a equipa'];

function juntar(lista) {
  if (lista.length <= 1) return lista.join('');
  return lista.slice(0, -1).join(', ') + ' e ' + lista[lista.length - 1];
}

// Itens de cada formato, incluindo os herdados ("Tudo do Clássico")
function itensCompletos(site) {
  const porNome = {};
  site.formatos.forEach((f) => { porNome[normalizar(f.nome)] = f; });
  const resolver = (f, vistos) => {
    const out = [];
    for (const it of f.itens) {
      const m = /^tudo do (.+)$/i.exec(it.trim());
      const outro = m && porNome[normalizar(m[1])];
      if (outro && !vistos.has(outro.nome)) {
        vistos.add(outro.nome);
        out.push(...resolver(outro, vistos));
      } else if (!m) {
        out.push(it);
      }
    }
    return out;
  };
  return site.formatos.map((f) => ({ formato: f, itens: resolver(f, new Set([f.nome])) }));
}

const IGNORAR_ITEM = new Set([
  'porco', 'espeto', 'bronze', 'tudo', 'classico', 'servico', 'mesa', 'ementa', 'personalizada', 'grandes',
  'eventos', 'casamentos', 'empresas', 'visita', 'prova', 'combinadas', 'mista', 'assada', 'medida'
]);

function montarTopicos(site) {
  const T = [];
  const tel = site.telefone ? ` (${site.telefone})` : '';
  const contactoLinks = () => contactos(site);
  const add = (t) => T.push(Object.assign({ peso: 0, links: [], sugestoes: [] }, t));

  // ---- Conversa social ----
  add({
    id: 'saudacao', peso: 1,
    chaves: ['ola', 'oi', 'boas', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hello', 'hi', 'viva', 'e ai'],
    texto: () => 'Olá! Sou o assistente virtual do ' + site.nome + '. Posso ajudar com preços, eventos, orçamentos e a tua conta. Em que posso ajudar?',
    sugestoes: SUGESTOES_BASE
  });
  add({
    id: 'obrigado', peso: 1,
    chaves: ['obrigado', 'obrigada', 'obg', 'agradeco', 'valeu', 'thanks', 'muito obrigado', 'muito obrigada', 'brigado', 'brigada'],
    texto: () => 'De nada! Se precisares de mais alguma coisa, é só perguntar.',
    sugestoes: ['Pedir orçamento', 'Falar com a equipa']
  });
  add({
    id: 'adeus', peso: 1,
    chaves: ['adeus', 'tchau', 'xau', 'ate logo', 'ate breve', 'ate ja', 'boa continuacao'],
    texto: () => 'Até breve! Quando quiseres um orçamento para o teu evento, estamos por aqui.',
    links: [LINK_ORCAMENTO]
  });
  add({
    id: 'identidade', peso: 2,
    chaves: ['es um robo', 'es robo', 'es uma pessoa', 'es humano', 'es real', 'quem es tu', 'quem es', 'chatbot', 'robo', 'bot', 'assistente virtual', 'inteligencia artificial', 'como te chamas', 'qual o teu nome'],
    texto: () => 'Sou o assistente virtual do site, não sou uma pessoa. Respondo a perguntas sobre eventos, preços de referência, orçamentos e a conta. Para tudo o resto, a equipa responde pessoalmente.',
    links: contactoLinks, sugestoes: SUGESTOES_BASE
  });
  add({
    id: 'ajuda', peso: 0,
    chaves: ['ajuda', 'ajudar', 'duvida', 'duvidas', 'o que sabes', 'o que podes fazer', 'o que fazes', 'para que serves', 'que perguntas'],
    texto: () => 'Posso responder sobre: preços e formatos, tipos de evento, como pedir orçamento, datas, zona onde trabalhamos, contactos, a conta e a conversa com a equipa. Escreve a tua pergunta ou escolhe uma sugestão.',
    sugestoes: SUGESTOES_BASE
  });
  add({
    id: 'problema', peso: 1,
    chaves: ['erro', 'nao funciona', 'nao consigo', 'problema', 'bug', 'avaria', 'nao carrega', 'falhou', 'nao abre', 'nao deixa'],
    texto: () => 'Lamento que algo não esteja a funcionar. Experimenta atualizar a página. Se continuar, diz-nos o que se passa para resolvermos:',
    links: contactoLinks
  });

  // ---- Contactos e localização ----
  add({
    id: 'contactar', peso: 1,
    chaves: ['falar com alguem', 'falar com a equipa', 'falar com uma pessoa', 'falar com um humano', 'contacto', 'contactos', 'contactar', 'telefone', 'telemovel', 'ligar', 'ligo', 'numero', 'whatsapp', 'email', 'mail', 'atendimento', 'equipa', 'humano', 'responsavel', 'dono', 'falar convosco'],
    texto: () => 'Podes falar diretamente com a equipa' + tel + '. Escolhe o que for mais fácil para ti:',
    links: contactoLinks
  });
  add({
    id: 'morada', peso: 1,
    chaves: ['morada', 'onde ficam', 'onde estao', 'onde fica', 'onde e que', 'localizacao', 'localizados', 'mapa', 'como chegar', 'em que zona', 'endereco', 'rua'],
    texto: () => 'A nossa morada é ' + site.morada + '. O serviço é feito no local do teu evento: chegamos, montamos e servimos. Se quiseres passar por cá, combina primeiro com a equipa.',
    links: () => [{ rotulo: 'Ver no mapa', href: '#contacto' }, ...contactoLinks().slice(0, 2)]
  });
  add({
    id: 'zona', peso: 1,
    chaves: ['zona', '!deslocam', '!deslocacao', 'deslocar', 'vao a', 'vao ate', 'fazem em', '!fora de odivelas', 'arredores', '!lisboa', '!loures', '!amadora', '!sintra', '!cascais', '!mafra', '!oeiras', '!pontinha', '!benfica', '!sacavem', '!camarate', 'distancia', 'longe', '!outra cidade', '!outra localidade', '!algarve', '!porto', '!norte', '!sul', '!fora de lisboa'],
    texto: () => 'Fazemos eventos em ' + site.local + ' e arredores. Para outra localidade, indica o local no pedido de orçamento e confirmamos se conseguimos ir.',
    links: () => [LINK_ORCAMENTO, ...contactoLinks().slice(0, 2)]
  });
  add({
    id: 'horario', peso: 0,
    chaves: ['horario', 'horarios', 'abertos', 'aberto', 'a que horas', 'abrem', 'fechado', 'fecham', 'funcionam'],
    texto: () => 'Podes pedir orçamento a qualquer hora pelo site e respondemos em menos de 24 horas. Para falar já com alguém, liga ou usa o WhatsApp.',
    links: () => [LINK_ORCAMENTO, ...contactoLinks()]
  });
  add({
    id: 'redes', peso: 0,
    chaves: ['instagram', 'insta', 'facebook', 'redes sociais', 'rede social', 'tiktok', 'seguir', 'casamentos pt'],
    texto: () => (site.instagram ? 'Estamos no Instagram: @' + site.instagram + '. ' : '') + 'Também temos página no Facebook (procura por "' + site.nome + ' Odivelas").',
    links: () => (site.instagram ? [{ rotulo: 'Instagram', href: 'https://instagram.com/' + site.instagram }] : [])
  });
  add({
    id: 'galeria', peso: 0,
    chaves: ['galeria', 'fotos', 'foto', 'imagens', 'fotografias', 'trabalhos', 'exemplos', 'portfolio', 'ver como'],
    texto: () => 'Tens fotos de eventos na galeria do site' + (site.instagram ? ' e mais no Instagram (@' + site.instagram + ')' : '') + '.',
    links: () => [{ rotulo: 'Ver galeria', href: '#galeria' }, ...(site.instagram ? [{ rotulo: 'Instagram', href: 'https://instagram.com/' + site.instagram }] : [])]
  });
  add({
    id: 'sobre', peso: 0,
    chaves: ['quem sao', 'quem somos', 'sobre voces', 'sobre a empresa', 'sobre o negocio', 'historia', 'desde quando', 'anos', 'experiencia', '2004', 'especializados', 'especialidade', 'o que fazem', 'o que e', 'servicos', 'catering'],
    texto: () => site.nome + ' é uma empresa de catering de ' + site.local + ', especializada em porco no espeto' + (site.desde ? ', desde ' + site.desde : '') + '. Com anos de experiência, servimos ' + juntar(site.eventos.map((e) => e.titulo.toLowerCase())) + '.',
    links: () => [LINK_ORCAMENTO],
    sugestoes: ['Quanto custa?', 'Como peço orçamento?']
  });
  add({
    id: 'preparacao', peso: 1,
    chaves: ['como e feito', 'como fazem', 'como preparam', 'como e preparado', 'preparacao', 'assam', 'assado', 'tempero', 'carvao', 'lenha', 'brasas', 'como e o porco'],
    texto: () => 'O porco é assado no espeto, devagar, à bronze. Para detalhes de preparação e tempero, fala com a equipa.',
    links: contactoLinks
  });

  // ---- Orçamento, preços e formatos ----
  add({
    id: 'orcamento', peso: 2,
    chaves: ['orcamento', 'pedir orcamento', 'como peco', 'como pedir', 'pedido de orcamento', 'proposta', 'reservar', 'reserva', 'marcar', 'encomendar', 'contratar', 'formulario', 'quero um orcamento'],
    texto: () => {
      const passos = site.passos.map((p) => p.n + ') ' + p.titulo + ': ' + p.texto).join(' ');
      return 'Pedir orçamento é simples e sem compromisso. ' + passos;
    },
    links: () => [LINK_ORCAMENTO],
    sugestoes: ['Quanto custa?', 'Quando respondem?']
  });
  add({
    id: 'precos', peso: 2,
    chaves: ['preco', 'precos', 'quanto custa', 'quanto fica', 'quanto e', 'valor', 'valores', 'custo', 'custa', 'caro', 'barato', 'tabela', 'euro', 'por pessoa', 'orcamento medio', 'preco medio'],
    texto: () => {
      const linhas = site.formatos.map((f) => f.nome + ': ' + f.preco);
      return linhas.join('. ') + '. Os valores são de referência por pessoa; o preço final depende da data, do local e do número de convidados.';
    },
    links: () => [LINK_ORCAMENTO],
    sugestoes: ['O que inclui cada formato?', 'Como peço orçamento?']
  });
  add({
    id: 'formatos', peso: 1,
    chaves: ['formato', 'formatos', 'ementa', 'menu', 'menus', 'pacote', 'pacotes', 'opcoes', 'o que inclui', 'inclui', 'incluem', 'servem', 'comida', 'comer', 'prato', 'pratos'],
    texto: () => site.formatos.map((f) => f.nome + ' (' + f.preco + '): ' + f.itens.join(', ')).join('. ') + '.',
    links: () => [LINK_ORCAMENTO],
    sugestoes: ['Quanto custa?']
  });
  // Um tópico por formato ("clássico", "festa completa", "à medida")
  site.formatos.forEach((f) => {
    add({
      id: 'formato-' + normalizar(f.nome), peso: 1,
      chaves: ['!' + f.nome],
      texto: () => 'O formato ' + f.nome + ' (' + f.preco + ') inclui: ' + f.itens.join(', ') + '.',
      links: () => [LINK_ORCAMENTO]
    });
  });
  // Perguntas sobre um item concreto ("tem salada?", "há sobremesa?")
  const completos = itensCompletos(site);
  const mapaItens = new Map();
  completos.forEach(({ formato, itens }) => {
    itens.forEach((it) => {
      tokens(it).filter((t) => t.length >= 3 && !PARAR.has(t) && !IGNORAR_ITEM.has(t)).forEach((t) => {
        if (!mapaItens.has(t)) mapaItens.set(t, new Map());
        mapaItens.get(t).set(formato.nome, it);
      });
    });
  });
  mapaItens.forEach((formatos, token) => {
    const nomes = [...formatos.keys()];
    const exemplo = [...formatos.values()][0];
    add({
      id: 'item-' + token, peso: 0,
      chaves: [token],
      texto: () => '"' + exemplo + '" está incluído no formato ' + juntar(nomes) + '.',
      links: () => [LINK_ORCAMENTO],
      sugestoes: ['O que inclui cada formato?']
    });
  });

  // ---- Eventos, datas, convidados ----
  add({
    id: 'eventos', peso: 0,
    chaves: ['evento', 'eventos', 'festa', 'festas', 'convivio', 'tipo de evento', 'que eventos', 'fazem festas'],
    texto: () => 'Fazemos ' + juntar(site.eventos.map((e) => e.titulo.toLowerCase())) + '. Diz-nos o tipo de evento no pedido de orçamento.',
    links: () => [LINK_ORCAMENTO],
    sugestoes: site.eventos.map((e) => e.titulo)
  });
  site.eventos.forEach((e) => {
    // Palavras do título no singular: "Casamentos" -> casamento, "Jantares de grupo e empresas" -> jantar, grupo, empresa
    const singular = (w) => (/res$/.test(w) ? w.slice(0, -2) : w.replace(/s$/, ''));
    const palavras = tokens(e.titulo).filter((w) => w.length >= 4 && !PARAR.has(w)).map(singular);
    add({
      id: 'evento-' + palavras[0], peso: 1,
      chaves: palavras,
      texto: () => e.titulo + ': ' + e.texto,
      links: () => [LINK_ORCAMENTO],
      sugestoes: ['Quanto custa?']
    });
  });
  add({
    id: 'outro-evento', peso: 2,
    chaves: ['comunhao', 'comunhoes', 'formatura', 'formaturas', 'bodas', 'despedida', 'reforma', 'baptizado', 'outro evento', 'outros eventos', 'cha de bebe', 'inauguracao', 'reuniao de familia'],
    texto: () => 'Os eventos mais comuns são ' + juntar(site.eventos.map((e) => e.titulo.toLowerCase())) + '. Para outro tipo de evento, escolhe "Outro" no formulário ou fala com a equipa para confirmarmos.',
    links: () => [LINK_ORCAMENTO, ...contactoLinks().slice(0, 2)]
  });
  add({
    id: 'convidados', peso: 1,
    chaves: ['convidados', 'quantas pessoas', 'numero de pessoas', 'minimo', 'maximo', 'pessoas', 'lotacao', 'grupo grande', 'poucas pessoas', 'muitas pessoas', 'capacidade'],
    texto: () => 'Ajustamos as quantidades ao número de convidados, do jantar mais pequeno à festa grande. Indica quantos serão no formulário. Para saber um mínimo ou máximo exato, fala com a equipa.',
    links: () => [LINK_ORCAMENTO, ...contactoLinks().slice(0, 2)]
  });
  add({
    id: 'data', peso: 1,
    chaves: ['data', 'datas', 'disponibilidade', 'disponivel', 'disponiveis', 'livre', 'ocupada', 'ocupado', 'calendario', 'sabado', 'domingo', 'fim de semana', 'feriado', 'antecedencia', 'para quando', 'reservar data', 'marcar data'],
    texto: () => 'Escolhe a data no formulário de orçamento. Se já houver um evento confirmado nesse dia, o site avisa, mas podes enviar o pedido na mesma e confirmamos a disponibilidade. Para saber com que antecedência pedir, fala com a equipa.',
    links: () => [LINK_ORCAMENTO, ...contactoLinks().slice(0, 2)]
  });
  add({
    id: 'tempo-resposta', peso: 2,
    chaves: ['quanto tempo demora', 'demoram a responder', 'demora', 'responder', 'resposta', 'respondem', '24 horas', '24h', 'quando respondem', 'prazo', 'urgente'],
    texto: () => 'Respondemos aos pedidos de orçamento em menos de 24 horas. Se for urgente, liga ou escreve por WhatsApp.',
    links: contactoLinks
  });
  add({
    id: 'funciona', peso: 1,
    chaves: ['como funciona', 'passos', 'processo', 'etapas', 'no dia', 'montam', 'montagem', 'chegam', 'servir', 'arrumam', 'limpeza'],
    texto: () => site.passos.map((p) => p.n + ') ' + p.titulo + ': ' + p.texto).join(' ') + ' No formato Festa Completa está incluído o serviço de mesa e montagem.',
    links: () => [LINK_ORCAMENTO]
  });

  // ---- Conta e conversa ----
  add({
    id: 'conta', peso: 1,
    chaves: ['conta', 'criar conta', 'registar', 'registo', 'login', 'entrar', 'iniciar sessao', 'terminar sessao', 'sair', 'minha conta', 'os meus pedidos', 'ver o meu pedido', 'ver os meus pedidos'],
    texto: () => 'Com uma conta vês todos os teus pedidos e mensagens em qualquer dispositivo, e só tu e a equipa veem a conversa. ' +
      (site.exigirConta ? 'Para pedir orçamento é preciso criar conta primeiro.' : 'Não é obrigatório para pedir orçamento: podes pedir sem conta e guardar o pedido na conta depois.'),
    links: () => [{ rotulo: 'Criar conta', href: '/conta/criar' }, { rotulo: 'Entrar', href: '/conta/entrar' }]
  });
  add({
    id: 'recuperar', peso: 2,
    chaves: ['esqueci', 'recuperar', 'palavra passe', 'password', 'senha', 'repor', 'redefinir', 'nao me lembro'],
    texto: () => 'Em "Entrar" escolhe "Esqueci a palavra-passe", escreve o teu email e enviamos um link para criares uma nova. O link vale 1 hora.',
    links: () => [{ rotulo: 'Recuperar palavra-passe', href: '/conta/recuperar' }]
  });
  add({
    id: 'conversa', peso: 1,
    chaves: ['conversa', 'chat', 'mensagens', 'mensagem', 'falar convosco no site', 'guardar pedido', 'link privado', 'privada', 'privado', 'ver resposta', 'acompanhar pedido', 'estado do pedido', 'estado', 'seguir pedido'],
    texto: () => 'Depois de enviares o pedido, abres uma conversa privada com a equipa, onde escreves e vês as respostas. O estado do pedido aparece lá: Pedido recebido, Em conversa, Evento confirmado ou Sem disponibilidade. Guarda o pedido na tua conta para o veres em qualquer dispositivo.',
    links: () => [{ rotulo: 'Os meus pedidos', href: '/conta' }]
  });

  // ---- O que não sabemos: honestos e direcionados ----
  add({
    id: 'sem-info', peso: 1,
    chaves: [
      'pagamento', 'pagar', 'sinal', 'mbway', 'mb way', 'transferencia', 'fatura', 'iva', 'cancelar', 'cancelamento', 'devolucao',
      'alergia', 'alergias', 'gluten', 'lactose', 'vegetariano', 'vegetariana', 'vegano', 'vegan', 'halal', 'kosher',
      'bebidas', 'cerveja', 'vinho', 'sumos', 'musica', 'dj', 'decoracao', 'flores',
      'louca', 'copos', 'talheres', 'toalhas', 'desconto', 'descontos', 'promocao', 'parceria',
      'seguro', 'licenca', 'eletricidade', 'energia', 'tenda', 'gerador', 'funcionarios', 'empregados', 'garcons', 'cozinheiro',
      'duracao', 'quanto tempo dura', 'degustacao', 'experimentar', 'sobras', 'take away', 'entrega', 'levantar', 'recolher',
      'dose', 'doses', 'quantidade por pessoa', 'kg', 'quilos', 'peso', 'leitao', 'cordeiro', 'vaca', 'frango', 'peixe', 'carne'
    ].map((k) => '!' + k),
    texto: () => 'Isso depende de cada evento e prefiro não te dar uma informação errada. A equipa responde-te com certeza:',
    links: () => [...contactoLinks(), LINK_ORCAMENTO]
  });
  add({
    id: 'admin', peso: 0,
    chaves: ['admin', 'administrador', 'painel de admin'],
    texto: () => 'A área de administração é só para a equipa. Se és cliente, entra em "Entrar" para ver os teus pedidos.',
    links: () => [{ rotulo: 'Entrar', href: '/conta/entrar' }]
  });

  return T;
}

function responder(textoBruto, site, topicos) {
  const texto = String(textoBruto || '').slice(0, 300);
  const norm = normalizar(texto);
  const toks = tokens(texto);
  const T = topicos || montarTopicos(site);

  if (!norm) {
    return { texto: 'Escreve a tua pergunta e eu tento ajudar.', links: [], sugestoes: SUGESTOES_BASE, sabia: true };
  }

  let melhor = null;
  let melhorPontos = 0;
  for (const t of T) {
    let pontos = 0;
    for (const chave of t.chaves) {
      // Prefixo "!" = chave forte (vale o dobro), para nomes de sítios e termos muito específicos
      const forte = chave.charAt(0) === '!';
      pontos += pontuarChave(forte ? chave.slice(1) : chave, norm, toks) * (forte ? 2 : 1);
    }
    if (!pontos) continue;
    if (pontos > melhorPontos || (pontos === melhorPontos && melhor && t.peso > melhor.peso)) {
      melhor = t;
      melhorPontos = pontos;
    }
  }

  if (!melhor || melhorPontos < 2) {
    return {
      texto: 'Não tenho essa informação com certeza, e não quero dar-te uma resposta errada. A equipa responde-te diretamente:',
      links: contactos(site),
      sugestoes: SUGESTOES_BASE,
      sabia: false
    };
  }

  return {
    texto: melhor.texto(),
    links: typeof melhor.links === 'function' ? melhor.links() : melhor.links,
    sugestoes: melhor.sugestoes && melhor.sugestoes.length ? melhor.sugestoes : [],
    sabia: true,
    topico: melhor.id
  };
}

module.exports = { montarTopicos, responder, normalizar, contactos };
