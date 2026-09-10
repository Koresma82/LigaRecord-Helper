import { blocoAnalise, analisarJornada } from '../src/analise.js';
import { unirJogos } from '../src/jogos-fallback.js';
import { resumoSemanal } from '../src/bot/mensagens.js';

// -----------------------------------------------------------------------------
// A guarda contra jogos implausiveis.
//
// Aconteceu em producao: a fonte dos jogos falhou a meio, a lista chegou
// vazia, e a mensagem concluiu "sem jogo esta jornada" para os 23 jogadores
// do plantel — incluindo o Zaidu, que tinha FC Porto-Casa Pia marcado.
//   npm run teste-jogos
// -----------------------------------------------------------------------------

let falhas = 0;
const ok = (c, nome) => {
  console.log(`${c ? 'OK   ' : 'FALHA'} ${nome}`);
  if (!c) falhas++;
};

const plantel = [
  { nome: 'Zaidu', equipa: 'FC Porto', posicao: 'DEF', proximoJogo: null },
  { nome: 'Pavlidis', equipa: 'Benfica', posicao: 'AVA', proximoJogo: null },
];

// --- 1. O CASO REAL: jogosIndisponiveis suprime a analise, nao afirma "sem jogo"
{
  const boletim = { jogosIndisponiveis: true, equipa: { plantel }, classificacao: [] };
  const texto = blocoAnalise(boletim);

  ok(!texto.includes('Sem jogo esta jornada'), 'não afirma que ninguém tem jogo');
  ok(!texto.includes('Tira-os do onze'), 'não dá o conselho errado de banir toda a gente');
  ok(texto.includes('Não consegui confirmar'), 'diz que não conseguiu confirmar, em vez de ficar calado');
}

// --- 2. Com jogos normais, a analise funciona como sempre ------------------
{
  const comJogo = plantel.map((j) => ({
    ...j,
    proximoJogo: { adversario: 'Casa Pia AC', casa: false, data: '2026-09-12' },
  }));
  const boletim = {
    jogosIndisponiveis: false,
    equipa: { plantel: comJogo },
    classificacao: [],
  };
  const a = analisarJornada(boletim);
  ok(a.semJogo.length === 0, 'com jogos presentes, ninguém aparece como sem jogo');
  ok(a.jogadores.every((j) => j.temJogo), 'todos os jogadores têm jogo atribuído');
}

// --- 3. Sem o sinalizador (boletins antigos), o comportamento é o mesmo de sempre
{
  // Um boletim gravado antes desta correcção nao tem `jogosIndisponiveis`
  // nenhures. Tem de continuar a funcionar exactamente como antes.
  const boletim = { equipa: { plantel }, classificacao: [] };
  const texto = blocoAnalise(boletim);
  ok(texto.includes('Sem jogo esta jornada'), 'boletim antigo sem o campo continua a mostrar "sem jogo" normalmente');
}

// --- 4. unirJogos: a jornada 7 nao se perde quando a 6 cai para o fallback --
{
  const jornada6Fallback = [
    { jornada: 6, casa: 'FC Porto', fora: 'Casa Pia AC' },
    { jornada: 6, casa: 'Nacional', fora: 'Alverca' },
  ];
  const jornada7Fresca = [
    { jornada: 7, casa: 'Gil Vicente FC', fora: 'Marítimo M.' },
    { jornada: 7, casa: 'Nacional', fora: 'Famalicão' },
  ];

  const resultado = unirJogos(jornada7Fresca, jornada6Fallback);

  ok(resultado.length === 4, 'os jogos das duas jornadas ficam todos, nenhum se perde');
  ok(
    resultado.some((j) => j.jornada === 6 && j.casa === 'FC Porto'),
    'o jogo do fallback (jornada 6) está presente'
  );
  ok(
    resultado.some((j) => j.jornada === 7 && j.casa === 'Gil Vicente FC'),
    'o jogo fresco (jornada 7) não foi apagado pelo fallback da outra jornada'
  );
}

// --- 5. unirJogos: o mesmo jogo em duas listas não duplica ------------------
{
  const mesmoJogo = { jornada: 6, casa: 'FC Porto', fora: 'Casa Pia AC' };
  const resultado = unirJogos([mesmoJogo], [{ ...mesmoJogo }]);
  ok(resultado.length === 1, 'o mesmo jogo (mesma jornada e equipas) não duplica');
}

// --- 6. A posição do jogador aparece junto ao nome nas notícias -------------
{
  const texto = resumoSemanal({
    jornada: { numero: 6 },
    equipa: { plantel: [{ nome: 'Zaidu', equipa: 'FC Porto', posicao: 'DEF' }] },
    emRisco: [],
    ligaInteira: [],
    duvidasIA: {
      jornada: 6,
      estado: 'ok',
      achados: [
        {
          nome: 'Zaidu',
          equipa: 'FC Porto',
          posicao: 'DEF',
          tipo: 'lesao',
          motivo: 'Lesão no adutor',
          confianca: 'alta',
          fonte: 'https://exemplo.pt/zaidu',
          dataNoticia: '2026-09-08',
        },
      ],
    },
  });
  ok(texto.includes('*Zaidu* (DEF)'), 'a posição aparece junto ao nome, como no resto da mensagem');
}

// --- 7. Quando os jogos faltam, o aviso aparece na mensagem, não só no log --
{
  const texto = resumoSemanal({
    jornada: { numero: 6 },
    equipa: { plantel: [{ nome: 'Zaidu', equipa: 'FC Porto', posicao: 'DEF' }] },
    emRisco: [],
    ligaInteira: [],
    jogosIndisponiveis: true,
    avisos: ['Só encontrei 0 jogo(s) para a jornada 6 — pouco para uma ronda completa.'],
  });
  ok(
    texto.includes('Só encontrei 0 jogo(s)'),
    'o aviso sobre a lista vazia chega mesmo à mensagem do Telegram'
  );
}

console.log('');
console.log(falhas ? `${falhas} teste(s) a falhar.` : 'Todos os testes dos jogos da jornada passam.');
process.exit(falhas ? 1 : 0);
