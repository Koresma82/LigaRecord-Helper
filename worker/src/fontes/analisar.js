// -----------------------------------------------------------------------------
// Leitura dos cartoes de jogador.
//
// A estrutura real, confirmada no inspector:
//
//   <article class="player-card player-search-itm"
//            data-position="goalkeeper" id="playerSearched41768">
//     <figure>… nome, clube, pontos, % …</figure>
//     <div class="value">
//       <div class="value-va">€ 2.000.000 V.A.</div>
//       <div class="value-vi">€ 2.000.000 V.I.</div>
//     </div>
//     <a href="javascript:BuyPlayer('41768')">…</a>
//   </article>
//
// O id verdadeiro do jogador esta em dois sitios (o id do article e o
// argumento do BuyPlayer). Usamos esse — nao o nome — como chave.
// -----------------------------------------------------------------------------

const POSICAO_POR_DADOS = {
  goalkeeper: 'GR',
  defender: 'DEF',
  midfielder: 'MED',
  forward: 'AVA',
  striker: 'AVA',
};

const POSICAO_POR_TEXTO = [
  ['guarda', 'GR'],
  ['defesa', 'DEF'],
  ['medio', 'MED'],
  ['médio', 'MED'],
  ['avancado', 'AVA'],
  ['avançado', 'AVA'],
];

export function detectarPosicao(texto = '') {
  const t = texto.toLowerCase();
  for (const [marca, sigla] of POSICAO_POR_TEXTO) if (t.includes(marca)) return sigla;
  return null;
}

// Os valores vem com &nbsp;: "€ 2.000.000 V.A." -> 2.0 (milhoes)
export function paraMilhoes(texto = '') {
  const limpo = String(texto).replace(/\u00a0/g, ' ');
  const m = limpo.match(/€\s*([\d.\s]+)/);
  if (!m) return 0;
  const n = Number(m[1].replace(/[.\s]/g, ''));
  return Number.isFinite(n) ? Number((n / 1_000_000).toFixed(3)) : 0;
}

// "24,85 %" -> 24.85
export function paraPercentagem(texto = '') {
  const m = String(texto).replace(/\u00a0/g, ' ').match(/([\d,.]+)\s*%/);
  return m ? Number(m[1].replace(',', '.')) : null;
}

function texto($, el) {
  return $(el).text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function lerCartao($, el) {
  const $c = $(el);

  // 1. Id: do BuyPlayer, ou do id do article.
  const accao = $c.find('a[href*="BuyPlayer"]').attr('href') ?? '';
  const id =
    accao.match(/BuyPlayer\('(\d+)'\)/)?.[1] ??
    ($c.attr('id') ?? '').match(/(\d+)/)?.[1] ??
    null;

  // 2. Posicao: do data-position, que e fiavel; texto so como recurso.
  const posicao =
    POSICAO_POR_DADOS[($c.attr('data-position') ?? '').toLowerCase()] ??
    detectarPosicao(texto($, el));
  if (!posicao) return null;

  // 3. Valores: classes proprias, sem ambiguidade.
  const custo = paraMilhoes(texto($, $c.find('.value-va')));
  const valorInicial = paraMilhoes(texto($, $c.find('.value-vi'))) || custo;
  if (!custo) return null;

  // 4. Nome, clube, pontos e % vem da figure. O nome e a primeira linha.
  const $figura = $c.find('figure');
  const bloco = texto($, $figura.length ? $figura : $c);

  const pontos = Number(bloco.match(/(-?\d+)\s*PTS/i)?.[1] ?? 0);
  const percentagemEquipas = paraPercentagem(bloco);

  const rotulo = POSICAO_POR_TEXTO.find(([m]) => bloco.toLowerCase().includes(m))?.[0];
  let nome = '';
  let equipa = '';

  if (rotulo) {
    const i = bloco.toLowerCase().indexOf(rotulo);
    nome = bloco.slice(0, i).replace(/[\d.,%€\s-]+$/, '').trim();
    equipa = bloco
      .slice(i + rotulo.length)
      .trim()
      .replace(/^redes/i, '')
      .split(/[\d€]/)[0]
      // "Benfica -2 PTS" deixa um hifen agarrado ao nome do clube.
      .replace(/[-\u2013\s]+$/, '')
      .trim();
  } else {
    nome = bloco.split(/\s{2,}|\d/)[0].trim();
  }

  if (!nome || nome.length > 60) return null;

  return {
    id: String(id ?? `${nome}|${equipa}`),
    nome,
    equipa,
    posicao,
    custo,
    valorInicial,
    valorizacao: Number((custo - valorInicial).toFixed(3)),
    pontosTotais: pontos,
    mediaPontos: pontos,
    percentagemEquipas,
    // Sem botao de compra = ja e teu.
    noPlantel: !accao,
  };
}

export function lerJogadores($) {
  // Selector especifico primeiro. Se um dia mudarem as classes, cai no
  // heuristico: qualquer bloco que tenha um valor em euros e uma posicao.
  let elementos = $('article.player-card').toArray();

  if (!elementos.length) {
    elementos = $('*')
      .filter((_, el) => {
        const proprio = $(el).clone().children().remove().end().text();
        return /V\.?A\.?/i.test(proprio) && /€/.test(proprio);
      })
      .map((_, el) => {
        let $no = $(el);
        for (let i = 0; i < 6; i++) {
          const $pai = $no.parent();
          if (!$pai.length) break;
          $no = $pai;
          if (detectarPosicao($no.text())) break;
        }
        return $no[0];
      })
      .toArray();
  }

  const porId = new Map();
  for (const el of elementos) {
    const j = lerCartao($, el);
    if (j && !porId.has(j.id)) porId.set(j.id, j);
  }
  return [...porId.values()];
}
