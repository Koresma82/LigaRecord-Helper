import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { obterSessao } from './fontes/sessao.js';
import { pedido } from './lib-http.js';
import { BASE } from './config/endpoints.js';
import { lerJogadoresJSON, lerJogadores } from './fontes/analisar.js';

// Bate no playersearch.ashx com varias combinacoes e MOSTRA a resposta.
// Ate agora eu decidia por um sim/nao e nunca via o que voltava — foi assim
// que dei o caminho certo como inexistente duas vezes seguidas.
//
//   npm run testar-pesquisa

await mkdir('debug', { recursive: true });

const CAMINHO = process.env.LR_URL_PESQUISA ?? '/common/services/playersearch.ashx';
const REFERER = `${BASE}/gerir-equipas/plantel.aspx?id_team=${process.env.LR_ID_TEAM ?? ''}`;

const frasco = await obterSessao();

const porDominio = {};
for (const [nome, c] of frasco.cookies) {
  (porDominio[c.dominio ?? '(sem dominio)'] ??= []).push(nome);
}
console.log('Cookies:');
for (const [d, nomes] of Object.entries(porDominio)) console.log(`  ${d}: ${nomes.join(', ')}`);
console.log(`\nCaminho: ${BASE}${CAMINHO}\n`);

const consulta = (extra = {}) =>
  new URLSearchParams({
    playerposition: '',
    name: '',
    club: 'benfica',
    minval: '500000',
    maxval: '12000000',
    order_by: 'points',
    order_dir: 'desc',
    ...extra,
  }).toString();

const VARIANTES = [
  {
    nome: 'como o browser',
    consulta: consulta(),
    headers: {
      'x-requested-with': 'XMLHttpRequest',
      referer: REFERER,
      accept: 'text/html, */*; q=0.01',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    },
  },
  { nome: 'sem cabecalho XHR', consulta: consulta(), headers: { referer: REFERER } },
  { nome: 'sem referer', consulta: consulta(), headers: { 'x-requested-with': 'XMLHttpRequest' } },
  {
    nome: 'posicao GR, sem clube',
    consulta: consulta({ playerposition: 'GR', club: '' }),
    headers: { 'x-requested-with': 'XMLHttpRequest', referer: REFERER },
  },
  {
    nome: 'com id_team',
    consulta: consulta({ id_team: process.env.LR_ID_TEAM ?? '' }),
    headers: { 'x-requested-with': 'XMLHttpRequest', referer: REFERER },
  },
];

for (const v of VARIANTES) {
  const url = `${BASE}${CAMINHO}?${v.consulta}`;
  let r;
  try {
    r = await pedido(url, { frasco, headers: v.headers, seguir: 3 });
  } catch (erro) {
    console.log(`${v.nome.padEnd(22)} ERRO: ${erro.message.split('\n')[0]}`);
    continue;
  }

  const emJSON = lerJogadoresJSON(r.texto);
  const jogadores = emJSON ?? lerJogadores(cheerio.load(r.texto));
  const tipo = r.headers?.['content-type'] ?? '?';

  console.log(
    `${v.nome.padEnd(22)} ${r.status}  ${String(r.texto.length).padStart(6)} chars  ` +
      `${emJSON ? 'JSON' : 'HTML'}  ${jogadores.length} jogadores`
  );
  console.log(`  content-type: ${tipo}`);
  console.log(`  url final:    ${r.url}`);

  const inicio = r.texto.replace(/\s+/g, ' ').trim().slice(0, 200);
  console.log(`  comeca por:   ${inicio || '(vazio)'}`);

  if (jogadores.length) {
    const j = jogadores[0];
    console.log(`  exemplo:      ${j.nome} / ${j.equipa} / ${j.posicao} / ${j.custo}M`);
  }

  const ficheiro = `debug/pesquisa-${v.nome.replace(/\s+/g, '-')}.html`;
  await writeFile(ficheiro, r.texto, 'utf8');
  console.log(`  gravado em:   ${ficheiro}\n`);

  await new Promise((res) => setTimeout(res, 700));
}

console.log('---');
console.log('Cola-me este output. Os fragmentos sao dados publicos de jogadores,');
console.log('sem credenciais — mas basta-me o resumo acima.');
