# Deploy, passo a passo (Windows)

Os comandos são para **CMD**. Onde o PowerShell for diferente, está indicado.

Ordem que importa: **Firebase → local → Netlify → Railway**. Cada passo
depende do anterior. Se saltares o local, vais depurar em produção.

---

## Nota rápida sobre o `npm install`

O aviso de `12 vulnerabilities (10 moderate, 2 high)` é normal e vem das
dependências de desenvolvimento do Vite. Nada disso vai para o bundle que
serves no browser.

**Não corras `npm audit fix --force`.** Ele faz downgrade do Vite para uma
versão incompatível e parte o build. O `npm audit fix` sozinho (sem `--force`)
é seguro, mas provavelmente não resolve nada.

---

## 1. Repositório e ramos

```cmd
cd C:\Projectos\LigaRecord-Helper
git init
git add .
git commit -m "primeira versao"

git branch -M main
git branch dev
git branch test

git remote add origin https://github.com/Koresma82/LigaRecord-Helper.git
git push -u origin main
git push origin dev
git push origin test

git checkout dev
```

Cria o repo no GitHub **vazio** — sem README, sem .gitignore, sem licença. Se
ele criar um commit inicial, o push é rejeitado e tens de fazer
`git pull --rebase origin main` primeiro.

Trabalhas em `dev`. Quando estiver bom, `dev → test`. Quando o test estiver
estável, `test → main`.

---

## 2. Firebase

Um projeto só. Os três ambientes ficam separados por sufixo no documento.

1. **console.firebase.google.com** → Adicionar projeto → `ligarecord-helper`.
   Podes desligar o Analytics, não é usado.

2. **Authentication** → Começar → **Google** → Ativar → escolhe o teu email
   como email de suporte → Guardar.

3. **Firestore Database** → Criar base de dados → **Modo de produção** →
   região `eur3 (europe-west)`.

4. **Regras** → cola o conteúdo de `firestore.rules` deste repo → Publicar.
   Sem isto, o modo de produção bloqueia tudo e a app fica em branco.

5. **Definições do projeto** (roda dentada) → "As tuas apps" → ícone `</>` →
   nome `ligarecord-helper-web` → **não** marques o Hosting → Registar.
   Copia o objeto `firebaseConfig`. São os seis valores do passo seguinte.

6. **Definições do projeto → Contas de serviço** → Gerar nova chave privada →
   descarrega o JSON. Guarda-o **fora** de `C:\Projectos\LigaRecord-Helper`.
   É acesso total à base de dados.

---

## 3. Local — é aqui que se descobre o que está partido

### Web

```cmd
cd C:\Projectos\LigaRecord-Helper\web
npm install
copy .env.example .env.local
notepad .env.local
```

PowerShell: `Copy-Item .env.example .env.local`

Preenche com os seis valores do passo 2.5 e deixa `VITE_AMBIENTE=dev`.

```cmd
npm run dev
```

Abre `http://localhost:5173` e entra com o Google. Deves ver "Ainda não há
boletim" — está correto, o worker ainda não correu.

Vai a **Firebase → Authentication → Users** e copia o **User UID**.

### Worker

Numa **segunda janela** de terminal (deixa o `npm run dev` a correr):

```cmd
cd C:\Projectos\LigaRecord-Helper\worker
npm install
copy .env.example .env
notepad .env
```

Preenche:

| Variável | Onde arranjar |
|---|---|
| `LR_ID_TEAM` | `175907` |
| `AMBIENTE` | `dev` |
| `FIREBASE_SERVICE_ACCOUNT` | o JSON do passo 2.6, **inteiro, numa linha só** |
| `UID_DONO` | o UID que copiaste acima |

Para achatar o JSON numa linha, no **PowerShell**:

