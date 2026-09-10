# Decisões, e porquê

O histórico do projecto. Nada aqui é preciso para o pôr a andar — é para
quando alguma coisa partir e a pergunta for "porque é que isto está assim".

## O login da Liga Record: desistimos, e está bem assim

O SSO do grupo Medialivre entrega a sessão aos sites por **iframe e
postMessage entre domínios**. Está escrito no `SSOSiteVariables.js` deles:
`SSORootIframe: "cofinasso-arbitration"`,
`ThirPartySetSSOTokenCookie: "cof_tp_ssotoken"`. Nenhum cliente HTTP
reproduz isso — exige JavaScript a correr e janelas a comunicar. O login em
si funciona (as cookies do SSO aparecem), mas a entrega ao liga.record.pt
nunca acontece.

Resolvia-se com um browser headless no Railway, mas seriam uns 400 MB de
imagem e mais uma peça a partir-se.

**E não é preciso.** A única coisa para que precisávamos do login era saber
quais são os teus 23 jogadores. Todo o resto — mercado, valores, pontos,
ronda, contador do fecho — vem do `playersearch.ashx` e das páginas públicas,
sem sessão nenhuma.

Como só tens uma troca por ronda, registar o plantel é um clique por semana.
O separador Construir tem um botão "Gravar como o meu plantel": marcas os 23,
gravas, e o worker passa a segui-los. Os valores e os pontos continuam a
actualizar-se sozinhos, porque são lidos do mercado a cada recolha.

A colecção `plantel` é a única que o browser pode escrever, e as regras
limitam-na à lista de ids e ao saldo, no documento do próprio.

Todo o código que tentava fazer login — `fontes/sessao.js`, `descobrir.js`,
`analisar-sso.js` e companhia — foi removido. Estava morto e a fazer parecer
que havia um caminho que não havia. Se um dia for preciso, está no histórico
do git.

## O login do Google: continua fora de questão

Não é preciso, e se um dia fosse: o Google deteta browsers automatizados no
fluxo OAuth e a resposta não é "falha o login", é pedir verificação ou marcar
a conta como comprometida. Não vale a pena arriscar a conta que também é o
teu email e o teu Firebase.

## O que a captura revelou

**Não há API JSON no site do jogo.** É ASP.NET WebForms — Microsoft-IIS,
`X-Aspnet-Version 4.0.30319`, páginas `.aspx`, e os únicos XHR no separador
Rede eram analytics. Tudo o que estava escrito à volta de `/api/players` foi
deitado fora.

**Mas há um endpoint de pesquisa**, que devolve JSON:

```
GET liga.record.pt/common/services/playersearch.ashx
      ?playerposition=GR|DF|MD|AV (ou vazio)
      &name=&club=<nome em minúsculas>
      &minval=500000&maxval=12000000
      &order_by=points&order_dir=desc
```

Com a posição vazia e o clube definido vem o plantel inteiro desse clube —
18 pedidos cobrem a liga toda. Valores em euros, `PercentTeams` com vírgula
decimal, posições `GR`/`DF`/`MD`/`AV`.

**`InTeam` não significa "está na minha equipa".** Vinha `true` para todos os
jogadores do Benfica com o plantel vazio.

## Fonte principal: a API oficial da Liga Portugal

```
GET ligaportugal.pt/api/v2/competition/top/players
      ?competition=ligaportugalbetclic&season=20262027&size=400&statId=NNN
```

| statId | Estatística |
|---|---|
| 142 | Golos |
| 3 | Assistências |
| 10139 | Cartões amarelos |
| 50 | Cartões vermelhos |

JSON, da fonte autoritativa, com o `playerId` a permitir cruzar amarelos com
vermelhos sem depender de nomes. Substituiu o raspar de HTML do maisfutebol e
do zerozero, que ficam como alternativas.

Duas coisas que só esta fonte dá: **assistências** e o **nome completo** a par
do curto, o que torna o emparelhamento com o plantel bastante mais fiável.

O `size` é o parâmetro a vigiar: a página do site pede 20. Nós pedimos 400,
porque um jogador com 4 amarelos pode estar em 60.º lugar e ser exactamente o
que interessa avisar.

## Lesões: Transfermarkt, não Zerozero

O Zerozero não serviu. As 18 páginas de equipa carregavam sem erro e
devolviam **zero ausências em todas** — aquelas páginas não listam lesionados
de todo. Toda essa abordagem foi construída em cima de um palpite que nunca
foi verificado.

