import * as cheerio from 'cheerio';
import { pedido, ErroSessao } from '../lib-http.js';
import { URLS, REGRAS } from '../config/endpoints.js';
import { obterSessao, invalidar } from './sessao.js';
import { lerJogadores, paraMilhoes } from './analisar.js';
import { todosOsJogadores } from './pesquisa.js';

// A pagina plantel.aspx?id_team=... e ao mesmo tempo plantel e mercado:
// mostra todos os jogadores em cartoes, com botao COMPRAR nos que ainda
// nao tens. A leitura dos cartoes esta em analisar.js.

async function abrir(url) {
  const frasco = await obterSessao();
  let r = await pedido(url, { frasco, seguir: 4 });

  if (r.status === 200 && /inicie sess/i.test(r.texto.slice(0, 5000))) {
    invalidar();
    const novo = await obterSessao({ forcar: true });
    r = await pedido(url, { frasco: novo, seguir: 4 });
  }

  if (r.status >= 400) throw new ErroSessao(`HTTP ${r.status} em ${url}`, r.status);
  return cheerio.load(r.texto);
}

async function lerPagina(url) {
  const $ = await abrir(url);
  const jogadores = lerJogadores($);

  const $saldo = $('*')
    .filter((_, el) => /saldo dispon/i.test($(el).text()))
    .last();

  return { jogadores, saldo: paraMilhoes($saldo.text()), $ };
}

function urlPlantel() {
  const id = process.env.LR_ID_TEAM;
  if (!id) {
    throw new Error(
      'Falta LR_ID_TEAM.\n' +
        'E o numero no fim do URL do teu plantel:\n' +
        '  liga.record.pt/gerir-equipas/plantel.aspx?id_team=XXXXXX'
    );
  }
  return `${URLS.plantel}?id_team=${id}`;
}

// Usa o playersearch.ashx: quatro pedidos, um por posicao. A pagina
// plantel.aspx so mostra os primeiros resultados, por isso raspa-la nao
// chegava — foi o proprio endpoint da app que resolveu isto.
export async function obterTodosJogadores({ log = () => {} } = {}) {
  const jogadores = await todosOsJogadores({ log });

  if (jogadores.length < 150) {
    throw new Error(
      `So li ${jogadores.length} jogadores. Com 18 equipas deviam ser varias centenas.\n` +
        'A pesquisa pode ter limite de resultados por pedido — nesse caso muda\n' +
        'para todosPorClube() em src/fontes/pesquisa.js.'
    );
  }
  return jogadores;
}

export async function obterMinhaEquipa() {
  const { jogadores, saldo } = await lerPagina(urlPlantel());
  const meus = jogadores.filter((j) => j.noPlantel);
  const valorEquipa = meus.reduce((s, j) => s + j.custo, 0);

  return {
    jogadores: meus,
    saldo: saldo || Number((REGRAS.orcamentoTotal - valorEquipa).toFixed(2)),
    valorEquipa: Number(valorEquipa.toFixed(2)),
    completo: meus.length === REGRAS.tamanhoPlantel,
    faltam: REGRAS.tamanhoPlantel - meus.length,
  };
}

export async function obterJornada() {
  try {
    const $ = await abrir(URLS.gerirEquipas);
    const texto = $('body').text().replace(/\s+/g, ' ');
    const numero = Number(texto.match(/ronda\s*(\d+)/i)?.[1]) || null;

    // O contador "01 : 04 : 06 : 20" e dias:horas:minutos:segundos.
    const c = texto.match(/(\d{1,2})\s*:\s*(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})/);
    const fechoMercado = c
      ? new Date(
          Date.now() + ((Number(c[1]) * 24 + Number(c[2])) * 3600 + Number(c[3]) * 60 + Number(c[4])) * 1000
        ).toISOString()
      : null;

    return { numero, fechoMercado };
  } catch {
    return { numero: null, fechoMercado: null };
  }
}
