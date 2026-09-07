import { getHTML } from '../lib-http.js';

// -----------------------------------------------------------------------------
// API oficial da Liga Portugal.
//
//   https://www.ligaportugal.pt/api/v2/competition/top/players
//     ?competition=ligaportugalbetclic&season=20262027&size=20&statId=NNN
//
// JSON, da fonte autoritativa, com quatro estatisticas num formato so.
// Substitui o raspar de HTML do maisfutebol e do zerozero, que continuam
// como alternativa.
//
// A resposta e enorme (centenas de kB) porque cada jogador traz o historico
// de videos e os titulos do clube. Ignoramos tudo isso — o que interessa
// esta nos primeiros campos de cada entrada:
//
//   { playerId, teamId, playerName, teamName, rankingPosition, total,
//     player: { position, fullName, ... } }
//
// O playerName vem na forma curta ("Pavlidis"), que e a mesma que a Liga
// Record usa. Guardamos tambem o fullName para o emparelhador ter duas
// hipoteses.
// -----------------------------------------------------------------------------

const BASE = 'https://www.ligaportugal.pt/api/v2/competition/top/players';

const COMPETICAO = process.env.LP_COMPETICAO ?? 'ligaportugalbetclic';
const EPOCA = process.env.LP_EPOCA ?? '20262027';

// O `size` da pagina web e 20 (o top que ela mostra). Pedimos mais, porque
// precisamos da lista toda: um jogador com 4 amarelos pode estar em 60.o
// lugar e ser exactamente o que interessa avisar.
const TAMANHO = Number(process.env.LP_TAMANHO ?? 400);

export const ESTATISTICAS = {
  golos: 142,
  assistencias: 3,
  amarelos: 10139,
  vermelhos: 50,
};

const POSICOES = {
  'guarda-redes': 'GR',
  defesa: 'DEF',
  'médio': 'MED',
  medio: 'MED',
  'avançado': 'AVA',
  avancado: 'AVA',
};

function siglaPosicao(texto = '') {
  const n = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return POSICOES[n] ?? POSICOES[texto.toLowerCase()] ?? null;
}

function url(statId, tamanho) {
  const p = new URLSearchParams({
    competition: COMPETICAO,
    season: EPOCA,
    size: String(tamanho),
    statId: String(statId),
  });
  return `${BASE}?${p}`;
}

export function lerLideres(texto) {
  let dados;
  try {
    dados = typeof texto === 'string' ? JSON.parse(texto) : texto;
  } catch {
    return null;
  }

  // A resposta e um array com um elemento por statId pedido.
  const blocos = Array.isArray(dados) ? dados : [dados];
  const lideres = blocos.flatMap((b) => b?.leaders ?? []);

  return lideres
    .map((l) => {
      const nome = l.playerName ?? l.player?.name;
      if (!nome) return null;

      return {
        id: l.playerId != null ? String(l.playerId) : null,
        nome,
        nomeCompleto: l.player?.fullName ?? null,
        equipa: l.teamName ?? l.team?.name ?? '',
        posicao: siglaPosicao(l.player?.position ?? ''),
        total: Number(l.total ?? 0),
        posicaoRanking: l.rankingPosition ?? null,
      };
    })
    .filter(Boolean);
}

async function buscar(nome, statId, { log = () => {}, tamanho = TAMANHO } = {}) {
  const texto = await getHTML(url(statId, tamanho));
  const lideres = lerLideres(texto);

  if (!lideres) {
    throw new Error(
      `A API da Liga Portugal respondeu, mas nao era JSON (${nome}, statId ${statId}).`
    );
  }

  log(`  ${nome}: ${lideres.length} jogadores`);
  return lideres;
}

export const golosDaLiga = (o) => buscar('Golos', ESTATISTICAS.golos, o);
export const assistenciasDaLiga = (o) => buscar('Assistencias', ESTATISTICAS.assistencias, o);
export const amarelosDaLiga = (o) => buscar('Amarelos', ESTATISTICAS.amarelos, o);
export const vermelhosDaLiga = (o) => buscar('Vermelhos', ESTATISTICAS.vermelhos, o);

// -----------------------------------------------------------------------------
// Tudo junto, no formato que o resto do worker ja espera.
//
// A API tem uma vantagem grande sobre o que tinhamos: o playerId. Cruzar
// amarelos com vermelhos por ID e exacto, sem depender de nomes.
// -----------------------------------------------------------------------------

