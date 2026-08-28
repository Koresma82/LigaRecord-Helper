import * as cheerio from 'cheerio';
import { Frasco, pedido, seguirAte, ErroSessao } from '../lib-http.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { URLS, BASE as BASE_SITE } from '../config/endpoints.js';
import { bd } from '../firestore.js';

// -----------------------------------------------------------------------------
// SESSAO NA LIGA RECORD
//
// Aprendido com a captura: nao ha API JSON nem Bearer token. E ASP.NET
// WebForms com autenticacao por cookie. A cadeia e:
//
//   1. GET da pagina protegida sem sessao       -> redirecciona para o SSO
//   2. POST /Api/Layers/Login com email+password -> devolve destino
//   3. .../user_login.ashx?token=...             -> poe as cookies
//   4. cookies "LigaRecordUser" e "cof_site_user" -> sessao activa
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

// Nomes de cookies que costumam indicar sessao no site. Servem de pista,
// NAO de prova: numa das tentativas a cadeia completou-se e estas nao
// apareceram, e mesmo assim a pergunta certa nunca foi "tenho a cookie X"
// — e "consigo ver o meu plantel?". E isso que decide.
const COOKIES_SESSAO = ['LigaRecordUser', 'cof_site_user'];

// FORA: o cabecalho de quem nao tem sessao mostra "Login/Registo".
const MARCAS_DE_FORA = /login\s*\/\s*registo|inicie sess|sso_layer_loginForm/i;

// DENTRO: texto que so a pagina autenticada do plantel tem.
//
// Tinha aqui "gerir-equipas", que e o caminho da propria pagina e aparece
// nos links de navegacao MESMO deslogado. O teste dava sempre positivo, a
// app julgava-se autenticada e descarregava a pagina publica — onde a
// classificacao geral (WIZARDS, ROCODREAMTEAM) parecia um plantel.
// Um teste que nunca falha nao e um teste.
const MARCAS_DE_DENTRO = /valor do plantel|saldo dispon[ií]vel|reabrir plantel|plantel completo/i;

export async function estaAutenticado(frasco) {
  try {
    const url = `${URLS.plantel}?id_team=${process.env.LR_ID_TEAM ?? ''}`;
    const r = await pedido(url, { frasco, seguir: 5 });
    if (r.status >= 400) return false;

    const texto = r.texto;
    if (MARCAS_DE_FORA.test(texto)) return false;
    return MARCAS_DE_DENTRO.test(texto);
  } catch {
    return false;
  }
}

let frascoActual = null;

// O cron corre varias vezes por semana e o servidor reinicia sozinho. Se as
// credenciais estiverem erradas, sem isto o worker martelava o login de hora
// a hora ate a conta ser bloqueada. Tres falhas seguidas e para.
const MAX_FALHAS = 3;
let falhasSeguidas = 0;

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

function cookiesPorDominio(frasco) {
  const mapa = {};
  for (const [nome, c] of frasco.cookies) {
    const dominio = c.dominio ?? '(sem dominio)';
    (mapa[dominio] ??= []).push(nome);
  }
  return Object.entries(mapa)
    .map(([dominio, nomes]) => `  ${dominio}: ${nomes.join(', ')}`)
    .join('\n');
}

