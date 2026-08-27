# Descobrir as paginas da Liga Record

A captura que fizeste ja respondeu a pergunta principal: **nao ha API JSON**.
A Liga Record e ASP.NET WebForms (Microsoft-IIS, paginas `.aspx`), com sessao
por cookie. Nao ha token para copiar — ha um login para fazer.

Por isso o worker autentica-se sozinho com `LR_EMAIL` e `LR_PASSWORD`. O que
falta e saber em que paginas estao os dados.

## O que preciso que faças

```bash
cd worker
npm install
cp ../worker/.env.example .env     # preenche LR_EMAIL, LR_PASSWORD e o Firebase
npm run descobrir login            # confirma que o formulario e lido
npm run descobrir                  # faz login e grava as paginas
```

O comando escreve o HTML em `worker/debug/` e imprime um resumo: quantas
tabelas cada pagina tem e o cabeçalho de cada uma. **Cola-me esse resumo.**

## Se o `descobrir login` falhar

Provavelmente o URL do formulario nao e o que assumi. Na screenshot que
mandaste a barra de endereço estava cortada. Abre a pagina de login, copia o
URL da barra, e mete em `LR_URL_LOGIN` no `.env`.

## Os separadores

No painel `gerir-equipas/default.aspx` viam-se cinco: Ativar Equipas, Comprar
Equipas, Ligas Privadas, Equipas e Plantel. Clica em **Plantel** e em **Comprar
Equipas** e diz-me o URL de cada um — sao esses que interessam.

## Segurança

Quando me mandares screenshots do painel Rede, **tapa `Set-Cookie`, `Cookie` e
`authorization`**. Na imagem que mandaste vinha o valor completo do cookie de
sessao, que dava entrada na tua conta sem password ate expirar.
