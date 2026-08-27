# Deploy, passo a passo

Ordem que importa: **Firebase → local → Netlify → Railway**. Cada passo
depende do anterior. Se saltares o local, vais depurar em produção.

---

## 1. Repositório e ramos

```bash
cd boletim
git init
git add .
git commit -m "boletim da jornada: primeira versão"

git branch -M main
git branch dev
git branch test

# Cria o repo vazio no GitHub (sem README, sem .gitignore) e depois:
git remote add origin https://github.com/Koresma82/boletim-jornada.git
git push -u origin main
git push origin dev
git push origin test

git checkout dev
```

Trabalhas em `dev`. Quando estiver bom, `dev → test`. Quando o test estiver
estável, `test → main`.

---

## 2. Firebase

Um projeto só, os três ambientes separados por sufixo no documento.

1. **console.firebase.google.com** → Adicionar projeto → nome `boletim-jornada`.
   Podes desligar o Analytics, não é usado.

2. **Authentication** → Começar → **Google** → Ativar → escolhe o teu email
   como email de suporte → Guardar.

3. **Firestore Database** → Criar base de dados → **Modo de produção** →
   região `eur3 (europe-west)`.

4. **Regras** → cola o conteúdo de `firestore.rules` deste repo → Publicar.
   Sem isto, o modo de produção bloqueia tudo e a app fica em branco.

5. **Definições do projeto** (roda dentada) → desce até "As tuas apps" →
   ícone `</>` → nome `boletim-web` → **não** marques o Hosting → Registar.
   Copia o objeto `firebaseConfig` que aparece. São os seis valores que vais
   precisar já a seguir.

6. **Definições do projeto → Contas de serviço** → Gerar nova chave privada →
   descarrega o JSON. Guarda-o fora do repositório. É o que dá acesso total à
   base de dados; se vazar, quem o tiver escreve o que quiser.

---

## 3. Local — é aqui que se descobre o que está partido

### Web

```bash
cd web
npm install
cp .env.example .env.local
```

Preenche o `.env.local` com os seis valores do passo 2.5, e deixa
`VITE_AMBIENTE=dev`.

```bash
npm run dev
```

Abre `http://localhost:5173`, entra com o Google. Deves ver "Ainda não há
boletim" — está correto, o worker ainda não correu.

Vai a **Firebase → Authentication → Users**, copia o **User UID**.

### Worker

```bash
cd ../worker
npm install
cp .env.example .env
```

Preenche:

| Variável | Onde arranjar |
|---|---|
| `LR_EMAIL` | o teu email da Liga Record |
| `LR_PASSWORD` | a tua password |
| `LR_ID_TEAM` | `175907` — o número no URL do plantel |
| `AMBIENTE` | `dev` |
| `FIREBASE_SERVICE_ACCOUNT` | o JSON do passo 2.6, **inteiro, numa linha só** |
| `UID_DONO` | o UID que copiaste acima |

Para meter o JSON numa linha, no PowerShell:

```powershell
(Get-Content chave.json -Raw) -replace "`r`n","" | Set-Clipboard
```

Depois o primeiro teste a sério:

```bash
npm run descobrir
```

**É aqui que vais saber se isto funciona.** Espera ver a sessão a abrir e as
quatro posições a devolver jogadores. Se falhar, o erro diz-te onde.

Se correr bem:

```bash
npm run recolher
```

Volta ao browser: a app deve encher-se sozinha, sem refresh.

---

## 4. Netlify

1. **Add new site → Import an existing project → GitHub** → escolhe o repo.

2. Confirma que apanhou o `netlify.toml`: base `web`, comando
   `npm run build`, publish `web/dist`. Não mexas.

3. **Site configuration → Environment variables** → Add a variable →
   **Add multiple** e cola:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_SENDER_ID
VITE_FIREBASE_APP_ID
```

Os mesmos seis valores do `.env.local`. **Não metas `VITE_AMBIENTE`** —
esse vem do `netlify.toml` conforme o ramo.

4. **Site configuration → Build & deploy → Branches and deploy contexts** →
   Production branch `main`, e em "Branch deploys" escolhe **Let me add
   individual branches** → `dev` e `test`.

Ficas com três URLs:

| Ramo | URL | Lê o documento |
|---|---|---|
| main | `boletim-jornada.netlify.app` | `boletins/{uid}` |
| test | `test--boletim-jornada.netlify.app` | `boletins/{uid}_test` |
| dev | `dev--boletim-jornada.netlify.app` | `boletins/{uid}_dev` |

5. **Passo que toda a gente esquece:** Firebase → Authentication → Settings →
   **Authorized domains** → Add domain → acrescenta os três domínios acima.
   Sem isto o popup do Google rebenta em produção e funciona em localhost, o
   que é o pior tipo de bug.

---

## 5. Railway

1. **New Project → Deploy from GitHub repo** → o teu repo.

2. **Settings → Root Directory** → `worker`. Sem isto ele tenta compilar o
   projeto todo e falha.

3. **Settings → Source → Branch** → `main`.

4. **Variables** → as mesmas do `worker/.env`, com duas diferenças:
   `AMBIENTE=prod` e, se quiseres o bot, `TELEGRAM_TOKEN`.

5. O `railway.json` já define o healthcheck em `/saude`. Abre esse URL para
   ver se o worker está vivo e quando foi a última recolha.

### Telegram

1. Fala com o **@BotFather** no Telegram → `/newbot` → nome e username.
2. Copia o token → `TELEGRAM_TOKEN` no Railway.
3. Manda `/start` ao teu bot. Ele responde com o chat id.
4. Mete esse id em `TELEGRAM_CHAT_ID` e faz redeploy.

**Não saltes o passo 4.** Sem `TELEGRAM_CHAT_ID` o bot responde a qualquer
pessoa que descubra o username, e a primeira coisa que mostra é o teu plantel.

---

## Ciclo de trabalho

```bash
git checkout dev
# … mexes no código …
npm run dev            # web
npm run recolher       # worker, escreve em {uid}_dev

git add . && git commit -m "o que mudou" && git push

# quando estiver bom:
git checkout test && git merge dev && git push
git checkout main && git merge test && git push   # Railway faz redeploy
git checkout dev
```

O worker local escreve sempre em `_dev` desde que o `.env` diga
`AMBIENTE=dev`. É o que impede um teste às três da tarde de apagar o boletim
que tens aberto no telemóvel.

---

## Quando falhar

| Sintoma | Causa quase certa |
|---|---|
| App em branco, consola diz `permission-denied` | Regras do Firestore por publicar |
| Login funciona em localhost, rebenta no Netlify | Domínio em falta nos Authorized domains |
| `Falta FIREBASE_SERVICE_ACCOUNT` | JSON com quebras de linha; tem de ser uma linha |
| `Login recusado` | Email ou password errados no `.env` |
| `So li N jogadores` | A sessão caiu, ou o `playersearch.ashx` mudou |
| `So N ausencias em toda a liga` | Selectores do Zerozero desatualizados — `npm run inspect` |
| Railway a reiniciar em ciclo | Root Directory não está em `worker` |

---

## O que esperar da primeira tentativa

O login da Liga Record e o scraping do Zerozero **nunca correram contra os
sites reais**. Foram escritos a partir das tuas screenshots e testados contra
HTML que eu construí. O passo 3 é onde isso se vai ver.

O mais provável é o Zerozero falhar: os 18 ids são adivinhados e os selectores
também. Manda-me o erro e o `debug/` e corrijo. A parte da Liga Record tem
melhor prognóstico, porque vi a estrutura real.
