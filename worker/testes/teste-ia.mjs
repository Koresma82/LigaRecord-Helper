import { criarIndice, procurar } from '../src/emparelhar-jogador.js';
import { resumoSemanal } from '../src/bot/mensagens.js';

// -----------------------------------------------------------------------------
// Testes da verificacao por IA. Nenhum chama a API — testam o que rodeia a
// chamada, que e onde estavam os bugs.
//   npm run teste-ia
// -----------------------------------------------------------------------------

let falhas = 0;
const ok = (c, nome, extra = '') => {
  console.log(`${c ? 'OK   ' : 'FALHA'} ${nome}${extra ? `  — ${extra}` : ''}`);
  if (!c) falhas++;
};

const plantel = [
  { nome: 'Zaidu', equipa: 'FC Porto', posicao: 'DEF' },
  { nome: 'Pavlidis', equipa: 'Benfica', posicao: 'AVA' },
  { nome: 'Gonçalo Paciência', equipa: 'SC Braga', posicao: 'AVA' },
];

// --- 1. O caso real: as noticias dizem "Zaidu Sanusi", o plantel diz "Zaidu"
{
  const indice = criarIndice(plantel);
  ok(
    procurar(indice, 'Zaidu Sanusi', 'FC Porto')?.nome === 'Zaidu',
    'nome completo das notícias liga ao nome curto do plantel'
  );
  ok(
    procurar(indice, 'Vangelis Pavlidis', 'SL Benfica')?.nome === 'Pavlidis',
    'liga apesar do prefixo do clube ser diferente'
  );
  ok(
    procurar(indice, 'Goncalo Paciencia', 'Sp. Braga')?.nome === 'Gonçalo Paciência',
    'acentos não partem o emparelhamento'
  );
  ok(
    procurar(indice, 'Otávio', 'FC Porto') === null,
    'jogador que não é do plantel é rejeitado'
  );
}

// --- 2. A mensagem separa lesao de duvida e poe a lesao em destaque --------
{
  const boletim = {
    jornada: { numero: 6 },
    equipa: { plantel },
    emRisco: [],
    ligaInteira: [],
    duvidasIA: {
      jornada: 6,
      achados: [
        {
          nome: 'Zaidu',
          nomeNaNoticia: 'Zaidu Sanusi',
          equipa: 'FC Porto',
          tipo: 'lesao',
          motivo: 'Lesão no adutor confirmada pelo clube, várias semanas de paragem',
          confianca: 'alta',
          fonte: 'https://exemplo.pt/zaidu',
        },
        {
          nome: 'Pavlidis',
          equipa: 'Benfica',
          tipo: 'duvida',
          motivo: 'Treino condicionado na véspera',
          confianca: 'media',
          fonte: 'https://exemplo.pt/pavlidis',
        },
      ],
    },
  };

  const texto = resumoSemanal(boletim);

  ok(texto.includes('fora da tabela de lesionados'), 'a mensagem tem o bloco de lesões fora da tabela');
  ok(texto.includes('Em dúvida nas notícias'), 'a mensagem tem o bloco de dúvidas');
  ok(texto.includes('Zaidu Sanusi'), 'mostra o nome usado nas notícias');
  ok(texto.includes('https://exemplo.pt/zaidu'), 'inclui a fonte para confirmar');

  // O bloco tem de vir ANTES da analise da jornada: e decisao, nao rodape.
  const posLesao = texto.indexOf('fora da tabela de lesionados');
  const posNenhum = texto.indexOf('Nenhum dos teus jogadores');
  ok(
    posNenhum !== -1 && posLesao > posNenhum && posLesao < posNenhum + 600,
    'o bloco fica logo a seguir à decisão, não no fim',
    `decisão em ${posNenhum}, bloco em ${posLesao}`
  );
}

// --- 3. Sem achados nao ha bloco nenhum -------------------------------------
{
  const texto = resumoSemanal({
    jornada: { numero: 6 },
    equipa: { plantel },
    emRisco: [],
    ligaInteira: [],
    duvidasIA: { jornada: 6, achados: [] },
  });
  ok(!texto.includes('notícias'), 'sem achados, nenhum bloco de notícias é escrito');
}

// --- 4. Boletim no formato antigo continua a ler-se -------------------------
{
  const texto = resumoSemanal({
    jornada: { numero: 6 },
    equipa: { plantel },
    emRisco: [],
    ligaInteira: [],
    duvidasIA: {
      jornada: 6,
      duvidas: [
        { nome: 'Pavlidis', equipa: 'Benfica', motivo: 'Queixas', confianca: 'baixa', fonte: 'https://x.pt' },
      ],
    },
  });
  ok(texto.includes('Em dúvida nas notícias'), 'campo antigo `duvidas` continua a ser lido');
}

console.log('');
console.log(falhas ? `${falhas} teste(s) a falhar.` : 'Todos os testes da verificação IA passam.');
process.exit(falhas ? 1 : 0);
