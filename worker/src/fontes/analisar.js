// -----------------------------------------------------------------------------
// Leitura dos jogadores.
//
// O playersearch.ashx devolve JSON, nao HTML. Um objecto por jogador:
//
//   {"Id":42896,"IdPlayer":42896,"Name":"Pavlidis","NameClub":"Benfica",
//    "ShirtUrl":"...","PhotoUrl":"/common/images/photos/p42896.jpg",
//    "PlayerPosition":"AV","InitialValue":6000000,"CurrentValue":...,
//    "Points":0,"PercentTeams":"55,45","RenegotiationAvailable":false,
//    "InTeam":true}
//
// Isto e muito melhor do que raspar cartoes: nada de selectores para
// partir, ids verdadeiros, e valores em numero em vez de texto formatado.
// A leitura de HTML fica so para a pagina do plantel.
// -----------------------------------------------------------------------------

const POSICAO = { GR: 'GR', DF: 'DEF', MD: 'MED', AV: 'AVA' };

// Os valores vem em euros: 6000000 -> 6.0
const paraMilhoesNumero = (n) =>
  Number.isFinite(Number(n)) ? Number((Number(n) / 1_000_000).toFixed(3)) : 0;

// "55,45" -> 55.45
const percentagem = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export function lerJogadorJSON(bruto) {
  const id = bruto.IdPlayer ?? bruto.Id;
  const nome = bruto.Name;
  if (!id || !nome) return null;

  const posicao = POSICAO[bruto.PlayerPosition] ?? bruto.PlayerPosition ?? null;
  if (!posicao) return null;

  const custo = paraMilhoesNumero(bruto.CurrentValue);
  const valorInicial = paraMilhoesNumero(bruto.InitialValue) || custo;

  // "PointsTotal" aparece truncado na captura; aceitamos as variantes.
  const pontosTotais = Number(
    bruto.PointsTotal ?? bruto.PointsTotais ?? bruto.TotalPoints ?? bruto.Points ?? 0
  );

  return {
    id: String(id),
    nome: String(nome).trim(),
    equipa: bruto.NameClub ?? '',
    posicao,
    custo,
    valorInicial,
    valorizacao: Number((custo - valorInicial).toFixed(3)),
    pontosTotais,
    mediaPontos: pontosTotais,
    pontosUltimaRonda: Number(bruto.Points ?? 0),
    percentagemEquipas: percentagem(bruto.PercentTeams),
    // ATENCAO: na captura vinha true para todos os jogadores do Benfica com
    // o plantel vazio, por isso NAO significa "esta na minha equipa".
    // Fica guardado, mas quem decide o plantel e a pagina plantel.aspx.
    inTeam: bruto.InTeam ?? null,
    renegociavel: bruto.RenegotiationAvailable ?? null,
  };
}

export function lerJogadoresJSON(texto) {
  let dados;
  try {
    dados = typeof texto === 'string' ? JSON.parse(texto) : texto;
  } catch {
    return null; // nao e JSON — quem chama que tente o HTML
  }

  const lista = Array.isArray(dados)
    ? dados
    : Array.isArray(dados?.data)
      ? dados.data
      : Array.isArray(dados?.Players)
        ? dados.Players
        : null;

  if (!lista) return null;

  const porId = new Map();
  for (const bruto of lista) {
    const j = lerJogadorJSON(bruto);
    if (j && !porId.has(j.id)) porId.set(j.id, j);
  }
  return [...porId.values()];
}

// -----------------------------------------------------------------------------
// Leitura de HTML, para a pagina do plantel (essa continua a ser cartoes).
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

export function paraMilhoes(texto = '') {
  const limpo = String(texto).replace(/\u00a0/g, ' ');
  const m = limpo.match(/€\s*([\d.\s]+)/);
  if (!m) return 0;
  const n = Number(m[1].replace(/[.\s]/g, ''));
  return Number.isFinite(n) ? Number((n / 1_000_000).toFixed(3)) : 0;
}

export function paraPercentagem(texto = '') {
  const m = String(texto).replace(/\u00a0/g, ' ').match(/([\d,.]+)\s*%/);
  return m ? Number(m[1].replace(',', '.')) : null;
}

const textoDe = ($, el) =>
  $(el).text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

export function lerCartao($, el) {
  const $c = $(el);

  const accao = $c.find('a[href*="BuyPlayer"]').attr('href') ?? '';
  const id =
    accao.match(/BuyPlayer\('(\d+)'\)/)?.[1] ??
    ($c.attr('id') ?? '').match(/(\d+)/)?.[1] ??
    null;

  const posicao =
    POSICAO_POR_DADOS[($c.attr('data-position') ?? '').toLowerCase()] ??
    detectarPosicao(textoDe($, el));
  if (!posicao) return null;

  const custo = paraMilhoes(textoDe($, $c.find('.value-va')));
  const valorInicial = paraMilhoes(textoDe($, $c.find('.value-vi'))) || custo;
  if (!custo) return null;

  const $figura = $c.find('figure');
  const bloco = textoDe($, $figura.length ? $figura : $c);

  const pontos = Number(bloco.match(/(-?\d+)\s*PTS/i)?.[1] ?? 0);
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
    percentagemEquipas: paraPercentagem(bloco),
    noPlantel: !accao,
  };
}

export function lerJogadores($) {
  const elementos = $('article.player-card').toArray();

  const porId = new Map();
  for (const el of elementos) {
    const j = lerCartao($, el);
    if (j && !porId.has(j.id)) porId.set(j.id, j);
  }
  return [...porId.values()];
}
