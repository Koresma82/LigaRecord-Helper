import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { pedido } from './lib-http.js';
import { lerTabelaLesoes } from './fontes/transfermarkt.js';

// Grava e analisa a pagina de lesionados do Transfermarkt.
//   npm run inspect-tm

const url =
  process.env.TM_URL_LESOES ??
  'https://www.transfermarkt.pt/liga-portugal/verletztespieler/wettbewerb/PO1';

const r = await pedido(url, {
  headers: {
    'accept-language': 'pt-PT,pt;q=0.9,en;q=0.8',
    accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  },
  seguir: 4,
});

await mkdir('debug', { recursive: true });
await writeFile('debug/transfermarkt.html', r.texto, 'utf8');

console.log(`${url}`);
console.log(`estado ${r.status}, ${r.texto.length} caracteres -> debug/transfermarkt.html\n`);

if (r.status !== 200) {
  console.log('Sem 200 nao ha nada a fazer. 403 significa que bloquearam o pedido.');
  process.exit(1);
}

const $ = cheerio.load(r.texto);
console.log(`tabelas .items: ${$('table.items').length}`);
console.log(`linhas directas: ${$('table.items > tbody > tr').length}`);
console.log(`links de jogador: ${$('a[href*="/profil/spieler/"]').length}`);
console.log(`escudos de clube: ${$('img.tiny_wappen').length}\n`);

const lesoes = lerTabelaLesoes(r.texto);
console.log(`lidos: ${lesoes.length} lesionados\n`);

for (const l of lesoes.slice(0, 12)) {
  console.log(`  ${l.nome.padEnd(22)} ${l.equipa.padEnd(16)} ${l.motivo}`);
}
if (lesoes.length > 12) console.log(`  ... e mais ${lesoes.length - 12}`);

const clubes = [...new Set(lesoes.map((l) => l.equipa).filter(Boolean))].sort();
console.log(`\nclubes encontrados (${clubes.length}): ${clubes.join(', ')}`);

console.log('\nCola-me este resumo.');
