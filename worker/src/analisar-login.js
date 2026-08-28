import { readFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';

// Analisa o debug/login.html ja gravado. Nao faz pedidos nenhuns.
//
// A pergunta e uma so: o reCAPTCHA esta DENTRO do formulario de login, ou
// noutro sitio do layer (tipicamente no registo de conta nova)? Se estiver
// fora, o login automatico passa.

const ficheiro = process.argv[2] ?? 'debug/login.html';
const html = await readFile(ficheiro, 'utf8').catch(() => null);

if (!html) {
  console.error(`Nao consegui ler ${ficheiro}. Corre \`npm run descobrir login\` primeiro.`);
  process.exit(1);
}

const $ = cheerio.load(html);
const MARCAS = /g-recaptcha|grecaptcha|data-sitekey|recaptcha\/api/i;

console.log(`${ficheiro}: ${html.length} caracteres, ${$('form').length} formularios\n`);

let loginTemCaptcha = null;

$('form').each((i, f) => {
  const $f = $(f);
  const temPassword = $f.find('input[type=password]').length > 0;
  const temEmail = $f.find('input[type=email]').length > 0;
  const html_ = $.html($f);
  const captcha = MARCAS.test(html_);

  const campos = $f
    .find('input')
    .map((_, el) => $(el).attr('name'))
    .get()
    .filter(Boolean);

  // Um formulario com password e email mas sem campos de nome/data de
  // nascimento e o de login; o de registo costuma ter muito mais.
  const papel = temPassword && campos.length <= 8 ? 'LOGIN' : temPassword ? 'registo?' : 'outro';

  console.log(`form ${i}  [${papel}]  action=${$f.attr('action') ?? '(propria)'}`);
  console.log(`  campos: ${campos.join(', ') || '(nenhum)'}`);
  console.log(`  password=${temPassword}  email=${temEmail}  reCAPTCHA=${captcha ? 'SIM' : 'nao'}`);
  console.log();

  if (papel === 'LOGIN') loginTemCaptcha = captcha;
});

// Onde e que a sitekey aparece, e o que a rodeia.
const ocorrencias = [...html.matchAll(/data-sitekey=["']([^"']+)["']/gi)];
if (ocorrencias.length) {
  console.log(`sitekeys encontradas: ${ocorrencias.length}`);
  for (const oc of ocorrencias) {
    const inicio = Math.max(0, oc.index - 220);
    const contexto = html
      .slice(inicio, oc.index + 80)
      .replace(/\s+/g, ' ')
      .trim();
    console.log(`  ...${contexto.slice(-200)}`);
  }
  console.log();
}

const scripts = [...html.matchAll(/<script[^>]*src=["']([^"']*recaptcha[^"']*)["']/gi)];
if (scripts.length) {
  console.log('scripts de reCAPTCHA:');
  for (const s of scripts) console.log(`  ${s[1]}`);
  console.log();
}

console.log('---');
if (loginTemCaptcha === false) {
  console.log('O formulario de LOGIN nao tem reCAPTCHA.');
  console.log('O que apanhamos antes deve ser do registo de conta nova.');
  console.log('Podes correr `npm run descobrir` — ha boas hipoteses de passar.');
} else if (loginTemCaptcha === true) {
  console.log('O reCAPTCHA esta DENTRO do formulario de login.');
  console.log('Se for exigido no POST, o login automatico nao passa.');
  console.log('Vale a pena tentar uma vez: pode ser v3 invisivel e so pontuar.');
} else {
  console.log('Nao identifiquei o formulario de login. Manda-me o output disto.');
}
