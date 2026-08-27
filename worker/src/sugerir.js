import { REGRAS } from './config/endpoints.js';

// -----------------------------------------------------------------------------
// Sugestao de troca.
//
// CORRECCAO IMPORTANTE em relacao a versao anterior: a Liga Record permite
// UMA troca por ronda — vendes um, compras um. Nao ha plano de trocas
// multiplas. Se tiveres tres lesionados, escolhes qual sacrificas e os
// outros dois vao para o banco ou entram na mesma a zero pontos.
//
// Por isso o que interessa nao e "o melhor conjunto", e "qual das trocas
// possiveis vale mais", ordenadas.
// -----------------------------------------------------------------------------

const MAX_OPCOES = 8;

function candidatos(todos, jogador, bloqueados, orcamento) {
  return todos
    .filter(
      (c) =>
        c.posicao === jogador.posicao &&
        c.id !== jogador.id &&
        !bloqueados.has(c.id) &&
        c.custo <= orcamento
    )
    .sort((a, b) => b.mediaPontos - a.mediaPontos)
    .slice(0, MAX_OPCOES);
}

export function sugerirSubstituicoes({
  plantel,
  todosJogadores,
  saldo,
  emRisco,
  idsIndisponiveis,
}) {
  const idsPlantel = new Set(plantel.map((j) => j.id));
  const bloqueados = new Set([...idsIndisponiveis, ...idsPlantel]);

  const porJogador = emRisco.map((jogador) => {
    const orcamento = Number((saldo + jogador.custo).toFixed(2));
    const opcoes = candidatos(todosJogadores, jogador, bloqueados, orcamento).map((c) => ({
      ...c,
      diferencaCusto: Number((c.custo - jogador.custo).toFixed(2)),
      ganhoMedia: Number((c.mediaPontos - jogador.mediaPontos).toFixed(2)),
      sobra: Number((orcamento - c.custo).toFixed(2)),
    }));
    return { sai: jogador, orcamento, opcoes };
  });

  // A troca unica que mais rende. Se houver empate na media, ganha a que
  // deixa mais saldo livre para a ronda seguinte.
  let melhorTroca = null;
  for (const { sai, opcoes } of porJogador) {
    for (const entra of opcoes) {
      const candidata = { sai, entra, ganho: entra.ganhoMedia, sobra: entra.sobra };
      if (
        !melhorTroca ||
        candidata.ganho > melhorTroca.ganho ||
        (candidata.ganho === melhorTroca.ganho && candidata.sobra > melhorTroca.sobra)
      ) {
        melhorTroca = candidata;
      }
    }
  }

  // Quem fica de fora sem troca possivel. E o que precisas de saber para
  // mexer no onze, nao no plantel.
  const semTroca = porJogador
    .filter(({ sai }) => !melhorTroca || melhorTroca.sai.id !== sai.id)
    .map(({ sai }) => sai);

  return {
    trocasPermitidas: REGRAS.trocasPorRonda,
    melhorTroca,
    porJogador,
    ficamNoPlantel: semTroca,
  };
}
