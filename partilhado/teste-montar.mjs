import { montarPlantel, FORMACAO } from './montar-plantel.js';

// Universo sintetico parecido com o real: valores em multiplos de 250k,
// entre 500k e 5.5M, pontos correlacionados com o preco mas com ruido.
function universo(n = 420) {
  const posicoes = [['GR', 60], ['DEF', 140], ['MED', 140], ['AVA', 80]];
  const clubes = ['Benfica','FC Porto','Sporting','Sp. Braga','V. Guimarães','Arouca',
                  'Alverca','Casa Pia','E. Amadora','Estoril','Famalicão','Gil Vicente',
                  'Marítimo','Moreirense','Nacional','Rio Ave','Santa Clara','Académico Viseu'];
  const lista = [];
  let id = 1000;
  let semente = 42;
  const rnd = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;

  for (const [pos, quantos] of posicoes) {
    for (let i = 0; i < quantos; i++) {
      const custo = 0.5 + Math.floor(rnd() * 21) * 0.25;
      const pontos = Math.round(custo * 8 + (rnd() - 0.5) * 20);
      lista.push({
        id: String(id++), nome: `${pos}${i}`, equipa: clubes[i % clubes.length],
        posicao: pos, custo: Number(custo.toFixed(2)), pontos,
      });
    }
  }
  return lista;
}

const todos = universo();

function verificar(nome, r, { fixos = [] } = {}) {
  const problemas = [];
  if (r.erro) { console.log(`${nome}: ERRO -> ${r.erro}`); return; }

  const contagem = {};
  for (const j of r.plantel) contagem[j.posicao] = (contagem[j.posicao] ?? 0) + 1;
  for (const [p, n] of Object.entries(FORMACAO)) {
    if (contagem[p] !== n) problemas.push(`${p}=${contagem[p] ?? 0} (devia ser ${n})`);
  }
  if (r.plantel.length !== 23) problemas.push(`tamanho ${r.plantel.length}`);
  if (r.custoTotal > 40.0001) problemas.push(`custo ${r.custoTotal}M > 40M`);

  const ids = new Set(r.plantel.map(j => j.id));
  if (ids.size !== r.plantel.length) problemas.push('jogadores repetidos');
  for (const f of fixos) if (!ids.has(String(f))) problemas.push(`fixo ${f} em falta`);

  const soma = r.plantel.reduce((s,j)=>s+j.pontos,0);
  console.log(
    `${problemas.length ? 'FALHA' : 'OK   '} ${nome.padEnd(30)} ` +
    `custo ${String(r.custoTotal).padStart(6)}M  sobra ${String(r.sobra).padStart(5)}M  pontos ${soma}` +
    (problemas.length ? `\n      -> ${problemas.join('; ')}` : '')
  );
  return soma;
}

console.log('--- construtor de plantel ---');
const t0 = Date.now();
const livre = montarPlantel({ todosJogadores: todos });
const base = verificar('sem fixos', livre);
console.log(`      (${Date.now()-t0} ms)`);

// Fixar 3 jogadores caros e ver se o resto se ajusta
const caros = todos.filter(j=>j.custo>=4).slice(0,3).map(j=>j.id);
const comFixos = montarPlantel({ todosJogadores: todos, fixos: caros });
const compontos = verificar('3 fixos caros', comFixos, { fixos: caros });
console.log(`      fixos: ${comFixos.fixos?.map(j=>`${j.nome} ${j.custo}M`).join(', ')}`);
if (compontos > base) console.log('      AVISO: com restricao devia render <= ao livre');

// Fixar demasiados da mesma posicao
console.log(verificar('4 GR fixos (deve falhar)',
  montarPlantel({ todosJogadores: todos, fixos: todos.filter(j=>j.posicao==='GR').slice(0,4).map(j=>j.id) })) ?? '');

// Orcamento impossivel
verificar('orcamento 5M (deve falhar)', montarPlantel({ todosJogadores: todos, orcamento: 5 }));

// Limite por clube
const limitado = montarPlantel({ todosJogadores: todos, maxPorClube: 3 });
if (!limitado.erro) {
  const porClube = {};
  for (const j of limitado.plantel) porClube[j.equipa] = (porClube[j.equipa]??0)+1;
  const excedidos = Object.entries(porClube).filter(([,n])=>n>3);
  verificar('max 3 por clube', limitado);
  console.log(`      clubes excedidos: ${excedidos.length ? JSON.stringify(excedidos) : 'nenhum'}`);
}

// Comparar com a estrategia gananciosa, para provar que a DP vale a pena
const ganancioso = [];
const faltam = {...FORMACAO};
for (const j of [...todos].sort((a,b)=>b.pontos-a.pontos)) {
  if (faltam[j.posicao] > 0) {
    const custo = ganancioso.reduce((s,x)=>s+x.custo,0);
    if (custo + j.custo <= 40) { ganancioso.push(j); faltam[j.posicao]--; }
  }
}
const completo = Object.values(faltam).every(n=>n===0);
console.log(`\nGanancioso: ${ganancioso.length}/23 jogadores` +
  (completo ? `, ${ganancioso.reduce((s,j)=>s+j.pontos,0)} pontos` : ' — nem consegue completar o plantel'));
console.log(`DP:         23/23 jogadores, ${base} pontos`);
