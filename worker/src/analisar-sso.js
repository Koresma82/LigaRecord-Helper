import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import { pedido } from './lib-http.js';

// Le os scripts do SSO e mostra como e que a sessao e distribuida pelos
// sites do grupo. Sao ficheiros publicos de JavaScript — sem credenciais.
//
//   npm run analisar-sso

const ORIGEM = process.env.LR_HOST_SSO ?? 'https://aminhaconta.xl.pt';
const SCRIPTS = ['/js/SSOSiteVariables.js', '/js/SSOSite.js'];

await mkdir('debug', { recursive: true });

for (const caminho of SCRIPTS) {
  const url = `${ORIGEM}${caminho}`;
  let r;
  try {
    r = await pedido(url, { seguir: 3 });
  } catch (erro) {
    console.log(`${caminho}: ERRO ${erro.message.split('\n')[0]}\n`);
    continue;
  }

  const ficheiro = `debug/${caminho.split('/').pop()}`;
  await writeFile(ficheiro, r.texto, 'utf8');
  console.log(`=== ${caminho} — ${r.status}, ${r.texto.length} chars -> ${ficheiro}`);

  if (r.status !== 200) {
    console.log();
    continue;
  }

  // Ficheiros pequenos: mostrar inteiros. Sao publicos e o conteudo e o
  // que interessa — o SSOSiteVariables tem 427 caracteres e provavelmente
  // define o appID de cada site.
  if (r.texto.length < 3000) {
    console.log('\nconteudo integral:');
    console.log(r.texto.replace(/^/gm, '  '));
  }

  // Variaveis de configuracao: normalmente é aqui que estão os dominios.
  const vars = [...r.texto.matchAll(/(?:var|let|const)\s+(\w+)\s*=\s*(["'][^"']{4,120}["']|\[[^\]]{0,300}\])/g)];
  if (vars.length) {
    console.log(`\nvariaveis (${vars.length}):`);
    for (const v of vars.slice(0, 25)) {
      console.log(`  ${v[1]} = ${v[2].replace(/\s+/g, ' ').slice(0, 90)}`);
    }
  }

  // Qualquer coisa que pareça um endpoint.
  const endpoints = new Set();
  for (const m of r.texto.matchAll(/["']([^"']*(?:user_login|\.ashx|\/login|SetCookie|Session)[^"']*)["']/gi)) {
    if (m[1].length > 3 && m[1].length < 200) endpoints.add(m[1]);
  }
  if (endpoints.size) {
    console.log(`\nendpoints (${endpoints.size}):`);
    for (const e of [...endpoints].slice(0, 20)) console.log(`  ${e.slice(0, 110)}`);
  }

  // Dominios dos sites do grupo.
  const dominios = new Set();
  for (const m of r.texto.matchAll(/https?:\/\/([a-z0-9.-]+\.(?:pt|com))/gi)) dominios.add(m[1]);
  if (dominios.size) {
    console.log(`\ndominios (${dominios.size}): ${[...dominios].join(', ').slice(0, 300)}`);
  }

  // Como e que o token entra no URL.
  const templates = [...r.texto.matchAll(/["'][^"']*(?:token|si|ticket)\s*=\s*["']?\s*\+/gi)];
  if (templates.length) {
    console.log(`\nconstrucao de URL com token (${templates.length}):`);
    for (const t of templates.slice(0, 6)) console.log(`  ${t[0].replace(/\s+/g, ' ').slice(0, 100)}`);
  }

  console.log();
}

console.log('---');
console.log('Isto e JavaScript publico, sem segredos. Podes colar o output.');
