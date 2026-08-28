import { readFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';

// Analisa o debug/cadeia-fim.txt — a ultima pagina da cadeia de login —
// e diz o que la esta, com os valores mascarados.
//
//   npm run analisar-cadeia

const ficheiro = process.argv[2] ?? 'debug/cadeia-fim.txt';
const bruto = await readFile(ficheiro, 'utf8').catch(() => null);

if (!bruto) {
  console.error(`Nao consegui ler ${ficheiro}.`);
  process.exit(1);
}

const [cabecalho, ...resto] = bruto.split('\n---\n');
const corpo = resto.join('\n---\n');

console.log('=== ONDE PAROU ===');
for (const linha of cabecalho.split('\n')) {
  if (/^(URL|Estado|content-type|location):/i.test(linha)) console.log(linha);
}

const $ = cheerio.load(corpo);
console.log(`\ncorpo: ${corpo.length} caracteres`);

const deslogado = /login\s*\/\s*registo|inicie sess/i.test(corpo);
console.log(`estado: ${deslogado ? 'DESLOGADO' : 'possivelmente autenticado'}\n`);

// O que poderia continuar a cadeia e nos nao seguimos.
const categorias = [
  ['iframes', 'iframe[src]', 'src'],
  ['imagens 1x1 / pixeis', 'img[width="1"], img[height="1"]', 'src'],
  ['scripts externos', 'script[src]', 'src'],
  ['formularios', 'form', 'action'],
];

for (const [nome, selector, atributo] of categorias) {
  const itens = $(selector)
    .map((_, el) => $(el).attr(atributo))
    .get()
    .filter(Boolean);
  if (!itens.length) continue;

  console.log(`${nome}: ${itens.length}`);
  for (const item of itens.slice(0, 8)) {
    const mascarado = item.replace(/([=/])([A-Za-z0-9%._-]{20,})/g, (_, sep, v) => `${sep}<${v.length} chars>`);
    console.log(`  ${mascarado.slice(0, 110)}`);
  }
  console.log();
}

// Redireccionamentos por JavaScript.
const js = [...corpo.matchAll(/(?:location\.href|location\.replace|window\.open)\s*=?\s*\(?\s*["']([^"']+)["']/gi)];
if (js.length) {
  console.log(`redireccionamentos JS: ${js.length}`);
  for (const m of js.slice(0, 5)) console.log(`  ${m[1].slice(0, 110)}`);
  console.log();
}

// Qualquer referencia ao endpoint que nos interessa.
const alvos = [...corpo.matchAll(/[^\s"'<>]*user_login[^\s"'<>]*/gi)];
console.log(`referencias a user_login: ${alvos.length}`);
for (const m of alvos.slice(0, 5)) {
  console.log(`  ${m[0].replace(/=([A-Za-z0-9%._-]{20,})/g, (_, v) => `=<${v.length} chars>`).slice(0, 110)}`);
}

console.log('\n---');
console.log('Podes colar este output — os valores estao mascarados.');
