import * as cheerio from 'cheerio';
import { pedido, pausa } from '../lib-http.js';
import { equipaCanonica, equipasContidas } from '../normalizar.js';

// -----------------------------------------------------------------------------
// Classificacao, calendario e marcadores.
//
// Cada um tem varios URLs candidatos porque nao vale a pena fixar um: ja
// perdi tempo suficiente nesta conversa a adivinhar caminhos. A primeira
// fonte que devolver dados plausiveis ganha, e quando nenhuma serve o erro
// diz o que cada uma respondeu.
// -----------------------------------------------------------------------------

const limpar = (t = '') => t.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

async function primeiraQueServe(urls, extrair, { log = () => {}, nome } = {}) {
  const tentativas = [];

  for (const url of urls.filter(Boolean)) {
    let host;
    try {
      host = new URL(url).host;
    } catch {
      continue;
    }

    try {
      const r = await pedido(url, {
        headers: { 'accept-language': 'pt-PT,pt;q=0.9' },
        seguir: 4,
      });

      if (r.status !== 200) {
        tentativas.push(`${host} -> HTTP ${r.status}`);
        await pausa(400);
        continue;
      }

      const dados = extrair(r.texto);
      if (dados?.length) {
        log(`  ${nome}: ${dados.length} de ${host}`);
        return { dados, fonte: host };
      }

      tentativas.push(`${host} -> 200 mas nada reconhecido (${r.texto.length} chars)`);
    } catch (erro) {
      tentativas.push(`${host} -> ${erro.message.split('\n')[0]}`);
    }
    await pausa(400);
  }

  log(`  ${nome}: nenhuma fonte serviu`);
  for (const t of tentativas) log(`    ${t}`);
  return { dados: [], fonte: null, tentativas };
}

// ---------------------------------------------------------------- classificacao

export function lerClassificacao(html) {
  const $ = cheerio.load(html);
  const linhas = [];

  $('tr').each((_, tr) => {
    const celulas = $(tr).find('td, th');
    if (celulas.length < 5) return;

    const textos = celulas.map((_, c) => limpar($(c).text())).get();
    const numeros = textos.filter((t) => /^\d+$/.test(t)).map(Number);
    if (numeros.length < 4) return;

    // O nome da equipa e a celula de texto mais longa que nao e um numero.
    // Ate 60 caracteres: ha sites que repetem o nome (logo + texto) e
    // "FC PortoFC Porto" passava dos 40 e ficava de fora.
    const equipa = textos
      .filter((t) => t && !/^\d+$/.test(t) && t.length > 2 && t.length < 60)
      .sort((a, b) => b.length - a.length)[0];

    if (!equipa) return;
    linhas.push({ equipa, numeros });
  });

  if (linhas.length < 10) return [];

  // Identificar as colunas pela aritmetica, nao pela posicao:
  //   jogos = vitorias + empates + derrotas
  //   pontos = 3 * vitorias + empates
  const colunas = Math.min(...linhas.map((l) => l.numeros.length));
  const esquemas = [];

  for (let j = 0; j < colunas; j++) {
    for (let v = 0; v < colunas; v++) {
      if (v === j) continue;
      for (let e = 0; e < colunas; e++) {
        if (e === j || e === v) continue;
        for (let d = 0; d < colunas; d++) {
          if (d === j || d === v || d === e) continue;

          const somaBate = linhas.every(
            (l) => l.numeros[v] + l.numeros[e] + l.numeros[d] === l.numeros[j]
          );
          if (!somaBate) continue;

          const p = [...Array(colunas).keys()].find((k) =>
            linhas.every((l) => l.numeros[k] === 3 * l.numeros[v] + l.numeros[e])
          );

          esquemas.push({ jogos: j, vitorias: v, empates: e, derrotas: d, pontos: p ?? null });
        }
      }
    }
  }

  // Aceitar so o esquema que a soma NAO chega para distinguir.
  //
  // A identidade jogos = V+E+D acontece por acaso noutras combinacoes de
  // colunas (golos marcados e sofridos dao coincidencias). Dois filtros
  // resolvem: os jogos disputados sao praticamente iguais em todas as
  // equipas, e tem de existir uma coluna que satisfaca pontos = 3V+E.
  const esquema =
    esquemas
      .filter((x) => x.pontos !== null)
      .filter((x) => {
        const jogos = linhas.map((l) => l.numeros[x.jogos]);
        const min = Math.min(...jogos);
        const max = Math.max(...jogos);
        return min >= 1 && max <= 34 && max - min <= 1;
      })
      .sort((a, b) => {
        const maxA = Math.max(...linhas.map((l) => l.numeros[a.jogos]));
        const maxB = Math.max(...linhas.map((l) => l.numeros[b.jogos]));
        return maxA - maxB;
      })[0] ?? null;

  if (!esquema) return [];

  return linhas
    .map((l, i) => ({
      posicao: i + 1,
      equipa: l.equipa,
      jogos: l.numeros[esquema.jogos],
      vitorias: l.numeros[esquema.vitorias],
      empates: l.numeros[esquema.empates],
      derrotas: l.numeros[esquema.derrotas],
      pontos: esquema.pontos !== null ? l.numeros[esquema.pontos] : null,
    }))
    .sort((a, b) => (b.pontos ?? 0) - (a.pontos ?? 0))
    .map((e, i) => ({ ...e, posicao: i + 1 }));
}

