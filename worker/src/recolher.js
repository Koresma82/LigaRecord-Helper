import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import * as lr from './fontes/ligarecord.js';
import { lesoesDaLiga } from './fontes/transfermarkt.js';
import { castigosPorAcumulacao } from './fontes/disciplina.js';
import { actualizarCastigosActivos } from './castigos-activos.js';
import { duvidasDaJornada } from './fontes/duvidas-ia.js';
import {
  disciplinaDaLiga as disciplinaMaisFutebol,
  marcadoresDaLiga as marcadoresMaisFutebol,
  classificacaoDaLiga as classificacaoMaisFutebol,
  jogosDeVariasJornadas as jogosMaisFutebol,
} from './fontes/maisfutebol.js';
import {
  marcadoresDaLiga as marcadoresZeroZero,
  disciplinaDaLiga as disciplinaZeroZero,
  jogosDeVariasJornadas,
  classificacaoDaLiga,
} from './fontes/zerozero.js';
// A API oficial da Liga Portugal e a primeira escolha: e JSON, e da fonte
// autoritativa, e traz assistencias que nenhuma das outras dava.
import {
  disciplinaDaLiga as disciplinaOficial,
  marcadoresDaLiga as marcadoresOficial,
  classificacaoDaLiga as classificacaoOficial,
  jogosDeVariasJornadas as jogosOficial,
} from './fontes/ligaportugal.js';
import { lerPlantelGuardado, montarEquipa } from './fontes/plantel-manual.js';
import { jornadaActual } from './fontes/jornada.js';
import { emparelhar } from './emparelhar.js';
import { normalizar, equipaCanonica } from './normalizar.js';
import { criarIndice, procurar } from './emparelhar-jogador.js';
import { sugerirSubstituicoes } from './sugerir.js';
import { guardarBoletim, lerBoletim } from './firestore.js';
import { montarPlantel } from './partilhado/montar-plantel.js';

// Menos ausencias do que isto em toda a liga significa quase de certeza
// que o scraping partiu, nao que a liga esta saudavel.
const MINIMO_PLAUSIVEL = 8;

// A consulta a IA custa dinheiro e as noticias de uma jornada nao mudam de
// hora a hora. Uma vez por jornada chega; nos outros dias reaproveita-se o
// resultado que ja esta no boletim.
async function duvidasSeNecessario(plantel, jornada, anterior, { log = () => {}, forcar = false } = {}) {
  const guardadas = anterior?.duvidasIA ?? null;

  // A consulta so acontece na mensagem de sexta, que e quando serve para
  // alguma coisa — e o momento em que vais mesmo mexer na equipa. Nos
  // outros dias reaproveita-se o que ja esta guardado, para a conta da API
  // ser exactamente uma chamada por semana.
  if (!forcar) return guardadas;

  try {
    return (await duvidasDaJornada(plantel, jornada, { log })) ?? guardadas;
  } catch (erro) {
    // Isto e um extra. Se falhar, a recolha continua — nunca vale a pena
    // perder as lesoes por causa de uma consulta opcional.
    log(`  Duvidas IA: falhou — ${erro.message.split('\n')[0]}`);
    return guardadas;
  }
}

// O zerozero devolve 403 a IPs de datacenter, mas continua a responder bem
// do teu portatil e tem a tabela mais completa (separa duplo amarelo de
// vermelho directo). Por isso tenta-se primeiro, e so se cair e que entra o
// maisfutebol — que responde de qualquer lado mas traz menos detalhe.
// Tenta a fonte principal e, se cair, a alternativa. Devolve [] se ambas
// falharem — uma seccao em falta nao pode deitar abaixo a recolha toda.
// Uma lista vazia conta como falha. Os leitores do zerozero apanham o 403
// por dentro e devolvem [] em vez de rebentar, portanto so trocar de fonte
// quando ha excepcao deixava a alternativa por usar: em producao o log saia
// cheio de 403 e sem uma unica linha do maisfutebol.
async function comAlternativa(nome, principal, alternativa, { log = () => {} } = {}) {
  // Em local o zerozero responde, portanto a alternativa nunca era exercitada
  // — testava-se um caminho e punha-se outro em producao. FORCAR_ALTERNATIVA=1
  // salta a fonte principal para se poder testar em dev aquilo que o Railway
  // vai mesmo correr.
  if (process.env.FORCAR_ALTERNATIVA === '1') {
    log(`  ${nome}: a saltar o zerozero (FORCAR_ALTERNATIVA=1)`);
    return alternativa();
  }

  try {
    const r = await principal();
    if (Array.isArray(r) && r.length === 0) {
      log(`  ${nome} (zerozero): nada devolvido — a tentar o maisfutebol`);
    } else {
      return r;
    }
  } catch (erro) {
    log(`  ${nome} (zerozero): ${erro.message.split('\n')[0]}`);
  }

  try {
    return await alternativa();
  } catch (erro) {
    log(`  ${nome} (maisfutebol): ${erro.message.split('\n')[0]}`);
    return [];
  }
}