```powershell
(Get-Content C:\caminho\para\chave.json -Raw) -replace "`r`n","" -replace "`n","" | Set-Clipboard
```

Colas no `.env` a seguir a `FIREBASE_SERVICE_ACCOUNT=`, **sem aspas à volta**.

Primeiro, uma verificação rápida que não precisa de credenciais nenhumas:

```cmd
npm run verificar
```

Confirma que todos os módulos carregam e exportam o que os outros esperam.
São dois segundos e evita descobrir um import partido a meio do login.

Agora o teste a sério:

```cmd
npm run descobrir login
```

Só encontra e analisa o formulário — não autentica. Se ele avisar que há
reCAPTCHA, corre isto antes de mais nada:

```cmd
npm run analisar-login
```

Lê o `debug/login.html` já gravado, sem tocar no servidor deles, e diz-te se
o reCAPTCHA está dentro do formulário de login ou no de registo de conta
nova. São coisas muito diferentes: no registo, não nos afecta.

Se estiver limpo:

```cmd
npm run descobrir
```

Se ele autenticar no SSO mas não conseguir a sessão do site, corre:

```cmd
npm run analisar-resposta
```

Lê o `debug/login-resposta.txt` e imprime a estrutura da resposta com os
valores mascarados — comprimento e formato, nunca o conteúdo. Esse output
podes colar à vontade.

**Se o login falhar, não insistas.** O worker pára sozinho ao fim de três
tentativas seguidas para não arriscar bloquear a conta, mas se andares a
correr o comando à mão o contador reinicia a cada arranque. Confirma o email
e a password antes de tentar outra vez.

**É aqui que vais saber se isto funciona.** Espera ver a sessão a abrir e as
quatro posições a devolver jogadores.

Se correr bem:

```cmd
npm run recolher
```

Volta ao browser: a app enche-se sozinha, sem refresh.

---

## 4. Netlify

1. **Add new site → Import an existing project → GitHub** →
   `LigaRecord-Helper`.

2. Confirma que apanhou o `netlify.toml`: base `web`, comando
   `npm run build`, publish `dist`. Não mexas.

   O `publish` é relativo à base. Se lá estiver `web/dist`, o Netlify vai
   procurar `web/web/dist` e falha com "deploy directory does not exist".

3. **Site configuration → Environment variables** → Add a variable →
   **Add multiple** e cola os seis:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_SENDER_ID
VITE_FIREBASE_APP_ID
```

**Não metas `VITE_AMBIENTE`** — esse vem do `netlify.toml` conforme o ramo, e
se o puseres aqui sobrepõe-se aos três contextos.

**Não marques nenhuma destas como "secret".** São valores públicos: o Vite
escreve-os dentro do JavaScript que serves ao browser, logo qualquer pessoa
os consegue ler no DevTools. Marcá-las como secretas só faz o build chumbar.
O que impede outra pessoa de ler os teus dados são as `firestore.rules`.

Se ainda assim o build chumbar com *"Exposed secrets detected"* e uma chave
`AIza…`, é o secret scanning a apanhar a chave do Firebase no bundle. O
`netlify.toml` já traz as duas variáveis que o desligam para este site
(`SECRETS_SCAN_OMIT_KEYS` e `SECRETS_SCAN_SMART_DETECTION_ENABLED`) — basta
fazer o push e voltar a correr o deploy.

4. **Build & deploy → Branches and deploy contexts** → Production branch
   `main`, e em "Branch deploys" escolhe **Let me add individual branches** →
   `dev` e `test`.

Ficas com:

| Ramo | URL | Lê o documento |
|---|---|---|
| main | `ligarecord-helper.netlify.app` | `boletins/{uid}` |
| test | `test--ligarecord-helper.netlify.app` | `boletins/{uid}_test` |
| dev | `dev--ligarecord-helper.netlify.app` | `boletins/{uid}_dev` |

5. **Passo que toda a gente esquece:** Firebase → Authentication → Settings →
   **Authorized domains** → acrescenta os três domínios acima. Sem isto o
   popup do Google funciona em localhost e rebenta em produção.

---

## 5. Railway

1. **New Project → Deploy from GitHub repo** → `LigaRecord-Helper`.

2. **Settings → Root Directory** → `worker`. Sem isto tenta compilar o repo
   todo e falha.

3. **Settings → Source → Branch** → `main`.

