import { semelhanca, normalizar, equipaCanonica } from './normalizar.js';

// -----------------------------------------------------------------------------
// Liga um jogador do plantel a um registo de outra fonte.
//
// Cada fonte escreve os nomes a sua maneira, e as diferencas sao maiores do
// que parecem:
//
//   Liga Record        zerozero                  Transfermarkt
//   Pavlidis           Vangelis Pavlidis         Vangelis Pavlidis
//   Barbero            Iván Barbero              Ivan Barbero
//   Samu               Samu Aghehowa             Samu Omorodion
//   Gonçalo Paciência  Gonçalo Paciência         Goncalo Paciencia
//
// A estrategia, por ordem, sempre dentro do MESMO CLUBE:
//   1. nome igual depois de normalizar
//   2. um so candidato no clube partilha um apelido distintivo
//   3. semelhanca difusa acima do limiar
//   4. um so candidato no clube e o nome e prefixo/sufixo do outro
//
// Restringir ao clube e o que torna isto seguro: dentro de um plantel de 25
// jogadores raramente ha dois apelidos iguais, e quando ha, a regra do
// "candidato unico" nao se aplica e caimos na semelhanca.
// -----------------------------------------------------------------------------

const LIMIAR = 0.7;
const LIMIAR_UNICO = 0.5;

const PARTICULAS = new Set(['de', 'da', 'do', 'dos', 'das', 'van', 'von', 'el', 'al', 'di', 'du']);

function fichasDistintivas(nome) {
  return normalizar(nome)
    .split(' ')
    .filter((t) => t.length >= 4 && !PARTICULAS.has(t));
}

export function criarIndice(registos) {
  const porEquipa = new Map();

  for (const r of registos) {
    const chave = equipaCanonica(r.equipa);
    if (!porEquipa.has(chave)) porEquipa.set(chave, []);
    porEquipa.get(chave).push({ ...r, __fichas: fichasDistintivas(r.nome) });
  }

  return porEquipa;
}

export function procurar(indice, nome, equipa) {
  const candidatos = indice.get(equipaCanonica(equipa)) ?? [];
  if (!candidatos.length) return null;

  const alvo = normalizar(nome);

  // 1. Igualdade depois de normalizar.
  const exacto = candidatos.find((c) => normalizar(c.nome) === alvo);
  if (exacto) return exacto;

  // 2. Apelido distintivo partilhado, e so um candidato o tem.
  const fichas = fichasDistintivas(nome);
  if (fichas.length) {
    const comFicha = candidatos.filter((c) =>
      c.__fichas.some((f) => fichas.includes(f))
    );
    if (comFicha.length === 1) return comFicha[0];
  }

  // 3. Semelhanca difusa.
  let melhor = null;
  let melhorPontos = 0;
  for (const c of candidatos) {
    const pontos = semelhanca(nome, c.nome);
    if (pontos > melhorPontos) {
      melhor = c;
      melhorPontos = pontos;
    }
  }
  if (melhor && melhorPontos >= LIMIAR) return melhor;

  // 4. Um so candidato cujo nome contem o outro. "Samu" e "Samu Aghehowa"
  //    nao chegam ao limiar por serem de comprimentos muito diferentes, mas
  //    dentro do mesmo clube nao ha duvida possivel.
  const contidos = candidatos.filter((c) => {
    const n = normalizar(c.nome);
    return n.startsWith(`${alvo} `) || n.endsWith(` ${alvo}`) || alvo.startsWith(`${n} `);
  });
  if (contidos.length === 1) return contidos[0];

  // 5. Ultimo recurso: candidato unico no clube com semelhanca fraca mas
  //    nao nula. Melhor um palpite fundamentado do que zero golos a quem
  //    marcou quatro.
  if (candidatos.length === 1 && melhorPontos >= LIMIAR_UNICO) return candidatos[0];

  return null;
}