export function classificacao({ log } = {}) {
  return primeiraQueServe(
    [
      process.env.URL_CLASSIFICACAO,
      // O caminho /edicao/liga-portugal-2026-2027/ que eu tinha aqui nao
      // existe — devolvia 200 de uma pagina qualquer, com 300 mil
      // caracteres de nada. O certo e este, e traz classificacao, jogos e
      // marcadores na mesma pagina.
      'https://www.zerozero.pt/competicao/liga-portuguesa',
      'https://www.abola.pt/futebol/competicao/liga-portugal-betclic-13/classificacao',
      'https://www.transfermarkt.pt/liga-portugal/tabelle/wettbewerb/PO1',
    ],
    lerClassificacao,
    { log, nome: 'Classificacao' }
  );
}

// ------------------------------------------------------------------ calendario

// Um jogo e uma linha com duas equipas. Procuramos pares de nomes na mesma
// linha, o que e mais robusto do que confiar em classes CSS.
export function lerJogos(html, equipasConhecidas = []) {
  const $ = cheerio.load(html);
  if (!equipasConhecidas.length) return [];

  // O emparelhamento tem de ser por nome canonico.
  //
  // A primeira versao procurava o nome literal do mercado da Liga Record
  // dentro do texto: "Sp. Braga" nunca aparece no Zerozero, que escreve
  // "SC Braga". Resultado: de nove jogos por jornada so um era reconhecido,
  // e quase nenhum jogador ficava com adversario.
  const canonicas = new Map();
  for (const nome of equipasConhecidas) {
    canonicas.set(equipaCanonica(nome), nome);
  }

  const jogos = [];

  const candidatos = $('tr, li, article, div').toArray();

  for (const el of candidatos) {
    const $el = $(el);
    if ($el.find('tr, li, article').length) continue; // so folhas

    const texto = limpar($el.text());
    if (texto.length > 160) continue;

    // Procurar nomes de equipa no texto, em qualquer grafia, e reduzi-los
    // a forma canonica antes de comparar.
    const encontradas = [];
    const vistas = new Set();

    for (const { fragmento, inicio } of segmentos(texto)) {
      // Um fragmento que contem DUAS equipas nao identifica nenhuma.
      //
      // "Arouca-Marítimo" chegava aqui como um so fragmento e a
      // correspondencia parcial devolvia a que aparecesse primeiro na lista
      // de alcunhas, nao a que aparece primeiro no texto. Resultado: casa e
      // fora trocados.
      const contidas = equipasContidas(fragmento).filter((c) => canonicas.has(c));
      if (contidas.length > 1) continue;

      const canonica = equipaCanonica(fragmento);
      const oficial = canonicas.get(canonica);
      if (oficial && !vistas.has(canonica)) {
        vistas.add(canonica);
        encontradas.push({ oficial, posicao: inicio });
      }
    }

    if (encontradas.length !== 2) continue;

    encontradas.sort((a, b) => a.posicao - b.posicao);
    const [casa, fora] = encontradas.map((e) => e.oficial);

    // Celula a celula. O texto de uma <tr> vem tudo colado ("Arouca20:30"),
    // e ai um \b entre letra e digito nunca existe — a hora saia sempre
    // nula. Nas celulas individuais o valor esta isolado.
    const celulas = $el
      .find('td, span, div, time')
      .map((_, c) => limpar($(c).text()))
      .get()
      .concat(texto);

    // O ponto final em "29.08." e comum e fazia a data ser descartada.
    const data =
      celulas
        .map((t) => t.match(/^(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)\.?$/)?.[1])
        .find(Boolean) ??
      texto.match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/)?.[1] ??
      texto.match(/(\d{1,2}[/.-]\d{1,2})/)?.[1] ??
      null;

    const hora =
      celulas.map((t) => t.match(/^(\d{1,2}[:h]\d{2})$/)?.[1]).find(Boolean) ??
      texto.match(/(\d{1,2}[:h]\d{2})(?!\d)/)?.[1] ??
      null;

    // Exigir data E hora. So a data deixava passar linhas com "26/27" (a
    // epoca) ou "23-1" (um resultado), que apareciam como jogos inventados.
    if (!data || !hora) continue;

    const quando = paraData(data);
    if (!quando) continue;

    const chave = `${casa}|${fora}`;
    if (jogos.some((j) => `${j.casa}|${j.fora}` === chave)) continue;

    jogos.push({ casa, fora, data, hora, quando });
  }

  return apenasUmaJornada(jogos);
}