```
https://www.transfermarkt.pt/liga-portugal/verletztespieler/wettbewerb/PO1
```

Uma tabela com a liga inteira: jogador, posição, clube, tipo de lesão, data
prevista de regresso e valor de mercado. Um pedido em vez de dezoito, e a
data de regresso é informação que o Zerozero nunca teve.

## Castigos: calculados, não copiados

A tabela de disciplina mostra **totais acumulados**, não quem está castigado.
Um jogador com 5 amarelos pode ter cumprido o castigo na jornada passada. Ler
`amarelos % 5 === 0` como "castigado" produz falsos positivos — e um falso
positivo faz-te gastar a única troca da ronda a tirar um jogador que podia
jogar.

Por isso o que interessa é quem **atravessou** um múltiplo de cinco desde a
última recolha, não quem lá está parado.

### Três correcções que este mecanismo precisou

**1. O castigo tem de sobreviver à recolha em que é detectado.**

A travessia só é visível na recolha imediatamente a seguir ao jogo. No dia
seguinte a contagem já é igual à anterior, a travessia deixa de existir, e o
jogador desaparecia do boletim. Na prática: 5.º amarelo ao domingo, detectado
na recolha de segunda, e na quarta já não aparecia — a mensagem de sexta, a
que precede o fecho do mercado, não o mostrava.

Agora cada castigo detectado fica guardado em `castigosActivos` com a
**jornada a que se aplica**, e sobrevive a todas as recolhas até essa jornada
ser jogada. Quando a próxima jornada por jogar passa a ser posterior, o
castigo sai sozinho. Está em `worker/src/castigos-activos.js`.

**2. A chave de comparação tem de ser normalizada.**

A comparação era por `${nome}|${equipa}` em bruto. Mas os cartões vêm de três
fontes em cascata e cada uma escreve os nomes à sua maneira — "Pavlidis" vs
"Vangelis Pavlidis", "Sp. Braga" vs "SC Braga". Bastava a fonte mudar entre
duas recolhas para nenhuma chave bater certo: tudo passava por "primeira
recolha", tudo saía com certeza baixa, e nada entrava nas ausências. A
cascata de fallback, que existe para dar robustez, desligava a detecção de
castigos em silêncio.

Agora a chave é o `playerId` quando a fonte o dá, e
`normalizar(nome)|equipaCanonica(equipa)` quando não dá.

**3. Contagens de fontes diferentes não se comparam.**

Mesmo com a chave certa, o número de amarelos que a API oficial reporta pode
não ser o que o zerozero reporta. Comparar 4 de uma com 5 de outra inventaria
uma travessia que não houve. Por isso o boletim guarda `fonteCartoes`, e
quando a fonte muda entre recolhas não se declara travessia nenhuma: marca-se
como certeza baixa, para confirmares à mão.

### Um castigo activo por jogador

O `emparelhar` liga o plantel às ausências por semelhança de nome, e duas
ausências com o mesmo nome na mesma equipa pontuam igual — a margem de
ambiguidade dispara e o jogador vai parar aos `ambiguos`, ou seja, desaparece
do boletim. Um jogador com 5 amarelos **e** um vermelho na mesma jornada
produzia isso. Por isso os castigos activos são deduplicados por jogador, e o
vermelho sobrepõe-se à acumulação.

### Vermelhos

Dão suspensão certa, mas a duração é decidida pelo Conselho de Disciplina e
não se calcula. A app mantém-nos activos uma jornada (o mínimo garantido) e
marca-os com "duração por decidir".

## A jornada, e o desalinhamento que deu bug

`jornadaPelaClassificacao` devolve `jogos disputados + 1` — ou seja, **a
jornada por jogar**. É também o que o selector do zerozero mostra e o que a
app põe no cabeçalho.

Mas metade do `recolher.js` tratava `jornada.numero` como a última jornada
**já disputada**. Os jogos eram pedidos para `numero + 1` e `numero + 2`, e o
próximo adversário procurado em `numero + 1`. Resultado visível: o cabeçalho
dizia "JORNADA 6" e o separador Campeonato mostrava os jogos da 7 e da 8,
saltando por completo a jornada que vinha a seguir. A classificação era
pedida à API com `round=6`, uma jornada que ainda não tinha sido jogada.

Agora há dois nomes e cada um diz o que é: `porJogar` e `disputada`.

## A Liga Record bloqueia servidores