async function escreverDiagnostico(nome, resposta) {
  try {
    await mkdir('debug', { recursive: true });
    await writeFile(
      `debug/${nome}`,
      `URL: ${resposta.url}\nEstado: ${resposta.status}\n\n` +
        Object.entries(resposta.headers ?? {})
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n') +
        `\n\n---\n${resposta.texto.slice(0, 20000)}`,
      'utf8'
    );
  } catch {
    // Diagnostico e um extra; nao vale a pena falhar o login por causa dele.
  }
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

// -----------------------------------------------------------------------------
// O formulario, confirmado no inspector:
//
//   <form method="post" action="/Api/Layers/Login">
//     <input type="hidden" name="returnUrl" value="https://liga.record.pt/#">
//     <input type="hidden" name="appID">
//     <input type="hidden" name="hdnIsLayer">
//     <input type="hidden" name="fbData">
//     <input type="email"    name="email">
//     <input type="password" name="password">
//     <button class="sso_submit">Entrar</button>
//   </form>
//
// Nao e WebForms — nao ha __VIEWSTATE nem __EVENTVALIDATION. E uma API que
// recebe um POST normal. O botao nao tem `name`, por isso nao se envia.
// -----------------------------------------------------------------------------

// Encontra o formulario de login: e o unico que tem um campo de password.
function localizarFormulario(html) {
  const $ = cheerio.load(html);

  const form = $('form')
    .filter((_, f) => $(f).find('input[type=password]').length > 0)
    .first();

  if (!form.length) return null;

  const campos = {};
  form.find('input').each((_, el) => {
    const nome = $(el).attr('name');
    if (nome) campos[nome] = $(el).attr('value') ?? '';
  });

  const nomeCampo = (selector, padrao) =>
    form.find(selector).attr('name') ?? padrao;

  // O link de recuperar password aponta para o dominio do SSO
  // (aminhaconta.xl.pt). Serve de alternativa se a accao relativa nao
  // existir no host onde o formulario esta embebido.
  const recuperar = $('a[href*="PasswordRecover" i], a[href*="recover" i]').attr('href');
  let origemAlternativa = null;
  try {
    if (recuperar) origemAlternativa = new URL(recuperar).origin;
  } catch {}

  return {
    accao: form.attr('action') ?? null,
    metodo: (form.attr('method') ?? 'post').toUpperCase(),
    campos,
    origemAlternativa,
    campoEmail: nomeCampo('input[type=email]', null) ??
                nomeCampo('input[name*="mail" i]', 'email'),
    campoPassword: nomeCampo('input[type=password]', 'password'),
  };
}

// A resposta pode ser JSON com um destino para onde seguir. E ai que o
// user_login.ashx?token=... poe as cookies do liga.record.pt.
function destinoNaResposta(texto, headers) {
  if (headers?.location) return headers.location;

  // O caminho mais provavel, e o que se ve na captura: um URL para o
  // user_login.ashx algures no corpo, com o token ja incluido.
  const directo = texto.match(/https?:\/\/[^\s"'\\<>]*user_login\.ashx[^\s"'\\<>]*/i);
  if (directo) return directo[0].replace(/&amp;/g, '&');

  const aparado = texto.trim();
  if (aparado.startsWith('{') || aparado.startsWith('[')) {
    try {
      const dados = JSON.parse(aparado);
      const procurar = (o, profundidade = 0) => {
        if (profundidade > 4 || !o || typeof o !== 'object') return null;
        // Confirmado na resposta real: o campo chama-se RedirectUrl.
        for (const [chave, valor] of Object.entries(o)) {
          if (typeof valor === 'string' && /^https?:\/\//.test(valor) &&
              /^redirect_?url$/i.test(chave)) {
            return valor;
          }
        }
        // Depois, qualquer campo com nome de destino.
        for (const [chave, valor] of Object.entries(o)) {
          if (typeof valor === 'string' && /^https?:\/\//.test(valor) &&
              /redirect|url|destino|location/i.test(chave)) {
            return valor;
          }
        }
        for (const valor of Object.values(o)) {
          if (typeof valor === 'string' && /^https?:\/\//.test(valor)) return valor;
          if (typeof valor === 'object') {
            const achado = procurar(valor, profundidade + 1);
            if (achado) return achado;
          }
        }
        return null;
      };
      return procurar(dados);
    } catch {
      return null;
    }
  }

  // Ou um redireccionamento por JavaScript.
  return aparado.match(/(?:location\.href|window\.location)\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
}

function mensagemDeErro(texto) {
  const aparado = texto.trim();
  if (aparado.startsWith('{')) {
    try {
      const d = JSON.parse(aparado);
      const m = d.message ?? d.error ?? d.Message ?? d.erro;
      if (typeof m === 'string') return m;
    } catch {}
  }
  if (/palavra-passe|password.*(incorrect|invalid|errad)/i.test(aparado.slice(0, 3000))) {
    return 'credenciais recusadas';
  }
  return null;
}

// -----------------------------------------------------------------------------
// Onde esta o formulario.
//
// Nao vem na pagina: e carregado por AJAX. Confirmado na captura —
//   GET .../Api/Layers/Login?returnUrl=https%3A%2F%2Fliga.record.pt%2F%23&appID=
//   (xhr, 13.8 kB, iniciado pelo jquery)
//
// Por isso seguir redireccionamentos nao dava: o site devolve 200 e injecta
// o layer com JavaScript. Vamos direitos ao endpoint que o devolve.
// -----------------------------------------------------------------------------

const CAMINHO_LAYER = '/Api/Layers/Login';

// Hosts a tentar, por ordem. O primeiro e o proprio site; o segundo e o SSO
// do grupo, revelado pelo link "Recuperar password" (aminhaconta.xl.pt).
function candidatos() {
  if (process.env.LR_URL_LOGIN) return [process.env.LR_URL_LOGIN];

  // Pedir o layer com o returnUrl a apontar para a pagina que queremos.
  // No browser e assim que ele e aberto; com "/#" o SSO pode nao ter a
  // informacao de que precisa para entregar a sessao ao site.
  const params = new URLSearchParams({
    returnUrl: `${BASE_SITE}/gerir-equipas/plantel.aspx?id_team=${
      process.env.LR_ID_TEAM ?? ''
    }`,
    appID: process.env.LR_APP_ID ?? '',
  });

  const hosts = [BASE_SITE, 'https://aminhaconta.xl.pt'];
  if (process.env.LR_HOST_SSO) hosts.unshift(process.env.LR_HOST_SSO);

  return hosts.map((h) => `${h}${CAMINHO_LAYER}?${params}`);
}

const temFormulario = (texto = '') =>
  /type=["']password["']/i.test(texto) || /inputPassword/i.test(texto);

export async function descobrirUrlLogin() {
  const tentativas = [];

  for (const url of candidatos()) {
    try {
      const r = await pedido(url, {
        headers: {
          'x-requested-with': 'XMLHttpRequest',
          referer: `${BASE_SITE}/`,
          accept: 'text/html, */*',
        },
        seguir: 5,
      });

      if (r.status === 200 && temFormulario(r.texto)) return url;

      tentativas.push(`${url} -> ${r.status}, ${r.texto.length} chars, sem formulario`);
    } catch (erro) {
      tentativas.push(`${url} -> ${erro.message}`);
    }
  }

  throw new Error(
    'Nao encontrei o formulario de login em nenhum dos sitios esperados.\n\n' +
      tentativas.map((t) => `  ${t}`).join('\n') +
      '\n\nNo browser: DevTools > Rede > filtro Fetch/XHR > recarrega a pagina\n' +
      'de login. Clica na linha "Login?returnUrl=..." > separador Cabecalhos >\n' +
      'copia o "URL do pedido" completo e poe em LR_URL_LOGIN no .env.'
  );
}

// -----------------------------------------------------------------------------
// A troca de token.
//
// O login no SSO da-nos cookies em aminhaconta.xl.pt (cof_user, cof_acsrf,
// ASP.NET_SessionId...). Mas o jogo vive noutro dominio e precisa das SUAS
// cookies. A ponte, vista na captura, e:
//
//   GET https://liga.record.pt/user_login.ashx?token=<64 hex>&returnUrl=...
//     -> Set-Cookie: LigaRecordUser=Id=...&MembershipId=...
//     -> Set-Cookie: cof_site_user=<o mesmo token>
//
// O token e um hexadecimal de 64 caracteres. Nao sabemos ao certo de onde
// sai — pode vir no corpo da resposta do login ou ser o valor de uma das
// cookies do SSO. Por isso juntamos os candidatos e tentamos cada um.
// -----------------------------------------------------------------------------

const CAMINHO_TROCA = '/user_login.ashx';

function candidatosAToken(frasco, corpoLogin = '') {
  const vistos = new Set();
  const lista = [];

  const juntar = (valor, origem) => {
    if (!valor || typeof valor !== 'string') return;
    // As cookies vem URL-encoded (%3D, %2F...). Descodificar antes de
    // avaliar, senao o filtro rejeitava quase tudo — na primeira versao
    // sobrou um unico candidato por causa disto.
    let limpo = valor.trim();
    try {
      limpo = decodeURIComponent(limpo);
    } catch {}
    if (limpo.length < 16 || limpo.length > 200) return;
    // Espacos ou sinais de igual a meio indicam um valor composto
    // (ex: "Id=123&MembershipId=..."), nao um token.
    if (/[\s]/.test(limpo)) return;
    if (vistos.has(limpo)) return;
    vistos.add(limpo);
    lista.push({ token: limpo, origem });
  };

  // 1. Hexadecimais longos no corpo da resposta — o formato do token.
  for (const m of corpoLogin.matchAll(/\b[a-f0-9]{32,80}\b/gi)) {
    juntar(m[0], 'corpo da resposta');
  }

  // 2. Um URL no corpo que ja traga token=...
  for (const m of corpoLogin.matchAll(/token=([A-Za-z0-9._-]{24,128})/gi)) {
    juntar(m[1], 'token= no corpo');
  }

  // 3. As cookies do SSO. A ordem importa: cof_user primeiro, porque na
  //    captura o cof_site_user tinha exactamente o mesmo valor.
  const prioridade = ['cof_user', 'cof_site_user', 'cof_rln', 'cof_appid', 'cof_acsrf'];
  for (const nome of prioridade) {
    const c = frasco.cookies.get(nome);
    if (c) juntar(c.valor, `cookie ${nome}`);
  }
  for (const [nome, c] of frasco.cookies) {
    if (!prioridade.includes(nome)) juntar(c.valor, `cookie ${nome}`);
  }

  // Um tecto para nao andarmos a martelar o user_login.ashx com lixo.
  // Se nenhum dos seis primeiros servir, o problema e outro.
  return lista.slice(0, 6);
}

// A cadeia nao acaba num 302. O RedirectUrl aponta para
// .../Redirects/INIT_SESSION?si=..., que so depois leva ao user_login.ashx
// do liga.record.pt. E pelo caminho o salto pode ser feito por meta refresh
// ou por JavaScript, que o seguidor de Location nao apanha.
function proximoSalto(texto = '') {
  const meta = texto.match(
    /<meta[^>]+http-equiv=["']refresh["'][^>]*content=["']\s*\d+\s*;\s*url=([^"']+)["']/i
  );
  if (meta) return meta[1].replace(/&amp;/g, '&');

  const js = texto.match(
    /(?:location\.href|location\.replace|window\.location)\s*=?\s*\(?\s*["']([^"']+)["']/i
  );
  if (js) return js[1].replace(/&amp;/g, '&');

  const ligacao = texto.match(/https?:\/\/[^\s"'\\<>]*user_login\.ashx[^\s"'\\<>]*/i);
  if (ligacao) return ligacao[0].replace(/&amp;/g, '&');

  return null;
}

// Um SSO distribui a sessao pelos sites do grupo carregando recursos
// escondidos — iframes, imagens de 1x1, scripts — que apontam para o
// endpoint de login de cada site. O browser carrega-os sem pensar; o nosso
// seguidor de redireccionamentos nunca lhes tocou.
//
// Esta e a hipotese mais provavel para a cadeia acabar sem cookies: o
// user_login.ashx do liga.record.pt nunca chega a ser chamado porque esta
// num <iframe> e nao num Location.
function recursosDeSessao($, base) {
  const encontrados = new Set();

  $('iframe[src], img[src], script[src], link[href]').each((_, el) => {
    const bruto = $(el).attr('src') ?? $(el).attr('href');
    if (!bruto) return;

    let url;
    try {
      url = new URL(bruto, base).toString();
    } catch {
      return;
    }

    // Filtro apertado. A primeira versao aceitava tudo o que fosse do
    // liga.record.pt e acabou a descarregar o jquery, o bootstrap e o
    // modernizr — ruido que gastava o orcamento de saltos sem servir de nada.
    const ehEndpoint = /user_login|\.ashx(\?|$)|[?&](token|si|ticket)=/i.test(url);
    const ehBiblioteca =
      /\/(vendor|lib|libs)\//i.test(url) ||
      /(jquery|bootstrap|modernizr|respond|slick|icheck|magnific|tooltipster|countdown|interact|analytics|gtag|gtm)/i.test(url) ||
      /\.(css|woff2?|ttf|png|jpe?g|gif|svg|webp|json|ico)(\?|$)/i.test(url);

    if (ehEndpoint && !ehBiblioteca) encontrados.add(url);
  });

  return [...encontrados].slice(0, 10);
}

// Segue ate as cookies do site aparecerem, ou ate acabarem os saltos.
async function seguirCadeia(frasco, urlInicial, { maxSaltos = 5, log = () => {} } = {}) {
  let url = urlInicial;
  const percurso = [];
  const visitados = new Set();

  for (let i = 0; i < maxSaltos; i++) {
    // Sem isto a cadeia dava voltas na mesma pagina: o JavaScript da
    // homepage aponta para si proprio e ficavamos a segui-lo em ciclo.
    if (visitados.has(url)) {
      percurso.push('(ciclo)');
      break;
    }
    visitados.add(url);

    const r = await pedido(url, { frasco, seguir: 6, headers: { referer: url } });
    percurso.push(`${new URL(r.url).host}${new URL(r.url).pathname} (${r.status})`);

    // Guardar cada salto: quando a cadeia falha, o passo interessante
    // costuma ser o do meio, nao o ultimo.
    await escreverDiagnostico(`cadeia-${i + 1}.txt`, r);

    // Carregar os recursos escondidos desta pagina antes de seguir em frente.
    // E aqui que o user_login.ashx costuma estar.
    const recursos = recursosDeSessao(cheerio.load(r.texto), r.url);
    for (const recurso of recursos) {
      if (visitados.has(recurso)) continue;
      visitados.add(recurso);
      try {
        await pedido(recurso, { frasco, seguir: 5, headers: { referer: r.url } });
        percurso.push(`  +${new URL(recurso).host}${new URL(recurso).pathname}`);
      } catch {
        // Um recurso que nao carrega nao interrompe a cadeia.
      }
      if (COOKIES_SESSAO.some((c) => frasco.tem(c))) {
        log(`  cadeia: ${percurso.join(' -> ')}`);
        return percurso;
      }
    }

    const seguinte = proximoSalto(r.texto);
    if (!seguinte) {
      await escreverDiagnostico('cadeia-fim.txt', r);
      break;
    }
    url = new URL(seguinte, r.url).toString();
  }

  log(`  cadeia: ${percurso.join(' -> ')}`);
  return percurso;
}

// -----------------------------------------------------------------------------
// Os scripts do SSO.
//
// Na cadeia aparecem SSOSite.js e SSOSiteVariables.js, servidos pelo dominio
// do SSO. Sao eles que sabem como distribuir a sessao pelos sites do grupo —
// e portanto contem o URL do endpoint de login de cada site, provavelmente
// como um template com o token por substituir.
//
// Sao ficheiros publicos, sem credenciais: da para os ler e aprender o
// formato em vez de o adivinhar.
// -----------------------------------------------------------------------------

const SCRIPTS_SSO = ['/js/SSOSiteVariables.js', '/js/SSOSite.js'];

export async function endpointsNoSSO(frasco, origemSSO, { log = () => {} } = {}) {
  const encontrados = new Set();

  for (const caminho of SCRIPTS_SSO) {
    const url = `${origemSSO}${caminho}`;
    try {
      const r = await pedido(url, { frasco, seguir: 3 });
      if (r.status !== 200) {
        log(`    ${caminho} -> ${r.status}`);
        continue;
      }

      // URLs completos, e caminhos soltos que acabem em .ashx.
      for (const m of r.texto.matchAll(/["'](https?:\/\/[^"']*?(?:user_login|login)[^"']*?)["']/gi)) {
        encontrados.add(m[1]);
      }
      for (const m of r.texto.matchAll(/["']([^"']*user_login[^"']*)["']/gi)) {
        encontrados.add(m[1]);
      }

      log(`    ${caminho} -> ${r.status}, ${r.texto.length} chars`);
    } catch (erro) {
      log(`    ${caminho} -> ${erro.message.split('\n')[0]}`);
    }
  }

  return [...encontrados];
}

async function trocarTokenPorSessao(frasco, corpoLogin, { log = () => {} } = {}) {
  const candidatos = candidatosAToken(frasco, corpoLogin);
  const tentados = [];

  // Se os scripts do SSO revelarem o formato do endpoint, usamo-lo em vez
  // do caminho que eu inferi da captura.
  const doSSO = await endpointsNoSSO(frasco, 'https://aminhaconta.xl.pt', { log }).catch(
    () => []
  );
  const doLigaRecord = doSSO.filter((u) => /liga\.record\.pt|^\/|user_login/i.test(u));
  if (doLigaRecord.length) {
    log(`    endpoints encontrados nos scripts do SSO: ${doLigaRecord.length}`);
  }

  for (const { token, origem } of candidatos) {
    const url =
      `${BASE_SITE}${CAMINHO_TROCA}?token=${encodeURIComponent(token)}` +
      `&returnUrl=${encodeURIComponent(BASE_SITE + '/')}`;

    try {
      await pedido(url, { frasco, seguir: 6, headers: { referer: `${BASE_SITE}/` } });
    } catch {
      // Um candidato mau nao interessa; interessa se algum resulta.
    }

    if (COOKIES_SESSAO.some((c) => frasco.tem(c))) {
      return { token, origem, tentados: tentados.length + 1 };
    }
    tentados.push(origem);
  }

  return { token: null, tentados: tentados.length };
}

async function autenticar() {
  if (falhasSeguidas >= MAX_FALHAS) {
    throw new ErroSessao(
      `Login falhou ${falhasSeguidas} vezes seguidas — parei de tentar para\n` +
        'nao arriscar bloquear a conta. Confirma LR_EMAIL e LR_PASSWORD e\n' +
        'reinicia o worker.',
      401
    );
  }

  const { email, password } = credenciais();
  const frasco = new Frasco();

  // 1. Encontrar a pagina que tem o formulario.
  const urlLogin = await descobrirUrlLogin();
  const pagina = await pedido(urlLogin, { frasco });
  if (pagina.status >= 400) {
    throw new Error(
      `A pagina de login (${urlLogin}) devolveu ${pagina.status}.\n` +
        'Se souberes o URL certo, poe-o em LR_URL_LOGIN no .env.'
    );
  }

  const formulario = localizarFormulario(pagina.texto);
  if (!formulario) {
    throw new Error(
      `Nao encontrei o formulario de login em ${pagina.url}.\n` +
        'Corre `npm run descobrir login` e ve debug/login.html.'
    );
  }

  // 2. Enviar.
  //
  // Dois campos escondidos merecem atencao. O formulario que buscamos vem
  // com returnUrl="https://liga.record.pt/#" e appID vazio, porque o
  // pedimos fora do contexto da pagina. No browser, o layer e aberto a
  // partir da pagina onde estas, e esses dois campos vao preenchidos.
  //
  // Se o SSO usa o returnUrl para saber a que site entregar a sessao, um
  // "/#" pode bastar para ele nos devolver a homepage sem fazer a entrega.
  // Por isso apontamos ao sitio onde queremos mesmo ir.
  const paginaProtegida = `${BASE_SITE}/gerir-equipas/plantel.aspx?id_team=${
    process.env.LR_ID_TEAM ?? ''
  }`;

  const campos = { ...formulario.campos };
  if ('returnUrl' in campos) campos.returnUrl = paginaProtegida;
  if (process.env.LR_APP_ID) campos.appID = process.env.LR_APP_ID;

  const corpo = new URLSearchParams({
    ...campos,
    [formulario.campoEmail]: email,
    [formulario.campoPassword]: password,
  });

  const destino = formulario.accao
    ? new URL(formulario.accao, pagina.url).toString()
    : pagina.url;

  const enviar = (para) =>
    pedido(para, {
      frasco,
      metodo: formulario.metodo === 'GET' ? 'GET' : 'POST',
      corpo: corpo.toString(),
      headers: {
        referer: pagina.url,
        origin: new URL(para).origin,
        'x-requested-with': 'XMLHttpRequest',
        accept: 'application/json, text/javascript, text/html, */*',
      },
      seguir: 8,
    });

  let resposta = await enviar(destino);

  // O formulario e um overlay: pode estar embebido no liga.record.pt mas a
  // API viver no dominio do SSO. Se a accao relativa nao existir la, tenta
  // no host que o link de recuperar password revela.
  if (resposta.status === 404 && formulario.origemAlternativa && formulario.accao) {
    const alternativo = new URL(formulario.accao, formulario.origemAlternativa).toString();
    if (alternativo !== destino) {
      resposta = await enviar(alternativo);
    }
  }

  // O SSOSite.js revelou o endpoint canonico: /Async/Site/LoginHandler/LOGIN.
  // O /Api/Layers/Login que o formulario usa e a variante do overlay, e pode
  // nao accionar a distribuicao da sessao pelos sites do grupo. Se ficarmos
  // sem sessao no site, vale a pena tentar por aqui.
  const ENDPOINT_CANONICO = '/Async/Site/LoginHandler/LOGIN';

  if (resposta.status >= 400) {
    throw new ErroSessao(
      `O POST do login devolveu ${resposta.status} em ${destino}.\n` +
        `Corpo: ${resposta.texto.slice(0, 200)}`,
      resposta.status
    );
  }

  // Guardar para diagnostico. Contem credenciais de sessao — o .gitignore
  // ja exclui a pasta debug/.
  if (process.env.GUARDAR_DIAGNOSTICO !== 'nao') {
    await escreverDiagnostico('login-resposta.txt', resposta);
  }

  const erro = mensagemDeErro(resposta.texto);
  if (erro) {
    falhasSeguidas += 1;
    // Se o reCAPTCHA for exigido no POST, e aqui que aparece — e nao ha
    // codigo que resolva isso. Melhor dizer-te ja do que fingir que e outra coisa.
    if (/captcha|robot|verifica/i.test(erro)) {
      throw new ErroSessao(
        `O login foi barrado pelo reCAPTCHA: ${erro}\n` +
          'Isto nao se resolve com codigo. Diz-me e voltamos a captura manual\n' +
          'de cookies, com a chatice de o cof_site_user durar meio dia.',
        401
      );
    }
    throw new ErroSessao(`Login recusado: ${erro}`, 401);
  }

  // 3. Se a API respondeu com um destino, segui-lo: e o passo que troca o
  //    token pelas cookies do liga.record.pt (o user_login.ashx).
  // 3. Seguir o destino que a resposta indica. Confirmado: e um
  //    .../Redirects/INIT_SESSION?si=..., que depois encaminha para o
  //    user_login.ashx do liga.record.pt.
  const seguinte = destinoNaResposta(resposta.texto, resposta.headers);
  if (seguinte) {
    await seguirCadeia(frasco, new URL(seguinte, destino).toString(), {
      log: (m) => console.log(m),
    });
  }

  // 4. Ja estamos dentro? A pergunta certa nao e que cookies temos.
  if (await estaAutenticado(frasco)) {
    falhasSeguidas = 0;
    await guardar({ cookies: frasco.paraObjecto() });
    frascoActual = frasco;
    console.log('  Autenticado.');
    return frasco;
  }

  // 4b. Ainda fora: repetir o login pelo endpoint canonico do SSO.
  if (formulario.origemAlternativa) {
    const canonico = `${formulario.origemAlternativa}${ENDPOINT_CANONICO}`;
    try {
      const r2 = await enviar(canonico);
      console.log(`  login canonico (${ENDPOINT_CANONICO}): ${r2.status}`);
      const destino2 = destinoNaResposta(r2.texto, r2.headers);
      if (destino2) {
        await seguirCadeia(frasco, new URL(destino2, canonico).toString(), {
          log: (m) => console.log(m),
        });
      }
      if (await estaAutenticado(frasco)) {
        falhasSeguidas = 0;
        await guardar({ cookies: frasco.paraObjecto() });
        frascoActual = frasco;
        console.log('  Autenticado pelo endpoint canonico.');
        return frasco;
      }
    } catch (erro) {
      console.log(`  login canonico falhou: ${erro.message.split('\n')[0]}`);
    }
  }

  // 5. Nao: tentar a troca directa do token no user_login.ashx.
  const troca = await trocarTokenPorSessao(frasco, resposta.texto, {
    log: (m) => console.log(m),
  });

  if (await estaAutenticado(frasco)) {
    falhasSeguidas = 0;
    if (troca.token) console.log(`  Autenticado (token de: ${troca.origem}).`);
    await guardar({ cookies: frasco.paraObjecto() });
    frascoActual = frasco;
    return frasco;
  }

  {
    falhasSeguidas += 1;
    throw new ErroSessao(
      'O login no SSO passou, mas continuo sem acesso ao plantel.\n' +
        `Tentei ${troca.tentados} candidato(s) a token no user_login.ashx.\n\n` +
        'Cookies por dominio:\n' + cookiesPorDominio(frasco) + '\n\n' +
        'Guardei debug/login-resposta.txt e debug/cadeia-fim.txt.\n' +
        'NAO mos mandes — tem credenciais. Corre `npm run analisar-resposta`\n' +
        'e manda-me a linha "cadeia:" acima.',
      401
    );
  }

  if (troca.token) {
    console.log(`  token do SSO veio de: ${troca.origem}`);
  }

  falhasSeguidas = 0;
  await guardar({ cookies: frasco.paraObjecto() });
  frascoActual = frasco;
  return frasco;
}

// Verifica se a sessao guardada ainda serve, sem gastar um login.
const aindaValida = (frasco) => estaAutenticado(frasco);

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
