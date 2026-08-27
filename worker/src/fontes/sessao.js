import * as cheerio from 'cheerio';
import { Frasco, pedido, ErroSessao } from '../lib-http.js';
import { URLS } from '../config/endpoints.js';
import { bd } from '../firestore.js';

// -----------------------------------------------------------------------------
// SESSAO NA LIGA RECORD
//
// Aprendido com a captura: nao ha API JSON nem Bearer token. E ASP.NET
// WebForms com autenticacao por cookie. A cadeia e:
//
//   1. GET da pagina de login (SSO do grupo Medialivre)  -> __VIEWSTATE etc.
//   2. POST do formulario com email + password           -> redirecciona
//   3. .../user_login.ashx?token=...&returnUrl=...       -> poe os cookies
//   4. cookies "LigaRecordUser" e "cof_site_user"        -> sessao activa
//
// O cookie de sessao dura menos de um dia, por isso a captura manual nao era
// opcao nenhuma: teria de ser feita todos os dias. O login automatico aqui
// nao e conveniencia, e a unica forma de isto funcionar.
// -----------------------------------------------------------------------------

const DOC = () => {
  const uid = process.env.UID_DONO ?? 'dono';
  const ambiente = process.env.AMBIENTE ?? 'dev';
  // Os cookies sao partilhados entre ambientes de proposito: sao a mesma
  // conta da Liga Record, e assim dev nao gera um login extra a cada teste.
  return bd().collection('segredos').doc(uid);
};

// Nome dos cookies que provam que a sessao esta viva.
const COOKIES_SESSAO = ['LigaRecordUser', 'cof_site_user'];

let frascoActual = null;

async function lerGuardado() {
  const doc = await DOC().get();
  return doc.exists ? doc.data() : {};
}

async function guardar(dados) {
  await DOC().set(
    { ...dados, actualizadoEm: new Date().toISOString() },
    { merge: true }
  );
}

function credenciais() {
  const email = process.env.LR_EMAIL;
  const password = process.env.LR_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'Faltam LR_EMAIL e LR_PASSWORD.\n' +
        'O login da Liga Record e email + palavra-passe no dominio deles,\n' +
        'por isso o worker consegue autenticar-se sozinho.'
    );
  }
  return { email, password };
}

// Extrai os campos escondidos do WebForms. Sem __VIEWSTATE e
// __EVENTVALIDATION o POST e rejeitado com erro 500.
function camposEscondidos(html) {
  const $ = cheerio.load(html);
  const campos = {};
  $('input[type=hidden]').each((_, el) => {
    const nome = $(el).attr('name');
    if (nome) campos[nome] = $(el).attr('value') ?? '';
  });
  return campos;
}

// Descobre os names reais dos inputs de email e password. O ASP.NET gera
// nomes como ctl00$ContentPlaceHolder1$txtEmail, e nao vale a pena fixa-los.
function nomesDosCampos(html) {
  const $ = cheerio.load(html);
  const email =
    $('input[type=email]').attr('name') ??
    $('input[name*="mail" i]').attr('name') ??
    $('input[type=text]').first().attr('name');
  const password =
    $('input[type=password]').attr('name') ??
    $('input[name*="pass" i]').attr('name');
  const botao =
    $('input[type=submit]').attr('name') ??
    $('button[type=submit]').attr('name');
  const accao = $('form').attr('action');
  return { email, password, botao, accao };
}

async function autenticar() {
  const { email, password } = credenciais();
  const frasco = new Frasco();

  // 1. Buscar o formulario.
  const pagina = await pedido(URLS.login, { frasco });
  if (pagina.status >= 400) {
    throw new Error(`A pagina de login devolveu ${pagina.status}. Confirma URLS.login.`);
  }

  const nomes = nomesDosCampos(pagina.texto);
  if (!nomes.email || !nomes.password) {
    throw new Error(
      'Nao encontrei os campos de email/password na pagina de login.\n' +
        'Corre `npm run descobrir login` para ver o HTML e ajustar.'
    );
  }

  // 2. Montar o POST com os campos escondidos por cima.
  const corpo = new URLSearchParams({
    ...camposEscondidos(pagina.texto),
    [nomes.email]: email,
    [nomes.password]: password,
    ...(nomes.botao ? { [nomes.botao]: 'Entrar' } : {}),
  });

  const destino = nomes.accao
    ? new URL(nomes.accao, pagina.url).toString()
    : pagina.url;

  const resposta = await pedido(destino, {
    frasco,
    metodo: 'POST',
    corpo: corpo.toString(),
    headers: { referer: pagina.url, origin: new URL(destino).origin },
    seguir: 8, // a cadeia passa pelo user_login.ashx antes de assentar
  });

  // 3. Confirmar que os cookies de sessao apareceram.
  const temSessao = COOKIES_SESSAO.some((c) => frasco.tem(c));
  if (!temSessao) {
    const pareceErro = /palavra-passe|password|incorrect|invalid/i.test(
      resposta.texto.slice(0, 4000)
    );
    throw new ErroSessao(
      pareceErro
        ? 'Login recusado. Confirma LR_EMAIL e LR_PASSWORD.'
        : 'O login passou mas nao vieram cookies de sessao. ' +
          'A pagina pode ter mudado — corre `npm run descobrir login`.',
      401
    );
  }

  await guardar({ cookies: frasco.paraObjecto() });
  frascoActual = frasco;
  return frasco;
}

// Verifica se a sessao guardada ainda serve, sem gastar um login.
async function aindaValida(frasco) {
  try {
    const r = await pedido(URLS.plantel, { frasco, seguir: 3 });
    // Se nos atirarem de volta para o login, a sessao morreu.
    return r.status === 200 && !/inicie sess|login/i.test(r.url);
  } catch {
    return false;
  }
}

export async function obterSessao({ forcar = false } = {}) {
  if (!forcar && frascoActual && (await aindaValida(frascoActual))) {
    return frascoActual;
  }

  if (!forcar) {
    const guardado = await lerGuardado().catch(() => ({}));
    if (guardado.cookies) {
      const frasco = new Frasco(guardado.cookies);
      if (await aindaValida(frasco)) {
        frascoActual = frasco;
        return frasco;
      }
    }
  }

  return autenticar();
}

export function invalidar() {
  frascoActual = null;
}
