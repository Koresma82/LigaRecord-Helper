import * as cheerio from 'cheerio';
import { getHTML } from '../lib-http.js';

// -----------------------------------------------------------------------------
// Maisfutebol — tabela de disciplina da Liga Portugal.
//
//   https://maisfutebol.iol.pt/liga/disciplina
//
// Existe porque o zerozero devolve 403 a partir de IPs de datacenter. As
// lesoes vem do Transfermarkt, que responde bem, mas o Transfermarkt nao
// tem dados disciplinares para a Liga Portugal — e sem eles nao ha castigos
// por acumulacao de amarelos.
//
// A tabela tem cinco colunas: jogador, clube, posicao, amarelos, vermelhos.
// Devolve a MESMA forma que disciplinaDaLiga() do zerozero, para o resto do
// worker nao ter de saber de onde vieram os dados.
//
// LIMITE: o maisfutebol nao separa duplo amarelo de vermelho directo — traz
// uma coluna so. Para efeitos de castigo tanto faz (ambos suspendem), mas
// os campos duplosAmarelos/vermelhosDirectos ficam a zero de proposito, em
// vez de adivinharem uma divisao que a fonte nao da.
// -----------------------------------------------------------------------------

const URL_DISCIPLINA =
  process.env.MF_URL_DISCIPLINA ?? 'https://maisfutebol.iol.pt/liga/disciplina';

function limpar(texto = '') {
  return texto.replace(/\s+/g, ' ').trim();
}

