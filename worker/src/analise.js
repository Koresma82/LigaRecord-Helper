// -----------------------------------------------------------------------------
// Analise da jornada, para decidir o onze.
//
// Tudo isto sai de dados que o boletim ja tem: o plantel com o proximo jogo,
// a classificacao e os cartoes. Nao ha pedidos novos.
//
// AVISO SOBRE O QUE ISTO NAO E: sao heuristicas, nao previsoes. "Joga contra
// o Benfica" reduz a probabilidade de pontos ofensivos, mas nao a zero, e um
// jogador do Benfica contra o ultimo classificado e o caso espelhado. Serve
// para ordenar duvidas, nao para decidir por ti.
// -----------------------------------------------------------------------------

// Os quatro que historicamente dominam.
//
// Identificados por PALAVRA distintiva, nao pelo nome completo: cada fonte
// escreve o prefixo a sua maneira ("SC Braga", "Sp. Braga", "Braga") e
// comparar strings inteiras deixava passar metade das grafias.
const PALAVRAS_GRANDES = ['benfica', 'sporting', 'porto', 'braga'];

const normalizar = (t = '') =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const ehGrande = (equipa = '') => {
  const palavras = normalizar(equipa).split(' ');
  return palavras.some((p) => PALAVRAS_GRANDES.includes(p));
};

// Posicao na tabela, por nome de equipa (aceita grafias diferentes).
function indexarClassificacao(classificacao = []) {
  const mapa = new Map();
  for (const e of classificacao) {
    mapa.set(normalizar(e.equipa), e);
  }
  return mapa;
}

function procurarEquipa(indice, nome = '') {
  const n = normalizar(nome);
  if (indice.has(n)) return indice.get(n);
  for (const [chave, valor] of indice) {
    if (n.includes(chave) || chave.includes(n)) return valor;
  }
  return null;
}

// -----------------------------------------------------------------------------

export function analisarJornada(boletim) {
  const plantel = boletim?.equipa?.plantel ?? [];
  const indice = indexarClassificacao(boletim?.classificacao ?? []);
  const totalEquipas = (boletim?.classificacao ?? []).length || 18;

  const jogadores = plantel.map((j) => {
    const jogo = j.proximoJogo ?? null;
    const adversario = jogo?.adversario ?? null;
    const tabelaAdv = adversario ? procurarEquipa(indice, adversario) : null;
    const tabelaPropria = procurarEquipa(indice, j.equipa);

    // Golos sofridos por jogo do adversario: quanto mais alto, melhor para
    // os nossos avancados e medios.
    // Casa e fora em separado, quando a fonte os dá.
    //
    // Isto importa mais do que parece: se o meu avançado joga EM CASA, o
    // que interessa é quanto o adversário sofre FORA — não a média geral.
    // Há equipas com registos muito diferentes conforme o local, e a média
    // dos dois esconde exactamente a informação que decide.
    const ladoAdversario = jogo?.casa ? tabelaAdv?.fora : tabelaAdv?.casa;
    const usarLado = ladoAdversario && ladoAdversario.jogos > 0;

    const golosSofridosPorJogo = usarLado
      ? ladoAdversario.golosSofridos / ladoAdversario.jogos
      : tabelaAdv && tabelaAdv.jogos > 0 && tabelaAdv.golosSofridos !== null
        ? tabelaAdv.golosSofridos / tabelaAdv.jogos
        : null;

    // Golos marcados por jogo do adversario: quanto mais baixo, melhor para
    // os nossos defesas e guarda-redes.
    const golosMarcadosPorJogo = usarLado
      ? ladoAdversario.golosMarcados / ladoAdversario.jogos
      : tabelaAdv && tabelaAdv.jogos > 0 && tabelaAdv.golosMarcados !== null
        ? tabelaAdv.golosMarcados / tabelaAdv.jogos
        : null;

    const defensivo = j.posicao === 'GR' || j.posicao === 'DEF';

    return {
      nome: j.nome,
      equipa: j.equipa,
      posicao: j.posicao,
      custo: j.custo,
      pontosTotais: j.pontosTotais ?? 0,
      pontosUltimaRonda: j.pontosUltimaRonda ?? null,
      amarelos: j.amarelos ?? 0,
      golos: j.golos ?? 0,
      assistencias: j.assistencias ?? 0,
      percentagemEquipas: j.percentagemEquipas ?? null,
      naoJoga: Boolean(j.naoJoga),

      temJogo: Boolean(jogo),
      adversario,
      casa: jogo?.casa ?? null,
      quando: jogo ? [jogo.data, jogo.hora].filter(Boolean).join(' ') : null,

      contraGrande: adversario ? ehGrande(adversario) : false,
      posicaoAdversario: tabelaAdv?.posicao ?? null,

      // A forma vem como "VVVVE": o jogo mais recente é o último caracter.
      formaAdversario: tabelaAdv?.forma ?? null,
      formaPropria: tabelaPropria?.forma ?? null,
      ladoUsado: usarLado ? (jogo?.casa ? 'fora do adversário' : 'casa do adversário') : 'total',
      posicaoPropria: tabelaPropria?.posicao ?? null,
      golosSofridosPorJogo,
      golosMarcadosPorJogo,

      // O sinal que interessa depende da posicao do jogador.
      favoravel: defensivo
        ? golosMarcadosPorJogo !== null && golosMarcadosPorJogo < 1
        : golosSofridosPorJogo !== null && golosSofridosPorJogo > 1.3,

      aUmAmarelo: (j.amarelos ?? 0) > 0 && (j.amarelos ?? 0) % 5 === 4,
    };
  });

  const disponiveis = jogadores.filter((j) => !j.naoJoga);

  return {
    jogadores,

    // Contra um dos quatro grandes, e fora de casa e pior.
    contraGrandes: disponiveis
      .filter((j) => j.contraGrande)
      .sort((a, b) => Number(a.casa) - Number(b.casa)),

    // Adversario na metade de baixo da tabela.
    contraFracos: disponiveis
      .filter(
        (j) =>
          !j.contraGrande &&
          j.posicaoAdversario !== null &&
          j.posicaoAdversario > totalEquipas / 2
      )
      .sort((a, b) => b.posicaoAdversario - a.posicaoAdversario),

    // Jogo favoravel pelo perfil do adversario (ataque fraco ou defesa fraca).
    favoraveis: disponiveis.filter((j) => j.favoravel && !j.contraGrande),

    // Sem jogo na jornada: equipa de folga ou jogo adiado.
    semJogo: disponiveis.filter((j) => !j.temJogo),

    aUmAmarelo: disponiveis.filter((j) => j.aUmAmarelo),

    // Quem produz. Golos e assistencias juntos: para um medio, assistir
    // vale tanto como marcar, e so olhar para golos escondia-o.
    produtivos: disponiveis
      .filter((j) => j.golos + j.assistencias > 0)
      .sort(
        (a, b) =>
          b.golos + b.assistencias - (a.golos + a.assistencias) ||
          b.golos - a.golos
      ),

    emCasa: disponiveis.filter((j) => j.casa === true).length,
    fora: disponiveis.filter((j) => j.casa === false).length,
  };
}

