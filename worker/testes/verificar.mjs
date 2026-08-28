// O `node --check` so valida sintaxe. Nao apanha um import de algo que
// deixou de ser exportado — foi assim que a `descobrirUrlLogin` desapareceu
// e so se viu ao correr. Isto importa mesmo todos os modulos e confirma
// que cada um exporta o que os outros lhe pedem.

const ESPERADO = {
  '../src/lib-http.js': ['Frasco', 'pedido', 'seguirAte', 'getHTML', 'pausa', 'campo', 'ErroSessao'],
  '../src/normalizar.js': ['normalizar', 'semelhanca', 'equipaCanonica', 'fichas'],
  '../src/emparelhar.js': ['emparelhar'],
  '../src/sugerir.js': ['sugerirSubstituicoes'],
  '../src/firestore.js': ['bd', 'guardarBoletim', 'lerBoletim', 'lerPerfil', 'guardarPerfil', 'AMBIENTE'],
  '../src/fontes/analisar.js': ['lerJogadores', 'lerCartao', 'paraMilhoes', 'paraPercentagem', 'detectarPosicao'],
  '../src/fontes/pesquisa.js': ['todosOsJogadores', 'todosPorClube', 'POSICOES'],
  '../src/fontes/ligarecord.js': ['obterTodosJogadores', 'obterJornada'],
  '../src/fontes/plantel-manual.js': ['lerPlantelGuardado', 'guardarPlantel', 'montarEquipa'],
  '../src/fontes/jornada.js': ['jornadaActual', 'jornadaPelaClassificacao'],
  '../src/fontes/zerozero.js': ['marcadoresDaLiga', 'disciplinaDaLiga', 'jogosDaJornada', 'jogosDeVariasJornadas', 'jornadaNoZerozero', 'classificacaoDaLiga', 'lerClassificacaoZZ'],
  '../src/fontes/transfermarkt.js': ['lesoesDaLiga', 'lerTabelaLesoes'],
  '../src/fontes/disciplina.js': ['castigosPorAcumulacao'],
  '../src/config/endpoints.js': ['BASE', 'URLS', 'REGRAS'],
  '../src/config/equipas.js': ['EQUIPAS', 'EQUIPAS_ZEROZERO'],
  '../src/bot/mensagens.js': ['resumoJornada', 'alertaNovidade', 'erroRecolha', 'resumoPlantel'],
  '../src/recolher.js': ['recolher', 'recolherLeve', 'recolherEDetectarNovidades'],
  '../../partilhado/montar-plantel.js': ['montarPlantel', 'FORMACAO', 'ORCAMENTO'],
};

import { existsSync } from 'node:fs';

if (!existsSync(new URL('../node_modules', import.meta.url))) {
  console.error('Falta o node_modules. Corre `npm install` primeiro.');
  process.exit(1);
}

let falhas = 0;

for (const [caminho, nomes] of Object.entries(ESPERADO)) {
  try {
    const modulo = await import(caminho);
    const emFalta = nomes.filter((n) => modulo[n] === undefined);
    if (emFalta.length) {
      falhas += 1;
      console.log(`FALTA  ${caminho}  ->  ${emFalta.join(', ')}`);
    } else {
      console.log(`ok     ${caminho}  (${nomes.length} exports)`);
    }
  } catch (erro) {
    falhas += 1;
    console.log(`ERRO   ${caminho}\n       ${erro.message.split('\n')[0]}`);
  }
}

// Armadilhas que so aparecem no Windows e que passam despercebidas porque
// o programa nao rebenta — simplesmente nao faz nada.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ARMADILHAS = [
  {
    padrao: /import\.meta\.url\s*===\s*`file:\/\/\$\{process\.argv\[1\]\}`/,
    aviso: 'comparacao de entrypoint que falha no Windows — usa pathToFileURL()',
  },
  {
    padrao: /require\s*\(/,
    aviso: 'require() num modulo ESM',
  },
  {
    // O plantel ficou a ler "uid" enquanto a app escrevia "uid_dev".
    // Qualquer coleccao por utilizador tem de passar por chave().
    padrao: /\.doc\(\s*process\.env\.UID_DONO/,
    aviso: 'documento por UID_DONO cru — usa chave() para apanhar o sufixo do ambiente',
  },
];

async function ficheirosJS(pasta) {
  const entradas = await readdir(pasta, { withFileTypes: true });
  const saida = [];
  for (const e of entradas) {
    const caminho = join(pasta, e.name);
    if (e.isDirectory()) saida.push(...(await ficheirosJS(caminho)));
    else if (e.name.endsWith('.js')) saida.push(caminho);
  }
  return saida;
}

// new URL(...).pathname da "/C:/Projectos/..." no Windows, e o join
// resultante fica "C:\\C:\\Projectos\\...". fileURLToPath e que converte
// em condicoes. Ironia: o teste que escrevi para apanhar bugs de Windows
// tinha um bug de Windows.
const src = fileURLToPath(new URL('../src', import.meta.url));
for (const ficheiro of await ficheirosJS(src)) {
  const conteudo = await readFile(ficheiro, 'utf8');
  for (const { padrao, aviso } of ARMADILHAS) {
    if (padrao.test(conteudo)) {
      falhas += 1;
      console.log(`AVISO  src${ficheiro.slice(src.length)}: ${aviso}`);
    }
  }
}

console.log(falhas ? `\n${falhas} problema(s).` : '\nTodos os modulos carregam, sem armadilhas conhecidas.');
process.exit(falhas ? 1 : 0);