Do Railway, a ligação a `liga.record.pt` morre sem sequer se estabelecer —
30 segundos sem resposta. Do mesmo contentor, a API da Liga Portugal responde
em 0,19s. Não é lentidão nem timeout: é bloqueio de IPs de datacenter.

| Dados | Onde |
|---|---|
| Jornadas, classificação, golos, assistências, cartões, lesões | **Railway**, todos os dias |
| Mercado: valores, pontuações | **A tua máquina**, `npm run mercado` |

Se a Liga Record não responder, o worker reaproveita o mercado da última
recolha que conseguiu e actualiza tudo o resto. O boletim guarda
`mercadoRecolhidoEm`, e tanto a app como a mensagem do Telegram dizem a idade
dos valores — um plantel avaliado com preços de há uma semana leva a decisões
erradas, e o pior seria não se saber que estão velhos.

## Aborta em vez de escrever vazio

Se uma fonte mudar o HTML, o parser devolve zero ausências — que na app
parece "ninguém está lesionado". É a falha mais perigosa aqui porque parece
sucesso. O worker recusa gravar um boletim com menos de 8 ausências em toda a
liga, mantém o anterior, e manda o erro pelo Telegram.

## Construtor de plantel

Antes da 1.ª ronda não há lesões para verificar — o problema é o oposto:
gastar bem os 40M. Escolher os melhores um a um não funciona: gasta tudo nos
primeiros e deixa-te sem dinheiro para completar as 23 vagas. No teste, a
estratégia gananciosa nem chegava a preencher o plantel (8 de 23).

Está resolvido por programação dinâmica exacta — os valores vêm em múltiplos
de 50.000, o que dá 800 degraus de orçamento — e verificado contra força
bruta numa instância pequena: dá o mesmo resultado. Corre no browser em cerca
de 40 ms.

Duas ressalvas honestas: os pontos são os da época passada, não uma previsão,
e o optimizador gasta o orçamento todo por defeito — se quiseres guardar
folga para trocas futuras, fixa jogadores mais baratos.

## Análise da jornada: heurísticas, não previsões

| Bloco | Porquê |
|---|---|
| Jogos difíceis | Jogadores teus contra Benfica, Sporting, FC Porto ou Sp. Braga |
| Sem jogo | Somam zero garantido — o erro mais caro e mais fácil de evitar |
| Jogos favoráveis | Adversário com ataque fraco (para GR/DEF) ou defesa fraca (para MED/AVA) |
| Casa / fora | Contagem simples |

Tudo sai de dados que o boletim já tem: zero pedidos novos.

Os quatro grandes são identificados por palavra distintiva — "benfica",
"sporting", "porto", "braga" — e não pelo nome completo, porque cada fonte
escreve o prefixo à sua maneira.

"Joga contra o Benfica" reduz a probabilidade de pontos ofensivos, não a
elimina — e um jogador do Benfica contra o último classificado é o caso
espelhado, que o código também apanha. Os "jogos favoráveis" usam golos por
jogo, e com poucas jornadas disputadas é amostra pequena: uma goleada
distorce a média. A partir da jornada 10 vale bastante mais.

## Firestore em vez de JSON no repo

Com login por utilizador já precisas de uma base de dados para separar quem vê
o quê, e o `onSnapshot` dá actualização em tempo real de borla — o boletim
muda no telemóvel sem refresh.

**Escrita quase só pela conta de serviço.** As regras têm `allow write: if
false` para tudo excepto a colecção `plantel`, e essa aceita apenas a lista de
ids e o saldo, no documento do próprio.

## O login Google da app: o que faz e o que não faz

**Faz:** fecha a app a ti. Sem sessão Firebase não se vê nada, e as regras do
Firestore só deixam ler o documento do teu próprio uid.

**Não faz:** dar acesso à Liga Record. Mesmo sendo a mesma conta Google. O
Firebase emite um token do Firebase, para o teu projeto; a Liga Record emite
um token dela, no domínio dela. Nenhum dos dois serve para o outro.

## Verificação por IA: artigos de outra época passam por perfeitos

Aconteceu em produção. O modelo devolveu o Zaidu como lesionado, citando um
artigo do Soccerway com o título "Ausências da 6.ª jornada da Liga
Portugal" — jogador certo, lesão certa, título perfeito. O artigo era de
19.09.2024, duas épocas antes da actual.

