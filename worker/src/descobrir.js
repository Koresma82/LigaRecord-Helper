import 'dotenv/config';
import { writeFile, mkdir } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { obterSessao, descobrirUrlLogin } from './fontes/sessao.js';
import { pedido } from './lib-http.js';
import { URLS, BASE } from './config/endpoints.js';
import { POSICOES, descobrirCaminhoPesquisa } from './fontes/pesquisa.js';
import { lerJogadoresJSON, lerJogadores } from './fontes/analisar.js';

// npm run descobrir login  -> so encontra e analisa o formulario
// npm run descobrir        -> login completo + teste do playersearch

await mkdir('debug', { recursive: true });

// ---------------------------------------------------------------------------
// Passo 1: onde fica o formulario de login
// ---------------------------------------------------------------------------

console.log('A descobrir a pagina de login...');
let urlLogin;
try {
  urlLogin = await descobrirUrlLogin();
  console.log(`  ${urlLogin}\n`);
} catch (erro) {
  console.error(erro.message);
  process.exit(1);
}

const formulario = await pedido(urlLogin, {
  headers: { 'x-requested-with': 'XMLHttpRequest', referer: `${BASE}/` },
});
await writeFile('debug/login.html', formulario.texto, 'utf8');

const $f = cheerio.load(formulario.texto);
const $form = $f('form')
  .filter((_, f) => $f(f).find('input[type=password]').length > 0)
  .first();

console.log(`Formulario (${formulario.status}), ${formulario.texto.length} chars:`);

if (!$form.length) {
  console.log('  NAO ENCONTREI nenhum form com campo de password.');
} else {
  const accao = $form.attr('action');
  console.log(`  action:  ${accao ?? '(a propria pagina)'}`);
  console.log(`  metodo:  ${($form.attr('method') ?? 'post').toUpperCase()}`);
  if (accao) {
    console.log(`  destino: ${new URL(accao, formulario.url).toString()}`);
  }
  const recuperar = $f('a[href*="Recover" i]').attr('href');
  if (recuperar) console.log(`  SSO:     ${new URL(recuperar).origin}`);
}

let temEmail = false;
let temPassword = false;

($form.length ? $form.find('input') : $f('input')).each((_, el) => {
  const a = $f(el).attr();
  if (!a.name) return;
  const tipo = a.type ?? 'text';
  if (tipo === 'hidden') {
    console.log(`  ${tipo.padEnd(9)} ${a.name}  (${String(a.value ?? '').length} chars)`);
  } else {
    console.log(`  ${tipo.padEnd(9)} ${a.name}`);
  }
  if (tipo === 'email' || /mail/i.test(a.name)) temEmail = true;
  if (tipo === 'password' || /pass/i.test(a.name)) temPassword = true;
});

console.log(
  temEmail && temPassword
    ? '\n  Campos de email e password encontrados.'
    : '\n  AVISO: nao encontrei campos de email/password. O formulario pode ' +
        'ser construido por JavaScript — nesse caso ve debug/login.html.'
);

// O reCAPTCHA e o unico obstaculo que nao se resolve com codigo.
const marcasRecaptcha = [
  /g-recaptcha/i,
  /grecaptcha/i,
  /recaptcha\/api\.js/i,
  /data-sitekey/i,
];
const temRecaptcha = marcasRecaptcha.some((m) => m.test(formulario.texto));

if (temRecaptcha) {
  const chave = formulario.texto.match(/data-sitekey=["']([^"']+)["']/i)?.[1];
  console.log('\n  ATENCAO: o formulario tem reCAPTCHA' + (chave ? ` (sitekey ${chave.slice(0, 12)}...)` : ''));
  console.log('  Se for exigido no POST, o login automatico nao passa.');
  console.log('  Se for v3 invisivel e so pontuar, pode passar na mesma.');
} else {
  console.log('\n  Sem reCAPTCHA no formulario. Bom sinal.');
}

