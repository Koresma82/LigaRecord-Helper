import { readFile } from 'node:fs/promises';

// Le o debug/login-resposta.txt e imprime um resumo SEM SEGREDOS.
// Valores longos aparecem mascarados: comprimento, formato e os primeiros
// caracteres. Chega para eu perceber a estrutura sem ver credenciais.
//
//   npm run analisar-resposta

const ficheiro = process.argv[2] ?? 'debug/login-resposta.txt';
const bruto = await readFile(ficheiro, 'utf8').catch(() => null);

if (!bruto) {
  console.error(`Nao consegui ler ${ficheiro}. Corre \`npm run descobrir\` primeiro.`);
  process.exit(1);
}

const [cabecalho, ...resto] = bruto.split('\n---\n');
const corpo = resto.join('\n---\n');

console.log('=== CABECALHOS ===');
for (const linha of cabecalho.split('\n')) {
  if (/^(URL|Estado|content-type|location|set-cookie):/i.test(linha)) {
    // Mascarar valores de cookies e tokens no proprio cabecalho.
    console.log(linha.replace(/=([A-Za-z0-9%._-]{16,})/g, (_, v) => `=<${v.length} chars>`));
  }
}

console.log(`\n=== CORPO (${corpo.length} caracteres) ===`);

const mascarar = (valor) => {
  const s = String(valor);
  if (s.length <= 8) return s;
  const formato = /^[a-f0-9]+$/i.test(s)
    ? 'hex'
    : /^[A-Za-z0-9+/=]+$/.test(s)
      ? 'base64?'
      : 'texto';
  return `<${s.length} chars, ${formato}, comeca ${s.slice(0, 4)}...>`;
};

const aparado = corpo.trim();

if (aparado.startsWith('{') || aparado.startsWith('[')) {
  try {
    const dados = JSON.parse(aparado);
    console.log('E JSON. Estrutura:\n');

    const mostrar = (o, indent = '  ') => {
      for (const [chave, valor] of Object.entries(o ?? {})) {
        if (valor && typeof valor === 'object') {
          console.log(`${indent}${chave}:`);
          mostrar(valor, indent + '  ');
        } else if (typeof valor === 'string' && /^https?:\/\//.test(valor)) {
          // URLs interessam inteiros na estrutura, mas com os valores mascarados.
          const u = new URL(valor);
          const params = [...u.searchParams].map(([k, v]) => `${k}=${mascarar(v)}`);
          console.log(`${indent}${chave}: ${u.origin}${u.pathname}${params.length ? '?' + params.join('&') : ''}`);
        } else {
          console.log(`${indent}${chave}: ${mascarar(valor)}`);
        }
      }
    };
    mostrar(dados);
  } catch (e) {
    console.log('Comeca como JSON mas nao faz parse:', e.message);
  }
} else {
  console.log(`Nao e JSON. Comeca por: ${aparado.slice(0, 60).replace(/\s+/g, ' ')}`);
}

console.log('\n=== PISTAS ===');

const pistas = [
  ['user_login', /user_login[^\s"'<>]*/gi],
  ['token=', /token=[^\s"'&<>]{8,}/gi],
  ['ticket', /ticket[=:"']\s*[^\s"'&<>]{8,}/gi],
  ['redirect', /redirect[^\s"'<>]{0,40}/gi],
  ['location.href', /location\.href\s*=\s*["'][^"']+["']/gi],
];

let achouAlgo = false;

for (const [nome, padrao] of pistas) {
  const encontrados = [...corpo.matchAll(padrao)].slice(0, 3);
  if (!encontrados.length) continue;
  achouAlgo = true;
  console.log(`\n${nome}: ${encontrados.length} ocorrencia(s)`);
  for (const m of encontrados) {
    console.log(`  ${m[0].replace(/([=:])([A-Za-z0-9%._-]{12,})/g, (_, sep, v) => `${sep}<${v.length} chars>`)}`);
  }
}

// Hexadecimais longos soltos — o formato do token que vimos na captura.
const hex = [...new Set([...corpo.matchAll(/\b[a-f0-9]{32,80}\b/gi)].map((m) => m[0]))];
if (hex.length) {
  achouAlgo = true;
  console.log(`\nhexadecimais longos: ${hex.length}`);
  for (const h of hex.slice(0, 5)) console.log(`  ${h.length} chars, comeca ${h.slice(0, 6)}...`);
}

if (!achouAlgo) {
  console.log('Nada. A resposta nao traz token nem destino — o passo seguinte');
  console.log('deve ser outro pedido que o JavaScript faz. Nesse caso preciso');
  console.log('de ver a lista de Rede depois de carregares em ENTRAR.');
}

console.log('\n---');
console.log('Podes colar este output — os valores estao mascarados.');
