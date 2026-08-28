import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { pedido } from './lib-http.js';
import { jornadaPelaClassificacao } from './fontes/jornada.js';

// Mostra o que cada fonte de classificacao devolve e porque e que o parser
// aceita ou rejeita. A jornada ficou em branco sem explicacao nenhuma.
//
//   npm run inspect-jornada

const FONTES = [
  'https://maisfutebol.iol.pt/liga/classificacao',
  'https://www.zerozero.pt/edicao/liga-portugal-2026-2027/classificacao',
  'https://www.transfermarkt.pt/liga-portugal/tabelle/wettbewerb/PO1',
];

await mkdir('debug', { recursive: true });

for (const url of FONTES) {
  const host = new URL(url).host;
  let r;
  try {
    r = await pedido(url, { headers: { 'accept-language': 'pt-PT,pt;q=0.9' }, seguir: 4 });
  } catch (erro) {
    console.log(`${host}: ERRO ${erro.message.split('\n')[0]}\n`);
    continue;
  }

  console.log(`=== ${host} — ${r.status}, ${r.texto.length} chars`);
  if (r.status !== 200) {
    console.log();
    continue;
  }

  await writeFile(`debug/classificacao-${host}.html`, r.texto, 'utf8');

  const $ = cheerio.load(r.texto);
  const linhas = [];
  $('tr').each((_, tr) => {
    const numeros = $(tr)
      .find('td, th')
      .map((_, c) => $(c).text().replace(/\u00a0/g, ' ').trim())
      .get()
      .filter((v) => /^-?\d+$/.test(v))
      .map(Number);
    if (numeros.length >= 4) linhas.push(numeros);
  });

  console.log(`  linhas com 4+ numeros: ${linhas.length}`);
  for (const l of linhas.slice(0, 4)) console.log(`    [${l.join(', ')}]`);

  const jornada = jornadaPelaClassificacao(r.texto);
  console.log(`  jornada: ${jornada ?? 'nao reconhecida'}`);

  if (!jornada && linhas.length) {
    console.log('  (nenhuma coluna satisfaz jogos = vitorias + empates + derrotas)');
  }
  console.log();
  await new Promise((res) => setTimeout(res, 500));
}

console.log('---');
console.log('Cola-me este resumo. Sao dados publicos de classificacao.');
