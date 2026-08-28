import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { obterSessao } from './fontes/sessao.js';
import { pedido } from './lib-http.js';
import { URLS } from './config/endpoints.js';

// Descobre COMO e que o plantel esta escrito na pagina, em vez de eu
// adivinhar outra vez. Grava o HTML e mostra a estrutura repetida.
//
//   npm run inspect-plantel

const frasco = await obterSessao();
const url = `${URLS.plantel}?id_team=${process.env.LR_ID_TEAM ?? ''}`;
const r = await pedido(url, { frasco, seguir: 5 });

await mkdir('debug', { recursive: true });
await writeFile('debug/plantel.html', r.texto, 'utf8');

console.log(`${url}`);
console.log(`estado ${r.status}, ${r.texto.length} caracteres -> debug/plantel.html\n`);

const $ = cheerio.load(r.texto);

// 0. Autenticado ou nao. Sem isto, analisa-se a pagina publica a pensar
//    que e o plantel — foi o que aconteceu da primeira vez.
const deslogado = /login\s*\/\s*registo|inicie sess|sso_layer_loginForm/i.test(r.texto);
console.log(deslogado ? 'ESTADO: DESLOGADO — esta e a pagina publica.\n' : 'ESTADO: autenticado.\n');
if (deslogado) {
  console.log('A sessao guardada expirou ou nao esta a ser enviada.');
  console.log('Apaga o documento em segredos/ no Firestore e corre outra vez,');
  console.log('para forcar um login novo.\n');
}

// 1. Os numeros que a pagina mostra ao utilizador.
const corpo = $('body').text().replace(/\s+/g, ' ');
const valor = corpo.match(/VALOR DO PLANTEL\s*€\s*([\d\s.]+)/i)?.[1]?.trim();
const saldo = corpo.match(/SALDO DISPON[IÍ]VEL\s*€\s*([\d\s.]+)/i)?.[1]?.trim();
const completo = /PLANTEL COMPLETO/i.test(corpo);
const faltam = corpo.match(/FALTAM[^A-Z]*([A-Z\s\d]+)/)?.[1]?.trim();

console.log(`valor do plantel: €${valor ?? '?'}`);
console.log(`saldo:            €${saldo ?? '?'}`);
console.log(`plantel completo: ${completo ? 'sim' : 'nao'}`);
if (faltam) console.log(`faltam:           ${faltam.slice(0, 60)}`);
console.log();

// 2. O que o parser actual encontra.
console.log(`article.player-card:      ${$('article.player-card').length}`);
console.log(`links BuyPlayer:          ${$('a[href*="BuyPlayer"]').length}`);
console.log(`links SellPlayer/Remove:  ${$('a[href*="Sell"], a[href*="Remove"]').length}`);
console.log(`.value-va:                ${$('.value-va').length}\n`);

// 3. Classes que se repetem muito: e quase sempre ai que esta o cartao.
const contagem = new Map();
$('[class]').each((_, el) => {
  for (const classe of ($(el).attr('class') ?? '').split(/\s+/)) {
    if (!classe) continue;
    contagem.set(classe, (contagem.get(classe) ?? 0) + 1);
  }
});

const repetidas = [...contagem]
  .filter(([, n]) => n >= 8 && n <= 60)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);

console.log('classes repetidas 8-60 vezes (candidatas a cartao de jogador):');
for (const [classe, n] of repetidas) {
  // CSS.escape nao existe no Node. Procuramos pelo atributo, que evita
  // problemas com classes que tenham caracteres especiais.
  const exemplo = $(`[class~="${classe.replace(/"/g, '')}"]`)
    .first()
    .text()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);
  console.log(`  ${String(n).padStart(3)}x .${classe.padEnd(24)} ${exemplo}`);
}

// 4. JSON embebido: muitas paginas .aspx trazem os dados num script.
const blocos = [...r.texto.matchAll(/(\[|\{)[^<]{200,}?(IdPlayer|PlayerPosition|CurrentValue)[^<]*?(\]|\})/g)];
console.log(`\nblocos JSON com campos de jogador: ${blocos.length}`);
for (const b of blocos.slice(0, 3)) {
  console.log(`  ${b[0].replace(/\s+/g, ' ').slice(0, 120)}...`);
}

// 5. Tabelas, caso o plantel venha em tabela.
console.log(`\ntabelas: ${$('table').length}`);
$('table').slice(0, 5).each((i, t) => {
  const linhas = $(t).find('tr').length;
  const cabecalho = $(t).find('tr').first().text().replace(/\s+/g, ' ').trim().slice(0, 80);
  if (linhas > 2) console.log(`  tabela ${i}: ${linhas} linhas | ${cabecalho}`);
});

console.log('\nCola-me este resumo.');
