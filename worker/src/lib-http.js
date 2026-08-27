import { request } from 'undici';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export const pausa = (ms = 1200) => new Promise((r) => setTimeout(r, ms));

export class ErroSessao extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.name = 'ErroSessao';
    this.status = status;
  }
}

// -----------------------------------------------------------------------------
// Frasco de cookies.
//
// A Liga Record e ASP.NET WebForms: a sessao vive em cookies, nao num
// header Authorization. Sem isto nao ha nada a fazer.
// -----------------------------------------------------------------------------

export class Frasco {
  constructor(inicial = {}) {
    this.cookies = new Map(Object.entries(inicial));
  }

  guardar(cabecalhoSetCookie) {
    if (!cabecalhoSetCookie) return;
    const lista = Array.isArray(cabecalhoSetCookie)
      ? cabecalhoSetCookie
      : [cabecalhoSetCookie];
    for (const linha of lista) {
      const [par] = linha.split(';');
      const i = par.indexOf('=');
      if (i < 1) continue;
      this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
  }

  cabecalho() {
    return [...this.cookies]
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  tem(nome) {
    return this.cookies.has(nome);
  }

  paraObjecto() {
    return Object.fromEntries(this.cookies);
  }
}

// Faz o pedido sem seguir redireccionamentos automaticamente: precisamos de
// apanhar os Set-Cookie de cada salto da cadeia de login.
export async function pedido(
  url,
  { frasco, metodo = 'GET', corpo, headers = {}, seguir = 5 } = {}
) {
  let alvo = url;
  let restantes = seguir;

  while (true) {
    const res = await request(alvo, {
      method: metodo,
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/json,*/*',
        ...(frasco?.cookies.size ? { cookie: frasco.cabecalho() } : {}),
        ...(corpo && metodo === 'POST'
          ? { 'content-type': 'application/x-www-form-urlencoded' }
          : {}),
        ...headers,
      },
      body: corpo,
      maxRedirections: 0,
    });

    frasco?.guardar(res.headers['set-cookie']);

    const local = res.headers.location;
    if (local && res.statusCode >= 300 && res.statusCode < 400 && restantes > 0) {
      alvo = new URL(local, alvo).toString();
      metodo = 'GET';
      corpo = undefined;
      restantes -= 1;
      continue;
    }

    const texto = await res.body.text();
    return { status: res.statusCode, texto, url: alvo, headers: res.headers };
  }
}

export async function getHTML(url, frasco) {
  const r = await pedido(url, { frasco });
  if (r.status >= 400) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.texto;
}

export function campo(objecto, nomesPossiveis, omissao = null) {
  for (const nome of nomesPossiveis) {
    if (objecto?.[nome] !== undefined && objecto?.[nome] !== null) return objecto[nome];
  }
  return omissao;
}
