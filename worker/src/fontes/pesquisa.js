import * as cheerio from 'cheerio';
import { pedido, pausa, ErroSessao } from '../lib-http.js';
import { BASE } from '../config/endpoints.js';
import { lerJogadoresJSON, lerJogadores } from './analisar.js';

// -----------------------------------------------------------------------------
// playersearch.ashx — o endpoint real, apanhado no separador Rede.
//
//   playersearch.ashx?playerposition=GR&name=&club=&minval=500000
//                    &maxval=12000000&order_by=points&order_dir=desc
//
// Devolve um fragmento HTML com <article class="player-card">. Isto e muito
// melhor do que raspar a pagina inteira: e o que a propria app usa, devolve
// so o que interessa, e podemos varrer por posicao em quatro pedidos.
// -----------------------------------------------------------------------------

// O DevTools so mostra o nome do ficheiro, nao a pasta — por isso o meu
// palpite de /gerir-equipas/playersearch.ashx deu 404. Como agora ha sessao,
// vamos busca-lo onde ele esta mesmo: no JavaScript que constroi o pedido.
const NOME_HANDLER = 'playersearch.ashx';

// Confirmado: nenhum palpite chegava la. A descoberta automatica fica como
// rede de seguranca para quando eles mudarem a estrutura.
const CAMINHO_CONHECIDO = '/common/services/playersearch.ashx';

let caminhoDescoberto = null;

// Extrai o caminho do handler e resolve-o contra a pagina.
//
// Um "playersearch.ashx" solto no JavaScript e relativo ao DOCUMENTO, nao
// ao script nem a raiz — por isso a base e sempre o URL da pagina. Sem isto,
// um caminho relativo virava /playersearch.ashx e dava 404 na mesma.
function extrairCaminho(texto = '', base) {
  const m = texto.match(
    new RegExp(`["'\\(]\\s*((?:https?://[^"'\\s]+)?[^"'\\s]*${NOME_HANDLER})`, 'i')
  );
  if (!m) return null;

  try {
    return new URL(m[1], base).pathname;
  } catch {
    return null;
  }
}

// Um caminho serve se devolver jogadores. O teste e sobre o CONTEUDO,
// nao sobre o markup: a resposta e JSON e nunca teve markup nenhum, o que
// me fez rejeitar tres vezes seguidas o caminho que estava certo.
async function responde(frasco, caminho, referer, log = () => {}) {
  const alvo =
    `${BASE}${caminho}?playerposition=&name=&club=benfica&minval=500000` +
    `&maxval=12000000&order_by=points&order_dir=desc`;

  try {
    const r = await pedido(alvo, {
      frasco,
      headers: {
        'x-requested-with': 'XMLHttpRequest',
        referer,
        accept: 'application/json, text/html, */*; q=0.01',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
      },
    });

    const jogadores = r.status === 200 ? lerJogadoresJSON(r.texto) : null;
    const serve = Boolean(jogadores?.length);

    log(
      `    ${caminho} -> ${r.status}, ${r.texto.length} chars` +
        (serve
          ? ` (${jogadores.length} jogadores)`
          : `, comeca por "${r.texto.replace(/\s+/g, ' ').trim().slice(0, 70)}"`)
    );

    return serve;
  } catch (erro) {
    log(`    ${caminho} -> ${erro.message.split('\n')[0]}`);
    return false;
  }
}

