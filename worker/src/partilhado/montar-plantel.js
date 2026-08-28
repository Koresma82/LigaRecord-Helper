// -----------------------------------------------------------------------------
// Construtor de plantel.
//
// O problema: escolher 23 jogadores (3 GR, 8 DEF, 8 MED, 4 AVA) dentro de
// 40M, maximizando pontos, com alguns jogadores ja fixados por ti.
//
// Nao e ganancia: escolher os melhores um a um estoura o orcamento nos
// primeiros e deixa-te com nove jogadores de 500.000 no fim. E um knapsack
// com quatro grupos a partilhar a mesma carteira, e resolve-se exacto por
// programacao dinamica — os valores da Liga Record vem em multiplos de
// 50.000, o que da 800 degraus de orcamento. Corre em milissegundos.
//
// Usado pelo worker e pelo browser, por isso: sem dependencias.
// -----------------------------------------------------------------------------

export const FORMACAO = { GR: 3, DEF: 8, MED: 8, AVA: 4 };
export const ORCAMENTO = 40;          // milhoes
export const DEGRAU = 0.05;           // 50.000

const emDegraus = (milhoes) => Math.round(milhoes / DEGRAU);

// Para um grupo de posicao: melhor pontuacao escolhendo exactamente `quantos`
// jogadores, para cada orcamento possivel.
//
// Guardamos a decisao para CADA jogador em vez de so a ultima por celula.
// Sem isso o valor sai certo mas a reconstrucao pode escolher o mesmo
// jogador duas vezes — foi exactamente o que aconteceu na primeira versao.
function melhoresPorGrupo(jogadores, quantos, tectoDegraus) {
  const INVALIDO = -Infinity;
  const largura = tectoDegraus + 1;
  const n = jogadores.length;

  let valores = Array.from({ length: quantos + 1 }, () =>
    new Float64Array(largura).fill(INVALIDO)
  );
  valores[0].fill(0);

  // usou[i * (quantos+1) * largura + k * largura + c] = 1 se o jogador i
  // entra na solucao optima para (k, c) considerando os jogadores ate i.
  const usou = new Uint8Array(n * (quantos + 1) * largura);

  for (let i = 0; i < n; i++) {
    const jogador = jogadores[i];
    const custo = emDegraus(jogador.custo);
    const base = i * (quantos + 1) * largura;

    if (custo > 0 && custo <= tectoDegraus) {
      for (let k = quantos; k >= 1; k--) {
        const anterior = valores[k - 1];
        const actual = valores[k];
        const deslocamento = base + k * largura;
        for (let c = tectoDegraus; c >= custo; c--) {
          const anteriorValor = anterior[c - custo];
          if (anteriorValor === INVALIDO) continue;
          const candidato = anteriorValor + jogador.pontos;
          if (candidato > actual[c]) {
            actual[c] = candidato;
            usou[deslocamento + c] = 1;
          }
        }
      }
    }
  }

  return { valores, usou, largura, quantos, jogadores };
}

// Anda para tras pelos jogadores: se `usou` marcou este, ele entra.
// Como cada jogador so e visitado uma vez, nao ha repeticoes possiveis.
function reconstruirGrupo(grupo, custoFinal) {
  if (!grupo || grupo.quantos === 0) return [];
  const { usou, largura, quantos, jogadores } = grupo;

  const escolhidos = [];
  let k = quantos;
  let c = custoFinal;

  for (let i = jogadores.length - 1; i >= 0 && k > 0; i--) {
    const marca = usou[i * (quantos + 1) * largura + k * largura + c];
    if (!marca) continue;
    const jogador = jogadores[i];
    escolhidos.push(jogador);
    c -= emDegraus(jogador.custo);
    k -= 1;
  }

  return escolhidos;
}

function reconstruir(grupos, custosFinais) {
  const equipa = [];
  for (const [posicao, grupo] of Object.entries(grupos)) {
    equipa.push(...reconstruirGrupo(grupo, custosFinais[posicao]));
  }
  return equipa;
}

/**
 * @param todosJogadores  [{id, nome, equipa, posicao, custo, pontos}]
 * @param fixos           ids que tens de incluir obrigatoriamente
 * @param orcamento       milhoes disponiveis (por omissao 40)
 *
 * Nota: nao ha limite de jogadores por clube. A FAQ da Liga Record diz
 * expressamente que nao existe essa limitacao — ao contrario do Fantasy da
 * Liga Portugal, que impoe tres. Se isso mudar, o limite obriga a uma
 * dimensao extra na DP e nao a um filtro previo, que foi o que eu tentei
 * primeiro e dava plantéis impossiveis de completar.
 */
