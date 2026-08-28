import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { pedido } from './lib-http.js';
import { BASE } from './config/endpoints.js';

// Procura, nos scripts do proprio liga.record.pt, a parte que transforma o
// token do SSO numa sessao local. Sabemos que o user_login.ashx existe (foi
// visto na primeira captura); falta saber quem o chama e com que parametros.
//
//   npm run analisar-site-js

await mkdir('debug', { recursive: true });

// Descobrir os scripts a partir da propria pagina, sem sessao (a lista de
// <script> e igual dentro e fora).
const pagina = await pedido(`${BASE}/`, { seguir: 4 });
const $ = cheerio.load(pagina.texto);

const scripts = $('script[src]')
  .map((_, el) => $(el).attr('src'))
  .get()
  .map((src) => {
    try {
      return new URL(src, `${BASE}/`).toString();
    } catch {
      return null;
    }
  })
  .filter((u) => u && u.startsWith(BASE))
  .filter((u) => !/(jquery|bootstrap|modernizr|respond|slick|icheck|magnific|tooltipster|countdown|interact)/i.test(u));

console.log(`${scripts.length} scripts proprios a analisar\n`);

const PISTAS = [
  ['user_login', /[^\s"'<>]{0,60}user_login[^\s"'<>]{0,80}/gi],
  ['INIT_SESSION', /[^\s"'<>]{0,40}INIT_SESSION[^\s"'<>]{0,60}/gi],
  ['REDIRECT_TO_SITE', /[^\s"'<>]{0,40}REDIRECT_TO_SITE[^\s"'<>]{0,60}/gi],
  ['LoginHandler', /[^\s"'<>]{0,40}LoginHandler[^\s"'<>]{0,60}/gi],
  ['aminhaconta', /[^\s"'<>]{0,40}aminhaconta[^\s"'<>]{0,60}/gi],
  ['cof_site_user', /[^\s"'<>]{0,40}cof_site_user[^\s"'<>]{0,60}/gi],
];

let encontrouAlgo = false;

for (const url of scripts.slice(0, 20)) {
  let r;
  try {
    r = await pedido(url, { seguir: 2 });
  } catch {
    continue;
  }
  if (r.status !== 200) continue;

  const achados = [];
  for (const [nome, padrao] of PISTAS) {
    const ms = [...new Set([...r.texto.matchAll(padrao)].map((m) => m[0]))];
    if (ms.length) achados.push([nome, ms]);
  }

  if (!achados.length) continue;

  encontrouAlgo = true;
  const ficheiro = `debug/${url.split('/').pop().split('?')[0]}`;
  await writeFile(ficheiro, r.texto, 'utf8');

  console.log(`=== ${url.replace(BASE, '')} (${r.texto.length} chars) -> ${ficheiro}`);
  for (const [nome, ms] of achados) {
    console.log(`  ${nome}: ${ms.length}`);
    for (const m of ms.slice(0, 5)) {
      const seguro = m.replace(/=([A-Za-z0-9%._-]{16,})/g, (_, v) => `=<${v.length} chars>`);
      console.log(`    ${seguro.slice(0, 120)}`);
    }
  }
  console.log();

  await new Promise((res) => setTimeout(res, 300));
}

if (!encontrouAlgo) {
  console.log('Nenhum script proprio menciona o user_login nem o SSO.');
  console.log('A troca e feita do lado do servidor, por redireccionamento.\n');
}

// -----------------------------------------------------------------------------
// Os campos escondidos do formulario.
//
// Nos enviamos appID vazio e returnUrl="https://liga.record.pt/#". Se o SSO
// usar o appID para saber a que site entregar a sessao, um appID vazio
// explica tudo: o login passa, mas nao ha site a quem entregar nada.
// -----------------------------------------------------------------------------

console.log('=== appID e returnUrl na pagina ===\n');

for (const [nome, url] of [
  ['homepage', `${BASE}/`],
  ['plantel', `${BASE}/gerir-equipas/plantel.aspx?id_team=${process.env.LR_ID_TEAM ?? ''}`],
]) {
  const r = await pedido(url, { seguir: 4 }).catch(() => null);
  if (!r || r.status !== 200) {
    console.log(`${nome}: ${r?.status ?? 'erro'}`);
    continue;
  }

  console.log(`${nome} (${r.texto.length} chars):`);

  const padroes = [
    ['appID em input', /<input[^>]*name=["']appID["'][^>]*>/gi],
    ['appID em JS', /appID\s*[:=]\s*["']?([^"',;\s)]{1,40})/gi],
    ['returnUrl em input', /<input[^>]*name=["']returnUrl["'][^>]*>/gi],
    ['hdnIsLayer', /<input[^>]*name=["']hdnIsLayer["'][^>]*>/gi],
    ['siteId / idSite', /(?:siteId|idSite|SiteID)\s*[:=]\s*["']?([^"',;\s)]{1,40})/gi],
  ];

  for (const [rotulo, padrao] of padroes) {
    const ms = [...new Set([...r.texto.matchAll(padrao)].map((m) => m[0]))];
    if (!ms.length) continue;
    console.log(`  ${rotulo}: ${ms.length}`);
    for (const m of ms.slice(0, 4)) {
      console.log(`    ${m.replace(/\s+/g, ' ').slice(0, 130)}`);
    }
  }
  console.log();
  await new Promise((res) => setTimeout(res, 400));
}

console.log('---');
console.log('JavaScript publico, sem segredos. Podes colar o output.');