export async function disciplinaDaLiga({ log = () => {} } = {}) {
  const [amarelos, vermelhos] = await Promise.all([
    amarelosDaLiga({ log }),
    vermelhosDaLiga({ log }),
  ]);

  const porId = new Map();

  const registar = (lista, campo) => {
    for (const l of lista) {
      const chave = l.id ?? `${l.nome}|${l.equipa}`;
      const actual = porId.get(chave) ?? {
        id: l.id,
        nome: l.nome,
        nomeCompleto: l.nomeCompleto,
        equipa: l.equipa,
        posicao: l.posicao,
        amarelos: 0,
        vermelhos: 0,
        // A API nao separa duplo amarelo de vermelho directo. Para efeito
        // de castigo tanto faz — ambos suspendem o jogo seguinte.
        duplosAmarelos: 0,
        vermelhosDirectos: 0,
        jogos: 0,
      };
      actual[campo] = l.total;
      porId.set(chave, actual);
    }
  };

  registar(amarelos, 'amarelos');
  registar(vermelhos, 'vermelhos');

  const lista = [...porId.values()];
  log(`  Disciplina (Liga Portugal): ${lista.length} jogadores`);
  return lista;
}

export async function marcadoresDaLiga({ log = () => {} } = {}) {
  const [golos, assistencias] = await Promise.all([
    golosDaLiga({ log }),
    assistenciasDaLiga({ log }),
  ]);

  const porId = new Map();

  for (const g of golos) {
    const chave = g.id ?? `${g.nome}|${g.equipa}`;
    porId.set(chave, {
      id: g.id,
      nome: g.nome,
      nomeCompleto: g.nomeCompleto,
      equipa: g.equipa,
      posicao: g.posicao,
      golos: g.total,
      assistencias: 0,
      // A API oficial nao distingue golos de penalti. O maisfutebol dava
      // essa coluna; se voltar a fazer falta, vem de la.
      penaltis: 0,
      marcaPenaltis: false,
      jogos: 0,
    });
  }

  for (const a of assistencias) {
    const chave = a.id ?? `${a.nome}|${a.equipa}`;
    const actual = porId.get(chave) ?? {
      id: a.id,
      nome: a.nome,
      nomeCompleto: a.nomeCompleto,
      equipa: a.equipa,
      posicao: a.posicao,
      golos: 0,
      penaltis: 0,
      marcaPenaltis: false,
      jogos: 0,
    };
    actual.assistencias = a.total;
    porId.set(chave, actual);
  }

  const lista = [...porId.values()];
  const comAssistencias = lista.filter((l) => l.assistencias > 0).length;
  log(`  Golos e assistencias (Liga Portugal): ${lista.length} jogadores, ${comAssistencias} com assistencias`);
  return lista;
}

// -----------------------------------------------------------------------------
// CLASSIFICACAO E JOGOS
//
//   classificacao  /api/v2/competition/standings?...&round=N
//   jogos          /api/v1/competition/matches?...&round=N
//
// Nota honesta sobre como isto esta escrito: a resposta da classificacao
// traz, por equipa, os titulos do clube, a lista de videos e as redes
// sociais — centenas de kB de coisas que nao queremos. Nao consegui
// inspeccionar o objecto todo para fixar os nomes exactos dos campos.
//
// Por isso a extraccao e por PADRAO de nome, nao por caminho fixo: procura
// campos numericos cujo nome case com "points/pontos", "played/jogos", etc.,
// em qualquer nivel ate tres de profundidade, ignorando os ramos de ruido.
//
// `npm run inspect-lp-tabela` imprime os nomes reais dos campos. Quando os
// souberes, isto pode passar a leitura directa — mas funciona sem isso.
// -----------------------------------------------------------------------------

const RAMOS_DE_RUIDO = new Set([
  'awards', 'highlightVideos', 'socials', 'kits', 'teamBoard', 'tags',
  'photosFormats', 'fullBodyImageFormats', 'imageFormats', 'competitions',
]);

