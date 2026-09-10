// -----------------------------------------------------------------------------
// Juntar os jogos de varias jornadas sem perder nem duplicar nada.
//
// O caso que isto resolve: um pedido a uma fonte traz duas jornadas de uma
// vez (a actual e a seguinte). Se a jornada actual vier vazia mas a seguinte
// vier bem, o fallback da actual (boletim anterior ou base de dados) nao
// pode apagar a seguinte que a propria recolha ja trouxe boa.
// -----------------------------------------------------------------------------

const chaveJogo = (j) => `${j.jornada}|${j.casa}|${j.fora}`;

export function unirJogos(...listas) {
  const vistos = new Set();
  const resultado = [];
  for (const lista of listas) {
    for (const j of lista ?? []) {
      const k = chaveJogo(j);
      if (vistos.has(k)) continue;
      vistos.add(k);
      resultado.push(j);
    }
  }
  return resultado;
}
