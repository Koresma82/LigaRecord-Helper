import * as cheerio from 'cheerio';
import { pedido, pausa } from '../lib-http.js';

// -----------------------------------------------------------------------------
// Zerozero — estatisticas da Liga Portugal.
//
// URLs confirmados, com a edicao e a fase como parametros:
//
//   golos       .../estatisticas?v=jt1&v1=j&v2=t&v3=1&...   (paginado)
//   disciplina  .../estatisticas?v=jt1&v1=j&v2=t&v3=4&...   (paginado)
//   jogos       /competicao/liga-portuguesa?fase=N&jornada_in=J
//
// As tabelas tem cabecalho nomeado (J, G, PEN, A, 2A, VE), por isso as
// colunas sao lidas PELO NOME. Todas as tentativas anteriores tentaram
// adivinhar posicoes e todas erraram — golos que eram minutos, amarelos que
// eram jogos disputados.
// -----------------------------------------------------------------------------

const EDICAO = process.env.ZZ_EDICAO ?? 'liga-portugal-betclic-2026-27/218294';
const FASE = process.env.ZZ_FASE ?? '240072';
const BASE = 'https://www.zerozero.pt';

const MAX_PAGINAS = 8;

const limpar = (t = '') => t.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

function urlEstatisticas(v3, pagina) {
  const p = new URLSearchParams({
    sc: '0',
    v: 'jt1',
    v1: 'j',
    v2: 't',
    v3: String(v3),
    pais: '0',
    pos: '0',
    id_equipa: '0',
    ord: 'd',
  });
  if (pagina > 1) p.set('page', String(pagina));
  return `${BASE}/edicao/${EDICAO}/estatisticas?${p}`;
}

// "Vangelis Pavlidis [Benfica]" -> { nome, equipa }
function separarNomeClube(texto) {
  const m = limpar(texto).match(/^(.*?)\s*\[(.+?)\]\s*$/);
  if (m) return { nome: m[1].trim(), equipa: m[2].trim() };
  return { nome: limpar(texto), equipa: '' };
}

// Le uma tabela com cabecalho: devolve linhas como objectos {JOGADOR, J, G...}
function lerTabelaComCabecalho(html) {
  const $ = cheerio.load(html);
  let melhor = [];

  $('table').each((_, tabela) => {
    const $t = $(tabela);

    const cabecalhos = $t
      .find('tr')
      .first()
      .find('th, td')
      .map((_, c) => limpar($(c).text()).toUpperCase())
      .get();

    if (!cabecalhos.some((c) => c.includes('JOGADOR'))) return;

    const linhas = [];
    $t.find('tr')
      .slice(1)
      .each((_, tr) => {
        const celulas = $(tr)
          .find('td')
          .map((_, c) => limpar($(c).text()))
          .get();
        if (celulas.length < cabecalhos.length - 2) return;

        const registo = {};
        cabecalhos.forEach((chave, i) => {
          if (chave) registo[chave] = celulas[i] ?? '';
        });

        // O nome pode estar numa celula sem cabecalho util; procuramos a
        // celula que tem o padrao "Nome [Clube]".
        const comClube = celulas.find((c) => /\[.+\]/.test(c));
        if (comClube) registo.__jogador = comClube;

        if (registo.__jogador || registo.JOGADOR) linhas.push(registo);
      });

    if (linhas.length > melhor.length) melhor = linhas;
  });

  return melhor;
}