// Tres fontes por ordem de preferencia. A oficial e JSON e cruza amarelos
// com vermelhos por id, sem depender de nomes.
//
// DEVOLVE O NOME DA FONTE, e isso e essencial e nao cosmetico: a deteccao de
// castigos compara contagens entre recolhas, e contagens de fontes
// diferentes nao se comparam. Sem saber de onde vieram os numeros, uma
// mudanca de fonte inventava travessias de multiplos de 5 que nunca houve.
//
// (Antes o campo `fonte` estava fixo em 'zerozero' mesmo quando os dados
// vinham da API oficial. O boletim mentia sobre a proveniencia.)
const FONTES_DISCIPLINA = [
  { nome: 'ligaportugal', ler: (o) => disciplinaOficial(o) },
  { nome: 'zerozero', ler: (o) => disciplinaZeroZero(o) },
  { nome: 'maisfutebol', ler: (o) => disciplinaMaisFutebol(o) },
];

async function lerDisciplina({ log = () => {} } = {}) {
  // Igual ao comAlternativa: FORCAR_ALTERNATIVA=1 salta a fonte principal
  // para se poder exercitar em dev o caminho que o Railway vai correr.
  const fontes =
    process.env.FORCAR_ALTERNATIVA === '1' ? FONTES_DISCIPLINA.slice(1) : FONTES_DISCIPLINA;

  for (const { nome, ler } of fontes) {
    try {
      const linhas = await ler({ log });
      // Uma lista vazia conta como falha, nao como "ninguem tem cartoes".
      if (Array.isArray(linhas) && linhas.length) {
        return { linhas, fonte: nome };
      }
      log(`  Disciplina (${nome}): nada devolvido — a tentar a seguinte`);
    } catch (erro) {
      log(`  Disciplina (${nome}): ${erro.message.split('\n')[0]}`);
    }
  }

  // Aqui o [] silencioso e perigoso: zero cartoes lidos passaria por "ninguem
  // esta em risco de castigo", que e uma mentira tranquilizadora.
  throw new Error('Nenhuma fonte de disciplina respondeu.');
}

// -----------------------------------------------------------------------------
// Duas recolhas.
//
//   COMPLETA  mercado (538 jogadores), classificacao, jogos, golos,
//             disciplina e lesoes. Uma vez por semana chega: os valores da
//             Liga Record so mudam a quarta.
//
//   LEVE      so lesoes e disciplina, reaproveitando o mercado da ultima
//             recolha completa. Sao meia duzia de pedidos em vez de
//             algumas dezenas, e e o que muda de um dia para o outro.
//
// Correr a completa todos os dias seria varrer 538 jogadores para detectar
// que ninguem se lesionou. A leve responde a mesma pergunta a um decimo do
// custo.
// -----------------------------------------------------------------------------