// "29/08" ou "29.08.2026" -> Date. Sem ano, assume o mais proximo de hoje.
function paraData(texto) {
  const m = texto.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (!m) return null;

  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;

  const agora = new Date();
  const ano = m[3]
    ? Number(m[3].length === 2 ? `20${m[3]}` : m[3])
    : agora.getFullYear();

  const d = new Date(ano, mes - 1, dia);

  // Sem ano, um jogo "no passado" ha mais de dois meses e do ano seguinte.
  if (!m[3] && d < new Date(agora.getFullYear(), agora.getMonth() - 2, 1)) {
    d.setFullYear(ano + 1);
  }
  return d;
}

// Fica so a jornada mais proxima.
//
// A pagina traz varias jornadas e a app mostrava vinte e dois jogos. A
// regra que resolve isto sem depender do HTML e do jogo: numa jornada cada
// equipa joga UMA vez. Percorremos por ordem cronologica e paramos de
// aceitar assim que uma equipa se repete.
function apenasUmaJornada(jogos) {
  const ordenados = jogos
    .filter((j) => j.quando)
    .sort((a, b) => a.quando - b.quando);

  const usadas = new Set();
  const saida = [];

  for (const jogo of ordenados) {
    if (usadas.has(jogo.casa) || usadas.has(jogo.fora)) continue;
    usadas.add(jogo.casa);
    usadas.add(jogo.fora);
    saida.push(jogo);
  }

  return saida;
}