4. **Variables** → as mesmas do `worker/.env`, com duas diferenças:
   `AMBIENTE=prod` e, se quiseres o bot, `TELEGRAM_TOKEN`.

5. O `railway.json` já define o healthcheck em `/saude`. Abre esse URL para
   ver se o worker está vivo e quando foi a última recolha.

### Telegram

1. **@BotFather** no Telegram → `/newbot` → nome e username.
2. Token → `TELEGRAM_TOKEN` no Railway.
3. Manda `/start` ao teu bot. Ele responde com o chat id.
4. Mete esse id em `TELEGRAM_CHAT_ID` e faz redeploy.

**Não saltes o passo 4.** Sem `TELEGRAM_CHAT_ID` o bot responde a qualquer
pessoa que descubra o username, e a primeira coisa que mostra é o teu plantel.

---

## Ciclo de trabalho

```cmd
git checkout dev
:: … mexes no codigo …
cd web
npm run dev

:: noutra janela
cd worker
npm run recolher

git add . && git commit -m "o que mudou" && git push

:: quando estiver bom:
git checkout test && git merge dev && git push
git checkout main && git merge test && git push
git checkout dev
```

O push para `main` faz o Railway e o Netlify redeployarem sozinhos.

O worker local escreve sempre em `_dev` desde que o `.env` diga
`AMBIENTE=dev`. É o que impede um teste à tarde de apagar o boletim que tens
aberto no telemóvel.

---

## Quando falhar

| Sintoma | Causa quase certa |
|---|---|
| `'cp' is not recognized` | Estás em CMD — usa `copy` |
| `'rm' is not recognized` | CMD outra vez — `del` para ficheiros, `rmdir /s` para pastas |
| App em branco, consola diz `permission-denied` | Regras do Firestore por publicar |
| Login funciona em localhost, rebenta no Netlify | Domínio em falta nos Authorized domains |
| Build chumba com `Exposed secrets detected` / `AIza***` | Secret scanning a ver a chave pública do Firebase no bundle — o `netlify.toml` já a isenta |
| `Deploy directory does not exist` | `publish` no `netlify.toml` com o prefixo `web/` a mais |
| `Falta FIREBASE_SERVICE_ACCOUNT` | JSON com quebras de linha; tem de ser uma linha |
| `Unexpected token` ao ler o JSON | Puseste aspas à volta do valor no `.env` — tira-as |
| `Sem plantel registado` | Abre a app → Construir → Gravar como o meu plantel |
| `permission-denied` ao gravar plantel | Regras do Firestore desactualizadas — republica-as |
| `So li N jogadores` | A sessão caiu, ou o `playersearch.ashx` mudou |
| `A pagina diz que tens plantel, mas...` | Parser do plantel desactualizado — `npm run inspect-plantel` |
| `So N ausencias em toda a liga` | Selectores do Zerozero desatualizados — `npm run inspect` |
| Railway a reiniciar em ciclo | Root Directory não está em `worker` |
| `does not provide an export named` | Corre `npm run verificar` — diz-te qual é |
| `EPERM` ou `EBUSY` no npm install | Antivírus ou OneDrive a segurar ficheiros |
| Um comando sai sem imprimir nada | Guarda de entrypoint incompatível com Windows — `npm run verificar` deteta |

**Se o projeto estiver dentro do OneDrive**, tira-o de lá. A sincronização
bloqueia ficheiros do `node_modules` a meio do `npm install` e dá erros que
parecem bugs do código e não são. `C:\Projectos\` está bem.

---

## O que esperar da primeira tentativa

O login da Liga Record e o scraping do Zerozero **nunca correram contra os
sites reais**. Foram escritos a partir das tuas screenshots e testados contra
HTML que eu construí. O passo 3 é onde isso se vai ver.

O mais provável é o Zerozero falhar: os 18 ids são adivinhados e os selectores
também. Manda-me o erro e o conteúdo de `worker\debug\` e corrijo. A parte da
Liga Record tem melhor prognóstico, porque vi a estrutura real.
