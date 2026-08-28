import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { pedido } from './lib-http.js';
import { lerClassificacao, lerJogos, lerMarcadores } from './fontes/campeonato.js';

// Mostra o que cada fonte de classificacao, calendario e marcadores devolve.
//   npm run inspect-campeonato

const EQUIPAS = [
  'FC Porto', 'Benfica', 'Sporting', 'Sp. Braga', 'V. Guimarães', 'Arouca',
  'Alverca', 'Casa Pia', 'E. Amadora', 'Estoril', 'Famalicão', 'Gil Vicente',
  'Marítimo', 'Moreirense', 'Nacional', 'Rio Ave', 'Santa Clara', 'Ac. Viseu',
];

const GRUPOS = [
  ['classificacao', lerClassificacao, [
    'https://www.zerozero.pt/competicao/liga-portuguesa',
    'https://www.abola.pt/futebol/competicao/liga-portugal-betclic-13/classificacao',
    'https://www.transfermarkt.pt/liga-portugal/tabelle/wettbewerb/PO1',
  ]],
  ['jogos', (h) => lerJogos(h, EQUIPAS), [
    'https://www.zerozero.pt/competicao/liga-portuguesa',
    'https://pt.soccerway.com/portugal/liga-portugal-betclic/',
    'https://maisfutebol.iol.pt/liga/jogos',
  ]],
  ['marcadores', lerMarcadores, [
    'https://www.zerozero.pt/competicao/liga-portuguesa',
    'https://www.transfermarkt.pt/liga-portugal/torschuetzenliste/wettbewerb/PO1',
  ]],
];

await mkdir('debug', { recursive: true });

for (const [nome, extrair, urls] of GRUPOS) {
  console.log(`=== ${nome.toUpperCase()}`);
  for (const url of urls) {
    const host = new URL(url).host;
    let r;
    try {
      r = await pedido(url, { headers: { 'accept-language': 'pt-PT,pt;q=0.9' }, seguir: 4 });
    } catch (erro) {
      console.log(`  ${host.padEnd(26)} ERRO ${erro.message.split('\n')[0]}`);
      continue;
    }

    if (r.status !== 200) {
      console.log(`  ${host.padEnd(26)} HTTP ${r.status}`);
      continue;
    }

    const dados = extrair(r.texto);
    console.log(
      `  ${host.padEnd(26)} 200  ${String(r.texto.length).padStart(7)} chars  ` +
        `${dados.length} lidos`
    );

    await writeFile(`debug/${nome}-${host}.html`, r.texto, 'utf8');

    if (dados.length) {
      for (const d of dados.slice(0, 3)) {
        console.log(`      ${JSON.stringify(d).slice(0, 120)}`);
      }
      break;
    }

    // Falhou: mostrar o que la esta, para se perceber porque.
    const $ = cheerio.load(r.texto);
    const linhas = [];
    $('tr').each((_, tr) => {
      const t = $(tr).find('td, th').map((_, c) => $(c).text().replace(/\s+/g, ' ').trim()).get();
      if (t.filter(Boolean).length >= 4) linhas.push(t);
    });
    console.log(`      linhas com 4+ celulas: ${linhas.length}`);
    for (const l of linhas.slice(0, 3)) {
      console.log(`        ${JSON.stringify(l).slice(0, 130)}`);
    }

    await new Promise((res) => setTimeout(res, 500));
  }
  console.log();
}

console.log('---');
console.log('Se alguma linha disser "0 lidos" em todas as fontes, manda-me o');
console.log('URL certo dessa pagina e eu meto-o em primeiro lugar.');
