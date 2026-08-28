import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { getHTML } from './lib-http.js';
import {
  lerTabelaDisciplina,
  lerTabelaMarcadores,
  lerClassificacao,
  lerJogos,
} from './fontes/maisfutebol.js';

// Grava a pagina e imprime a estrutura das tabelas, para quando o parser
// deixar de reconhecer linhas. Nao precisa de credenciais do Firebase.

const URL = process.env.MF_URL_DISCIPLINA ?? 'https://maisfutebol.iol.pt/liga/disciplina';

const html = await getHTML(URL);
await mkdir('debug', { recursive: true });
await writeFile('debug/maisfutebol-disciplina.html', html);
console.log(`Gravado debug/maisfutebol-disciplina.html (${html.length} chars)`);

const $ = cheerio.load(html);
console.log(`\nTabelas na pagina: ${$('table').length}`);

$('table').each((i, t) => {
  const linhas = $(t).find('tr');
  const primeira = linhas
    .eq(1)
    .find('td')
    .map((_, td) => $(td).text().replace(/\s+/g, ' ').trim())
    .get();
  console.log(`  tabela ${i}: ${linhas.length} linhas — exemplo: ${JSON.stringify(primeira)}`);
});

const disciplina = lerTabelaDisciplina(html);
console.log(`\nDisciplina: o parser escolheu uma tabela com ${disciplina.length} jogadores.`);
console.log(disciplina.slice(0, 3));

const marcadores = lerTabelaMarcadores(html);
console.log(`\nMarcadores: ${marcadores.length} jogadores.`);
console.log(marcadores.slice(0, 3));

// Se algum destes numeros for absurdo, o parser apanhou a tabela errada.
const maxAmarelos = Math.max(0, ...disciplina.map((d) => d.amarelos));
console.log(`\nMaior numero de amarelos lido: ${maxAmarelos} (deve ser baixo).`);

const tabela = lerClassificacao(html);
console.log(`\nClassificacao: ${tabela.length} equipas (esperado: 18).`);
console.log(tabela.slice(0, 3));

const jogos = lerJogos(html, 0);
console.log(`\nJogos: ${jogos.length} reconhecidos (esperado: 9 ou 18).`);
console.log(jogos.slice(0, 6));

// -----------------------------------------------------------------------------
// Despejo cru de uma tabela, celula a celula. MF_TABELA=3 escolhe qual.
// Serve para ver se as equipas vem em celulas separadas ou coladas na mesma.
// -----------------------------------------------------------------------------
const iTabela = Number(process.env.MF_TABELA ?? 3);
console.log(`\n===== TABELA ${iTabela}, CELULA A CELULA =====`);

$('table')
  .eq(iTabela)
  .find('tr')
  .slice(0, 14)
  .each((i, tr) => {
    const celulas = $(tr)
      .find('td, th')
      .map((_, td) => {
        const $td = $(td);
        const filhos = $td.children().length;
        return `"${$td.text().replace(/\s+/g, ' ').trim().slice(0, 30)}"${filhos ? `(${filhos} filhos)` : ''}`;
      })
      .get();
    console.log(`  [${i}] ${celulas.length ? celulas.join(' | ') : '(sem celulas)'}`);
  });

// -----------------------------------------------------------------------------
// Todas as <li> que parecem um jogo, com a classe que o site lhes deu.
// Serve para confirmar que os jogos por disputar tambem entram.
// -----------------------------------------------------------------------------
console.log('\n===== <li> COM FORMA DE JOGO =====');
$('li').each((_, li) => {
  const texto = $(li).text().replace(/\s+/g, ' ').trim();
  if (!texto || texto.length > 60) return;
  if (!/^(.+?)\s+(\d{1,2}\s+\d{1,2}|\d{1,2}[:h]\d{2})\s+(.+)$/.test(texto)) return;
  console.log(`  class="${$(li).attr('class') ?? ''}" -> "${texto}"`);
});
