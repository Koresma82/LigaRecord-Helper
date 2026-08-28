// -----------------------------------------------------------------------------
// Castigos por acumulacao de amarelos.
//
// REGRA (artigo 164.º n.º 7 do RDLPFP): uma serie de 5 cartoes amarelos da
// 1 jogo de suspensao. Amarelos da Taca, Supertaca e Taca da Liga nao
// contam, e a contagem nao transita de epoca.
//
// A ARMADILHA: a tabela de disciplina mostra TOTAIS ACUMULADOS, nao quem
// esta castigado. Um jogador com 5 amarelos pode ja ter cumprido na jornada
// passada. Ler "amarelos % 5 === 0" como "castigado" produz falsos
// positivos — e um falso positivo faz-te gastar a UNICA troca da ronda a
// tirar alguem que podia jogar.
//
// Por isso comparamos com a recolha anterior: interessa quem ATRAVESSOU um
// multiplo de 5 desde a ultima vez, nao quem la esta parado.
//
// Os dados vem de fontes/zerozero.js (disciplinaDaLiga).
// -----------------------------------------------------------------------------

const SERIE = 5;

export function castigosPorAcumulacao(actuais, anteriores) {
  const antes = new Map((anteriores ?? []).map((c) => [`${c.nome}|${c.equipa}`, c]));

  const castigados = [];
  const emRisco = [];

  for (const c of actuais) {
    const anterior = antes.get(`${c.nome}|${c.equipa}`);

    const serieActual = Math.floor(c.amarelos / SERIE);
    const serieAnterior = anterior ? Math.floor(anterior.amarelos / SERIE) : null;

    if (serieAnterior !== null && serieActual > serieAnterior) {
      castigados.push({
        nome: c.nome,
        equipa: c.equipa,
        posicao: c.posicao,
        tipo: 'castigo',
        motivo: `${c.amarelos}.º cartão amarelo — um jogo de suspensão`,
        certeza: 'alta',
        fonte: 'zerozero',
      });
    } else if (serieAnterior === null && c.amarelos > 0 && c.amarelos % SERIE === 0) {
      // Primeira recolha: nao ha com que comparar. Pode ja ter cumprido.
      castigados.push({
        nome: c.nome,
        equipa: c.equipa,
        posicao: c.posicao,
        tipo: 'castigo',
        motivo: `${c.amarelos} amarelos (múltiplo de ${SERIE}) — pode já ter cumprido`,
        certeza: 'baixa',
        fonte: 'zerozero',
      });
    } else if (c.amarelos % SERIE === SERIE - 1) {
      // A um amarelo do castigo. Nao e ausencia, e um aviso util.
      emRisco.push({
        nome: c.nome,
        equipa: c.equipa,
        posicao: c.posicao,
        amarelos: c.amarelos,
      });
    }

    // Expulsoes: suspensao certa, duracao decidida pelo Conselho de
    // Disciplina. Nao da para calcular quantos jogos.
    if (anterior && c.vermelhos > anterior.vermelhos) {
      castigados.push({
        nome: c.nome,
        equipa: c.equipa,
        posicao: c.posicao,
        tipo: 'castigo',
        motivo: 'Expulso — suspensão de pelo menos um jogo, duração por decidir',
        certeza: 'alta',
        fonte: 'zerozero',
      });
    }
  }

  return { castigados, emRisco };
}
