import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import { getHTML } from './lib-http.js';
import { lerClassificacaoLP, lerJogosLP } from './fontes/ligaportugal.js';

// npm run inspect-lp-tabela [jornada]
//
// Mostra os NOMES DOS CAMPOS da classificação e dos jogos, sem despejar a
// resposta inteira (são centenas de kB de vídeos e prémios dos clubes).
//
// Com estes nomes posso trocar a extracção por padrão de nome — que é o que
// está lá agora — por leitura directa, mais rápida e menos frágil.

const COMPETICAO = process.env.LP_COMPETICAO ?? 'ligaportugalbetclic';
const EPOCA = process.env.LP_EPOCA ?? '20262027';
const jornada = Number(process.argv[2]) || Number(process.env.LR_JORNADA) || 5;

await mkdir('debug', { recursive: true });

// Ramos que só têm ruído: não vale a pena listar os campos deles.
const RUIDO = new Set([
  'awards', 'highlightVideos', 'socials', 'kits', 'teamBoard', 'tags',
  'photosFormats', 'fullBodyImageFormats', 'imageFormats',
]);

function camposDe(objecto, prefixo = '', profundidade = 0) {
  const saida = [];
  if (!objecto || typeof objecto !== 'object' || profundidade > 2) return saida;

  for (const [chave, valor] of Object.entries(objecto)) {
    if (RUIDO.has(chave)) {
      saida.push(`${prefixo}${chave}: (ignorado)`);
      continue;
    }

    const caminho = `${prefixo}${chave}`;

    if (valor === null) saida.push(`${caminho}: null`);
    else if (typeof valor === 'number') saida.push(`${caminho}: ${valor}`);
    else if (typeof valor === 'boolean') saida.push(`${caminho}: ${valor}`);
    else if (typeof valor === 'string') {
      saida.push(`${caminho}: "${valor.slice(0, 40)}${valor.length > 40 ? '…' : ''}"`);
    } else if (Array.isArray(valor)) {
      saida.push(`${caminho}: [${valor.length}]`);
    } else {
      saida.push(...camposDe(valor, `${caminho}.`, profundidade + 1));
    }
  }
  return saida;
}

// ------------------------------------------------------------ classificação

console.log(`=== CLASSIFICAÇÃO (jornada ${jornada}) ===\n`);

const urlTabela =
  `https://www.ligaportugal.pt/api/v2/competition/standings` +
  `?competition=${COMPETICAO}&season=${EPOCA}&round=${jornada}`;

try {
  const texto = await getHTML(urlTabela);
  await writeFile('debug/lp-standings.json', texto, 'utf8');
  console.log(`resposta: ${texto.length} caracteres -> debug/lp-standings.json`);

  const dados = JSON.parse(texto);
  const equipas = dados?.teams ?? dados?.standings ?? dados;
  console.log(`chaves de topo: ${Object.keys(dados).join(', ')}`);
  console.log(`equipas: ${Array.isArray(equipas) ? equipas.length : '?'}\n`);

  // `teams` é só o catálogo dos clubes. Os pontos vivem noutro ramo — é
  // esse que interessa ver.
  for (const ramo of ['standingsTable', 'groupStandingsTable']) {
    const valor = dados?.[ramo];
    if (!valor) {
      console.log(`${ramo}: (vazio)`);
      continue;
    }

    const lista = Array.isArray(valor)
      ? valor
      : valor.rows ?? valor.standings ?? valor.table ?? null;

    console.log(`\n${ramo}: ${Array.isArray(valor) ? `array de ${valor.length}` : `objecto {${Object.keys(valor).join(', ')}}`}`);

    if (Array.isArray(lista) && lista[0]) {
      console.log(`  primeira linha (${lista.length} no total):`);
      for (const linha of camposDe(lista[0])) console.log(`    ${linha}`);
    }
  }

  const tabela = lerClassificacaoLP(texto);
  console.log(`\nparser actual: ${tabela ? `${tabela.length} equipas` : 'NÃO reconheceu'}`);
  if (tabela) {
    for (const e of tabela.slice(0, 3)) {
      console.log(`  ${e.posicao}. ${e.equipa} ${e.pontos}pts ${e.jogos}j ${e.vitorias}v ${e.empates}e ${e.derrotas}d`);
    }
  }
} catch (erro) {
  console.log(`ERRO: ${erro.message.split('\n')[0]}`);
}

// -------------------------------------------------------------------- jogos

console.log(`\n\n=== JOGOS (jornada ${jornada + 1}) ===\n`);

const urlJogos =
  `https://www.ligaportugal.pt/api/v1/competition/matches` +
  `?competition=${COMPETICAO}&season=${EPOCA}&round=${jornada + 1}`;

try {
  const texto = await getHTML(urlJogos);
  await writeFile('debug/lp-matches.json', texto, 'utf8');
  console.log(`resposta: ${texto.length} caracteres -> debug/lp-matches.json`);

  const dados = JSON.parse(texto);
  const lista = dados?.matches ?? dados?.fixtures ?? dados;
  console.log(`chaves de topo: ${Array.isArray(dados) ? '(array)' : Object.keys(dados).join(', ')}`);
  console.log(`jogos: ${Array.isArray(lista) ? lista.length : '?'}\n`);

  if (Array.isArray(lista) && lista[0]) {
    console.log('campos do primeiro jogo:');
    for (const linha of camposDe(lista[0])) console.log(`  ${linha}`);
  }

  const jogos = lerJogosLP(texto, jornada + 1);
  console.log(`\nparser actual: ${jogos ? `${jogos.length} jogos` : 'NÃO reconheceu'}`);
  if (jogos) {
    for (const j of jogos.slice(0, 4)) {
      console.log(`  ${j.data ?? '?'} ${j.hora ?? '?'}  ${j.casa} - ${j.fora}`);
    }
  }
} catch (erro) {
  console.log(`ERRO: ${erro.message.split('\n')[0]}`);
}

console.log('\n---');
console.log('Cola-me este output. São nomes de campos e dados públicos.');