// Divide o texto em fragmentos candidatos a nome de equipa: sequencias de
// uma a quatro palavras. Assim apanhamos "Vitoria SC", "Sp. Braga" e
// "Academico de Viseu" sem ter a lista de todas as grafias possiveis.
function segmentos(texto) {
  // Guardamos a posicao REAL de cada palavra no texto original.
  //
  // Antes procurava o fragmento com indexOf, mas um fragmento de varias
  // palavras e reconstruido com espacos ("Casa Pia AC") e no texto original
  // as palavras podem vir coladas. O indexOf devolvia -1, a posicao ficava
  // errada, e a casa trocava com o fora.
  const palavras = [...texto.matchAll(/[\p{L}\p{N}.]+/gu)].map((m) => ({
    palavra: m[0],
    inicio: m.index,
  }));

  const saida = [];
  for (let i = 0; i < palavras.length; i++) {
    for (let n = 1; n <= 4 && i + n <= palavras.length; n++) {
      const fragmento = palavras
        .slice(i, i + n)
        .map((p) => p.palavra)
        .join(' ');

      // Fragmentos de tres letras ou menos sao siglas soltas ("AC", "SC")
      // e nao identificam equipa nenhuma.
      if (fragmento.replace(/[^\p{L}]/gu, '').length >= 4) {
        saida.push({ fragmento, inicio: palavras[i].inicio });
      }
    }
  }

  // Os mais longos primeiro: "Casa Pia AC" antes de "Casa Pia".
  return saida.sort((a, b) => b.fragmento.length - a.fragmento.length);
}

// Uma jornada tem nove jogos. Uma fonte que devolva um ou dois nao esta a
// dar-nos o calendario — esta a dar-nos coincidencias.
const MINIMO_JOGOS = 4;

export function jogosDaProximaJornada(equipas, { log } = {}) {
  return primeiraQueServe(
    [
      process.env.URL_CALENDARIO,
      'https://www.zerozero.pt/competicao/liga-portuguesa',
      'https://pt.soccerway.com/portugal/liga-portugal-betclic/',
      'https://maisfutebol.iol.pt/liga/jogos',
    ],
    (html) => {
      const jogos = lerJogos(html, equipas);
      return jogos.length >= MINIMO_JOGOS ? jogos : [];
    },
    { log, nome: 'Jogos' }
  );
}

// ------------------------------------------------------------------ marcadores

export function lerMarcadores(html) {
  const $ = cheerio.load(html);
  const linhas = [];

  $('tr').each((_, tr) => {
    const textos = $(tr)
      .find('td, th')
      .map((_, c) => limpar($(c).text()))
      .get();
    if (textos.length < 3) return;

    const numeros = textos.filter((t) => /^\d+$/.test(t)).map(Number);
    if (!numeros.length) return;

    const nome = textos.find((t) => t && !/^\d+$/.test(t) && t.length > 2 && t.length < 40);
    if (!nome) return;

    // Os golos sao o ultimo numero e nunca passam de umas dezenas.
    const golos = numeros[numeros.length - 1];
    if (golos > 60) return;

    const equipa = textos.filter(
      (t) => t !== nome && t && !/^\d+$/.test(t) && t.length > 2 && t.length < 30
    )[0];

    linhas.push({ nome, equipa: equipa ?? '', golos });
  });

  if (linhas.length < 5) return [];

  // Uma tabela de marcadores esta ordenada por golos, do maior para o menor.
  // Se os valores que extrai nao respeitarem isso, apanhei a coluna errada
  // — jogos, minutos, o que for. Melhor devolver nada do que dizer que um
  // guarda-redes marcou dois golos.
  const decrescente = linhas.every((l, i) => i === 0 || linhas[i - 1].golos >= l.golos);
  if (!decrescente) return [];

  return linhas;
}

export function marcadores({ log } = {}) {
  return primeiraQueServe(
    [
      process.env.URL_MARCADORES,
      'https://www.zerozero.pt/competicao/liga-portuguesa',
      'https://www.transfermarkt.pt/liga-portugal/torschuetzenliste/wettbewerb/PO1',
      'https://maisfutebol.iol.pt/liga/marcadores',
    ],
    lerMarcadores,
    { log, nome: 'Marcadores' }
  );
}
