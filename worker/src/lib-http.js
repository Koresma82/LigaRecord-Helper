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
  // { nome: { valor, dominio } }. O dominio importa porque o login
  // atravessa dois hosts (o SSO do grupo e o liga.record.pt), e mandar
  // as cookies de um para o outro e a melhor forma de partir a sessao.
  constructor(inicial = {}) {
    this.cookies = new Map(
      Object.entries(inicial).map(([nome, v]) =>
        typeof v === 'string' ? [nome, { valor: v, dominio: null }] : [nome, v]
      )
    );
  }

  guardar(cabecalhoSetCookie, urlOrigem) {
    if (!cabecalhoSetCookie) return;
    const lista = Array.isArray(cabecalhoSetCookie)
      ? cabecalhoSetCookie
      : [cabecalhoSetCookie];

    const host = urlOrigem ? new URL(urlOrigem).hostname : null;

    for (const linha of lista) {
      const partes = linha.split(';');
      const [par] = partes;
      const i = par.indexOf('=');
      if (i < 1) continue;

      const nome = par.slice(0, i).trim();
      const valor = par.slice(i + 1).trim();

      // Domain=.record.pt no Set-Cookie manda; senao vale o host do pedido.
      const declarado = partes
        .slice(1)
        .map((p) => p.trim())
        .find((p) => /^domain=/i.test(p));
      const dominio = declarado
        ? declarado.split('=')[1].replace(/^\./, '').toLowerCase()
        : host;

      this.cookies.set(nome, { valor, dominio });
    }
  }

  // Uma cookie serve o pedido se o host for o dominio dela ou um subdominio.
  cabecalho(url) {
    const host = url ? new URL(url).hostname.toLowerCase() : null;

    return [...this.cookies]
      .filter(([, c]) => {
        if (!host || !c.dominio) return true;
        return host === c.dominio || host.endsWith(`.${c.dominio}`);
      })
      .map(([nome, c]) => `${nome}=${c.valor}`)
      .join('; ');
  }

  tem(nome) {
    return this.cookies.has(nome);
  }

  get tamanho() {
    return this.cookies.size;
  }

  paraObjecto() {
    return Object.fromEntries(
      [...this.cookies].map(([nome, c]) => [nome, c])
    );
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
    const paraEnviar = frasco?.cabecalho(alvo);

    const res = await request(alvo, {
      method: metodo,
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/json,*/*',
        ...(paraEnviar ? { cookie: paraEnviar } : {}),
        ...(corpo && metodo === 'POST'
          ? { 'content-type': 'application/x-www-form-urlencoded' }
          : {}),
        ...headers,
      },
      body: corpo,
      maxRedirections: 0,
    });

    frasco?.guardar(res.headers['set-cookie'], alvo);

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

// Segue os redireccionamentos a partir de uma pagina protegida e devolve
// onde se foi parar. Como nao ha sessao, o destino e a pagina de login —
// que e exactamente o que precisamos de saber sem a adivinhar.
export async function seguirAte(url) {
  const r = await pedido(url, { seguir: 8 });
  return { url: r.url, status: r.status, texto: r.texto };
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
