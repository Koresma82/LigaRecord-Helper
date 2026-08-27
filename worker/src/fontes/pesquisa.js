import * as cheerio from 'cheerio';
import { pedido, pausa, ErroSessao } from '../lib-http.js';
import { BASE } from '../config/endpoints.js';
import { obterSessao, invalidar } from './sessao.js';
import { lerJogadores } from './analisar.js';

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

const CAMINHO = '/gerir-equipas/playersearch.ashx';

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

function url({ posicao, clube = '', nome = '', ordem = 'points', sentido = 'desc' }) {
  const p = new URLSearchParams({
    playerposition: posicao,
    name: nome,
    club: clube,
    minval: String(LIMITES.minval),
    maxval: String(LIMITES.maxval),
    order_by: ordem,
    order_dir: sentido,
  });
  return `${BASE}${CAMINHO}?${p}`;
}

async function buscar(parametros) {
  const frasco = await obterSessao();
  const alvo = url(parametros);

  let r = await pedido(alvo, {
    frasco,
    headers: { 'x-requested-with': 'XMLHttpRequest', accept: 'text/html, */*' },
  });

  if (r.status === 401 || r.status === 403 || /inicie sess/i.test(r.texto.slice(0, 2000))) {
    invalidar();
    const novo = await obterSessao({ forcar: true });
    r = await pedido(alvo, {
      frasco: novo,
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    });
  }

  if (r.status >= 400) throw new ErroSessao(`HTTP ${r.status} em ${alvo}`, r.status);

  return lerJogadores(cheerio.load(r.texto));
}

// Varre as quatro posicoes. Quatro pedidos, nao quatrocentos.
export async function todosOsJogadores({ log = () => {} } = {}) {
  const todos = new Map();
  const vazias = [];

  for (const posicao of POSICOES) {
    const lote = await buscar({ posicao });
    log(`  ${posicao}: ${lote.length}`);
    if (!lote.length) vazias.push(posicao);
    for (const j of lote) todos.set(j.id, j);
    await pausa(800);
  }

  if (vazias.length) {
    throw new Error(
      `As posicoes ${vazias.join(', ')} nao devolveram jogadores.\n` +
        'Os codigos estao confirmados, por isso o problema nao e esse:\n' +
        'ou a sessao caiu, ou o playersearch.ashx mudou de assinatura.\n' +
        'Corre `npm run descobrir` e ve os fragmentos em debug/.'
    );
  }

  return [...todos.values()];
}

// Alternativa: varrer clube a clube. Mais lento (72 pedidos) mas garante
// que nada fica de fora se a pesquisa por posicao tiver limite de resultados.
export async function todosPorClube(clubes, { log = () => {} } = {}) {
  const todos = new Map();

  for (const clube of clubes) {
    for (const posicao of POSICOES) {
      const lote = await buscar({ posicao, clube });
      for (const j of lote) todos.set(j.id, j);
      await pausa(600);
    }
    log(`  ${clube}: ${todos.size} acumulados`);
  }

  return [...todos.values()];
}
