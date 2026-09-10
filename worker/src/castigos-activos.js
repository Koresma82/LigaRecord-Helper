import { chaveDisciplina } from './fontes/disciplina.js';

// -----------------------------------------------------------------------------
// Castigos ACTIVOS — os que ainda nao foram cumpridos.
//
// O BUG QUE ISTO CORRIGE
//
// A deteccao de castigos compara a recolha de hoje com a de ontem e assinala
// quem ATRAVESSOU um multiplo de 5 amarelos. Isso esta certo para detectar.
// O problema era usar so isso para decidir quem esta de fora.
//
// Uma travessia so e visivel na recolha imediatamente a seguir ao jogo. No
// dia seguinte a contagem ja e igual a anterior, a travessia deixa de
// existir, e o jogador desaparecia do boletim.
//
// Na pratica: 5.o amarelo ao domingo, a recolha leve de segunda as 07:00
// detecta e marca, e na quarta ja nao aparece. A mensagem de sexta — a que
// interessa, a que precede o fecho do mercado — nao o mostrava. O castigo
// aplica-se a jornada seguinte, mas o sinal vivia um dia.
//
// A CORRECCAO
//
// Um castigo detectado fica guardado com a JORNADA A QUE SE APLICA, e
// sobrevive a todas as recolhas ate essa jornada ser jogada. Quando a
// proxima jornada por jogar passa a ser posterior a jornada do castigo, o
// castigo foi cumprido e sai sozinho.
//
// Um vermelho tem duracao decidida pelo Conselho de Disciplina e podem ser
// mais do que um jogo. Nao da para adivinhar, por isso mantem-se activo uma
// jornada (o minimo garantido) e vai marcado com `duracaoIncerta` para a
// mensagem poder dizer que pode ser mais.
// -----------------------------------------------------------------------------

// UM castigo activo por jogador, e nao um por motivo.
//
// A razao e pratica e custou pensar: o `emparelhar` liga o plantel as
// ausencias por semelhanca de nome, e duas ausencias com o MESMO nome na
// mesma equipa pontuam igual. A margem de ambiguidade dispara, o jogador vai
// parar aos `ambiguos` — e desaparece do boletim, que e exactamente o
// contrario do que queremos. Um jogador com 5 amarelos e um vermelho na
// mesma jornada produziria isso.
//
// Como um jogador suspenso e suspenso, uma linha chega. Um vermelho
// detectado depois sobrepoe-se a acumulacao, que e a ordem certa: e o
// castigo mais grave e o de duracao mais incerta.
const chaveCastigo = (c) => c.chave ?? chaveDisciplina(c);

/**
 * Junta os castigos que ja estavam activos com os detectados agora, e
 * descarta os que a jornada ja ultrapassou.
 *
 * @param guardados       castigos activos do boletim anterior
 * @param detectados      castigos vindos de castigosPorAcumulacao (certeza alta)
 * @param proximaJornada  a jornada por jogar; null se nao se conseguiu determinar
 */
export function actualizarCastigosActivos({
  guardados = [],
  detectados = [],
  proximaJornada = null,
} = {}) {
  const activos = new Map();

  // 1. O que ja estava activo e ainda nao foi cumprido.
  //
  // Sem jornada conhecida NAO se limpa nada: preferimos manter um castigo a
  // mais do que perder um por nao sabermos em que jornada estamos. O aviso
  // de jornada indeterminada ja e dado noutro sitio.
  for (const c of guardados) {
    const cumprido =
      proximaJornada != null &&
      c.jornadaAplicavel != null &&
      Number(c.jornadaAplicavel) < Number(proximaJornada);

    if (!cumprido) activos.set(chaveCastigo(c), c);
  }

  // 2. Os detectados agora. Sobrepoem-se aos guardados com a mesma chave:
  //    um jogador que leve o 10.o amarelo tem motivo novo, e o registo novo
  //    e o que vale.
  for (const c of detectados) {
    activos.set(chaveCastigo(c), {
      ...c,
      jornadaAplicavel: c.jornadaAplicavel ?? proximaJornada,
      detectadoEm: c.detectadoEm ?? new Date().toISOString(),
    });
  }

  return [...activos.values()];
}