Sites de futebol republicam este tipo de peça todas as épocas com o mesmo
título genérico. Uma pesquisa por "ausências jornada 6 liga portugal" sem
mais contexto apanha qualquer uma delas, e o título sozinho não distingue.

A correcção tem duas camadas, porque confiar só no modelo já falhou uma vez:

1. **Ao modelo** passamos agora a data de hoje e a época actual (a mesma
   `LP_EPOCA` que o resto do worker usa), com instrução explícita para
   confirmar a data do artigo antes de o usar, e para reportá-la no campo
   `dataNoticia`.
2. **No código**, `dataEProvavelmenteActual` em `duvidas-ia.js` rejeita
   mecanicamente qualquer achado datado de fora de uma janela generosa (-2
   a +45 dias). Deliberadamente larga: o objectivo é apanhar o erro óbvio
   de época trocada, não filtrar ao milímetro. Uma data que o modelo não
   conseguiu determinar não é penalizada — não sabe, não filtra.

A data, quando existe, aparece agora na mensagem do Telegram a par do
motivo — para poderes desconfiar tu também, sem teres de abrir a fonte.

Ligado a isto: uma pesquisa genérica da jornada tende a só apanhar os
clubes grandes. O Liziero (Nacional) estava lesionado e não foi apanhado
por essa via. O prompt passou a pedir explicitamente uma pesquisa pelo
nome de cada jogador, não só pela ronda em bloco, e o limite de idas e
vindas à pesquisa subiu de 5 para 8 — verificar 23 jogadores um a um
precisa de mais tentativas do que uma pergunta agregada.

## Jogos da jornada: o boletim anterior não chegava

Aconteceu em produção. A jornada 6 tinha um jogo marcado (FC Porto - Casa
Pia), mas nessa recolha a fonte não devolveu nenhum jogo para ela — só para
a jornada 7, pedida no mesmo pedido. O `adversarios` ficou vazio, e os 23
jogadores do plantel apareceram todos como "sem jogo esta jornada, tira-os
do onze". Um conselho activamente errado, não só uma lacuna.

Duas causas, corrigidas as duas:

**Não havia guarda nenhuma.** Ao contrário das lesões (`MINIMO_PLAUSIVEL`)
e do mercado (reaproveita o anterior se a Liga Record não responder), uma
lista de jogos vazia era aceite calada.

**O único sítio de reserva era o boletim anterior**, que é uma fotografia
de uma recolha só. Se a jornada faltar duas recolhas seguidas, a segunda já
não tem onde a ir buscar — o "anterior" que ela vê já é o da recolha em que
também faltou.

A correcção tem três níveis, do mais barato ao mais duradouro:

1. Se a recolha trouxe menos de 4 jogos para a jornada por jogar (uma
   jornada tem 9), não confia.
2. Tenta o boletim anterior — só se era sobre a mesma jornada.
3. Tenta a colecção `jogosPorJornada` no Firestore, escrita sempre que uma
   recolha traz jogos bons e nunca apagada por uma que traga poucos. É a
   diferença entre "a última fotografia" e "o que já soubemos alguma vez" —
   sobrevive a quantas recolhas falhadas seguidas for preciso.

Se nem isso houver, o boletim leva um sinalizador (`jogosIndisponiveis`) e
a mensagem diz *"Não consegui confirmar os jogos desta jornada"* em vez de
concluir "sem jogo" a partir de um buraco de dados.

Um cuidado à parte: quando só a jornada por jogar falha mas a seguinte vem
bem no mesmo pedido (foi o caso real), o fallback da primeira não pode
apagar a segunda. `unirJogos()` em `jogos-fallback.js` junta as duas sem
duplicar — antes disso, o código guardava sempre a lista inteira OU o
fallback, nunca os dois juntos, e uma jornada boa perdia-se por causa da
outra que falhou.

A colecção `jogosPorJornada` não tem regra própria no `firestore.rules` —
não precisa. É lida e escrita só pela conta de serviço do worker, que
ignora as regras; o "nada mais é acessível" do fim do ficheiro já a fecha
ao browser, tal como fecha `segredos`.

## Custos, sem rodeios

Netlify e Firebase ficam dentro do plano gratuito à vontade nesta escala. O
**Railway já não tem tier gratuito permanente** — é crédito de teste e depois
o Hobby, cerca de 5 USD/mês. Se não quiseres pagar, o worker corre na mesma em
GitHub Actions com o mesmo código (só o `servidor.js` fica de fora) e o bot
passa a só enviar mensagens em vez de responder a comandos.