export async function recolherLeve({ log = console.log, duvidasIA: forcarDuvidas = false } = {}) {
  const anterior = await lerBoletim();

  if (!anterior?.mercado?.length) {
    log('Sem recolha completa anterior — a fazer uma completa.');
    return recolher({ log });
  }

  const avisos = [];
  const mercado = anterior.mercado;

  const guardado = await lerPlantelGuardado({ log });
  const minhaEquipa = guardado
    ? montarEquipa(guardado, mercado)
    : { jogadores: [], saldo: 0, valorEquipa: 0, completo: false, faltam: 23, desaparecidos: [] };

  log('A ler as lesoes...');
  let ausencias = [];
  let falha = null;

  try {
    ausencias = await lesoesDaLiga({ log });
  } catch (erro) {
    falha = erro.message;
    log(`  Lesoes: ${erro.message.split('\n')[0]}`);
  }

  let cartoes = anterior.cartoes ?? [];
  let fonteCartoes = anterior.fonteCartoes ?? null;
  let emRiscoDeCastigo = anterior.emRiscoDeCastigo ?? [];
  let porConfirmar = [];

  // A jornada por jogar. A recolha leve nao volta a determina-la: herda a do
  // boletim anterior, tal como faz com tudo o resto.
  const proximaJornada = anterior.jornada?.numero ?? null;

  // Os castigos que ainda nao foram cumpridos, vindos do boletim anterior.
  // Sobrevivem a esta recolha mesmo que hoje nao haja travessia nenhuma a
  // detectar — e o ponto todo da correccao.
  let castigosActivos = anterior.castigosActivos ?? [];

  try {
    const d = await lerDisciplina({ log });
    cartoes = d.linhas;

    const r = castigosPorAcumulacao(cartoes, anterior.cartoes, {
      fonte: d.fonte,
      fonteAnterior: fonteCartoes,
      jornada: proximaJornada,
    });

    fonteCartoes = d.fonte;
    porConfirmar = r.castigados.filter((c) => c.certeza === 'baixa');
    emRiscoDeCastigo = r.emRisco;

    castigosActivos = actualizarCastigosActivos({
      guardados: castigosActivos,
      detectados: r.castigados.filter((c) => c.certeza === 'alta'),
      proximaJornada,
    });

    if (!r.comparavel && anterior.cartoes?.length) {
      avisos.push(
        `Os cartões vieram de ${d.fonte} e os anteriores de ${anterior.fonteCartoes ?? 'fonte desconhecida'}. ` +
          'Contagens de fontes diferentes não se comparam, por isso esta recolha não ' +
          'declara castigos novos. Resolve-se sozinho na próxima recolha da mesma fonte.'
      );
    }

    log(
      `  Castigos: ${castigosActivos.length} activos, ` +
        `${porConfirmar.length} por confirmar, ${r.emRisco.length} a um amarelo (fonte: ${d.fonte})`
    );
  } catch (erro) {
    log(`  Disciplina: ${erro.message.split('\n')[0]}`);
    avisos.push('A leitura dos cartões falhou; só as lesões estão actualizadas.');
    // Sem cartoes novos os castigos activos mantem-se: um castigo nao deixa
    // de existir por a pagina ter falhado.
    castigosActivos = actualizarCastigosActivos({
      guardados: castigosActivos,
      detectados: [],
      proximaJornada,
    });
  }

  ausencias = [...ausencias, ...castigosActivos];

  if (falha && minhaEquipa.jogadores.length) {
    throw new Error(
      `A recolha de lesoes falhou: ${falha}\n` +
        'O boletim anterior fica intacto.'
    );
  }

  const emparelhado = ausencias.length
    ? emparelhar(mercado, ausencias)
    : { ligados: [], ambiguos: [] };

  const indiceCartoes = criarIndice(cartoes);
  const indiceGolos = criarIndice(
    (anterior.equipa?.plantel ?? []).map((j) => ({ nome: j.nome, equipa: j.equipa, golos: j.golos }))
  );

  const emRisco = minhaEquipa.jogadores
    .map((j) => {
      const ligado = emparelhado.ligados.find((l) => l.id === j.id);
      return ligado ? { ...j, ausencia: ligado.ausencia, confianca: ligado.confianca } : null;
    })
    .filter(Boolean);

  const forasCertos = emRisco.filter((j) => j.ausencia.tipo !== 'duvida');

  const boletim = {
    ...anterior,
    geradoEm: new Date().toISOString(),
    tipo: 'leve',
    // A recolha leve nunca toca na Liga Record: herda a data do mercado.
    mercadoRecolhidoEm: anterior.mercadoRecolhidoEm ?? anterior.geradoEm,
    mercadoActual: anterior.mercadoActual ?? true,
    avisos,
    equipa: {
      ...anterior.equipa,
      plantel: minhaEquipa.jogadores.map((j) => {
        const disciplina = procurar(indiceCartoes, j.nome, j.equipa);
        const marcador = procurar(indiceGolos, j.nome, j.equipa);
        const amarelos = disciplina?.amarelos ?? 0;
        const ausencia = emRisco.find((x) => x.id === j.id)?.ausencia ?? null;
        const anteriorDoPlantel = (anterior.equipa?.plantel ?? []).find((p) => p.id === j.id);

        return {
          ...j,
          equipaCanonica: equipaCanonica(j.equipa),
          golos: marcador?.golos ?? anteriorDoPlantel?.golos ?? 0,
          // A recolha leve nao vai buscar golos nem assistencias; herda-os
          // da ultima completa, que corre a quarta.
          assistencias: anteriorDoPlantel?.assistencias ?? 0,
          // Quem bate os penaltis da equipa tem pontos quase garantidos de
          // cada vez que a equipa ganha um. So o maisfutebol da esta coluna.
          penaltis: marcador?.penaltis ?? anteriorDoPlantel?.penaltis ?? 0,
          marcaPenaltis: marcador?.marcaPenaltis ?? anteriorDoPlantel?.marcaPenaltis ?? false,
          amarelos,
          vermelhos: disciplina?.vermelhos ?? 0,
          proximoJogo: anteriorDoPlantel?.proximoJogo ?? null,
          naoJoga: Boolean(ausencia && ausencia.tipo !== 'duvida'),
          emRiscoProxima: amarelos > 0 && amarelos % 5 === 4,
        };
      }),
    },
    emRisco,
    sugestoes: sugerirSubstituicoes({
      plantel: minhaEquipa.jogadores,
      todosJogadores: mercado,
      saldo: minhaEquipa.saldo,
      emRisco: forasCertos,
      idsIndisponiveis: new Set(
        emparelhado.ligados.filter((j) => j.ausencia.tipo !== 'duvida').map((j) => j.id)
      ),
    }),
    ligaInteira: emparelhado.ligados.map(({ bruto, ...r }) => r),
    cartoes,
    // Guardada para a proxima recolha saber se pode comparar contagens.
    fonteCartoes,
    emRiscoDeCastigo,
    // Os castigos por cumprir, com a jornada a que se aplicam. Sobrevivem
    // entre recolhas ate essa jornada ser jogada.
    castigosActivos,
    castigosPorConfirmar: porConfirmar,
    // Campo proprio, deliberadamente fora de emRisco: isto e interpretacao
    // de noticias, nao um facto lido de uma tabela.
    // A recolha leve nao volta a ler a jornada — reaproveita a do boletim
    // anterior, que e o que ela faz com tudo o resto.
    duvidasIA: await duvidasSeNecessario(
      minhaEquipa.jogadores,
      anterior.jornada?.numero ?? null,
      anterior,
      { log, forcar: forcarDuvidas }
    ),
  };

  await guardarBoletim(boletim);
  log(`Recolha leve concluida. ${forasCertos.length} de fora.`);
  return boletim;
}