export function montarPlantel({
  todosJogadores,
  fixos = [],
  orcamento = ORCAMENTO,
  formacao = FORMACAO,
}) {
  const porId = new Map(todosJogadores.map((j) => [String(j.id), j]));

  // 1. Separar os fixos e descontar o que ja gastam.
  const escolhidos = [];
  const idsFixos = new Set(fixos.map(String));
  const naoEncontrados = [];

  for (const id of idsFixos) {
    const j = porId.get(id);
    if (j) escolhidos.push(j);
    else naoEncontrados.push(id);
  }

  const gastoFixo = escolhidos.reduce((s, j) => s + j.custo, 0);
  let restante = Number((orcamento - gastoFixo).toFixed(2));

  // 2. Quantos faltam por posicao.
  const faltam = { ...formacao };
  for (const j of escolhidos) {
    if (faltam[j.posicao] === undefined) continue;
    faltam[j.posicao] -= 1;
  }

  const excesso = Object.entries(faltam).filter(([, n]) => n < 0);
  if (excesso.length) {
    return {
      erro:
        `Fixaste jogadores a mais em ${excesso.map(([p]) => p).join(', ')}. ` +
        `A formacao e ${Object.entries(formacao).map(([p, n]) => `${n} ${p}`).join(', ')}.`,
    };
  }

  if (restante < 0) {
    return {
      erro: `Os jogadores fixos custam ${gastoFixo.toFixed(2)}M e o orcamento e ${orcamento}M.`,
    };
  }

  // 3. Candidatos: tudo o que nao esta fixo. Se houver limite por clube,
  //    corta-se aqui de forma aproximada (os melhores N de cada clube).
  const candidatos = todosJogadores.filter((j) => !idsFixos.has(String(j.id)));

  const tecto = emDegraus(restante);

  // 4. Uma tabela por posicao.
  const grupos = {};
  for (const [posicao, quantos] of Object.entries(faltam)) {
    if (quantos === 0) {
      grupos[posicao] = { quantos: 0, jogadores: [] };
      continue;
    }
    const doGrupo = candidatos.filter((j) => j.posicao === posicao);
    if (doGrupo.length < quantos) {
      return { erro: `So ha ${doGrupo.length} jogadores em ${posicao} e precisas de ${quantos}.` };
    }
    grupos[posicao] = melhoresPorGrupo(doGrupo, quantos, tecto);
  }

  // 5. Combinar os quatro grupos: distribuir o orcamento entre eles.
  const posicoes = Object.keys(grupos).filter((p) => grupos[p].quantos > 0);
  const INVALIDO = -Infinity;

  let acumulado = new Float64Array(tecto + 1).fill(INVALIDO);
  acumulado[0] = 0;
  let repartição = [new Int32Array(tecto + 1).fill(0)];

  for (let i = 0; i < posicoes.length; i++) {
    const linha = grupos[posicoes[i]].valores[grupos[posicoes[i]].quantos];
    const seguinte = new Float64Array(tecto + 1).fill(INVALIDO);
    const usado = new Int32Array(tecto + 1).fill(-1);

    for (let c = 0; c <= tecto; c++) {
      if (acumulado[c] === INVALIDO) continue;
      for (let d = 0; c + d <= tecto; d++) {
        if (linha[d] === INVALIDO) continue;
        const total = acumulado[c] + linha[d];
        if (total > seguinte[c + d]) {
          seguinte[c + d] = total;
          usado[c + d] = d;
        }
      }
    }

    acumulado = seguinte;
    repartição.push(usado);
  }

  // 6. Melhor total, e reconstruir a repartição do orcamento.
  let melhorCusto = -1;
  let melhorPontos = INVALIDO;
  for (let c = 0; c <= tecto; c++) {
    if (acumulado[c] > melhorPontos) {
      melhorPontos = acumulado[c];
      melhorCusto = c;
    }
  }

  if (melhorCusto < 0 || melhorPontos === INVALIDO) {
    return { erro: `Nao ha combinacao possivel com ${restante.toFixed(2)}M.` };
  }

  const custosFinais = {};
  let sobra = melhorCusto;
  for (let i = posicoes.length; i >= 1; i--) {
    const d = repartição[i][sobra];
    custosFinais[posicoes[i - 1]] = d;
    sobra -= d;
  }
  for (const p of Object.keys(grupos)) if (!(p in custosFinais)) custosFinais[p] = 0;

  const sugeridos = reconstruir(grupos, custosFinais);
  const plantel = [...escolhidos, ...sugeridos];
  const custoTotal = plantel.reduce((s, j) => s + j.custo, 0);

  return {
    plantel: plantel.sort(
      (a, b) =>
        ['GR', 'DEF', 'MED', 'AVA'].indexOf(a.posicao) -
          ['GR', 'DEF', 'MED', 'AVA'].indexOf(b.posicao) || b.pontos - a.pontos
    ),
    fixos: escolhidos,
    sugeridos,
    custoTotal: Number(custoTotal.toFixed(2)),
    sobra: Number((orcamento - custoTotal).toFixed(2)),
    pontosTotais: Number((melhorPontos + escolhidos.reduce((s, j) => s + j.pontos, 0)).toFixed(1)),
    naoEncontrados,
  };
}
