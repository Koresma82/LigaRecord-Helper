# Boletim da Jornada

Abres a app antes do fecho do mercado e vês quais dos **teus** jogadores não
jogam esta jornada e por quem os podes trocar sem estourar o saldo. O bot do
Telegram avisa-te sozinho quando alguém cai.

## Arquitetura

```
Railway (worker)                    Firebase                Netlify (PWA)
┌──────────────────────┐          ┌───────────┐          ┌──────────────┐
│ cron 5ª/6ª/sáb       │          │ Firestore │◀─ lê ────│ React + Auth │
│  ├ Liga Record (LR_TOKEN)  ─────▶│ boletins/ │          │  login Google│
│  ├ Zerozero (scraping)   escreve │   {uid}   │          └──────────────┘
│  ├ emparelha + sugere │          └───────────┘
│  └ bot Telegram       │
└──────────────────────┘
```

## O que o login Google faz — e o que não faz

**Faz:** fecha a app a ti. Sem sessão Firebase não se vê nada, e as regras do
Firestore só deixam ler o documento do teu próprio uid.

**Não faz:** dar acesso à Liga Record. Mesmo sendo a mesma conta Google. O
Firebase emite um token do Firebase, para o teu projeto; a Liga Record emite
um token dela, no domínio dela. Nenhum dos dois serve para o outro. Mesmo que
a Liga Record use "entrar com Google", o que sai daí é uma sessão *deles* que
só existe no browser depois de fazeres login lá.

Por isso o `LR_TOKEN` continua a ser capturado à mão (ver `CAPTURA.md`) e vive
como variável de ambiente no Railway — nunca no browser, nunca no Firestore.

## O que a captura revelou

Três coisas que mudaram o projeto:

**1. Não há API JSON.** É ASP.NET WebForms — Microsoft-IIS, `X-Aspnet-Version
4.0.30319`, páginas `.aspx`, e os únicos XHR no separador Rede eram analytics.
Os dados vêm renderizados no HTML. Tudo o que estava escrito à volta de
`/api/players` foi deitado fora e substituído por scraping com cheerio.

**2. A sessão é por cookie, não por token.** O login passa por
`user_login.ashx?token=…` que devolve dois cookies, `LigaRecordUser` e
`cof_site_user`. O segundo expirava em menos de doze horas. Ou seja: a captura
manual que eu propus antes era inviável — terias de a fazer todos os dias.

**3. O login é email + palavra-passe no domínio deles.** O botão do Google
existe mas é alternativa, não obrigação. Isto muda a minha recomendação
anterior: aqui o login automático é seguro de fazer, porque não passa pelo
OAuth do Google e não põe a tua conta Google em risco. O worker autentica-se
sozinho com `LR_EMAIL` e `LR_PASSWORD`, incluindo os campos `__VIEWSTATE` e
`__EVENTVALIDATION` que o WebForms exige.

## Construtor de plantel

Antes da 1ª ronda não há lesões para verificar — o teu plantel está vazio. O
que serve nessa altura é o problema oposto: gastar bem os 40M.

O separador **Construir** deixa-te fixar os jogadores que queres de certeza e
sugere os restantes. Escolher os melhores um a um não funciona: gasta tudo nos
primeiros e deixa-te sem dinheiro para completar as 23 vagas — no meu teste, a
estratégia gananciosa nem chegava a preencher o plantel. Está resolvido por
programação dinâmica exacta (os valores vêm em múltiplos de 50.000, o que dá
800 degraus de orçamento), e verifiquei contra força bruta numa instância
pequena: dá o mesmo resultado.

Corre no browser em cerca de 40 ms, por isso podes ir fixando e desfixando
jogadores e a sugestão refaz-se enquanto escreves. No Telegram é
`/montar` ou `/montar Trubin, Otávio`.

Duas ressalvas honestas: os pontos são os da época passada, não uma previsão,
e o optimizador gasta o orçamento todo por defeito — se quiseres guardar folga
para trocas futuras, fixa jogadores mais baratos.

**Não há limite de jogadores por clube.** A FAQ da Liga Record diz
expressamente que não existe essa limitação, ao contrário do Fantasy da Liga
Portugal. Tentei implementar o limite na primeira versão e produzia plantéis
impossíveis de completar, porque um filtro prévio não serve — obrigaria a uma
dimensão extra na DP. Se eu estiver enganado sobre a regra, diz e faço-o em
condições.

## Regra do jogo que eu tinha errada

A Liga Record dá **uma troca por ronda** — vendes um jogador, compras outro.
Não são as transferências múltiplas do Fantasy da Liga Portugal. Orçamento de
40M para 23 jogadores (3 GR, 8 DEF, 8 MED, 4 AVA), com seis trocas só na
reabertura de fevereiro.

O optimizador que eu tinha escrito procurava o melhor *conjunto* de trocas.
Isso não existe neste jogo e a sugestão seria inaplicável. Está reescrito:
ordena as trocas individuais possíveis, mostra a que mais rende, e diz-te
quem fica no plantel sem hipótese de troca — porque esses tens de tirar do
onze e cobrir com suplentes, que é uma decisão diferente.