export async function recolher({ log = console.log, anterior = null } = {}) {
  const avisos = [];

  // ---------------------------------------------------------------------
  // A Liga Record e a UNICA fonte do mercado: valores, pontuacoes, plantel.
  // Tambem e a unica que bloqueia servidores de datacenter — do Railway, a
  // ligacao morre sem sequer se estabelecer.
  //
  // Por isso deixou de ser fatal. Se nao responder, reaproveitamos o mercado
  // da ultima recolha que conseguiu, e o resto (jornadas, classificacao,
  // golos, cartoes, lesoes) e recolhido na mesma. Assim o Railway mantem
  // tudo o que consegue actualizado, e tu corres localmente so quando
  // precisares de valores novos.
  //
  // O que NAO fazemos e fingir que esta tudo bem: o boletim leva a data do
  // mercado e um aviso quando ele nao e desta recolha.
  // ---------------------------------------------------------------------
  log('A ler a Liga Record...');

  const boletimAnterior = anterior ?? (await lerBoletim().catch(() => null));

  let todosJogadores = [];
  let mercadoDesactualizado = null;

  try {
    // Em serie, nao em paralelo: partilham a mesma sessao e quatro pedidos
    // simultaneos so servem para nos porem na lista negra.
    todosJogadores = await lr.obterTodosJogadores({ log });
  } catch (erro) {
    const motivo = erro.message.split('\n')[0];
    log(`  Liga Record indisponivel: ${motivo}`);

    todosJogadores = boletimAnterior?.mercado ?? [];
    mercadoDesactualizado = boletimAnterior?.mercadoRecolhidoEm ?? boletimAnterior?.geradoEm ?? null;

    if (!todosJogadores.length) {
      throw new Error(
        `A Liga Record nao respondeu (${motivo}) e nao ha mercado anterior ` +
          'guardado.\nCorre `npm run recolher` na tua maquina uma vez, para ' +
          'haver um ponto de partida.'
      );
    }

    const quando = mercadoDesactualizado
      ? new Date(mercadoDesactualizado).toLocaleDateString('pt-PT')
      : 'data desconhecida';

    log(`  A usar o mercado de ${quando}: ${todosJogadores.length} jogadores.`);
    avisos.push(
      `A Liga Record não respondeu. Valores e pontuações são de ${quando} — ` +
        'o resto está actualizado. Corre a recolha na tua máquina para os refrescar.'
    );
  }

  // O plantel vem do que tu registaste, nao do site. O login da Liga Record
  // usa SSO por iframe, que um cliente HTTP nao reproduz — e nao vale a pena,
  // porque isto e a unica coisa que dele precisavamos.
  const guardado = await lerPlantelGuardado({ log });

  let minhaEquipa;
  if (guardado) {
    minhaEquipa = montarEquipa(guardado, todosJogadores);
    log(
      `  Plantel registado: ${minhaEquipa.jogadores.length}/${23} jogadores` +
        (minhaEquipa.desaparecidos.length
          ? `, ${minhaEquipa.desaparecidos.length} id(s) ja nao existem no mercado`
          : '')
    );
    if (minhaEquipa.desaparecidos.length) {
      avisos.push(
        `${minhaEquipa.desaparecidos.length} jogador(es) do teu plantel já não ` +
          'aparecem no mercado. Actualiza o plantel na app.'
      );
    }
  } else {
    minhaEquipa = {
      jogadores: [],
      saldo: 0,
      valorEquipa: 0,
      completo: false,
      faltam: 23,
      desaparecidos: [],
      origem: 'nenhum',
    };
    log('  Sem plantel registado — regista-o na app, no separador Construir.');
    avisos.push(
      'Ainda não registaste o teu plantel. Abre a app, escolhe os teus 23 ' +
        'jogadores em Construir e grava. Sem isso não há lesões a verificar.'
    );
  }

  // Duas contagens diferentes: a jornada da Primeira Liga (que decide
  // lesoes e castigos) e a ronda da Liga Record (que so arranca na 6.a).
  // A ronda da Liga Record tambem pode falhar; nao e critica.
  let [jornada, ronda] = await Promise.all([
    jornadaActual({ log }),
    lr.obterJornada().catch(() => ({ numero: null, fechoMercado: null, origem: 'indisponivel' })),
  ]);

  // Ultimo recurso: a Liga Record arranca a sua ronda 1 na 6.a jornada do
  // campeonato, portanto jornada = ronda + 5. So vale enquanto o jogo
  // estiver a decorrer, e fica marcado como derivado para nao passar por
  // dado certo.
  const jornadaPlausivel = (n) => Number.isInteger(n) && n >= 1 && n <= 34;

  if (!jornadaPlausivel(jornada.numero)) jornada = { ...jornada, numero: null };

  if (!jornada.numero && ronda.numero) {
    const derivada = ronda.numero + 5;
    if (jornadaPlausivel(derivada)) {
      jornada = { numero: derivada, origem: 'derivada da ronda' };
      log(`  Jornada ${derivada} (derivada da ronda ${ronda.numero})`);
    }
  }

  if (!jornada.numero) {
    avisos.push(
      'Não consegui determinar a jornada. Corre `npm run inspect-jornada` ' +
        'ou define LR_JORNADA no .env.'
    );
  }

  // ---------------------------------------------------------------------
  // AS DUAS JORNADAS, escritas de uma vez para nao voltarem a divergir.
  //
  // `jornada.numero` significa A JORNADA POR JOGAR. E o que o
  // jornadaPelaClassificacao devolve (jogos disputados + 1), o que o
  // selector do zerozero mostra, e o que a app poe no cabecalho.
  //
  // O BUG QUE ISTO CORRIGE: metade do ficheiro tratava `jornada.numero`
  // como a ultima jornada JA DISPUTADA. Os jogos eram pedidos para
  // `numero + 1` e `numero + 2`, e o proximo adversario procurado em
  // `numero + 1`. Resultado visivel: o cabecalho dizia "JORNADA 6" e o
  // separador Campeonato mostrava os jogos da 7 e da 8, saltando por
  // completo a jornada que realmente vinha a seguir. A classificacao era
  // pedida a API com round=6, uma jornada que ainda nao foi jogada.
  //
  // Agora ha dois nomes e cada um diz o que e.
  // ---------------------------------------------------------------------
  const porJogar = jornada.numero ?? null;
  const disputada = porJogar && porJogar > 1 ? porJogar - 1 : null;
  // Sem jornada conhecida nao se pedem jogos: `null + 1` dava 1 e trazia os
  // jogos da primeira jornada da epoca como se fossem os proximos.
  const jornadasAPedir = porJogar ? [porJogar, porJogar + 1] : [];
  log(`  ${todosJogadores.length} jogadores, ${minhaEquipa.jogadores.length} no plantel`);

  // Antes da 1a ronda o plantel esta vazio e nao ha nada para avisar.
  if (!minhaEquipa.jogadores.length) {
    log(`  Plantel por construir — faltam ${minhaEquipa.faltam} jogadores.`);
  }

  log('A ler as lesoes no Transfermarkt...');

  // O Zerozero e a parte fragil. Se falhar, NAO deitamos fora o resto:
  // o mercado e a sugestao de plantel continuam a valer, e antes da 1a
  // ronda sao a unica coisa que interessa.
  let ausencias = [];
  let falhadas = [];
  let zerozeroFalhou = null;

  try {
    ausencias = await lesoesDaLiga({ log });

    if (ausencias.length < MINIMO_PLAUSIVEL) {
      throw new Error(
        `so ${ausencias.length} lesionados em toda a liga, o que nao e credivel`
      );
    }
  } catch (erro) {
    zerozeroFalhou = erro.message;
    ausencias = [];
    log(`  Lesoes: falhou — ${erro.message.split('\n')[0]}`);
  }

  // Castigos, calculados a partir dos cartoes acumulados.
  let cartoes = [];
  let fonteCartoes = null;
  let emRiscoDeCastigo = [];
  let porConfirmar = [];

  // Os castigos por cumprir herdados do boletim anterior. Nao se perdem so
  // porque hoje nao houve travessia nova a detectar.
  let castigosActivos = anterior?.castigosActivos ?? [];

  // Declarada aqui e nao mais abaixo: o bloco dos castigos preenche-a antes
  // do bloco do campeonato correr, e ter a declaracao depois rebentava com
  // "Cannot access before initialization" — que apanhava TODOS os castigos.
  // O indice dos cartoes so pode ser construido depois de os ler.
  let indiceCartoes = new Map();

  try {
    const d = await lerDisciplina({ log });
    cartoes = d.linhas;

    const r = castigosPorAcumulacao(cartoes, anterior?.cartoes, {
      fonte: d.fonte,
      fonteAnterior: anterior?.fonteCartoes ?? null,
      jornada: porJogar,
    });

    fonteCartoes = d.fonte;

    // Separacao deliberada. Um castigo de certeza baixa (sem historico para
    // comparar) NAO entra nas ausencias, logo nao gera sugestao de troca.
    //
    // A assimetria justifica-o: um falso negativo custa-te os pontos de um
    // jogador numa jornada; um falso positivo faz-te gastar a UNICA troca da
    // ronda a tirar alguem que podia jogar. O segundo erro e muito pior, por
    // isso na duvida nao mexemos — mostramos e deixamos-te confirmar.
    const certos = r.castigados.filter((c) => c.certeza === 'alta');
    porConfirmar = r.castigados.filter((c) => c.certeza === 'baixa');

    castigosActivos = actualizarCastigosActivos({
      guardados: castigosActivos,
      detectados: certos,
      proximaJornada: porJogar,
    });

    emRiscoDeCastigo = r.emRisco;

    if (!r.comparavel && anterior?.cartoes?.length) {
      avisos.push(
        `Os cartões vieram de ${d.fonte} e os anteriores de ${anterior.fonteCartoes ?? 'fonte desconhecida'}. ` +
          'Contagens de fontes diferentes não se comparam, por isso esta recolha não ' +
          'declara castigos novos.'
      );
    }

    indiceCartoes = criarIndice(cartoes);

    log(
      `  Castigos: ${certos.length} novos, ${castigosActivos.length} activos, ` +
        `${porConfirmar.length} por confirmar, ${r.emRisco.length} a um amarelo (fonte: ${d.fonte})`
    );

    if (porConfirmar.length) {
      avisos.push(
        `${porConfirmar.length} possível(eis) castigo(s) por confirmar: sem recolha ` +
          'anterior não dá para saber se já foram cumpridos. Não entram nas ' +
          'sugestões de troca. A partir da próxima recolha isto resolve-se sozinho.'
      );
    }
  } catch (erro) {
    log(`  Castigos: falhou — ${erro.message.split('\n')[0]}`);
    avisos.push(
      'A leitura dos cartões falhou; só as lesões estão actualizadas. ' +
        'Confirma os castigos à mão.'
    );
    // Um castigo nao deixa de existir por a pagina ter falhado: os activos
    // mantem-se, so se limpam os ja cumpridos.
    castigosActivos = actualizarCastigosActivos({
      guardados: castigosActivos,
      detectados: [],
      proximaJornada: porJogar,
    });
  }

  // Os castigos por cumprir entram nas ausencias, venham eles de hoje ou de
  // uma recolha anterior.
  ausencias = [...ausencias, ...castigosActivos];

  const temPlantel = minhaEquipa.jogadores.length > 0;

  if (zerozeroFalhou) {
    if (temPlantel) {
      // Com plantel montado, uma lista vazia de lesoes e perigosa: parece
      // "esta tudo bem". Preferimos manter o boletim anterior.
      throw new Error(
        `A recolha de lesoes falhou: ${zerozeroFalhou}\n` +
          'Corre `npm run inspect-tm` para ver o que a pagina devolveu.\n' +
          'O boletim anterior fica intacto — dados de ontem valem mais do que\n' +
          'uma lista vazia que parece boas noticias.'
      );
    }
    avisos.push(
      'A recolha de lesoes e castigos falhou; o mercado esta actualizado. ' +
        'Como ainda nao tens plantel, nao ha nada a assinalar.'
    );
  }

  const emparelhado = ausencias.length
    ? emparelhar(todosJogadores, ausencias)
    : { ligados: [], ambiguos: [], semCorrespondencia: [] };

  // Sem isto o log dizia "13 lesionados" e depois "0 de fora", e nao havia
  // como saber se era boa noticia (nenhum e teu) ou emparelhamento partido.
  // Estes numeros distinguem as duas coisas.
  if (ausencias.length) {
    const naoLigadas = ausencias.length - emparelhado.ligados.length - emparelhado.ambiguos.length;
    log(
      `  Emparelhamento: ${emparelhado.ligados.length}/${ausencias.length} ligadas ao mercado` +
        (emparelhado.ambiguos.length ? `, ${emparelhado.ambiguos.length} ambiguas` : '') +
        (naoLigadas > 0 ? `, ${naoLigadas} sem correspondencia` : '')
    );

    // Se mais de metade nao encontra dono, o problema esta nos nomes ou nas
    // equipas — nao na liga estar saudavel.
    if (emparelhado.ligados.length * 2 < ausencias.length) {
      const orfas = emparelhado.semCorrespondencia ?? [];
      for (const a of orfas.slice(0, 5)) {
        log(`    sem par: ${a.nome} (${a.equipa})`);
      }
      avisos.push(
        `So ${emparelhado.ligados.length} de ${ausencias.length} ausencias foram ` +
          'ligadas a jogadores do mercado. Os nomes ou as equipas nao estao a bater certo.'
      );
    }
  }

  const indisponiveis = new Set(
    emparelhado.ligados.filter((j) => j.ausencia.tipo !== 'duvida').map((j) => j.id)
  );

  const emRisco = minhaEquipa.jogadores
    .map((j) => {
      const ligado = emparelhado.ligados.find((l) => l.id === j.id);
      const ambiguo = emparelhado.ambiguos.find((a) => a.jogador.id === j.id);
      if (ligado) return { ...j, ausencia: ligado.ausencia, confianca: ligado.confianca };
      if (ambiguo) return { ...j, ausencia: null, hipoteses: ambiguo.hipoteses, confianca: 0 };
      return null;
    })
    .filter(Boolean);

  const forasCertos = emRisco.filter((j) => j.ausencia && j.ausencia.tipo !== 'duvida');

  const sugestoes = sugerirSubstituicoes({
    plantel: minhaEquipa.jogadores,
    todosJogadores,
    saldo: minhaEquipa.saldo,
    emRisco: forasCertos,
    idsIndisponiveis: indisponiveis,
  });

  // Contexto do campeonato: tabela, jogos da proxima jornada e marcadores.
  // Nenhum destes e critico — se falharem, o boletim sai na mesma.
  log('A ler o campeonato...');

  const equipasDoMercado = [...new Set(todosJogadores.map((j) => j.equipa).filter(Boolean))];

  const [tabela, listaJogos, golos] = await Promise.all([
    // A classificacao vem da mesma pagina dos jogos, lida pelo cabecalho.
    // A classificacao da API oficial e pedida para a jornada JA DISPUTADA:
    // a tabela da jornada 5 e a que reflecte os 5 jogos jogados.
    comAlternativa(
      'Classificacao',
      () => classificacaoOficial({ log, jornada: disputada }),
      () =>
        comAlternativa(
          'Classificacao (2.a alternativa)',
          () => classificacaoDaLiga({ log }),
          () => classificacaoMaisFutebol({ log }),
          { log }
        ),
      { log }
    ),
    // A jornada e um parametro do URL: pedimos a actual e a seguinte, cada
    // uma no seu pedido, para poderem ser mostradas separadas.
    // NOTA sobre que jornadas pedir: a classificacao da jornada 5 significa
    // "5 jogos disputados", portanto os jogos POR JOGAR sao os da 6 e da 7.
    // Pedir a jornada 5 aqui traria jogos ja realizados.
    comAlternativa(
      'Jogos',
      () => jogosOficial(jornadasAPedir, { log }),
      () =>
        comAlternativa(
          'Jogos (2.a alternativa)',
          () => jogosDeVariasJornadas(jornadasAPedir, { log }),
          () => jogosMaisFutebol(jornadasAPedir, { log }),
          { log }
        ),
      { log }
    ),
    comAlternativa(
      'Golos e assistencias',
      () => marcadoresOficial({ log }),
      () =>
        comAlternativa(
          'Golos (2.a alternativa)',
          () => marcadoresZeroZero({ log }),
          () => marcadoresMaisFutebol({ log }),
          { log }
        ),
      { log }
    ),
  ]);

  const proximosJogos = { dados: listaJogos };

  // Estatisticas por jogador. Emparelhamento DIFUSO, nao por igualdade: o
  // zerozero escreve "Vangelis Pavlidis" e a Liga Record "Pavlidis".
  const indiceGolos = criarIndice(golos);

  const adversarios = new Map();
  // O proximo adversario e o da jornada POR JOGAR — que e `porJogar`, nao
  // `porJogar + 1`.
  for (const j of listaJogos.filter((x) => Number(x.jornada) === porJogar)) {
    const base = { data: j.data, hora: j.hora, jornada: j.jornada };
    adversarios.set(equipaCanonica(j.casa), { ...base, adversario: j.fora, casa: true });
    adversarios.set(equipaCanonica(j.fora), { ...base, adversario: j.casa, casa: false });
  }

  const limpar = ({ bruto, ...resto }) => resto;

  // Antes da 1a ronda ninguem tem plantel. O que serve nessa altura nao e o
  // boletim de lesoes — e ajuda a gastar os 40M. Guardamos o mercado inteiro
  // para a app poder refazer contas no browser com os jogadores que fixares.
  const mercado = todosJogadores.map((j) => ({
    id: j.id,
    nome: j.nome,
    equipa: j.equipa,
    posicao: j.posicao,
    custo: j.custo,
    pontos: j.pontosTotais,
    percentagemEquipas: j.percentagemEquipas ?? null,
  }));

  const fixos = minhaEquipa.jogadores.map((j) => j.id);
  const sugestaoPlantel = minhaEquipa.completo
    ? null
    : montarPlantel({ todosJogadores: mercado, fixos });

  const boletim = {
    geradoEm: new Date().toISOString(),

    // Quando o mercado foi lido pela ultima vez COM SUCESSO. Se esta
    // recolha nao chegou a Liga Record, mantem a data antiga — e assim a
    // app e o bot podem dizer a verdade sobre a idade dos valores em vez de
    // os apresentarem como se fossem de agora.
    mercadoRecolhidoEm: mercadoDesactualizado ?? new Date().toISOString(),
    mercadoActual: !mercadoDesactualizado,

    jornada: { ...jornada, fechoMercado: ronda.fechoMercado },
    ronda,
    avisos,
    equipa: {
      saldo: minhaEquipa.saldo,
      valorEquipa: minhaEquipa.valorEquipa,
      plantel: minhaEquipa.jogadores.map((j) => {
        const disciplina = procurar(indiceCartoes, j.nome, j.equipa);
        const marcador = procurar(indiceGolos, j.nome, j.equipa);
        const amarelos = disciplina?.amarelos ?? 0;

        // A ausencia que ja foi apurada para este jogador, se houver.
        const ausencia = emRisco.find((x) => x.id === j.id)?.ausencia ?? null;

        // Tres estados, e a diferenca importa: quem nao joga agora, quem
        // pode nao jogar na proxima, e quem esta bem.
        const naoJoga = Boolean(ausencia && ausencia.tipo !== 'duvida');
        const emRiscoProxima = !naoJoga && amarelos > 0 && amarelos % 5 === 4;

        return {
          ...limpar(j),
          equipaCanonica: equipaCanonica(j.equipa),
          golos: marcador?.golos ?? 0,
          assistencias: marcador?.assistencias ?? 0,
          amarelos,
          vermelhos: disciplina?.vermelhos ?? 0,
          proximoJogo: adversarios.get(equipaCanonica(j.equipa)) ?? null,
          naoJoga,
          emRiscoProxima,
        };
      }),
    },
    emRisco: emRisco.map(limpar),
    sugestoes,
    ligaInteira: emparelhado.ligados.map(limpar),
    mercado,
    sugestaoPlantel,
    // Guardado para a proxima recolha poder detectar quem ATRAVESSOU um
    // multiplo de 5 amarelos. Sem isto nao ha forma de distinguir um castigo
    // novo de um ja cumprido.
    cartoes,
    // Qual das tres fontes produziu essas contagens. Sem isto nao da para
    // saber se a comparacao da proxima recolha e legitima.
    fonteCartoes,
    emRiscoDeCastigo,
    // Castigos por cumprir, com a jornada a que se aplicam.
    castigosActivos,
    // Campo proprio, deliberadamente fora de emRisco: isto e interpretacao
    // de noticias, nao um facto lido de uma tabela.
    duvidasIA: await duvidasSeNecessario(minhaEquipa.jogadores, jornada.numero, anterior, { log }),
    classificacao: tabela.map((e) => ({ ...e, equipaCanonica: equipaCanonica(e.equipa) })),
    // Cada jogo leva o nome canonico das duas equipas.
    //
    // A app precisa de saber se tem jogadores num jogo, e comparava os nomes
    // tal e qual: o plantel diz "Nacional" e a API diz "CD Nacional", por
    // isso so os clubes escritos igual nas duas fontes eram assinalados.
    // A tabela de alcunhas vive aqui no worker e nao vale a pena duplica-la
    // no browser — anotamos os dados e a app so compara.
    proximosJogos: proximosJogos.dados.map((j) => ({
      ...j,
      casaCanonica: equipaCanonica(j.casa),
      foraCanonica: equipaCanonica(j.fora),
    })),
    castigosPorConfirmar: porConfirmar,
    porConfirmar: emparelhado.ambiguos.map((a) => ({
      jogador: a.jogador.nome,
      equipa: a.jogador.equipa,
      hipoteses: a.hipoteses,
    })),
    diagnostico: {
      jogadoresLidos: todosJogadores.length,
      ausenciasLidas: ausencias.length,
      emparelhadas: emparelhado.ligados.length,
      ambiguas: emparelhado.ambiguos.length,
      equipasFalhadas: falhadas,
      fonteLesoes: 'transfermarkt',
      falhaLesoes: zerozeroFalhou,
    },
  };

  await guardarBoletim(boletim);
  log(
    `Boletim guardado. ${forasCertos.length} de fora, ` +
      `${emRisco.length - forasCertos.length} em duvida ` +
      `(de ${minhaEquipa.jogadores.length} no teu plantel; ` +
      `${emparelhado.ligados.length} ausencias em toda a liga).`
  );

  return boletim;
}

// Compara com o boletim anterior para so avisar quando ha novidade.
export async function recolherEDetectarNovidades() {
  const anterior = await lerBoletim();
  const idsAntes = new Set((anterior?.emRisco ?? []).map((j) => j.id));
  const novo = await recolher({ anterior });

  const novidades = novo.emRisco.filter((j) => !idsAntes.has(j.id));
  const recuperados = (anterior?.emRisco ?? []).filter(
    (a) => !novo.emRisco.some((j) => j.id === a.id)
  );

  return { boletim: novo, novidades, recuperados };
}

// Permite correr so a recolha: `npm run recolher`
//
// pathToFileURL e obrigatorio: no Windows o process.argv[1] vem
// "C:\\Projectos\\...\\recolher.js" e o import.meta.url vem
// "file:///C:/Projectos/.../recolher.js". Comparar com `file://${...}`
// nunca da igual, o comando saia sem fazer nada e sem dizer porque.
if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  // Tambem le o anterior quando corrido a mao, senao os castigos vinham
  // sempre marcados como "por confirmar".
  lerBoletim()
    .catch(() => null)
    .then((anterior) => recolher({ anterior }))
    .catch((e) => {
      console.error('\n' + e.message);
      process.exit(1);
    });
}
