import { montarPlantel } from './montar-plantel.js';

// Instancia pequena onde da para calcular a resposta certa por forca bruta,
// e comparar com a DP. Se a DP nao bater certo aqui, nao serve para nada.
const formacao = { GR: 1, DEF: 2, MED: 2, AVA: 1 };
const orcamento = 8;

let semente = 7;
const rnd = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;

const todos = [];
let id = 1;
for (const [pos, quantos] of [['GR', 5], ['DEF', 7], ['MED', 7], ['AVA', 5]]) {
  for (let i = 0; i < quantos; i++) {
    todos.push({
      id: String(id++), nome: `${pos}${i}`, equipa: 'X', posicao: pos,
      custo: Number((0.5 + Math.floor(rnd() * 8) * 0.25).toFixed(2)),
      pontos: Math.round(rnd() * 40),
    });
  }
}

// Forca bruta: todas as combinacoes validas.
function combinacoes(lista, k) {
  if (k === 0) return [[]];
  const saida = [];
  for (let i = 0; i <= lista.length - k; i++) {
    for (const resto of combinacoes(lista.slice(i + 1), k - 1)) {
      saida.push([lista[i], ...resto]);
    }
  }
  return saida;
}

let melhorForcaBruta = { pontos: -1 };
const grupos = Object.entries(formacao).map(([p, k]) =>
  combinacoes(todos.filter((j) => j.posicao === p), k)
);

const percorrer = (i, escolhidos, custo, pontos) => {
  if (custo > orcamento) return;
  if (i === grupos.length) {
    if (pontos > melhorForcaBruta.pontos) melhorForcaBruta = { pontos, custo, escolhidos: [...escolhidos] };
    return;
  }
  for (const grupo of grupos[i]) {
    const c = grupo.reduce((s, j) => s + j.custo, 0);
    const p = grupo.reduce((s, j) => s + j.pontos, 0);
    percorrer(i + 1, [...escolhidos, ...grupo], custo + c, pontos + p);
  }
};
percorrer(0, [], 0, 0);

const dp = montarPlantel({ todosJogadores: todos, formacao, orcamento });
const pontosDP = dp.erro ? -1 : dp.plantel.reduce((s, j) => s + j.pontos, 0);

console.log(`força bruta: ${melhorForcaBruta.pontos} pontos, ${melhorForcaBruta.custo.toFixed(2)}M`);
console.log(`DP:          ${pontosDP} pontos, ${dp.custoTotal}M`);
console.log(pontosDP === melhorForcaBruta.pontos ? 'IGUAL — a DP e optima' : 'DIFERENTE — ha erro na DP');

// Com um fixo obrigatorio
const fixo = todos.find((j) => j.posicao === 'AVA');
const comFixo = montarPlantel({ todosJogadores: todos, formacao, orcamento, fixos: [fixo.id] });
const temFixo = !comFixo.erro && comFixo.plantel.some((j) => j.id === fixo.id);
const pontosFixo = comFixo.erro ? -1 : comFixo.plantel.reduce((s, j) => s + j.pontos, 0);
console.log(`\ncom ${fixo.nome} (${fixo.custo}M, ${fixo.pontos}pts) fixo: ${pontosFixo} pontos`);
console.log(temFixo ? 'fixo respeitado' : 'FALHA: fixo ignorado');
console.log(pontosFixo <= melhorForcaBruta.pontos ? 'nunca supera o optimo livre, como esperado' : 'FALHA: supera o optimo');