// -----------------------------------------------------------------------------
// O bloco de texto para o Telegram.
//
// Ordenado por accionabilidade: primeiro o que te faz tirar alguem do onze,
// depois o que te faz metê-lo.
// -----------------------------------------------------------------------------

export function blocoAnalise(boletim) {
  const a = analisarJornada(boletim);
  const linhas = [];

  if (!a.jogadores.length) return '';

  if (a.contraGrandes.length) {
    linhas.push('', '*Jogos difíceis*');
    for (const j of a.contraGrandes) {
      const onde = j.casa === false ? 'fora' : 'casa';
      const forma = j.formaAdversario ? ` [${j.formaAdversario.slice(-5)}]` : '';
      linhas.push(`• ${j.nome} (${j.posicao}) — ${j.adversario}${forma}, ${onde}`);
    }
    linhas.push('_Menos provável somarem muito. Pesa antes de os pores no onze._');
  }

  if (a.semJogo.length) {
    linhas.push(
      '',
      `⚪ *Sem jogo esta jornada:* ${a.semJogo.map((j) => j.nome).join(', ')}`,
      '_Somam zero. Tira-os do onze._'
    );
  }

  if (a.favoraveis.length) {
    linhas.push('', '*Jogos favoráveis*');
    for (const j of a.favoraveis.slice(0, 6)) {
      const onde = j.casa ? 'casa' : 'fora';
      const detalhe =
        j.posicao === 'GR' || j.posicao === 'DEF'
          ? `${j.adversario} marca ${j.golosMarcadosPorJogo.toFixed(1)}/jogo`
          : `${j.adversario} sofre ${j.golosSofridosPorJogo.toFixed(1)}/jogo`;
      const forma = j.formaAdversario ? ` [${j.formaAdversario.slice(-5)}]` : '';
      linhas.push(`• ${j.nome} (${j.posicao}) — ${detalhe}${forma}, ${onde}`);
    }
  }

  // "A um amarelo do castigo" NAO entra aqui de proposito: a mensagem
  // semanal ja tem esse bloco, e repeti-lo faz o leitor deixar de acreditar
  // que cada seccao diz coisa nova. Fica disponivel em analisarJornada()
  // para quem precisar.

  if (a.produtivos.length) {
    linhas.push('', '*Quem tem produzido*');
    for (const j of a.produtivos.slice(0, 6)) {
      const partes = [];
      if (j.golos) partes.push(`${j.golos}⚽`);
      if (j.assistencias) partes.push(`${j.assistencias}🅰️`);
      linhas.push(`• ${j.nome} (${j.posicao}) — ${partes.join(' ')}`);
    }
  }

  linhas.push('', `_Em casa: ${a.emCasa} · Fora: ${a.fora}_`);

  return linhas.join('\n');
}
