import { castigosPorAcumulacao } from '../src/fontes/disciplina.js';
import { actualizarCastigosActivos } from '../src/castigos-activos.js';

// -----------------------------------------------------------------------------
// Testes da deteccao e persistencia de castigos.
//
// Cada um destes reproduz um bug que existiu. Se algum falhar, o bug voltou.
//   npm run teste-castigos
// -----------------------------------------------------------------------------

let falhas = 0;
function ok(condicao, nome, extra = '') {
  console.log(`${condicao ? 'OK   ' : 'FALHA'} ${nome}${extra ? `  — ${extra}` : ''}`);
  if (!condicao) falhas++;
}

const jogador = (nome, equipa, amarelos, vermelhos = 0, id = null) => ({
  nome,
  equipa,
  posicao: 'MED',
  amarelos,
  vermelhos,
  ...(id ? { id } : {}),
});

// --- 1. A travessia do multiplo de 5 e detectada -----------------------------
{
  const antes = [jogador('Otávio', 'FC Porto', 4)];
  const agora = [jogador('Otávio', 'FC Porto', 5)];
  const r = castigosPorAcumulacao(agora, antes, {
    fonte: 'ligaportugal',
    fonteAnterior: 'ligaportugal',
    jornada: 6,
  });
  ok(
    r.castigados.length === 1 && r.castigados[0].certeza === 'alta',
    'travessia do 5.º amarelo detectada com certeza alta'
  );
  ok(r.castigados[0].jornadaAplicavel === 6, 'castigo fica agarrado à jornada 6');
}

// --- 2. Quem ja la estava parado NAO e castigado -----------------------------
{
  const antes = [jogador('Otávio', 'FC Porto', 5)];
  const agora = [jogador('Otávio', 'FC Porto', 5)];
  const r = castigosPorAcumulacao(agora, antes, {
    fonte: 'ligaportugal',
    fonteAnterior: 'ligaportugal',
    jornada: 7,
  });
  ok(r.castigados.length === 0, '5 amarelos parados não voltam a castigar');
}

// --- 3. O BUG PRINCIPAL: o castigo tem de sobreviver ate a jornada ser jogada -
{
  // Segunda-feira: 5.º amarelo, aplica-se a jornada 6.
  const detectados = castigosPorAcumulacao(
    [jogador('Otávio', 'FC Porto', 5)],
    [jogador('Otávio', 'FC Porto', 4)],
    { fonte: 'ligaportugal', fonteAnterior: 'ligaportugal', jornada: 6 }
  ).castigados.filter((c) => c.certeza === 'alta');

  let activos = actualizarCastigosActivos({
    guardados: [],
    detectados,
    proximaJornada: 6,
  });
  ok(activos.length === 1, 'segunda: castigo activo');

  // Terca a sexta: a contagem ja nao muda, nao ha travessia nenhuma.
  // ANTES DA CORRECCAO o jogador desaparecia aqui.
  for (const dia of ['terça', 'quarta', 'quinta', 'sexta']) {
    const semTravessia = castigosPorAcumulacao(
      [jogador('Otávio', 'FC Porto', 5)],
      [jogador('Otávio', 'FC Porto', 5)],
      { fonte: 'ligaportugal', fonteAnterior: 'ligaportugal', jornada: 6 }
    ).castigados.filter((c) => c.certeza === 'alta');

    activos = actualizarCastigosActivos({
      guardados: activos,
      detectados: semTravessia,
      proximaJornada: 6,
    });
    ok(activos.length === 1, `${dia}: castigo continua activo`);
  }

  // Jogada a jornada 6, a proxima passa a 7 e o castigo sai sozinho.
  activos = actualizarCastigosActivos({
    guardados: activos,
    detectados: [],
    proximaJornada: 7,
  });
  ok(activos.length === 0, 'jornada 6 jogada: castigo cumprido e removido');
}

