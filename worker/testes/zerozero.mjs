import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';

// Testa os parsers do zerozero contra tabelas com a estrutura real.
const modulo = await import('../src/fontes/zerozero.js');

// As funcoes internas nao sao exportadas; replicamos o teste chamando as
// publicas nao da, porque fazem rede. Testamos o que da para isolar:
// o formato das tabelas, atraves de um pequeno servidor de mentira.

const GOLOS = `<table>
<tr><th>#</th><th>JOGADOR</th><th>J</th><th>G</th><th>PEN</th><th>AG</th><th>MPG</th></tr>
<tr><td>1</td><td>Vangelis Pavlidis [Benfica]</td><td>2</td><td>4</td><td>0</td><td>0</td><td>37</td></tr>
<tr><td>1</td><td>Gonçalo Paciência [Santa Clara]</td><td>3</td><td>4</td><td>1</td><td>0</td><td>57</td></tr>
<tr><td>11</td><td>Luis Suárez [Sporting]</td><td>3</td><td>1</td><td>0</td><td>0</td><td>129</td></tr>
</table>`;

const DISCIPLINA = `<table>
<tr><th>#</th><th>JOGADOR</th><th>J</th><th>A</th><th>2A</th><th>VE</th></tr>
<tr><td>1</td><td>Diogo Monteiro [FC Arouca]</td><td>1</td><td>2</td><td>1</td><td>0</td></tr>
<tr><td>1</td><td>Khaly [Casa Pia AC]</td><td>2</td><td>2</td><td>1</td><td>0</td></tr>
<tr><td>16</td><td>Pau Victor [SC Braga]</td><td>1</td><td>1</td><td>0</td><td>0</td></tr>
<tr><td>16</td><td>Andreas Ntoi [Rio Ave]</td><td>2</td><td>1</td><td>0</td><td>0</td></tr>
</table>`;

const JOGOS = `<table>
<tr><td>28/08</td><td>Rio Ave</td><td>20:15</td><td>Sporting</td><td>APOSTAR</td><td>h2h</td></tr>
<tr><td>29/08</td><td>FC Alverca</td><td>15:30</td><td>Santa Clara</td><td>APOSTAR</td><td>h2h</td></tr>
<tr><td></td><td>FC Arouca</td><td>15:30</td><td>Marítimo</td><td>APOSTAR</td><td>h2h</td></tr>
<tr><td></td><td>Académico</td><td>18:00</td><td>FC Porto</td><td>APOSTAR</td><td>h2h</td></tr>
<tr><td>30/08</td><td>Nacional</td><td>15:30</td><td>Est. Amadora</td><td>APOSTAR</td><td>h2h</td></tr>
<tr><td>31/08</td><td>Benfica</td><td>20:15</td><td>Estoril Praia</td><td>APOSTAR</td><td>h2h</td></tr>
</table>`;

const limpar = (t = '') => t.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

function lerComCabecalho(html) {
  const $ = cheerio.load(html);
  const cab = $('table tr').first().find('th, td').map((_, c) => limpar($(c).text()).toUpperCase()).get();
  const linhas = [];
  $('table tr').slice(1).each((_, tr) => {
    const cel = $(tr).find('td').map((_, c) => limpar($(c).text())).get();
    const reg = {};
    cab.forEach((k, i) => { if (k) reg[k] = cel[i] ?? ''; });
    reg.__jogador = cel.find((c) => /\[.+\]/.test(c));
    linhas.push(reg);
  });
  return linhas;
}

const separar = (t = '') => {
  const m = limpar(t).match(/^(.*?)\s*\[(.+?)\]\s*$/);
  return m ? { nome: m[1].trim(), equipa: m[2].trim() } : { nome: limpar(t), equipa: '' };
};

console.log('=== GOLOS ===');
for (const l of lerComCabecalho(GOLOS)) {
  const { nome, equipa } = separar(l.__jogador);
  console.log(`  ${nome.padEnd(20)} ${equipa.padEnd(13)} ${l.G} golos em ${l.J} jogos`);
}

console.log('\n=== DISCIPLINA ===');
for (const l of lerComCabecalho(DISCIPLINA)) {
  const { nome, equipa } = separar(l.__jogador);
  const vermelhos = Number(l['2A']) + Number(l.VE);
  console.log(`  ${nome.padEnd(20)} ${equipa.padEnd(13)} ${l.A}A  ${l['2A']}x2A  ${l.VE}VE  -> ${vermelhos} expulsoes`);
}

console.log('\n=== JOGOS (data herdada da linha anterior) ===');
const $ = cheerio.load(JOGOS);
let dataCorrente = null;
$('tr').each((_, tr) => {
  const cel = $(tr).find('td').map((_, c) => limpar($(c).text())).get().filter(Boolean);
  if (cel.length < 3) return;
  const data = cel.find((c) => /^\d{1,2}[/.-]\d{1,2}$/.test(c));
  if (data) dataCorrente = data;
  const hora = cel.find((c) => /^\d{1,2}[:h]\d{2}$/.test(c));
  if (!hora) return;
  const i = cel.indexOf(hora);
  const casa = cel.slice(0, i).filter((c) => !/^\d/.test(c) && c.length > 2).pop();
  const fora = cel.slice(i + 1).find((c) => !/^\d/.test(c) && c.length > 2 && !/apostar|h2h/i.test(c));
  console.log(`  ${dataCorrente} ${hora}  ${(casa ?? '?').padEnd(14)} - ${fora ?? '?'}`);
});
