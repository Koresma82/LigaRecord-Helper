import { criarIndice, procurar } from '../src/emparelhar-jogador.js';
import { resumoSemanal } from '../src/bot/mensagens.js';
import { validar, dataEProvavelmenteActual } from '../src/fontes/duvidas-ia.js';

// -----------------------------------------------------------------------------
// Testes da verificacao por IA. Nenhum chama a API — testam o que rodeia a
// chamada, que e onde estavam os bugs.
//   npm run teste-ia
// -----------------------------------------------------------------------------

// O que o Telegram MOSTRA ao utilizador, depois de retirar as barras de
// escape. E contra isto que faz sentido comparar, nao contra o texto cru
// que vai no pedido — esse tem mesmo as barras, de proposito.
const semEscape = (texto) => texto.replace(/\\([_*`[])/g, '$1');

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

// --- 3. Verificou e nao achou nada: TEM de o dizer --------------------------
{
  const texto = resumoSemanal({
    jornada: { numero: 6 },
    equipa: { plantel },
    emRisco: [],
    ligaInteira: [],
    duvidasIA: { jornada: 6, estado: 'ok', achados: [] },
  });
  ok(
    texto.includes('Notícias verificadas'),
    'sem achados, a mensagem diz que verificou — silêncio não é prova'
  );
}

// --- 3b. Desligada ou falhada: a mensagem avisa, nao finge que correu -------
{
  const desligada = resumoSemanal({
    jornada: { numero: 6 },
    equipa: { plantel },
    emRisco: [],
    ligaInteira: [],
    duvidasIA: { jornada: 6, estado: 'desligado', razao: 'ANTHROPIC_API_KEY não está definida', achados: [] },
  });
  ok(desligada.includes('está desligada'), 'IA desligada é avisada na mensagem');
  ok(
    semEscape(desligada).includes('ANTHROPIC_API_KEY'),
    'e diz a razão concreta (depois de o Telegram remover o escape)'
  );

  const falhou = resumoSemanal({
    jornada: { numero: 6 },
    equipa: { plantel },
    emRisco: [],
    ligaInteira: [],
    duvidasIA: { jornada: 6, estado: 'falhou', razao: 'API devolveu 429', achados: [] },
  });
  ok(falhou.includes('falhou'), 'falha da IA é avisada na mensagem');
}

// --- 3c. O link tem de apontar para o host certo ----------------------------
{
  const texto = resumoSemanal({
    jornada: { numero: 6 },
    equipa: { plantel },
    emRisco: [],
    ligaInteira: [],
  });
  ok(
    !texto.includes('www.record.pt/liga-record'),
    'o link partido www.record.pt/liga-record desapareceu'
  );
  ok(texto.includes('liga.record.pt'), 'e aponta para liga.record.pt');
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

// --- 5. O BUG REAL: texto vindo das noticias tem de nao partir o Markdown ---
//
// Aconteceu em producao: o /actualizar respondeu "can't parse entities" e a
// mensagem inteira falhou ao enviar. A causa era um caracter de formatacao
// do Telegram (_ * ` [) dentro do motivo ou do URL que a IA devolveu — texto
// que nao controlamos, ao contrario do resto da mensagem que escrevemos nos.
{
  const boletim = {
    jornada: { numero: 6 },
    equipa: { plantel },
    emRisco: [],
    ligaInteira: [],
    duvidasIA: {
      jornada: 6,
      estado: 'ok',
      achados: [
        {
          nome: 'Zaidu',
          nomeNaNoticia: 'Zaidu_Sanusi [FC Porto]',
          equipa: 'FC Porto',
          tipo: 'lesao',
          motivo: 'Lesão no adutor, fora "pelo menos_3" jogos [fonte: clube]',
          confianca: 'alta',
          fonte: 'https://exemplo.pt/noticia_com_underscore_no_titulo',
        },
      ],
    },
  };

  let rebentou = false;
  let texto = '';
  try {
    texto = resumoSemanal(boletim);
  } catch {
    rebentou = true;
  }

  ok(!rebentou, 'motivo/URL com caracteres de Markdown não rebenta a montagem da mensagem');

  // O teste que importa mesmo: contar pares de cada caractere de formatacao
  // NAO ESCAPADO na mensagem final. Um numero impar e exactamente o que faz
  // o Telegram recusar a mensagem inteira.
  for (const simbolo of ['_', '*', '`']) {
    // Um '\\' antes do simbolo conta como escapado — nao entra na contagem.
    const regex = new RegExp(`(?<!\\\\)\\${simbolo}`, 'g');
    const ocorrencias = (texto.match(regex) ?? []).length;
    ok(
      ocorrencias % 2 === 0,
      `número de '${simbolo}' não escapados é par (fecha tudo o que abre)`,
      `${ocorrencias} ocorrência(s)`
    );
  }

  ok(
    semEscape(texto).includes('Zaidu_Sanusi'),
    'o texto original continua legível depois do Telegram remover o escape'
  );
}

// --- 6. O CASO REAL: artigo com titulo perfeito, epoca errada --------------
//
// Aconteceu em producao: o Zaidu apareceu como lesionado citando um artigo
// do Soccerway sobre "Ausencias da 6.a jornada da Liga Portugal" — titulo
// impecavel — mas datado de 19.09.2024, duas epocas antes da actual. O
// codigo tem de rejeitar isto sozinho, mesmo que o modelo se engane outra
// vez da mesma forma.
{
  const hoje = new Date('2026-09-10');

  ok(
    dataEProvavelmenteActual('2026-09-08', hoje) === true,
    'notícia de há dois dias passa'
  );
  ok(
    dataEProvavelmenteActual('2024-09-19', hoje) === false,
    'o artigo real do Soccerway (2024, duas épocas antes) é rejeitado'
  );
  ok(
    dataEProvavelmenteActual(null, hoje) === true,
    'sem data determinada, o código não penaliza — não sabe, não filtra'
  );
  ok(
    dataEProvavelmenteActual('data esquisita', hoje) === true,
    'uma data que não dá para interpretar não é tratada como inválida'
  );
  ok(
    dataEProvavelmenteActual('2026-11-01', hoje) === false,
    'uma data no futuro (impossível) também é rejeitada'
  );

  // De ponta a ponta, atraves do validar() a serio — nao uma copia da logica.
  const plantel = [{ nome: 'Zaidu', equipa: 'FC Porto', posicao: 'DEF' }];
  const brutoAntigo = {
    achados: [
      {
        nome: 'Zaidu',
        equipa: 'FC Porto',
        tipo: 'lesao',
        motivo: 'Lesão no adutor, ausente na 6.ª jornada',
        confianca: 'alta',
        fonte: 'https://pt.soccerway.com/noticias/ausencias-6-jornada',
        dataNoticia: '2024-09-19',
      },
    ],
  };
  const resultado = validar(brutoAntigo, plantel, { hoje });
  ok(resultado.length === 0, 'de ponta a ponta: o achado de 2024 nunca chega ao boletim');

  const brutoActual = {
    achados: [{ ...brutoAntigo.achados[0], dataNoticia: '2026-09-08' }],
  };
  ok(
    validar(brutoActual, plantel, { hoje }).length === 1,
    'o mesmo achado, com data actual, passa normalmente'
  );
}

// --- 7. A data do artigo aparece na mensagem, quando existe -----------------
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
          tipo: 'lesao',
          motivo: 'Lesão no adutor',
          confianca: 'alta',
          fonte: 'https://exemplo.pt/zaidu',
          dataNoticia: '2026-09-08',
        },
      ],
    },
  });
  ok(texto.includes('2026-09-08'), 'a data da notícia aparece na mensagem, para se poder desconfiar dela');
}

console.log('');
console.log(falhas ? `${falhas} teste(s) a falhar.` : 'Todos os testes da verificação IA passam.');
process.exit(falhas ? 1 : 0);