function numero(texto = '') {
  const n = parseInt(limpar(texto).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

// As posicoes da tabela, usadas para reconhecer a coluna certa sem depender
// da ordem nem de classes CSS.
const POSICOES = new Set(['guarda-redes', 'defesa', 'medio', 'medio', 'avancado']);

const ehPosicao = (t) =>
  POSICOES.has(
    limpar(t)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  );

// Varias tabelas da pagina tem a MESMA forma — nome, clube, posicao, dois
// numeros. A de jogadores traz minutos jogados ("Joel Robles, Estoril,
// Guarda-redes, 270, 3") e passava por disciplina se olhassemos so para a
// forma. Por isso extraimos tabela a tabela e escolhemos uma, em vez de
// varrer todas as <tr> da pagina de uma vez.
//
// O criterio e a grandeza dos numeros: cartoes e golos contam-se em
// unidades ou dezenas, minutos em centenas. Uma tabela cujo maior valor
// ultrapassa o limite plausivel nao e a que procuramos.
function linhasPorTabela($, extrair) {
  return $('table')
    .map((_, tabela) => {
      const linhas = [];
      $(tabela)
        .find('tr')
        .each((_, tr) => {
          const celulas = $(tr)
            .find('td')
            .map((_, td) => limpar($(td).text()))
            .get();
          const linha = extrair(celulas);
          if (linha) linhas.push(linha);
        });
      return { linhas };
    })
    .get();
}

// 38 jornadas: nenhum jogador chega la com mais cartoes ou golos do que isto.
// Minutos jogados, que e o que nos queremos excluir, passam dos 3000.
const MAXIMO_PLAUSIVEL = 60;

function melhorTabela(candidatas, valores) {
  const validas = candidatas.filter(
    (t) =>
      t.linhas.length >= 20 &&
      t.linhas.every((l) => valores(l).every((v) => v <= MAXIMO_PLAUSIVEL))
  );
  if (!validas.length) return [];
  return validas.sort((a, b) => b.linhas.length - a.linhas.length)[0].linhas;
}

// Nome, clube e posicao sao as tres primeiras colunas uteis de todas estas
// tabelas. A posicao serve de ancora porque e o unico valor de um conjunto
// conhecido.
function cabecaDaLinha(celulas) {
  const iPosicao = celulas.findIndex(ehPosicao);
  if (iPosicao < 2) return null;
  const nome = celulas[iPosicao - 2];
  const equipa = celulas[iPosicao - 1];
  if (!nome || !equipa) return null;
  return { nome, equipa, cauda: celulas.slice(iPosicao + 1) };
}

export function lerTabelaDisciplina(html) {
  const $ = cheerio.load(html);

  const candidatas = linhasPorTabela($, (celulas) => {
    if (celulas.length < 5) return null;
    const cabeca = cabecaDaLinha(celulas);
    if (!cabeca) return null;

    const numericas = cabeca.cauda.filter((c) => /^\d+$/.test(c));
    if (numericas.length < 2) return null;

    return {
      nome: cabeca.nome,
      equipa: cabeca.equipa,
      amarelos: numero(numericas[0]),
      vermelhos: numero(numericas[1]),
      // A fonte nao distingue os dois tipos de expulsao. Deixamos a zero em
      // vez de inventar; quem usa isto so precisa do total.
      duplosAmarelos: 0,
      vermelhosDirectos: 0,
      jogos: 0,
    };
  });

  return melhorTabela(candidatas, (l) => [l.amarelos, l.vermelhos]);
}

export async function disciplinaDaLiga({ log = () => {} } = {}) {
  const html = await getHTML(URL_DISCIPLINA);
  const linhas = lerTabelaDisciplina(html);

  if (!linhas.length) {
    throw new Error(
      `Li a pagina do maisfutebol (${html.length} chars) mas nao reconheci ` +
        'nenhuma linha da tabela. A estrutura mudou — corre ' +
        '`npm run inspect-maisfutebol` para ver o que veio.'
    );
  }

  log(`  Disciplina (maisfutebol): ${linhas.length} jogadores`);
  return linhas;
}

// -----------------------------------------------------------------------------
// MARCADORES — https://maisfutebol.iol.pt/liga/marcadores
//
// Mesma estrutura da disciplina: jogador, clube, posicao, e depois duas
// colunas de golos. A primeira e "golos de penalti" (a bola com o (p) no
// cabecalho) e vem VAZIA para quem nao marcou nenhum; a segunda e o total.
//
// Os penaltis interessam por si: quem os marca e o marcador designado da
// equipa, e isso vale pontos na Liga Record de forma bastante previsivel.
// O zerozero nao dava esta coluna.
// -----------------------------------------------------------------------------

const URL_MARCADORES =
  process.env.MF_URL_MARCADORES ?? 'https://maisfutebol.iol.pt/liga/marcadores';

export function lerTabelaMarcadores(html) {
  const $ = cheerio.load(html);

  const candidatas = linhasPorTabela($, (celulas) => {
    if (celulas.length < 4) return null;
    const cabeca = cabecaDaLinha(celulas);
    if (!cabeca) return null;

    // A seguir a posicao vem [penaltis, total]. A celula dos penaltis fica
    // VAZIA quando sao zero, e o total e sempre o ultimo numero da linha.
    const preenchidas = cabeca.cauda.filter((c) => /^\d+$/.test(c));
    if (!preenchidas.length) return null;

    const golos = numero(preenchidas[preenchidas.length - 1]);
    const penaltis = preenchidas.length >= 2 ? numero(preenchidas[0]) : 0;

    // Penaltis marcados sao um subconjunto dos golos. Se o primeiro numero
    // for maior que o segundo, nao sao penaltis — e outra coluna qualquer.
    if (penaltis > golos) return null;

    return {
      nome: cabeca.nome,
      equipa: cabeca.equipa,
      golos,
      penaltis,
      // Quem ja marcou de penalti e o marcador designado da equipa.
      marcaPenaltis: penaltis > 0,
      jogos: 0,
    };
  });

  return melhorTabela(candidatas, (l) => [l.golos, l.penaltis]);
}

export async function marcadoresDaLiga({ log = () => {} } = {}) {
  const html = await getHTML(URL_MARCADORES);
  const linhas = lerTabelaMarcadores(html);

  if (!linhas.length) {
    throw new Error(
      `Li a pagina de marcadores do maisfutebol (${html.length} chars) mas nao ` +
        'reconheci nenhuma linha. Corre `npm run inspect-maisfutebol`.'
    );
  }

  const comPenaltis = linhas.filter((l) => l.marcaPenaltis).length;
  log(`  Golos (maisfutebol): ${linhas.length} jogadores, ${comPenaltis} marcaram de penalti`);
  return linhas;
}

// -----------------------------------------------------------------------------
// CLASSIFICACAO E JOGOS — https://maisfutebol.iol.pt/liga/resultadoseclassificacao
//
// Uma pagina so, com os jogos da jornada em cima e a classificacao em baixo.
// Os jogos da jornada seguinte aparecem sem resultado, com hora — e assim
// que se distinguem dos ja jogados.
// -----------------------------------------------------------------------------

const URL_CLASSIFICACAO =
  process.env.MF_URL_CLASSIFICACAO ??
  'https://maisfutebol.iol.pt/liga/resultadoseclassificacao';

export function lerClassificacao(html) {
  const $ = cheerio.load(html);
  const linhas = [];

  $('tr').each((_, tr) => {
    const celulas = $(tr)
      .find('td')
      .map((_, td) => limpar($(td).text()))
      .get();

    // Forma da linha: [checkbox, "1o", seta?, equipa, JJ, V, E, D, GM, GS,
    // Pts, ultimos jogos]. A seta de subida/descida nem sempre esta la, por
    // isso ancoramos na posicao ("1o", "2o"...) e nao num indice fixo.
    const iPos = celulas.findIndex((c) => /^\d{1,2}[.\u00ba\u00b0]?$/.test(c));
    if (iPos < 0) return;

    const resto = celulas.slice(iPos + 1);
    const equipa = resto.find((c) => c && !/^\d+$/.test(c) && c.length > 2);
    if (!equipa) return;

    const nums = resto.filter((c) => /^\d+$/.test(c)).map(numero);
    if (nums.length < 7) return;

    const [jogos, vitorias, empates, derrotas, golosMarcados, golosSofridos, pontos] = nums;

    // Uma classificacao real bate certo: J = V + E + D. Se nao bater, a
    // linha nao e o que pensamos e e melhor descarta-la do que gravar lixo.
    if (vitorias + empates + derrotas !== jogos) return;

    linhas.push({
      posicao: linhas.length + 1,
      equipa,
      pontos,
      jogos,
      vitorias,
      empates,
      derrotas,
      golosMarcados,
      golosSofridos,
    });
  });

  return linhas;
}

// Os jogos NAO estao numa <table>. Vivem em <li class="JgTerminado"> (e
// classes irmas para os que ainda nao se realizaram), com o texto todo
// numa linha:
//
//   "Marítimo 2 2 Ac. Viseu"     — ja disputado
//   "Moreirense 01:00 Benfica"   — por disputar
//
// Andei a procura-los em tabelas e nao os encontrava. Ler pelo texto do
// <li> e mais robusto do que depender dos <div> aninhados la dentro, que
// mudam com o layout.
const JOGO_DISPUTADO = /^(.+?)\s+(\d{1,2})\s+(\d{1,2})\s+(.+)$/;
const JOGO_AGENDADO = /^(.+?)\s+(\d{1,2}[:h]\d{2})\s+(.+)$/;
const DATA_LONGA = /(\d{1,2})\s+([a-zç]{3,10})\.?\s+(\d{4})/i;

function nomeLimpo(texto) {
  const t = limpar(texto);
  return t.length > 1 && t.length < 40 ? t : null;
}

// A data e um cabecalho antes do grupo de jogos do dia. Subimos pelos
// irmaos anteriores ate encontrar um que pareca uma data.
function dataDoJogo($, $li) {
  const anterior = $li
    .prevAll()
    .toArray()
    .map((el) => limpar($(el).text()))
    .find((t) => t.length < 40 && DATA_LONGA.test(t));
  if (!anterior) return null;
  const d = anterior.match(DATA_LONGA);
  return `${d[1]}/${d[2].toLowerCase().slice(0, 3)}`;
}

export function lerJogos(html, jornada) {
  const $ = cheerio.load(html);
  const jogos = [];
  const vistos = new Set();

  // Os jogos ja disputados tem class="JgTerminado"; os que faltam usam
  // outra classe que nao conheco. Em vez de a adivinhar, aceitamos qualquer
  // <li> cujo TEXTO tenha a forma de um jogo — a forma e um filtro mais
  // fiavel do que o nome da classe.
  //
  // A barra lateral nao passa: la os nomes vem colados ("AroucaMarítimo") e
  // os resultados ficam depois de cada equipa ("Gil Vicente 2 Casa Pia 0"),
  // portanto nenhuma das duas expressoes encaixa.
  $('li').each((_, li) => {
    const $li = $(li);
    const texto = limpar($li.text());
    if (!texto || texto.length > 60) return;

    let casa;
    let fora;
    let hora = null;
    let golosCasa = null;
    let golosFora = null;

    const disputado = texto.match(JOGO_DISPUTADO);
    const agendado = texto.match(JOGO_AGENDADO);

    if (disputado) {
      casa = nomeLimpo(disputado[1]);
      golosCasa = Number(disputado[2]);
      golosFora = Number(disputado[3]);
      fora = nomeLimpo(disputado[4]);
    } else if (agendado) {
      casa = nomeLimpo(agendado[1]);
      hora = agendado[2];
      fora = nomeLimpo(agendado[3]);
    } else {
      return;
    }

    if (!casa || !fora || casa === fora) return;

    // A mesma <li> aparece repetida em blocos diferentes da pagina.
    const chave = `${casa}|${fora}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);

    jogos.push({
      casa,
      fora,
      data: dataDoJogo($, $li),
      hora,
      jornada,
      golosCasa,
      golosFora,
      disputado: Boolean(disputado),
    });
  });

  return jogos;
}

export async function classificacaoDaLiga({ log = () => {} } = {}) {
  const html = await getHTML(URL_CLASSIFICACAO);
  const linhas = lerClassificacao(html);

  if (!linhas.length) {
    throw new Error(
      `Li a pagina de classificacao do maisfutebol (${html.length} chars) mas nao ` +
        'reconheci nenhuma linha. Corre `npm run inspect-maisfutebol`.'
    );
  }

  log(`  Classificacao (maisfutebol): ${linhas.length} equipas`);
  return linhas;
}

export async function jogosDaJornada(jornada, { log = () => {} } = {}) {
  // A pagina aceita a jornada por parametro; o seletor da direita faz o
  // mesmo pedido.
  const url = `${URL_CLASSIFICACAO}?jornada=${jornada}`;
  const html = await getHTML(url);
  const jogos = lerJogos(html, jornada);

  log(`  Jogos da jornada ${jornada} (maisfutebol): ${jogos.length}`);
  return jogos;
}

export async function jogosDeVariasJornadas(jornadas, { log = () => {} } = {}) {
  const tudo = [];
  for (const j of jornadas) {
    try {
      tudo.push(...(await jogosDaJornada(j, { log })));
    } catch (erro) {
      log(`  Jogos da jornada ${j} (maisfutebol): ${erro.message.split('\n')[0]}`);
    }
  }
  return tudo;
}