// Procura o primeiro campo numerico cujo nome case com um dos padroes.
function campoNumerico(objecto, padroes, profundidade = 0) {
  if (!objecto || typeof objecto !== 'object' || profundidade > 3) return null;

  for (const [chave, valor] of Object.entries(objecto)) {
    if (RAMOS_DE_RUIDO.has(chave)) continue;
    if (typeof valor === 'number' && padroes.some((p) => p.test(chave))) {
      return valor;
    }
  }

  for (const [chave, valor] of Object.entries(objecto)) {
    if (RAMOS_DE_RUIDO.has(chave)) continue;
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
      const achado = campoNumerico(valor, padroes, profundidade + 1);
      if (achado !== null) return achado;
    }
  }

  return null;
}

const PADROES = {
  pontos: [/^points$/i, /^pontos$/i, /points$/i],
  jogos: [/^played$/i, /^number_matches$/i, /^matches(Played)?$/i, /^games(Played)?$/i, /^jogos$/i],
  vitorias: [/^total_wins$/i, /^won$/i, /^wins$/i, /^victories$/i, /^vitorias$/i],
  empates: [/^total_draws$/i, /^draw(n|s)?$/i, /^ties$/i, /^empates$/i],
  derrotas: [/^total_loses$/i, /^lost$/i, /^losses$/i, /^defeats$/i, /^derrotas$/i],
  golosMarcados: [/^total_goals_for$/i, /^goalsFor$/i, /^scored$/i, /^golosMarcados$/i],
  golosSofridos: [/^total_goals_against$/i, /^goalsAgainst$/i, /^conceded$/i, /^golosSofridos$/i],
  posicao: [/^position$/i, /^rank(ing)?$/i, /^posicao$/i, /^order$/i],
};

// Procura, em qualquer ponto do objecto, o array que parece a tabela.
//
// O `teams` da resposta e so o CATALOGO dos clubes: nomes, cores, emblemas,
// e `winsPercentage: 0` para toda a gente. Os pontos vivem noutro ramo
// (`standingsTable`). Em vez de fixar esse caminho, procuramos o array cujos
// elementos tenham os campos de uma classificacao — assim aguenta a estrutura
// mudar de sitio.
function arraysCandidatos(objecto, profundidade = 0, saida = []) {
  if (!objecto || typeof objecto !== 'object' || profundidade > 4) return saida;

  if (Array.isArray(objecto)) {
    if (objecto.length >= 10 && objecto.every((x) => x && typeof x === 'object')) {
      saida.push(objecto);
    }
    for (const item of objecto.slice(0, 3)) {
      arraysCandidatos(item, profundidade + 1, saida);
    }
    return saida;
  }

  for (const [chave, valor] of Object.entries(objecto)) {
    if (RAMOS_DE_RUIDO.has(chave)) continue;
    arraysCandidatos(valor, profundidade + 1, saida);
  }
  return saida;
}

// Quantos dos campos de uma classificacao existem neste registo?
function pontuarComoTabela(registo) {
  const encontrados = Object.keys(PADROES).filter(
    (campo) => campoNumerico(registo, PADROES[campo]) !== null
  );
  return encontrados.length;
}

// Os campos reais do `standingsTable`, confirmados com a resposta da API:
//
//   team_name, position, points, played, number_matches,
//   total_wins, total_draws, total_loses,
//   total_goals_for, total_goals_against, totals_goals_difference,
//   home_wins, home_draws, home_loses, home_goals_for, home_goals_against,
//   away_wins, away_draws, away_loses, away_goals_for, away_goals_against,
//   form ("VVVVV"), homePlayedGames, awayPlayedGames
//
// A versao anterior procurava por padrao de nome e falhava por pouco: os
// campos chamam-se `total_draws` e `total_loses`, e eu procurava `drawn` e
// `lost`. Agora e leitura directa, com a busca por padrao so como rede.
const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function lerLinhaDirecta(r) {
  const equipa = r.team_name ?? r.teamName ?? r.name;
  if (!equipa) return null;

  const jogos = numero(r.played) ?? numero(r.number_matches);
  const vitorias = numero(r.total_wins) ?? numero(r.wins);
  const empates = numero(r.total_draws);
  const derrotas = numero(r.total_loses);

  if (jogos === null || vitorias === null || empates === null || derrotas === null) {
    return null;
  }

  return {
    equipa,
    posicao: numero(r.position),
    pontos: numero(r.points),
    jogos,
    vitorias,
    empates,
    derrotas,
    golosMarcados: numero(r.total_goals_for),
    golosSofridos: numero(r.total_goals_against),

    // A forma recente, em letras: "VVVVV", "VEDVV". O jogo mais recente e
    // o ultimo caracter.
    forma: typeof r.form === 'string' && r.form ? r.form : null,

    // Casa e fora em separado. Isto muda a analise: para um jogador que
    // recebe, o que interessa e o registo FORA do adversario, nao o total.
    casa: {
      jogos: numero(r.homePlayedGames),
      vitorias: numero(r.home_wins),
      empates: numero(r.home_draws),
      derrotas: numero(r.home_loses),
      golosMarcados: numero(r.home_goals_for),
      golosSofridos: numero(r.home_goals_against),
    },
    fora: {
      jogos: numero(r.awayPlayedGames),
      vitorias: numero(r.away_wins),
      empates: numero(r.away_draws),
      derrotas: numero(r.away_loses),
      golosMarcados: numero(r.away_goals_for),
      golosSofridos: numero(r.away_goals_against),
    },
  };
}

