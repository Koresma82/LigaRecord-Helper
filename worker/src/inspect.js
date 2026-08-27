import { writeFile, mkdir } from 'node:fs/promises';
import { getHTML } from './lib-http.js';
import { EQUIPAS_ZEROZERO } from './config/equipas.js';

// Grava o HTML em bruto de uma equipa para se afinarem os selectores
// quando o Zerozero mudar de layout.
const alvo = process.argv[2] ?? EQUIPAS_ZEROZERO[0].nome;
const equipa = EQUIPAS_ZEROZERO.find(
  (e) => e.nome.toLowerCase() === alvo.toLowerCase()
);

if (!equipa) {
  console.error(`Equipa desconhecida: ${alvo}`);
  console.error('Disponiveis: ' + EQUIPAS_ZEROZERO.map((e) => e.nome).join(', '));
  process.exit(1);
}

const html = await getHTML(equipa.urlPlantel);
await mkdir('debug', { recursive: true });
const ficheiro = `debug/${equipa.nome.replace(/\s+/g, '-').toLowerCase()}.html`;
await writeFile(ficheiro, html, 'utf8');
console.log(`${html.length} caracteres gravados em ${ficheiro}`);
console.log('Abre no browser, encontra a tabela do plantel, e ajusta');
console.log('SELECTORES em src/fontes/zerozero.js.');
