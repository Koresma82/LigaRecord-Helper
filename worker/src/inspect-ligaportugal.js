import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import {
  golosDaLiga,
  assistenciasDaLiga,
  amarelosDaLiga,
  vermelhosDaLiga,
  ESTATISTICAS,
} from './fontes/ligaportugal.js';

// npm run inspect-lp
//
// Confirma que a API oficial responde e quantos jogadores devolve por
// estatistica. O `size` importa: a pagina web pede 20, nos pedimos mais,
// e e aqui que se ve se o servidor respeita o pedido.

await mkdir('debug', { recursive: true });

const grupos = [
  ['Golos', golosDaLiga, ESTATISTICAS.golos],
  ['Assistências', assistenciasDaLiga, ESTATISTICAS.assistencias],
  ['Amarelos', amarelosDaLiga, ESTATISTICAS.amarelos],
  ['Vermelhos', vermelhosDaLiga, ESTATISTICAS.vermelhos],
];

const tudo = {};

for (const [nome, buscar, statId] of grupos) {
  try {
    const lista = await buscar({ log: () => {} });
    tudo[nome] = lista;

    const comValor = lista.filter((l) => l.total > 0).length;
    const maximo = lista.length ? Math.max(...lista.map((l) => l.total)) : 0;

    console.log(`${nome.padEnd(14)} statId ${String(statId).padEnd(6)} ${String(lista.length).padStart(4)} jogadores, ${comValor} com valor > 0, máximo ${maximo}`);

    for (const l of lista.slice(0, 3)) {
      console.log(`   ${l.nome.padEnd(20)} ${l.equipa.padEnd(16)} ${l.total}`);
    }
  } catch (erro) {
    console.log(`${nome.padEnd(14)} ERRO: ${erro.message.split('\n')[0]}`);
  }
  console.log();
  await new Promise((r) => setTimeout(r, 600));
}

// O que interessa mesmo: quem esta a um amarelo do castigo.
const amarelos = tudo['Amarelos'] ?? [];
const aUm = amarelos.filter((l) => l.total > 0 && l.total % 5 === 4);
const noLimite = amarelos.filter((l) => l.total > 0 && l.total % 5 === 0);

console.log(`a um amarelo do castigo: ${aUm.length}`);
for (const l of aUm.slice(0, 10)) console.log(`   ${l.nome} (${l.equipa}) ${l.total}`);
console.log(`em múltiplo de 5:        ${noLimite.length}`);

await writeFile('debug/ligaportugal.json', JSON.stringify(tudo, null, 2), 'utf8');
console.log('\nGravado em debug/ligaportugal.json. Cola-me este resumo.');