const numero = (v) => {
  const n = Number(String(v).replace(/[^\d-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

async function paginado(v3, mapear, { log = () => {}, nome } = {}) {
  const porChave = new Map();

  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const url = urlEstatisticas(v3, pagina);

    let r;
    try {
      r = await pedido(url, { headers: { 'accept-language': 'pt-PT,pt;q=0.9' }, seguir: 4 });
    } catch (erro) {
      log(`  ${nome}: pagina ${pagina} falhou (${erro.message.split('\n')[0]})`);
      break;
    }

    if (r.status !== 200) {
      log(`  ${nome}: pagina ${pagina} devolveu ${r.status}`);
      break;
    }

    const linhas = lerTabelaComCabecalho(r.texto);
    if (!linhas.length) break;

    const antes = porChave.size;
    for (const linha of linhas) {
      const registo = mapear(linha);
      if (!registo?.nome) continue;
      const chave = `${registo.nome}|${registo.equipa}`;
      if (!porChave.has(chave)) porChave.set(chave, registo);
    }

    // Pagina sem nada de novo: chegamos ao fim (ou andamos em circulo).
    if (porChave.size === antes) break;

    await pausa(600);
  }

  log(`  ${nome}: ${porChave.size} jogadores`);
  return [...porChave.values()];
}

// ------------------------------------------------------------------- golos

export function marcadoresDaLiga({ log } = {}) {
  return paginado(
    1,
    (linha) => {
      const { nome, equipa } = separarNomeClube(linha.__jogador ?? linha.JOGADOR ?? '');
      return { nome, equipa, golos: numero(linha.G), jogos: numero(linha.J) };
    },
    { log, nome: 'Golos' }
  );
}

// -------------------------------------------------------------- disciplina

export function disciplinaDaLiga({ log } = {}) {
  return paginado(
    4,
    (linha) => {
      const { nome, equipa } = separarNomeClube(linha.__jogador ?? linha.JOGADOR ?? '');
      const amarelos = numero(linha.A);
      const duplos = numero(linha['2A']);
      const directos = numero(linha.VE);
      return {
        nome,
        equipa,
        amarelos,
        // Expulsoes = vermelho directo + duplo amarelo. Sao coisas
        // diferentes na tabela e a soma e o que interessa para saber quem
        // esta suspenso.
        vermelhos: duplos + directos,
        duplosAmarelos: duplos,
        vermelhosDirectos: directos,
        jogos: numero(linha.J),
      };
    },
    { log, nome: 'Disciplina' }
  );
}

// ------------------------------------------------------------- classificacao

// A classificacao vive na mesma pagina da competicao, com cabecalhos
// nomeados: P (pontos), J, V, E, D, GM, GS, DG.
//
// Ler pelo cabecalho e melhor do que a deteccao aritmetica que eu tinha:
// aquela funcionava mas era fragil, e nao distinguia P de J quando as
// colunas coincidiam por acaso.
export function lerClassificacaoZZ(html) {
  const $ = cheerio.load(html);
  let melhor = [];

  $('table').each((_, tabela) => {
    const $t = $(tabela);

    // O cabecalho pode estar em <th> ou na primeira <tr>.
    const cabecalhos = $t
      .find('tr')
      .first()
      .find('th, td')
      .map((_, c) => limpar($(c).text()).toUpperCase())
      .get();

    const col = (nome) => cabecalhos.indexOf(nome);
    const iP = col('P');
    const iJ = col('J');
    const iV = col('V');
    const iE = col('E');
    const iD = col('D');

    if (iP < 0 || iJ < 0 || iV < 0 || iE < 0 || iD < 0) return;

    const linhas = [];
    $t.find('tr')
      .slice(1)
      .each((_, tr) => {
        const celulas = $(tr)
          .find('td')
          .map((_, c) => limpar($(c).text()))
          .get();
        if (celulas.length <= iD) return;

        // O nome da equipa e a celula de texto mais longa antes dos numeros.
        const equipa = celulas
          .slice(0, iP)
          .filter((c) => c && !/^\d+$/.test(c) && c.length > 2)
          .sort((a, b) => b.length - a.length)[0];
        if (!equipa) return;

        const n = (i) => {
          const v = Number(String(celulas[i]).replace(/[^\d-]/g, ''));
          return Number.isFinite(v) ? v : 0;
        };

        linhas.push({
          posicao: linhas.length + 1,
          equipa,
          pontos: n(iP),
          jogos: n(iJ),
          vitorias: n(iV),
          empates: n(iE),
          derrotas: n(iD),
          golosMarcados: col('GM') >= 0 ? n(col('GM')) : null,
          golosSofridos: col('GS') >= 0 ? n(col('GS')) : null,
        });
      });

    // Uma classificacao tem de bater certo: jogos = V+E+D em todas as linhas.
    const coerente =
      linhas.length >= 10 &&
      linhas.every((l) => l.vitorias + l.empates + l.derrotas === l.jogos);

    if (coerente && linhas.length > melhor.length) melhor = linhas;
  });

  return melhor;
}

export async function classificacaoDaLiga({ log = () => {} } = {}) {
  const url = `${BASE}/competicao/liga-portuguesa`;

  try {
    const r = await pedido(url, {
      headers: { 'accept-language': 'pt-PT,pt;q=0.9' },
      seguir: 4,
    });
    if (r.status !== 200) {
      log(`  Classificacao: ${r.status}`);
      return [];
    }

    const tabela = lerClassificacaoZZ(r.texto);
    log(`  Classificacao: ${tabela.length} equipas`);
    return tabela;
  } catch (erro) {
    log(`  Classificacao: ${erro.message.split('\n')[0]}`);
    return [];
  }
}

// ------------------------------------------------------------------ jornada

// A jornada a decorrer, lida da propria pagina da competicao.
//
// A pagina tem um seletor "CAMPEONATO [Jornada 4]" e um titulo "JORNADA 4".
// E a fonte mais directa que ha: e o proprio site a dizer em que jornada
// estamos, em vez de a inferirmos contando jogos disputados.
// Uma jornada da Primeira Liga vai de 1 a 34. Fora disso e lixo.
const jornadaPlausivel = (n) => Number.isInteger(n) && n >= 1 && n <= 34;

export async function jornadaNoZerozero({ log = () => {} } = {}) {
  const url = `${BASE}/competicao/liga-portuguesa`;

  try {
    const r = await pedido(url, {
      headers: { 'accept-language': 'pt-PT,pt;q=0.9' },
      seguir: 4,
    });
    if (r.status !== 200) return null;

    const $ = cheerio.load(r.texto);

    // 1. A opcao seleccionada no seletor de jornada.
    const seleccionada = limpar(
      $('select option[selected]').first().text() ||
        $('option[selected]').first().text()
    );
    const doSelector = Number(
      seleccionada.match(/jornada\s*(\d{1,2}?)(?=\d{1,2}[/.]\d|\D|$)/i)?.[1]
    );
    if (jornadaPlausivel(doSelector)) {
      log(`  Jornada ${doSelector} (seletor do zerozero)`);
      return doSelector;
    }

    // 2. O titulo do bloco de jogos.
    //
    // Duas armadilhas aqui, ambas apanhadas a mal:
    //
    // - Sem o /i de proposito: o titulo esta em maiusculas e as opcoes do
    //   seletor em "Jornada 3", "Jornada 4"... Com /i apanhava a primeira
    //   opcao da lista em vez do cabecalho.
    // - o titulo "JORNADA 4" vem colado a data do primeiro jogo, "28/08",
    //   e `\d+` lia "428". A negacao simples de digitos tambem nao serve,
    //   porque rejeitava "JORNADA 1006/09" (jornada 10 + data). O que
    //   funciona e reconhecer o que vem a seguir: ou uma data, ou um
    //   nao-digito, ou o fim.
    const titulo = Number(
      limpar($('body').text()).match(/JORNADA\s+(\d{1,2}?)(?=\d{1,2}[/.]\d|\D|$)/)?.[1]
    );
    if (jornadaPlausivel(titulo)) {
      log(`  Jornada ${titulo} (titulo do zerozero)`);
      return titulo;
    }

    return null;
  } catch (erro) {
    log(`  Jornada pelo zerozero: ${erro.message.split('\n')[0]}`);
    return null;
  }
}

// -------------------------------------------------------------------- jogos

export async function jogosDaJornada(jornada, { log = () => {} } = {}) {
  if (!jornadaPlausivel(jornada)) {
    log(`  Jogos: jornada ${jornada} nao e valida (1 a 34)`);
    return [];
  }

  const url = `${BASE}/competicao/liga-portuguesa?fase=${FASE}&jornada_in=${jornada}`;
  const r = await pedido(url, { headers: { 'accept-language': 'pt-PT,pt;q=0.9' }, seguir: 4 });

  if (r.status !== 200) {
    log(`  Jogos: ${url} devolveu ${r.status}`);
    return [];
  }

  const $ = cheerio.load(r.texto);
  const jogos = [];
  let dataCorrente = null;

  // A data so aparece na primeira linha de cada dia; as seguintes herdam-na.
  $('tr').each((_, tr) => {
    const celulas = $(tr)
      .find('td')
      .map((_, c) => limpar($(c).text()))
      .get()
      .filter((c) => c !== '');

    if (celulas.length < 3) return;

    const data = celulas.find((c) => /^\d{1,2}[/.-]\d{1,2}$/.test(c));
    if (data) dataCorrente = data;

    const hora = celulas.find((c) => /^\d{1,2}[:h]\d{2}$/.test(c));
    if (!hora) return;

    const iHora = celulas.indexOf(hora);
    const casa = celulas
      .slice(0, iHora)
      .filter((c) => !/^\d/.test(c) && c.length > 2)
      .pop();
    const fora = celulas
      .slice(iHora + 1)
      .find((c) => !/^\d/.test(c) && c.length > 2 && !/apostar|h2h/i.test(c));

    if (!casa || !fora) return;

    jogos.push({ casa, fora, data: dataCorrente, hora, jornada });
  });

  // A pagina pode trazer mais do que a jornada pedida. A regra do jogo
  // resolve: numa jornada cada equipa joga UMA vez. Percorremos por ordem e
  // paramos quando uma equipa se repete.
  const usadas = new Set();
  const daJornada = [];
  for (const j of jogos) {
    if (usadas.has(j.casa) || usadas.has(j.fora)) continue;
    usadas.add(j.casa);
    usadas.add(j.fora);
    daJornada.push(j);
  }

  log(`  Jogos da jornada ${jornada}: ${daJornada.length}`);
  return daJornada;
}

// Varias jornadas de uma vez, cada uma no seu pedido.
export async function jogosDeVariasJornadas(jornadas, { log = () => {} } = {}) {
  const todos = [];

  for (const n of jornadas.filter((j) => j > 0)) {
    try {
      const jogos = await jogosDaJornada(n, { log });
      todos.push(...jogos);
    } catch (erro) {
      log(`  Jornada ${n}: ${erro.message.split('\n')[0]}`);
    }
    await pausa(700);
  }

  return todos;
}