export function lerClassificacaoLP(texto) {
  let dados;
  try {
    dados = typeof texto === 'string' ? JSON.parse(texto) : texto;
  } catch {
    return null;
  }

  const tabela = Array.isArray(dados?.standingsTable)
    ? dados.standingsTable
    : dados?.standingsTable?.rows ?? null;

  let linhas = Array.isArray(tabela) ? tabela.map(lerLinhaDirecta).filter(Boolean) : [];

  // Rede: se a estrutura mudar, procura o array que mais se pareca com uma
  // classificacao em qualquer ponto da resposta.
  if (linhas.length < 10) {
    linhas = lerPorPadrao(dados);
  }

  if (linhas.length < 10) return null;

  // Coerencia: jogos = V + E + D em todas as linhas.
  const coerente = linhas.every(
    (l) => l.vitorias + l.empates + l.derrotas === l.jogos
  );
  if (!coerente) return null;

  return linhas
    .sort((a, b) => (b.pontos ?? 0) - (a.pontos ?? 0))
    .map((l, i) => ({ ...l, posicao: l.posicao ?? i + 1 }));
}

// A busca por padrao de nome, agora so como alternativa.
function lerPorPadrao(dados) {
  const nomePorId = new Map();
  for (const t of dados?.teams ?? []) {
    if (t?.id != null && t?.name) nomePorId.set(String(t.id), t.name);
  }

  const candidatos = arraysCandidatos(dados);
  let melhor = null;
  let melhorPontuacao = 0;

  for (const array of candidatos) {
    const pontuacao = pontuarComoTabela(array[0]);
    if (pontuacao > melhorPontuacao) {
      melhor = array;
      melhorPontuacao = pontuacao;
    }
  }

  if (!melhor || melhorPontuacao < 5) return [];

  return melhor
    .map((r) => {
      const equipa =
        r.team_name ??
        r.name ??
        r.teamName ??
        r.team?.name ??
        nomePorId.get(String(r.team_id ?? r.teamId ?? r.id ?? '')) ??
        null;
      if (!equipa) return null;

      const ler = (campo) => campoNumerico(r, PADROES[campo]);
      const jogos = ler('jogos');
      const vitorias = ler('vitorias');
      const empates = ler('empates');
      const derrotas = ler('derrotas');
      if ([jogos, vitorias, empates, derrotas].some((v) => v === null)) return null;

      return {
        equipa,
        posicao: ler('posicao'),
        pontos: ler('pontos'),
        jogos,
        vitorias,
        empates,
        derrotas,
        golosMarcados: ler('golosMarcados'),
        golosSofridos: ler('golosSofridos'),
        forma: null,
        casa: null,
        fora: null,
      };
    })
    .filter(Boolean);
}

export async function classificacaoDaLiga({ log = () => {}, jornada } = {}) {
  const p = new URLSearchParams({
    competition: COMPETICAO,
    season: EPOCA,
    ...(jornada ? { round: String(jornada) } : {}),
  });

  const url = `https://www.ligaportugal.pt/api/v2/competition/standings?${p}`;
  const texto = await getHTML(url);
  const tabela = lerClassificacaoLP(texto);

  if (!tabela) {
    throw new Error(
      'A API de classificacao respondeu mas nao reconheci os campos.\n' +
        'Corre `npm run inspect-lp-tabela` para ver os nomes reais.'
    );
  }

  log(`  Classificacao (Liga Portugal): ${tabela.length} equipas`);
  return tabela;
}