if (process.argv[2] === 'login') {
  console.log('\nHTML em debug/login.html');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Passo 2: autenticar
// ---------------------------------------------------------------------------

console.log('\nA autenticar...');
const frasco = await obterSessao();

const porDominio = {};
for (const [nome, c] of frasco.cookies) {
  (porDominio[c.dominio ?? '(sem dominio)'] ??= []).push(nome);
}
console.log(`  Sessao activa, ${frasco.tamanho} cookies:`);
for (const [dominio, nomes] of Object.entries(porDominio)) {
  console.log(`    ${dominio}: ${nomes.join(', ')}`);
}
console.log();

// ---------------------------------------------------------------------------
// Passo 3: o endpoint de pesquisa
// ---------------------------------------------------------------------------

console.log('A localizar o playersearch.ashx...');
let caminho;
try {
  caminho = await descobrirCaminhoPesquisa({ log: (m) => console.log(m) });
  console.log(`  ${BASE}${caminho}\n`);
} catch (erro) {
  console.error(erro.message);
  process.exit(1);
}

console.log('Pesquisa por posicao (club vazio):');
let total = 0;

for (const posicao of POSICOES) {
  const p = new URLSearchParams({
    playerposition: posicao,
    name: '',
    club: '',
    minval: '500000',
    maxval: '12000000',
    order_by: 'points',
    order_dir: 'desc',
  });
  const r = await pedido(`${BASE}${caminho}?${p}`, {
    frasco,
    headers: {
      'x-requested-with': 'XMLHttpRequest',
      referer: `${BASE}/gerir-equipas/plantel.aspx?id_team=${process.env.LR_ID_TEAM ?? ''}`,
      'sec-fetch-site': 'same-origin',
    },
  });

  await writeFile(`debug/pesquisa-${posicao}.json`, r.texto, 'utf8');
  const jogadores = lerJogadoresJSON(r.texto) ?? lerJogadores(cheerio.load(r.texto));
  total += jogadores.length;

  console.log(
    `  ${jogadores.length ? 'OK   ' : 'VAZIO'} ${posicao}  ${r.status}  ` +
      `${jogadores.length} jogadores  (${r.texto.length} chars)`
  );
  if (jogadores.length) {
    const j = jogadores[0];
    console.log(`        ex: ${j.nome} / ${j.equipa} / ${j.custo}M / ${j.pontosTotais}pts`);
  }
}

console.log(`  subtotal: ${total}\n`);

console.log('Pesquisa por clube (posicao vazia):');
const { nomeDeClubeParaPesquisa } = await import('./fontes/pesquisa.js');
const { EQUIPAS } = await import('./config/equipas.js');
let porClube = 0;

for (const equipa of EQUIPAS.slice(0, 3)) {
  const p = new URLSearchParams({
    playerposition: '',
    name: '',
    club: nomeDeClubeParaPesquisa(equipa.nome),
    minval: '500000',
    maxval: '12000000',
    order_by: 'points',
    order_dir: 'desc',
  });
  const r = await pedido(`${BASE}${caminho}?${p}`, {
    frasco,
    headers: {
      'x-requested-with': 'XMLHttpRequest',
      referer: `${BASE}/gerir-equipas/plantel.aspx?id_team=${process.env.LR_ID_TEAM ?? ''}`,
      'sec-fetch-site': 'same-origin',
    },
  });

  const jogadores = lerJogadoresJSON(r.texto) ?? lerJogadores(cheerio.load(r.texto));
  porClube += jogadores.length;
  console.log(
    `  ${jogadores.length ? 'OK   ' : 'VAZIO'} ${equipa.nome.padEnd(18)} ${r.status}  ${jogadores.length} jogadores`
  );
  if (jogadores.length) {
    const j = jogadores[0];
    console.log(`        ex: ${j.nome} / ${j.posicao} / ${j.custo}M / ${j.pontosTotais}pts`);
  }
  await new Promise((r) => setTimeout(r, 800));
}

console.log(`\nPor posicao: ${total} | Por clube (3 equipas): ${porClube}`);

if (!total && porClube) {
  console.log('A pesquisa exige clube. O worker ja usa a varredura por clube.');
} else if (total >= 150) {
  console.log('Por posicao chega. Quatro pedidos por recolha.');
} else if (!total && !porClube) {
  console.log('Nenhuma das duas devolveu nada. Ve os fragmentos em debug/.');
}

console.log('\nGravado em debug/. Cola-me este resumo.');
