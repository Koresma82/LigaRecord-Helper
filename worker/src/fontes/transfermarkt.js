import * as cheerio from 'cheerio';
import { pedido } from '../lib-http.js';

// -----------------------------------------------------------------------------
// Transfermarkt — jogadores lesionados de toda a Liga Portugal numa pagina.
//
//   https://www.transfermarkt.pt/liga-portugal/verletztespieler/wettbewerb/PO1
//
// Uma tabela com jogador, posicao, clube, tipo de lesao, data de regresso e
// valor de mercado. Um pedido em vez de dezoito, e a data de regresso e uma
// informacao que o Zerozero nao dava.
//
// LIMITE IMPORTANTE: isto sao LESOES, nao castigos. O Transfermarkt nao tem
// pagina equivalente para suspensoes na Liga Portugal, e os castigos por
// acumulacao de amarelos e por vermelho ficam de fora. Ver o README.
// -----------------------------------------------------------------------------

const URL_LESOES =
  process.env.TM_URL_LESOES ??
  'https://www.transfermarkt.pt/liga-portugal/verletztespieler/wettbewerb/PO1';

const CABECALHOS = {
  'accept-language': 'pt-PT,pt;q=0.9,en;q=0.8',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

function limpar(texto = '') {
  return texto.replace(/\s+/g, ' ').trim();
}

// "31/08/2026" -> ISO, para se poder ordenar e comparar
function paraISO(texto = '') {
  const m = limpar(texto).match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (!m) return null;
  const [, dia, mes, ano] = m;
  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

export function lerTabelaLesoes(html) {
  const $ = cheerio.load(html);
  const linhas = [];

  // ">" directo: a celula do jogador tem uma tabela LA DENTRO, e sem isto
  // as linhas internas eram lidas como se fossem jogadores. Dava cada
  // jogador duas vezes, a segunda com o clube vazio.
  $('table.items > tbody > tr').each((_, tr) => {
    const $tr = $(tr);

    // O nome esta sempre num link para o perfil do jogador.
    const $jogador = $tr.find('a[href*="/profil/spieler/"]').first();
    const nome = limpar($jogador.attr('title') || $jogador.text());
    if (!nome) return;

    // O clube so aparece como escudo; o nome esta no title da imagem.
    const equipa = limpar(
      $tr.find('img.tiny_wappen').attr('title') ??
        $tr.find('a[href*="/startseite/verein/"] img').attr('title') ??
        $tr.find('a[href*="/spielplan/verein/"]').attr('title') ??
        ''
    );

    // A posicao vem na segunda linha da tabela interna do jogador.
    const posicao = limpar(
      $tr.find('table.inline-table tr').eq(1).find('td').first().text()
    );

    // A primeira celula e a do jogador (nome + posicao) e a segunda o clube.
    // Saltamos as duas: o que interessa esta nas seguintes.
    const restantes = $tr
      .find('> td')
      .slice(2)
      .map((_, td) => limpar($(td).text()))
      .get();

    const dataRegresso = restantes.map(paraISO).find(Boolean) ?? null;

    const lesao =
      restantes.find(
        (c) => c && !/€/.test(c) && !paraISO(c) && c.length > 3
      ) ?? 'Lesionado';

    linhas.push({
      nome,
      equipa,
      posicao,
      tipo: 'lesao',
      motivo: dataRegresso ? `${lesao} — regresso previsto ${dataRegresso}` : lesao,
      dataRegresso,
      fonte: 'transfermarkt',
    });
  });

  return linhas;
}

export async function lesoesDaLiga({ log = () => {} } = {}) {
  const r = await pedido(URL_LESOES, { headers: CABECALHOS, seguir: 4 });

  if (r.status === 403) {
    throw new Error(
      'O Transfermarkt devolveu 403 — bloqueou o pedido.\n' +
        'Acontece com scrapers. Se persistir, temos de mudar de fonte.'
    );
  }
  if (r.status >= 400) {
    throw new Error(`Transfermarkt devolveu ${r.status} em ${URL_LESOES}`);
  }

  const lesoes = lerTabelaLesoes(r.texto);
  log(`  Transfermarkt: ${lesoes.length} lesionados (${r.texto.length} chars)`);

  if (!lesoes.length) {
    throw new Error(
      `A pagina carregou (${r.texto.length} chars) mas nao li nenhuma linha.\n` +
        'A tabela mudou de estrutura. Corre `npm run inspect-tm` para gravar\n' +
        'o HTML e ver o que mudou.'
    );
  }

  return lesoes;
}
