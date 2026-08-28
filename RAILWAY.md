# Pôr o bot a correr no Railway

Guia do princípio ao fim, assumindo que nunca usaste o Railway.

O worker é um programa que fica **sempre ligado**. Não é um site que responde
a pedidos: fica à espera das horas marcadas, recolhe os dados e manda-te
mensagem no Telegram. É por isso que precisa de um sítio como o Railway e não
serve o Netlify, que só serve ficheiros.

---

## O que isto custa, antes de começares

O Railway **não tem plano gratuito permanente**. Dá um crédito de teste e
depois é o plano Hobby, **cerca de 5 USD por mês**. Este worker consome muito
pouco — está parado quase o tempo todo — mas o plano é por serviço ligado,
não por uso.

Se não quiseres pagar, diz-me: o mesmo código corre em GitHub Actions de
graça. Perdes os comandos do bot (`/boletim`, `/montar`) porque não há nada a
escutar, mas as mensagens automáticas continuam a chegar.

---

## Antes de abrir o Railway

Três coisas têm de estar feitas, e a terceira é a mais esquecida.

**1. O código no GitHub**, no ramo `main`:

```cmd
cd C:\Projectos\LigaRecord-Helper
git add .
git commit -m "worker pronto para producao"
git push origin main
```

**2. A chave da conta de serviço do Firebase.** Consola Firebase →
Definições do projeto (roda dentada) → **Contas de serviço** → Gerar nova
chave privada. Descarrega um `.json`. Guarda-o **fora** da pasta do projeto.

**3. O plantel gravado em produção.** Este é o passo esquecido. O que
gravaste até agora está em `plantel/{uid}_dev`, e o Railway vai correr com
`AMBIENTE=prod`, que lê `plantel/{uid}` sem sufixo.

Tens duas opções: abrir a app no domínio de produção do Netlify e gravar o
plantel outra vez, ou copiar o documento na consola do Firestore. Se te
esqueceres, o worker avisa-te — diz-te em que ambiente encontrou o plantel e
onde estava à procura.

---

## Passo 1 — Criar a conta e o projeto

1. Vai a **railway.app** e entra com o GitHub. É mais simples do que criar
   conta à parte, porque vais precisar de dar acesso ao repositório na mesma.

2. **New Project** → **Deploy from GitHub repo**.

3. Se o repositório não aparecer, clica em **Configure GitHub App** e dá
   acesso ao `LigaRecord-Helper`. Podes dar acesso só a esse.

4. Escolhe o repositório. O Railway começa logo a tentar construir — **vai
   falhar**, e está certo. Ele ainda não sabe que o código está na pasta
   `worker`.

---

## Passo 2 — Dizer-lhe onde está o código

Isto é o que faz falhar a maioria das primeiras tentativas.

1. Clica no serviço que apareceu → separador **Settings**.

2. Procura **Source** → **Root Directory**. Escreve:

   ```
   worker
   ```

3. Ainda em Source, confirma que **Branch** é `main`.

4. O Railway lê o `worker/railway.json` do repositório, que já define o
   comando de arranque (`npm start`) e o healthcheck (`/saude`). Não precisas
   de configurar Build ou Start Command à mão.

Sem o Root Directory, ele tenta compilar a raiz do repositório, não encontra
`package.json` onde espera, e reinicia em ciclo.

---

## Passo 3 — As variáveis de ambiente

Separador **Variables** → **New Variable**. Ou **Raw Editor**, que deixa
colar tudo de uma vez no formato `NOME=valor`.

### As obrigatórias

| Variável | Valor | Onde arranjar |
|---|---|---|
| `AMBIENTE` | `prod` | Escreves tu. Decide onde o worker lê e escreve no Firestore. |
| `FIREBASE_SERVICE_ACCOUNT` | o JSON inteiro | O ficheiro do passo 2 dos pré-requisitos |
| `UID_DONO` | ex. `sWfo9WoCZ0N3Q63HbbACc1XkOrD2` | Firebase → Authentication → Users → **User UID** |

**O `FIREBASE_SERVICE_ACCOUNT` é o que costuma correr mal.** O ficheiro tem
quebras de linha e a chave privada tem `\n` lá dentro. Tem de ir tudo numa
linha só, sem aspas à volta.

No **PowerShell**, para o achatar e copiar:

