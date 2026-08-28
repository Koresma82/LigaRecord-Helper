import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import { marcadoresDaLiga, disciplinaDaLiga, jogosDaJornada } from './fontes/zerozero.js';

// npm run inspect-zerozero [jornada]

await mkdir('debug', { recursive: true });
const jornada = Number(process.argv[2]) || Number(process.env.LR_JORNADA) || 4;

console.log('=== GOLOS ===');
const golos = await marcadoresDaLiga({ log: (m) => console.log(m) });
for (const g of golos.slice(0, 8)) {
  console.log(`  ${g.nome.padEnd(24)} ${g.equipa.padEnd(16)} ${g.golos} golos`);
}
if (golos.length > 8) console.log(`  ... e mais ${golos.length - 8}`);

console.log('\n=== DISCIPLINA ===');
const cartoes = await disciplinaDaLiga({ log: (m) => console.log(m) });
for (const c of cartoes.slice(0, 8)) {
  console.log(
    `  ${c.nome.padEnd(24)} ${c.equipa.padEnd(16)} ${c.amarelos}A  ${c.vermelhos} expulsoes`
  );
}
const noLimite = cartoes.filter((c) => c.amarelos % 5 === 4).length;
console.log(`  a um amarelo do castigo: ${noLimite}`);

console.log(`\n=== JOGOS DA JORNADA ${jornada} ===`);
const jogos = await jogosDaJornada(jornada, { log: (m) => console.log(m) });
for (const j of jogos) {
  console.log(`  ${(j.data ?? '?').padEnd(6)} ${(j.hora ?? '?').padEnd(6)} ${j.casa.padEnd(16)} - ${j.fora}`);
}

await writeFile(
  'debug/zerozero.json',
  JSON.stringify({ golos, cartoes, jogos }, null, 2),
  'utf8'
);
console.log('\nGravado em debug/zerozero.json. Cola-me este resumo.');
