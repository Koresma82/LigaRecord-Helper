import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { pedido } from './lib-http.js';
import { lerTabelaDisciplina } from './fontes/disciplina.js';

const url = process.env.MF_URL_DISCIPLINA ?? 'https://maisfutebol.iol.pt/liga/disciplina';

const r = await pedido(url, { headers: { 'accept-language': 'pt-PT,pt;q=0.9' }, seguir: 4 });
await mkdir('debug', { recursive: true });
await writeFile('debug/disciplina.html', r.texto, 'utf8');

console.log(`${url}`);
console.log(`estado ${r.status}, ${r.texto.length} caracteres -> debug/disciplina.html\n`);
if (r.status !== 200) process.exit(1);

const $ = cheerio.load(r.texto);
console.log(`tabelas: ${$('table').length}, linhas: ${$('tr').length}\n`);

const cartoes = lerTabelaDisciplina(r.texto);
console.log(`lidos: ${cartoes.length} jogadores\n`);

const somaA = cartoes.reduce((s, c) => s + c.amarelos, 0);
const somaV = cartoes.reduce((s, c) => s + c.vermelhos, 0);
console.log(`total amarelos ${somaA}, vermelhos ${somaV}`);
console.log(
  somaA > somaV * 3
    ? '  proporcao plausivel — colunas identificadas correctamente\n'
    : '  ATENCAO: proporcao estranha, as colunas podem estar trocadas\n'
);

for (const c of cartoes.slice(0, 10)) {
  console.log(`  ${c.nome.padEnd(20)} ${c.equipa.padEnd(16)} ${c.amarelos}A ${c.vermelhos}V`);
}

const noLimite = cartoes.filter((c) => c.amarelos > 0 && c.amarelos % 5 === 0);
const perto = cartoes.filter((c) => c.amarelos % 5 === 4);
console.log(`\nmultiplos de 5 amarelos: ${noLimite.length}`);
console.log(`a um amarelo do castigo: ${perto.length}`);

const clubes = [...new Set(cartoes.map((c) => c.equipa).filter(Boolean))].sort();
console.log(`\nclubes (${clubes.length}): ${clubes.join(', ')}`);
console.log('\nCola-me este resumo.');