// --- 4. O BUG DA CHAVE: mudanca de grafia nao pode partir a comparacao -------
{
  // Mesma pessoa, escrita como cada fonte a escreve, mas com o mesmo id.
  const antes = [{ ...jogador('Pavlidis', 'Benfica', 4), id: 42896 }];
  const agora = [{ ...jogador('Vangelis Pavlidis', 'SL Benfica', 5), id: 42896 }];
  const r = castigosPorAcumulacao(agora, antes, {
    fonte: 'ligaportugal',
    fonteAnterior: 'ligaportugal',
    jornada: 6,
  });
  ok(r.castigados.length === 1, 'mesmo id liga apesar do nome e do clube mudarem de grafia');
}
{
  // Sem id, so o nome e o clube — a normalizacao tem de chegar.
  const antes = [jogador('Gonçalo Paciência', 'Sp. Braga', 4)];
  const agora = [jogador('Goncalo Paciencia', 'SC Braga', 5)];
  const r = castigosPorAcumulacao(agora, antes, {
    fonte: 'maisfutebol',
    fonteAnterior: 'maisfutebol',
    jornada: 6,
  });
  ok(r.castigados.length === 1, 'acentos e prefixo do clube não partem a chave');
}

// --- 5. Fontes diferentes nao se comparam ------------------------------------
{
  const antes = [jogador('Otávio', 'FC Porto', 4)];
  const agora = [jogador('Otávio', 'FC Porto', 5)];
  const r = castigosPorAcumulacao(agora, antes, {
    fonte: 'maisfutebol',
    fonteAnterior: 'ligaportugal',
    jornada: 6,
  });
  ok(!r.comparavel, 'mudança de fonte marca a comparação como não legítima');
  ok(
    r.castigados.every((c) => c.certeza === 'baixa'),
    'sem certeza alta quando a fonte mudou',
    `certezas: ${r.castigados.map((c) => c.certeza).join(', ') || 'nenhuma'}`
  );
}

// --- 6. A um amarelo do castigo ----------------------------------------------
{
  const r = castigosPorAcumulacao([jogador('Zaidu', 'Benfica', 4)], [], {
    fonte: 'ligaportugal',
    jornada: 6,
  });
  ok(r.emRisco.length === 1, '4 amarelos entra em risco, não em castigo');
  ok(r.castigados.length === 0, '4 amarelos não é castigo');
}

// --- 7. Um jogador so gera UMA linha activa ----------------------------------
{
  // Vermelho e 5.o amarelo na mesma jornada. Duas linhas com o mesmo nome
  // punham o emparelhador em ambiguidade e o jogador sumia do boletim.
  const detectados = castigosPorAcumulacao(
    [jogador('Bednarek', 'Benfica', 5, 1)],
    [jogador('Bednarek', 'Benfica', 4, 0)],
    { fonte: 'ligaportugal', fonteAnterior: 'ligaportugal', jornada: 6 }
  ).castigados.filter((c) => c.certeza === 'alta');

  ok(detectados.length === 2, 'a detecção reporta os dois motivos');

  const activos = actualizarCastigosActivos({ guardados: [], detectados, proximaJornada: 6 });
  ok(activos.length === 1, 'mas só fica uma linha activa por jogador');
  ok(activos[0].duracaoIncerta === true, 'e é a do vermelho, a mais grave');
}

// --- 8. Sem jornada conhecida nao se limpa nada ------------------------------
{
  const guardados = [
    { chave: 'id:1', nome: 'X', equipa: 'Y', tipo: 'castigo', jornadaAplicavel: 6 },
  ];
  const activos = actualizarCastigosActivos({ guardados, detectados: [], proximaJornada: null });
  ok(activos.length === 1, 'jornada indeterminada não descarta castigos');
}

console.log('');
console.log(falhas ? `${falhas} teste(s) a falhar.` : 'Todos os testes de castigos passam.');
process.exit(falhas ? 1 : 0);
