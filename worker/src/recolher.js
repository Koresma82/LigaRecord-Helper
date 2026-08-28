import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import * as lr from './fontes/ligarecord.js';
import { lesoesDaLiga } from './fontes/transfermarkt.js';
import { castigosPorAcumulacao } from './fontes/disciplina.js';
import {
  marcadoresDaLiga,
  disciplinaDaLiga,
  jogosDeVariasJornadas,
  classificacaoDaLiga,
} from './fontes/zerozero.js';
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

export async function recolherLeve({ log = console.log } = {}) {
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
  let emRiscoDeCastigo = anterior.emRiscoDeCastigo ?? [];
  let porConfirmar = [];

  try {
    cartoes = await disciplinaDaLiga({ log });
    const r = castigosPorAcumulacao(cartoes, anterior.cartoes);
    ausencias = [...ausencias, ...r.castigados.filter((c) => c.certeza === 'alta')];
    porConfirmar = r.castigados.filter((c) => c.certeza === 'baixa');
    emRiscoDeCastigo = r.emRisco;
    log(`  Castigos: ${r.castigados.length}, ${r.emRisco.length} a um amarelo`);
  } catch (erro) {
    log(`  Disciplina: ${erro.message.split('\n')[0]}`);
    avisos.push('A leitura dos cartões falhou; só as lesões estão actualizadas.');
  }

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
          golos: marcador?.golos ?? anteriorDoPlantel?.golos ?? 0,
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
    emRiscoDeCastigo,
    castigosPorConfirmar: porConfirmar,
  };

  await guardarBoletim(boletim);
  log(`Recolha leve concluida. ${forasCertos.length} de fora.`);
  return boletim;
}

export async function recolher({ log = console.log, anterior = null } = {}) {
  const avisos = [];

  log('A ler a Liga Record...');
  // Em serie, nao em paralelo: partilham a mesma sessao e quatro logins
  // simultaneos so servem para nos porem na lista negra.
  const todosJogadores = await lr.obterTodosJogadores({ log });

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
  let [jornada, ronda] = await Promise.all([jornadaActual({ log }), lr.obterJornada()]);

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
  let emRiscoDeCastigo = [];
  let porConfirmar = [];

  // Declarada aqui e nao mais abaixo: o bloco dos castigos preenche-a antes
  // do bloco do campeonato correr, e ter a declaracao depois rebentava com
  // "Cannot access before initialization" — que apanhava TODOS os castigos.
  // O indice dos cartoes so pode ser construido depois de os ler.
  let indiceCartoes = new Map();

  try {
    cartoes = await disciplinaDaLiga({ log });
    const r = castigosPorAcumulacao(cartoes, anterior?.cartoes);

    // Separacao deliberada. Um castigo de certeza baixa (sem historico para
    // comparar) NAO entra nas ausencias, logo nao gera sugestao de troca.
    //
    // A assimetria justifica-o: um falso negativo custa-te os pontos de um
    // jogador numa jornada; um falso positivo faz-te gastar a UNICA troca da
    // ronda a tirar alguem que podia jogar. O segundo erro e muito pior, por
    // isso na duvida nao mexemos — mostramos e deixamos-te confirmar.
    const certos = r.castigados.filter((c) => c.certeza === 'alta');
    porConfirmar = r.castigados.filter((c) => c.certeza === 'baixa');

    ausencias = [...ausencias, ...certos];
    emRiscoDeCastigo = r.emRisco;



    indiceCartoes = criarIndice(cartoes);

    log(
      `  Castigos: ${certos.length} confirmados, ${porConfirmar.length} por confirmar, ` +
        `${r.emRisco.length} a um amarelo`
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
  }

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
    classificacaoDaLiga({ log }).catch(() => []),
    // A jornada e um parametro do URL: pedimos a actual e a seguinte, cada
    // uma no seu pedido, para poderem ser mostradas separadas.
    jogosDeVariasJornadas([jornada.numero, jornada.numero + 1], { log }).catch(() => []),
    marcadoresDaLiga({ log }).catch(() => []),
  ]);

  const proximosJogos = { dados: listaJogos };

  // Estatisticas por jogador. Emparelhamento DIFUSO, nao por igualdade: o
  // zerozero escreve "Vangelis Pavlidis" e a Liga Record "Pavlidis".
  const indiceGolos = criarIndice(golos);

  const adversarios = new Map();
  // O proximo adversario e o da jornada ACTUAL, nao o da seguinte.
  for (const j of listaJogos.filter((x) => x.jornada === jornada.numero)) {
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
          golos: marcador?.golos ?? 0,
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
    emRiscoDeCastigo,
    classificacao: tabela,
    proximosJogos: proximosJogos.dados,
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