export async function descobrirCaminhoPesquisa({ log = () => {} } = {}) {
  if (process.env.LR_URL_PESQUISA) return process.env.LR_URL_PESQUISA;
  if (caminhoDescoberto) return caminhoDescoberto;

  const frasco = null;
  const paginaUrl = `${BASE}/gerir-equipas/plantel.aspx?id_team=${process.env.LR_ID_TEAM ?? ''}`;

  // 0. O caminho conhecido, primeiro. Um pedido em vez de doze.
  if (await responde(frasco, CAMINHO_CONHECIDO, paginaUrl, log)) {
    caminhoDescoberto = CAMINHO_CONHECIDO;
    return CAMINHO_CONHECIDO;
  }
  log('  a procurar no JavaScript da pagina...');

  const pagina = await pedido(paginaUrl, { frasco, seguir: 5 });

  // 1. Directamente no HTML da pagina.
  const noHtml = extrairCaminho(pagina.texto, paginaUrl);
  if (noHtml) {
    log(`  caminho encontrado no HTML: ${noHtml}`);
    caminhoDescoberto = noHtml;
    return noHtml;
  }

  // 2. Nos scripts que a pagina carrega. O iniciador era o default.js,
  //    por isso comecamos pelos do proprio dominio.
  const $ = cheerio.load(pagina.texto);
  const scripts = $('script[src]')
    .map((_, el) => $(el).attr('src'))
    .get()
    .map((src) => {
      try {
        return new URL(src, paginaUrl).toString();
      } catch {
        return null;
      }
    })
    .filter((u) => u && u.startsWith(BASE));

  // Os mais provaveis primeiro, para nao descarregar o site inteiro.
  scripts.sort((a, b) => {
    const peso = (u) => (/plantel|default|gestao|equipas/i.test(u) ? 0 : 1);
    return peso(a) - peso(b);
  });

  for (const url of scripts.slice(0, 12)) {
    try {
      const r = await pedido(url, { frasco });
      const achado = extrairCaminho(r.texto, paginaUrl);
      if (achado) {
        log(`  caminho encontrado em ${url.split('/').pop()}: ${achado}`);
        caminhoDescoberto = achado;
        return achado;
      }
    } catch {
      // Um script que nao carrega nao e motivo para parar.
    }
    await pausa(300);
  }

  // 3. Sondagem final, caso mudem a pasta outra vez.
  const palpites = [
    `/common/services/${NOME_HANDLER}`,
    `/common/${NOME_HANDLER}`,
    `/services/${NOME_HANDLER}`,
    `/gerir-equipas/${NOME_HANDLER}`,
    `/handlers/${NOME_HANDLER}`,
    `/${NOME_HANDLER}`,
  ];

  for (const palpite of palpites) {
    if (await responde(frasco, palpite, paginaUrl, log)) {
      log(`  caminho encontrado por sondagem: ${palpite}`);
      caminhoDescoberto = palpite;
      return palpite;
    }
    await pausa(400);
  }

  throw new Error(
    `O ${NOME_HANDLER} nao devolveu jogadores em nenhuma tentativa.\n` +
      'O caminho /common/services/ esta confirmado, por isso o problema nao\n' +
      'e a pasta — e o que a resposta traz.\n\n' +
      'Corre `npm run testar-pesquisa`: bate no endpoint com varias\n' +
      'combinacoes de cabecalhos e parametros e mostra o que volta.'
  );
}

// CONFIRMADO no inspector: input[name="posicao"] com value GR, DF, MD, AV
// (ids posicaoGR, posicaoDF, posicaoMD, posicaoAV). Nao sao palpites.
export const POSICOES = ['GR', 'DF', 'MD', 'AV'];

// O playersearch devolve data-position em ingles; a nossa sigla interna e
// outra. Este mapa liga as duas coisas.
export const SIGLA_INTERNA = { GR: 'GR', DF: 'DEF', MD: 'MED', AV: 'AVA' };

const LIMITES = {
  minval: 500_000,
  maxval: 12_000_000,
};

function url(caminho, { posicao, clube = '', nome = '', ordem = 'points', sentido = 'desc' }) {
  const p = new URLSearchParams({
    playerposition: posicao,
    name: nome,
    club: clube,
    minval: String(LIMITES.minval),
    maxval: String(LIMITES.maxval),
    order_by: ordem,
    order_dir: sentido,
  });
  return `${BASE}${caminho}?${p}`;
}

// Os mesmos cabecalhos que o browser envia. Confirmado na captura:
// Sec-Fetch-Site: same-origin e o Referer a apontar para a pagina do plantel.
// Handlers .ashx recusam pedidos sem Referer com alguma frequencia.
function cabecalhosDePesquisa() {
  return {
    'x-requested-with': 'XMLHttpRequest',
    accept: 'text/html, */*; q=0.01',
    referer: `${BASE}/gerir-equipas/plantel.aspx?id_team=${process.env.LR_ID_TEAM ?? ''}`,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };
}