```powershell
(Get-Content C:\caminho\para\chave.json -Raw) -replace "`r`n","" -replace "`n","" | Set-Clipboard
```

Depois colas no campo do valor. Se o worker arrancar e disser
`Unexpected token`, é porque puseste aspas à volta — tira-as.

### As do Telegram

| Variável | Valor |
|---|---|
| `TELEGRAM_TOKEN` | o token do BotFather |
| `TELEGRAM_CHAT_ID` | o teu chat id — **deixa vazio por agora** |

Como obter o token:

1. No Telegram, procura **@BotFather** e abre a conversa.
2. Manda `/newbot`.
3. Ele pede um nome (o que aparece na conversa, ex. `Liga Record`) e depois
   um username, que tem de acabar em `bot` (ex. `koresma_ligarecord_bot`).
4. Ele responde com um token do género
   `8123456789:AAF-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx`. É esse.

O `TELEGRAM_CHAT_ID` obtém-se a seguir, no passo 5.

### As opcionais

| Variável | Para quê |
|---|---|
| `LR_ID_TEAM` | `175907` — a tua equipa. Usado para ler a ronda e o contador do fecho. |
| `LR_JORNADA` | Forçar a jornada, se a leitura automática falhar |
| `ZZ_EDICAO` / `ZZ_FASE` | Edição e fase do zerozero. **Mudam todas as épocas.** |

---

## Passo 4 — Primeiro arranque

Depois de gravares as variáveis, o Railway faz redeploy sozinho. Vai ao
separador **Deployments** e abre os **logs** do mais recente.

O que deves ver:

```
Worker a escutar na porta 8080
Bot do Telegram ligado.
A ler a Liga Record...
  Plantel registado: 23/23 jogadores
```

Se disser `Sem plantel registado`, é o passo 3 dos pré-requisitos — o plantel
está em `_dev` e o worker está em `prod`.

---

## Passo 5 — Fechar o bot a ti

**Não saltes isto.** Sem `TELEGRAM_CHAT_ID`, qualquer pessoa que descubra o
username do bot vê o teu plantel e pode mandar comandos.

1. No Telegram, procura o teu bot pelo username e abre a conversa.
2. Manda `/start`.
3. Ele responde com o teu chat id, um número como `1234567890`.
4. Volta ao Railway → Variables → mete esse número em `TELEGRAM_CHAT_ID`.
5. O Railway faz redeploy sozinho.

A partir daqui, o bot responde só a ti.

---

## Passo 6 — Confirmar que está vivo

No Railway, separador **Settings** → **Networking** → **Generate Domain**.
Dá-te um endereço público. Abre-o com `/saude` no fim:

```
https://o-teu-servico.up.railway.app/saude
```

Deve responder algo assim:

```json
{
  "ultimaRecolha": "2026-08-28T07:00:12.000Z",
  "ultimoErro": null,
  "bot": true
}
```

`ultimoErro` a `null` é o que interessa. Se tiver texto, é a última coisa que
correu mal.

No Telegram, manda `/boletim` ao bot. Se responder com o estado da tua
equipa, está tudo ligado.

---

## O que vai acontecer a partir daqui

| Quando | O quê |
|---|---|
| Todos os dias 07:00 | Recolha leve: lesões e cartões. **Só te escreve se algo mudar contigo.** |
| Quarta 08:00 | Recolha completa: mercado, valores, classificação, jogos, golos. Silenciosa. |
| **Sexta 08:00** | **A mensagem.** Quem está de fora, quais são teus, e o aviso para actualizares. |

Horas de Lisboa — o `timezone` está definido no código, não depende do
servidor.

Comandos do bot: `/boletim` `/semana` `/lesoes` `/actualizar` `/montar`
`/saldo`.

---

## Quando falhar

| Sintoma | Causa |
|---|---|
| Reinicia em ciclo, log diz `package.json not found` | Root Directory não está em `worker` |
| `Falta FIREBASE_SERVICE_ACCOUNT` | Variável vazia ou mal colada |
| `Unexpected token ... in JSON` | Puseste aspas à volta do JSON, ou tem quebras de linha |
| `Falta UID_DONO` | Não preencheste o uid |
| `Sem plantel registado` | O plantel está em `_dev` e o worker corre em `prod` |
| O bot não responde | `TELEGRAM_TOKEN` errado, ou o serviço está parado |
| O bot responde a estranhos | Falta o `TELEGRAM_CHAT_ID` |
| `Jornada não determinada` | Define `LR_JORNADA` e diz-me, para eu corrigir a leitura |
| Deixou de haver dados a meio da época | `ZZ_EDICAO` e `ZZ_FASE` mudaram |

Os logs estão em **Deployments → o deploy activo → View Logs**. Ficam
guardados alguns dias.

---

## Manutenção

**Uma vez por época**, em julho ou agosto: abre
`zerozero.pt/competicao/liga-portuguesa`, tira os números novos da edição e
da fase do URL, e actualiza `ZZ_EDICAO` e `ZZ_FASE` no Railway.

**Quando mudares de equipa** na Liga Record: grava o plantel novo na app.

**Quando alguma fonte mudar de estrutura**, o worker manda-te o erro pelo
Telegram em vez de ficar calado. Manda-mo e corrijo.

---

## Se quiseres desligar

Settings → **Danger** → **Remove Service**. Os dados no Firestore ficam; só
pára a recolha automática. A app do Netlify continua a mostrar o último
boletim recolhido.
