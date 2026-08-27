import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { obterSessao } from './fontes/sessao.js';
import { pedido } from './lib-http.js';
import { URLS, BASE } from './config/endpoints.js';
import { POSICOES } from './fontes/pesquisa.js';
import { lerJogadores } from './fontes/analisar.js';

// Confirma que o login funciona e que o playersearch.ashx responde
// para as quatro posicoes.
//   npm run descobrir           -> tudo
//   npm run descobrir login     -> so o formulario, sem autenticar

await mkdir('debug', { recursive: true });

if (process.argv[2] === 'login') {
  const r = await pedido(URLS.login);
  await writeFile('debug/login.html', r.texto, 'utf8');
  const $ = cheerio.load(r.texto);
  console.log(`Estado ${r.status}, URL final ${r.url}\n`);
  $('input').each((_, el) => {
    const a = $(el).attr();
    if (a.name) console.log(`  ${(a.type ?? 'text').padEnd(9)} ${a.name}`);
  });
  console.log('\nHTML em debug/login.html');
  process.exit(0);
}

const frasco = await obterSessao();
console.log('Sessao activa.\n');

console.log('playersearch.ashx por posicao:');
let total = 0;

for (const posicao of POSICOES) {
  const p = new URLSearchParams({
    playerposition: posicao,
    name: '',
    club: '',
    minval: '500000',
    maxval: '12000000',
    order_by: 'points',
    order_dir: 'desc',
  });
  const url = `${BASE}/gerir-equipas/playersearch.ashx?${p}`;
  const r = await pedido(url, {
    frasco,
    headers: { 'x-requested-with': 'XMLHttpRequest' },
  });

  await writeFile(`debug/pesquisa-${posicao}.html`, r.texto, 'utf8');
  const jogadores = lerJogadores(cheerio.load(r.texto));
  total += jogadores.length;

  const marca = jogadores.length ? 'OK   ' : 'VAZIO';
  console.log(`  ${marca} ${posicao}  ${r.status}  ${jogadores.length} jogadores  (${r.texto.length} chars)`);
  if (jogadores.length) {
    const j = jogadores[0];
    console.log(`        ex: ${j.nome} / ${j.equipa} / ${j.custo}M / ${j.pontosTotais}pts`);
  }
}

console.log(`\nTotal: ${total} jogadores unicos lidos.`);
if (total < 150) {
  console.log(
    'Sao poucos. Ou algum codigo de posicao esta errado (ve os VAZIO acima),\n' +
      'ou a pesquisa tem limite por pedido e e preciso varrer clube a clube.'
  );
}
console.log('\nFragmentos gravados em debug/. Cola-me este resumo.');
