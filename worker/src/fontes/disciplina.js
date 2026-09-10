import { normalizar, equipaCanonica } from '../normalizar.js';

// -----------------------------------------------------------------------------
// Castigos por acumulacao de amarelos.
//
// REGRA (artigo 164.º n.º 7 do RDLPFP): uma serie de 5 cartoes amarelos da
// 1 jogo de suspensao. Amarelos da Taca, Supertaca e Taca da Liga nao
// contam, e a contagem nao transita de epoca.
//
// A ARMADILHA: a tabela de disciplina mostra TOTAIS ACUMULADOS, nao quem
// esta castigado. Um jogador com 5 amarelos pode ja ter cumprido na jornada
// passada. Ler "amarelos % 5 === 0" como "castigado" produz falsos
// positivos — e um falso positivo faz-te gastar a UNICA troca da ronda a
// tirar alguem que podia jogar.
//
// Por isso comparamos com a recolha anterior: interessa quem ATRAVESSOU um
// multiplo de 5 desde a ultima vez, nao quem la esta parado.
//
// -----------------------------------------------------------------------------
// DUAS CORRECCOES IMPORTANTES NESTE MODULO
//
// 1. A CHAVE DE COMPARACAO tem de ser normalizada.
//
//    A versao anterior comparava por `${nome}|${equipa}` em bruto. Mas os
//    cartoes vem de tres fontes em cascata (API da Liga Portugal, zerozero,
//    maisfutebol) e cada uma escreve os nomes a sua maneira — "Pavlidis" vs
//    "Vangelis Pavlidis", "Sp. Braga" vs "SC Braga". Bastava a fonte mudar
//    entre duas recolhas para NENHUMA chave bater certo: tudo passava por
//    "primeira recolha", tudo saia com certeza baixa, e nada entrava nas
//    ausencias. A cascata de fallback, que existe para dar robustez,
//    desligava a deteccao de castigos em silencio.
//
//    Agora a chave e o playerId quando a fonte o da (a oficial da), e
//    normalizar(nome)|equipaCanonica(equipa) quando nao da.
//
// 2. CONTAGENS DE FONTES DIFERENTES NAO SE COMPARAM.
//
//    Mesmo com a chave certa, o numero de amarelos que a oficial reporta
//    pode nao ser o mesmo que o zerozero reporta (criterios de duplo
//    amarelo, jogos contabilizados). Comparar 4 da oficial com 5 do
//    maisfutebol inventaria uma travessia que nao houve.
//
//    Por isso, quando a fonte muda entre recolhas, NAO se declara travessia:
//    marca-se o que estiver em multiplo de 5 como certeza baixa, tal como na
//    primeira recolha. E a mesma assimetria de sempre — na duvida nao
//    mexemos na equipa.
// -----------------------------------------------------------------------------

const SERIE = 5;

// A mesma chave para os dois lados da comparacao. O id e sempre preferido:
// e a unica coisa que nao muda com a grafia do nome.
export function chaveDisciplina(registo) {
  // A API oficial chama-lhe `id`; guardamo-lo como `playerId` no boletim.
  // Aceitamos os dois para a chave ser a mesma antes e depois de gravar.
  const id = registo?.playerId ?? registo?.id;
  if (id != null && id !== '') return `id:${id}`;
  return `n:${normalizar(registo?.nome ?? '')}|${equipaCanonica(registo?.equipa ?? '')}`;
}

/**
 * @param actuais      linhas de disciplina desta recolha
 * @param anteriores   linhas de disciplina da recolha anterior (ou null)
 * @param opcoes.fonte          nome da fonte que produziu `actuais`
 * @param opcoes.fonteAnterior  nome da fonte que produziu `anteriores`
 * @param opcoes.jornada        a proxima jornada por jogar — e a jornada a
 *                              que o castigo detectado se aplica
 */
export function castigosPorAcumulacao(actuais, anteriores, opcoes = {}) {
  const { fonte = 'desconhecida', fonteAnterior = null, jornada = null } = opcoes;

  // Sem historico, ou com historico de outra fonte, nao ha comparacao
  // legitima a fazer.
  const comparavel = Boolean(anteriores?.length) && fonteAnterior === fonte;

  const antes = new Map(comparavel ? anteriores.map((c) => [chaveDisciplina(c), c]) : []);

  const castigados = [];
  const emRisco = [];

  for (const c of actuais) {
    const anterior = antes.get(chaveDisciplina(c));

    const amarelos = Number(c.amarelos) || 0;
    const vermelhos = Number(c.vermelhos) || 0;

    const serieActual = Math.floor(amarelos / SERIE);
    const serieAnterior = anterior ? Math.floor((Number(anterior.amarelos) || 0) / SERIE) : null;

    const identidade = {
      nome: c.nome,
      equipa: c.equipa,
      posicao: c.posicao,
      playerId: c.playerId ?? c.id ?? null,
      chave: chaveDisciplina(c),
    };

    if (serieAnterior !== null && serieActual > serieAnterior) {
      castigados.push({
        ...identidade,
        tipo: 'castigo',
        motivo: `${amarelos}.º cartão amarelo — um jogo de suspensão`,
        certeza: 'alta',
        fonte,
        jornadaAplicavel: jornada,
      });
    } else if (serieAnterior === null && amarelos > 0 && amarelos % SERIE === 0) {
      // Sem historico comparavel: pode ja ter cumprido. Nao entra nas
      // ausencias, so e mostrado para confirmares a mao.
      castigados.push({
        ...identidade,
        tipo: 'castigo',
        motivo: comparavel
          ? `${amarelos} amarelos (múltiplo de ${SERIE}) — pode já ter cumprido`
          : `${amarelos} amarelos (múltiplo de ${SERIE}) — sem histórico da mesma fonte para comparar`,
        certeza: 'baixa',
        fonte,
        jornadaAplicavel: jornada,
      });
    } else if (amarelos % SERIE === SERIE - 1) {
      // A um amarelo do castigo. Nao e ausencia, e um aviso util.
      emRisco.push({ ...identidade, amarelos });
    }

    // Expulsoes: suspensao certa, duracao decidida pelo Conselho de
    // Disciplina. Nao da para calcular quantos jogos, so garantir um.
    if (anterior && vermelhos > (Number(anterior.vermelhos) || 0)) {
      castigados.push({
        ...identidade,
        tipo: 'castigo',
        motivo: 'Expulso — suspensão de pelo menos um jogo, duração por decidir',
        certeza: 'alta',
        fonte,
        jornadaAplicavel: jornada,
        duracaoIncerta: true,
      });
    }
  }

  return { castigados, emRisco, comparavel, fonte };
}