async function buscar(parametros) {
  // Sem sessao: o playersearch e publico. Foi a descoberta que salvou o
  // projecto — todo o mercado, com valores e pontos, sem login nenhum.
  const frasco = null;
  const caminho = await descobrirCaminhoPesquisa();
  const alvo = url(caminho, parametros);

  const r = await pedido(alvo, { frasco, headers: cabecalhosDePesquisa() });

  // Se um dia pedirem sessao aqui, o erro tem de ser explicito. Antes havia
  // uma tentativa de re-autenticar que ja nao faz sentido nenhum: o login
  // foi abandonado e o playersearch e publico.
  if (r.status === 401 || r.status === 403) {
    throw new ErroSessao(
      `O playersearch passou a exigir sessao (${r.status}).\n` +
        'Isso muda a arquitectura: avisa-me.',
      r.status
    );
  }

  if (r.status >= 400) throw new ErroSessao(`HTTP ${r.status} em ${alvo}`, r.status);

  // O endpoint devolve JSON. Se um dia mudar para HTML, o parser de
  // cartoes continua la e apanha isso sem partir nada.
  const emJSON = lerJogadoresJSON(r.texto);
  if (emJSON) return emJSON;

  return lerJogadores(cheerio.load(r.texto));
}

// Varre a liga toda.
//
// Duas estrategias. A por posicao sao quatro pedidos, mas depende de a
// pesquisa aceitar clube vazio — o que nao e certo. A por clube sao 18
// pedidos e e a que sabemos funcionar, porque foi a que o browser fez.
// Tentamos a rapida e caimos na fiavel se ela nao chegar.
export async function todosOsJogadores({ log = () => {}, clubes } = {}) {
  const todos = new Map();



  for (const posicao of POSICOES) {
    const lote = await buscar({ posicao });
    log(`  ${posicao}: ${lote.length}`);
    for (const j of lote) todos.set(j.id, j);
    await pausa(800);
  }

  if (todos.size >= 150) return [...todos.values()];

  log(`  por posicao deu ${todos.size}. A varrer clube a clube...`);

  // Os nomes vem dos proprios dados ja recolhidos, nao de uma lista minha.
  const lista = clubes ?? clubesDosDados([...todos.values()]);
  if (!lista.length) {
    throw new Error(
      'Nao consegui nem por posicao nem descobrir os clubes.\n' +
        'Corre `npm run testar-pesquisa` e ve o que o endpoint devolve.'
    );
  }

  const porClube = await todosPorClube(lista, { log });
  for (const j of porClube) todos.set(j.id, j);

  return [...todos.values()];
}

// O parametro `club` leva o NOME do clube, nao um id.
//
// A minha lista escrita a mao falhava: "Académico Viseu" deu zero jogadores.
// A solucao e nao inventar nomes — o proprio JSON traz o NameClub de cada
// jogador, que e exactamente a grafia que o site aceita.
export function nomeDeClubeParaPesquisa(nome = '') {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Descobre os clubes a partir de um lote de jogadores.
export function clubesDosDados(jogadores) {
  return [...new Set(jogadores.map((j) => j.equipa).filter(Boolean))].sort();
}

// Alternativa: varrer clube a clube. Mais lento (18 pedidos) mas garante
// que nada fica de fora se a pesquisa por posicao tiver limite de resultados.
export async function todosPorClube(clubes, { log = () => {} } = {}) {
  const todos = new Map();

  for (const clube of clubes) {
    // Com o clube definido e a posicao vazia vem o plantel todo de uma vez.
    const lote = await buscar({ posicao: '', clube: nomeDeClubeParaPesquisa(clube) });
    for (const j of lote) todos.set(j.id, j);
    log(`  ${clube}: ${lote.length} (${todos.size} acumulados)`);
    await pausa(800);
  }

  return [...todos.values()];
}
