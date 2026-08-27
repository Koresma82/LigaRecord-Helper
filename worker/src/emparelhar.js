import { semelhanca, equipaCanonica } from './normalizar.js';

const LIMIAR = 0.7;
const MARGEM_AMBIGUIDADE = 0.12;

// Liga cada jogador da Liga Record a uma entrada do boletim de ausencias.
// Devolve tambem os casos duvidosos, para nao fingirmos certezas que nao temos.
export function emparelhar(jogadoresLR, ausencias) {
  const ligados = [];
  const ambiguos = [];
  const semCorrespondencia = [];

  // Indexar ausencias por equipa reduz o problema de N*M para algo trivial
  // e, mais importante, impede que o "Silva" do Braga case com o do Porto.
  const porEquipa = new Map();
  for (const a of ausencias) {
    const chave = equipaCanonica(a.equipa);
    if (!porEquipa.has(chave)) porEquipa.set(chave, []);
    porEquipa.get(chave).push(a);
  }

  for (const jogador of jogadoresLR) {
    const candidatos = porEquipa.get(equipaCanonica(jogador.equipa)) ?? [];

    const pontuados = candidatos
      .map((a) => ({ ausencia: a, pontos: semelhanca(jogador.nome, a.nome) }))
      .filter((c) => c.pontos >= LIMIAR)
      .sort((x, y) => y.pontos - x.pontos);

    if (!pontuados.length) {
      semCorrespondencia.push(jogador);
      continue;
    }

    const [melhor, segundo] = pontuados;

    if (segundo && melhor.pontos - segundo.pontos < MARGEM_AMBIGUIDADE) {
      // Dois candidatos igualmente plausiveis. Marcamos e mostramos ambos
      // na app em vez de escolher a sorte.
      ambiguos.push({
        jogador,
        hipoteses: pontuados.slice(0, 3).map((p) => p.ausencia),
      });
      continue;
    }

    ligados.push({
      ...jogador,
      ausencia: melhor.ausencia,
      confianca: Number(melhor.pontos.toFixed(2)),
    });
  }

  return { ligados, ambiguos, semCorrespondencia };
}
