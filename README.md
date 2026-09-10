# LigaRecord Helper

Abres a app antes do fecho do mercado e vês quais dos **teus** jogadores não
jogam esta jornada e por quem os podes trocar sem estourar o saldo. O bot do
Telegram avisa-te sozinho quando alguém cai.

O histórico das decisões — porque é que as fontes são estas, o que foi
tentado e falhou — está em [DECISOES.md](DECISOES.md). Este ficheiro é só
como pôr a andar e como usar.

## Arquitetura

```
Railway (worker)                    Firebase                Netlify (PWA)
┌──────────────────────┐          ┌───────────┐          ┌──────────────┐
│ cron diário + 3ª/4ª  │          │ Firestore │◀─ lê ────│ React + Auth │
│  ├ Liga Portugal API │  escreve │ boletins/ │          │  login Google│
│  ├ Transfermarkt     │ ────────▶│   {uid}   │          └──────────────┘
│  ├ emparelha + sugere│          │ plantel/  │◀─ escreve ──────┘
│  └ bot Telegram      │          └───────────┘
└──────────────────────┘

A tua máquina ──▶ Liga Record (mercado, valores) ──▶ mesmo Firestore
```

O mercado da Liga Record é recolhido **da tua máquina**, não do Railway: a
Liga Record bloqueia IPs de datacenter. Tudo o resto corre no Railway.

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

**4. Worker no Railway.** Root directory `worker`. Variáveis obrigatórias:
`FIREBASE_SERVICE_ACCOUNT` (o JSON inteiro da conta de serviço), `UID_DONO`
(o do passo 2) e `AMBIENTE=prod`. Opcionalmente `TELEGRAM_TOKEN` e
`TELEGRAM_CHAT_ID`. A lista completa e comentada está em
`worker/.env.example`.

**5. Telegram.** `/newbot` ao @BotFather, mete o token no Railway, manda
`/start` ao bot. Ele responde com o chat id — mete-o em `TELEGRAM_CHAT_ID`
e faz redeploy. Sem isso, qualquer pessoa que descubra o nome do bot vê o teu
plantel.

**6. Registar o plantel.** Abre a app, separador **Construir**, marca os teus
23 jogadores e carrega em "Gravar como o meu plantel". Sem isto não há lesões
a verificar — o worker não consegue ler o plantel do site (ver DECISOES.md).

**7. Mercado.** Na tua máquina, com `AMBIENTE=prod` no `worker/.env`:

```cmd
cd worker
npm run mercado
```

Escreve no mesmo Firestore que o Railway lê. Os valores da Liga Record mudam
à quarta, no máximo — uma vez por semana chega.

## Comandos do bot

`/boletim` estado actual · `/semana` recolhe e manda o resumo ·
`/lesoes` lesionados da liga · `/actualizar` recolha completa ·
`/montar` sugere plantel · `/saldo` saldo e valor da equipa

## O calendário

| Quando | O quê |
|---|---|
| Todos os dias 07:00 | Recolha **leve**: só lesões e cartões. Silenciosa, salvo se alguém do teu plantel mudar de estado. |
| Quarta 08:00 | Recolha **completa**: mercado, valores, classificação, jogos, golos. |
| Quarta 08:30 | Análise da jornada, depois da recolha completa. |
| Quinta 08:00 | Análise, já com o mapa de castigos. |
| **Sexta 08:00** | **A última antes do fecho**, e a única com a análise de notícias por IA. |

A chamada paga à IA corre **só à sexta**. Correr três vezes por semana
triplicava o custo para acrescentar pouco: as notícias de quarta ainda são as
de terça.

**Uma nota estratégica que não é sobre código.** Só tens uma troca por ronda,
e as notícias de última hora saem nas conferências de sexta e sábado. Editares
à quinta significa gastar a troca antes de saberes tudo. É uma escolha tua
entre decidir cedo e decidir informado — a app apoia as duas.

## As duas jornadas

Isto está escrito aqui porque já deu um bug e vai voltar a confundir:

- **`jornada.numero` é sempre a jornada POR JOGAR.** É o que o cabeçalho da
  app mostra e o que o bot diz.
- A **classificação** é pedida à API para `numero - 1`, a última já disputada.
- Os **jogos** são pedidos para `numero` e `numero + 1`.

Se o cabeçalho disser "Jornada 6" e o separador Campeonato mostrar a 7 como
"Esta jornada", é este alinhamento que partiu.

## Testes

```cmd
cd worker
npm run teste
```

Corre a verificação de módulos, os testes de castigos e os do optimizador de
plantel. Os testes de castigos reproduzem bugs que existiram — se algum
falhar, o bug voltou.

## Regras do jogo

Orçamento de 40M para 23 jogadores (3 GR, 8 DEF, 8 MED, 4 AVA). **Uma troca
por ronda** — vendes um jogador, compras outro. Seis trocas só na reabertura
de fevereiro. Não há limite de jogadores por clube (a FAQ da Liga Record
di-lo expressamente, ao contrário do Fantasy da Liga Portugal).

Castigos: uma série de cinco amarelos dá um jogo de suspensão (artigo 164.º
do regulamento disciplinar da Liga). Amarelos da Taça, Supertaça e Taça da
Liga não contam, e a contagem não transita de época.

## Manutenção

Isto é scraping: parte. Início de época, confirmar os ids em
`worker/src/config/equipas.js` e a `LP_EPOCA` no `.env`. Quando uma fonte
mexer no layout, o bot avisa-te e usas o `npm run inspect-*` correspondente:

| Comando | Fonte |
|---|---|
| `npm run inspect-lp` | API da Liga Portugal (golos, cartões) |
| `npm run inspect-lp-tabela` | API da Liga Portugal (classificação) |
| `npm run inspect-tm` | Transfermarkt (lesões) |
| `npm run inspect-maisfutebol` | Maisfutebol (disciplina, alternativa) |
| `npm run inspect-zerozero` | Zerozero (alternativa) |
| `npm run inspect-jornada` | Detecção do número da jornada |
| `npm run inspect` | Endpoint de pesquisa da Liga Record |

## Aviso

Os termos de serviço da Liga Record quase de certeza proíbem acesso
automatizado. Ferramenta pessoal. Não publiques nem partilhes o acesso.
