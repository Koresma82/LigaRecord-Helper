import * as cheerio from 'cheerio';
import { pedido, ErroSessao } from '../lib-http.js';
import { URLS } from '../config/endpoints.js';
import { lerJogadores, paraMilhoes } from './analisar.js';
import { todosOsJogadores } from './pesquisa.js';

// A pagina plantel.aspx?id_team=... e ao mesmo tempo plantel e mercado:
// mostra todos os jogadores em cartoes, com botao COMPRAR nos que ainda
// nao tens. A leitura dos cartoes esta em analisar.js.

async function abrir(url) {
  // Sem sessao. A ronda e o contador do fecho estao na pagina publica.
  let r = await pedido(url, { seguir: 4 });

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

// obterMinhaEquipa() foi removida. O plantel deixou de ser lido do site:
// o SSO da Liga Record entrega a sessao por iframe entre dominios, o que um
// cliente HTTP nao reproduz. Passou a vir do que registas na app — ver
// fontes/plantel-manual.js.

// -----------------------------------------------------------------------------
// A jornada.
//
// Ha duas contagens diferentes e e facil confundi-las:
//   - a JORNADA da Primeira Liga (a que interessa para lesoes e castigos)
//   - a RONDA da Liga Record, que so comeca na 6.a jornada
//
// Lemos a ronda da Liga Record da pagina publica, e a jornada da Primeira
// Liga conta-se pelos jogos ja realizados. LR_JORNADA no .env sobrepoe-se
// a tudo, para quando as fontes discordarem.
// -----------------------------------------------------------------------------

export async function obterJornada() {
  const manual = Number(process.env.LR_JORNADA);
  if (Number.isFinite(manual) && manual > 0) {
    return { numero: manual, fechoMercado: null, origem: 'manual' };
  }

  try {
    const $ = await abrir(URLS.gerirEquipas);
    const texto = $('body').text().replace(/\s+/g, ' ');

    const ronda = Number(texto.match(/ronda\s*(\d+)/i)?.[1]) || null;

    // "01 : 04 : 06 : 20" = dias : horas : minutos : segundos
    const c = texto.match(/(\d{1,2})\s*:\s*(\d{2})\s*:\s*(\d{2})\s*:\s*(\d{2})/);
    const fechoMercado = c
      ? new Date(
          Date.now() +
            ((Number(c[1]) * 24 + Number(c[2])) * 3600 + Number(c[3]) * 60 + Number(c[4])) * 1000
        ).toISOString()
      : null;

    return { numero: ronda, fechoMercado, origem: ronda ? 'liga-record' : 'desconhecida' };
  } catch {
    return { numero: null, fechoMercado: null, origem: 'erro' };
  }
}