## Sobre automatizar o login

A app tenta manter a sessão sozinha, por esta ordem: token em cache → token
guardado no Firestore → **refresh token** → login com credenciais → desiste e
avisa-te. O passo do refresh token é o que interessa: capturas uma vez, corres
`npm run registar-sessao <access> <refresh>`, e a partir daí renova-se sozinho
sem nunca mais precisar de browser nem de password.

O worker reutiliza os cookies guardados no Firestore enquanto servirem, e só
faz login novo quando a sessão morre. A password vive numa variável de ambiente
no Railway e nunca chega ao browser.

**O que continua fora de questão é automatizar o botão do Google.** Não é
preciso — eles têm login próprio — e se um dia deixar de haver, o Google deteta
browsers automatizados no fluxo OAuth e a resposta não é "falha o login": é
pedir verificação ou marcar a conta como comprometida. Não vale a pena arriscar
a conta que também é o teu email e o teu Firebase.

## Pôr a andar

**1. Firebase.** Cria o projeto. Ativa Authentication → Google. Cria o
Firestore em modo produção. Publica as `firestore.rules` deste repo.

**2. Web.** Copia `web/.env.example` para `web/.env.local` com os valores da
consola. `cd web && npm install && npm run dev`. Faz login uma vez — depois vai
a Authentication → Users e copia o teu **User UID**.

**3. Netlify.** Liga o repo. O `netlify.toml` já tem base e comando. Mete as
seis `VITE_FIREBASE_*` em Environment variables. Em Firebase → Authentication →
Settings → Authorized domains, acrescenta o domínio do Netlify, senão o popup
de login rebenta.

**4. Worker no Railway.** Root directory `worker`. Variáveis: `LR_TOKEN`,
`FIREBASE_SERVICE_ACCOUNT` (o JSON inteiro da conta de serviço), `UID_DONO`
(o do passo 2), e opcionalmente `TELEGRAM_TOKEN`.

**5. Telegram.** `/newbot` ao @BotFather, mete o token no Railway, manda
`/start` ao bot. Ele responde com o chat id — mete-o em `TELEGRAM_CHAT_ID`
e faz redeploy. Sem isso, qualquer pessoa que descubra o nome do bot vê o teu
plantel.

## Comandos do bot

`/boletim` quem não joga · `/actualizar` força recolha · `/saldo` saldo e valor

## O que ainda falta

Os URLs das páginas em `worker/src/config/endpoints.js` ainda são palpites: da
captura só sei o `gerir-equipas/default.aspx`, e os separadores Plantel e
Comprar Equipas têm caminhos que não vi. Corre `npm run descobrir` — faz login,
grava o HTML e imprime as tabelas de cada página. Cola-me o resumo e escrevo os
parsers com os selectores certos.

O mesmo para o Zerozero: `npm run inspect Benfica`.

## Decisões, e porquê

**Firestore em vez de JSON no repo.** Com login por utilizador já precisas de
uma base de dados para separar quem vê o quê, e o `onSnapshot` dá-te
actualização em tempo real de borla — o boletim muda no telemóvel sem refresh.

**Escrita só pela conta de serviço.** As regras têm `allow write: if false`
para todos. O browser nunca escreve. Se o token da Liga Record vazasse a
partir do cliente estava tudo perdido, por isso ele nunca lá chega.

**O bot só avisa quando muda alguma coisa.** Durante a semana compara com o
boletim anterior e só manda mensagem se alguém entrou ou saiu do boletim. Um
alerta diário a dizer o mesmo deixa de ser lido ao fim de duas semanas. Sábado
de manhã manda o resumo completo antes do fecho.

**Aborta em vez de escrever vazio.** Se o Zerozero mudar o HTML, o parser
devolve zero ausências — que na app parece "ninguém está lesionado". É a falha
mais perigosa aqui porque parece sucesso. O worker recusa gravar um boletim com
menos de 8 ausências, mantém o anterior, e manda-te o erro pelo Telegram.

## Custos, sem rodeios

Netlify e Firebase ficam dentro do plano gratuito à vontade nesta escala. O
**Railway já não tem tier gratuito permanente** — é crédito de teste e depois
o Hobby, cerca de 5 USD/mês. Se não quiseres pagar, o worker corre na mesma em
GitHub Actions com o mesmo código (só o `servidor.js` fica de fora) e o bot
passa a só enviar mensagens em vez de responder a comandos. Diz-me e mando essa
variante.

## Manutenção

Isto é scraping: parte. Início de época, confirmar os ids em
`config/equipas.js`. Quando o Zerozero mexer no layout, o bot avisa-te e usas
`npm run inspect`. Quando o `LR_TOKEN` expirar, dá 401 e renovas no Railway.

## Aviso

Os termos de serviço da Liga Record quase de certeza proíbem acesso
automatizado. Ferramenta pessoal. Não publiques nem partilhes o acesso.
