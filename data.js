// Conteúdo editável do site. Altera aqui textos, preços e contactos.
// ATENÇÃO: os preços abaixo são EXEMPLOS - confirmar com o cliente antes de publicar.

module.exports = {
  nome: 'Porco no Espeto à Bronze',
  local: 'Odivelas',
  email: process.env.NOTIFY_EMAIL || 'porcoespetoodivelas@gmail.com',
  whatsapp: (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, ''), // ex: 351912345678
  telefone: process.env.PHONE_DISPLAY || '',
  morada: process.env.ADDRESS || 'Odivelas',
  horario: 'Orçamentos respondidos em menos de 24h',

  eventos: [
    { icone: '💍', titulo: 'Casamentos', texto: 'Um banquete de sabor que os convidados vão recordar. Porco no espeto assado devagar, ao ritmo da festa.' },
    { icone: '👶', titulo: 'Batizados', texto: 'Mesa farta e ambiente de família, sem stresses para os pais. Nós tratamos de tudo.' },
    { icone: '🎂', titulo: 'Festas e aniversários', texto: 'Do jantar íntimo à festa grande. Ajustamos as quantidades ao número de convidados.' },
    { icone: '🏢', titulo: 'Jantares de grupo e empresas', texto: 'Almoços de equipa, convívios e jantares de empresa com serviço profissional.' }
  ],

  formatos: [
    {
      nome: 'Clássico',
      preco: 'desde 12 €/pessoa',
      destaque: false,
      itens: ['Porco no espeto à bronze', 'Pão e molhos', 'Salada mista', 'Batata assada']
    },
    {
      nome: 'Festa Completa',
      preco: 'desde 18 €/pessoa',
      destaque: true,
      itens: ['Tudo do Clássico', 'Entradas e enchidos', 'Sobremesa', 'Serviço de mesa e montagem']
    },
    {
      nome: 'À medida',
      preco: 'sob orçamento',
      destaque: false,
      itens: ['Ementa personalizada', 'Grandes eventos', 'Casamentos e empresas', 'Visita e prova combinadas']
    }
  ],

  passos: [
    { n: '1', titulo: 'Pedes orçamento', texto: 'Preenches o formulário com a data e o número de convidados.' },
    { n: '2', titulo: 'Respondemos', texto: 'Enviamos proposta com ementa e preço, sem compromisso.' },
    { n: '3', titulo: 'Tratamos do resto', texto: 'No dia chegamos, montamos, servimos e arrumamos tudo.' }
  ],

  tiposEvento: ['Casamento', 'Batizado', 'Aniversário / Festa', 'Jantar de empresa', 'Jantar de grupo', 'Outro']
};