// ---------------------------------------------------------------------- jogos

const CAMPOS_EQUIPA_CASA = ['homeTeam', 'home', 'teamHome', 'equipaCasa'];
const CAMPOS_EQUIPA_FORA = ['awayTeam', 'away', 'teamAway', 'equipaFora'];

function nomeDeEquipa(valor) {
  if (!valor) return null;
  if (typeof valor === 'string') return valor;
  return valor.name ?? valor.teamName ?? valor.shortName ?? null;
}

function primeiroCampo(objecto, nomes) {
  for (const n of nomes) {
    if (objecto?.[n] !== undefined) return objecto[n];
  }
  return null;
}

const FUSO_PT = 'Europe/Lisbon';

function emLisboa(iso) {
  if (!iso) return { data: null, hora: null };

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { data: null, hora: null };

  const partes = new Intl.DateTimeFormat('pt-PT', {
    timeZone: FUSO_PT,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const valor = (tipo) => partes.find((p) => p.type === tipo)?.value ?? '';

  return {
    data: `${valor('day')}/${valor('month')}`,
    hora: `${valor('hour')}:${valor('minute')}`,
    iso,
  };
}

export function lerJogosLP(texto, jornada) {
  let dados;
  try {
    dados = typeof texto === 'string' ? JSON.parse(texto) : texto;
  } catch {
    return null;
  }

  const bruto =
    dados?.matches ?? dados?.fixtures ?? dados?.games ?? (Array.isArray(dados) ? dados : null);
  if (!Array.isArray(bruto)) return null;

  const jogos = bruto
    .map((m) => {
      const casa = nomeDeEquipa(primeiroCampo(m, CAMPOS_EQUIPA_CASA));
      const fora = nomeDeEquipa(primeiroCampo(m, CAMPOS_EQUIPA_FORA));
      if (!casa || !fora) return null;

      const quando =
        m.date ?? m.matchDate ?? m.kickOff ?? m.datetime ?? m.startDate ?? null;

      // A API da as horas em UTC ("2026-09-12T19:30:00Z"). Formatar com a
      // hora local da maquina dava 20:30 no meu portatil (Lisboa) e 19:30
      // no Railway (UTC) — o mesmo jogo com horas diferentes conforme onde
      // o codigo corresse. O fuso tem de ser explicito.
      const { data, hora } = emLisboa(quando);

      return {
        casa,
        fora,
        data,
        hora,
        quando: quando ?? null,
        adiado: Boolean(m.postponedFixture || m.canceledFixture),
        jornada: m.round ?? m.matchweekNumber ?? m.matchday ?? jornada,
        golosCasa: m.homeGoals ?? m.homeScore ?? m.scoreHome ?? null,
        golosFora: m.awayGoals ?? m.awayScore ?? m.scoreAway ?? null,
      };
    })
    .filter(Boolean);

  return jogos.length ? jogos : null;
}

export async function jogosDaJornada(jornada, { log = () => {} } = {}) {
  const p = new URLSearchParams({
    competition: COMPETICAO,
    season: EPOCA,
    round: String(jornada),
  });

  const url = `https://www.ligaportugal.pt/api/v1/competition/matches?${p}`;
  const texto = await getHTML(url);
  const jogos = lerJogosLP(texto, jornada);

  if (!jogos) {
    throw new Error(
      `A API de jogos respondeu mas nao reconheci os campos (jornada ${jornada}).\n` +
        'Corre `npm run inspect-lp-tabela` para ver a estrutura.'
    );
  }

  log(`  Jogos da jornada ${jornada} (Liga Portugal): ${jogos.length}`);
  return jogos;
}

export async function jogosDeVariasJornadas(jornadas, { log = () => {} } = {}) {
  const tudo = [];
  for (const j of jornadas.filter(Boolean)) {
    try {
      tudo.push(...(await jogosDaJornada(j, { log })));
    } catch (erro) {
      log(`  Jornada ${j}: ${erro.message.split('\n')[0]}`);
    }
  }
  return tudo;
}
