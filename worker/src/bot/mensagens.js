import { blocoAnalise } from '../analise.js';

const euros = (v) => `${Number(v ?? 0).toFixed(1)}M`;

const ROTULO = {
  lesao: 'lesionado',
  castigo: 'castigado',
  duvida: 'em dúvida',
};

// O Telegram corta mensagens acima de 4096 caracteres, por isso
// mantemos isto curto de proposito. O detalhe esta na app.
const BASE_LR = process.env.LR_BASE ?? 'https://liga.record.pt';

function ligacaoLigaRecord() {
  const equipa = process.env.LR_ID_TEAM;
  return equipa
    ? `${BASE_LR}/gerir-equipas/plantel.aspx?id_team=${equipa}`
    : BASE_LR;
}

export function resumoJornada(boletim) {
  // Quinta de manha: e este que te chega, com tudo o que precisas para ires
  // editar no site.
  const fora = boletim.emRisco.filter((j) => j.ausencia?.tipo !== 'duvida' && j.ausencia);
  const duvida = boletim.emRisco.filter((j) => j.ausencia?.tipo === 'duvida' || j.hipoteses);

  const linhas = [`*Ronda ${boletim.jornada?.numero ?? '?'}*`];

  if (boletim.jornada?.fechoMercado) {
    const horas = Math.round((new Date(boletim.jornada.fechoMercado) - Date.now()) / 36e5);
    if (horas > 0) {
      linhas.push(
        horas >= 48 ? `Fecha daqui a ${Math.floor(horas / 24)} dias.` : `Fecha daqui a ${horas}h.`
      );
    }
  }

  if (!fora.length && !duvida.length) {
    linhas.push('', 'Plantel inteiro disponível. Nada a fazer.');
    return linhas.join('\n');
  }

  if (fora.length) {
    linhas.push('', `*Não jogam (${fora.length})*`);
    for (const j of fora) {
      // Um vermelho suspende pelo menos um jogo, mas quantos e decidido pelo
      // Conselho de Disciplina. Dizer so "castigado" sugeria uma certeza
      // sobre a duracao que nao temos.
      const duracao = j.ausencia.duracaoIncerta ? ' (duração por decidir)' : '';
      linhas.push(`• ${j.nome} — ${ROTULO[j.ausencia.tipo] ?? 'fora'}${duracao}`);
    }
  }

  if (duvida.length) {
    linhas.push('', `*A confirmar (${duvida.length})*`);
    for (const j of duvida) {
      linhas.push(`• ${j.nome}${j.hipoteses ? ' — nome ambíguo, confirma' : ''}`);
    }
  }

  const s = boletim.sugestoes;
  if (s?.melhorTroca) {
    const { sai, entra, ganho, sobra } = s.melhorTroca;
    linhas.push('', `*A troca da ronda* (só tens ${s.trocasPermitidas})`);
    linhas.push(`${sai.nome} → *${entra.nome}* (${euros(entra.custo)})`);
    linhas.push(`sobra ${euros(sobra)}, média ${ganho >= 0 ? '+' : ''}${ganho}`);

    if (s.ficamNoPlantel?.length) {
      linhas.push(
        '',
        `Ficam no plantel sem poderem ser trocados: ${s.ficamNoPlantel
          .map((j) => j.nome)
          .join(', ')}. Tira-os do onze.`
      );
    }
  }

  // O que as noticias apanharam e as tabelas nao. Tambem aqui, para o
  // /boletim dar a mesma informacao que a mensagem automatica.
  linhas.push(...blocoIA(boletim));

  const meus = new Set((boletim.equipa?.plantel ?? []).map((j) => j.nome));

  // Castigos que nao dao para confirmar. So aparecem se forem TEUS —
  // encher a mensagem com duvidas sobre jogadores alheios nao ajuda.
  const duvidosos = (boletim.castigosPorConfirmar ?? []).filter((c) => meus.has(c.nome));
  if (duvidosos.length) {
    linhas.push('', '*Confirma antes de trocar*');
    for (const c of duvidosos) linhas.push(`• ${c.nome} — ${c.motivo}`);
  }

  // A um amarelo do castigo: aviso para a ronda seguinte, nao para esta.
  const noLimite = (boletim.emRiscoDeCastigo ?? []).filter((c) => meus.has(c.nome));
  if (noLimite.length) {
    linhas.push(
      '',
      `⚠️ A um amarelo do castigo: ${noLimite.map((c) => c.nome).join(', ')}`
    );
  }

  if (boletim.avisos?.length) {
    linhas.push('', boletim.avisos.map((a) => '⚠️ ' + a).join('\n'));
  }

  return linhas.join('\n');
}

export function alertaNovidade({ novidades, recuperados, tardio = false }) {
  const linhas = [];

  for (const j of novidades) {
    const motivo = j.ausencia ? ROTULO[j.ausencia.tipo] ?? 'indisponível' : 'a confirmar';
    linhas.push(`🔴 *${j.nome}* passou a ${motivo}.`);
  }
  for (const j of recuperados) {
    linhas.push(`🟢 *${j.nome}* saiu do boletim, já pode jogar.`);
  }

  if (!linhas.length) return '';

  if (tardio) {
    linhas.unshift('*Mudou desde quinta*', '');
    // Nao repetir "vai trocar" se ele ja gastou a troca da ronda.
    linhas.push(
      '',
      'Se já usaste a troca desta ronda, resta mexer no onze e nos suplentes.'
    );
  }

  return linhas.join('\n');
}

export function erroRecolha(mensagem) {
  return (
    '⚠️ *A recolha falhou.*\n\n' +
    '```\n' + mensagem.slice(0, 500) + '\n```\n\n' +
    'O boletim anterior continua no ar, mas está desatualizado. ' +
    'Confirma as ausências à mão antes do fecho do mercado.'
  );
}

const ORDEM = ['GR', 'DEF', 'MED', 'AVA'];
const NOME_POSICAO = { GR: 'Guarda-redes', DEF: 'Defesas', MED: 'Médios', AVA: 'Avançados' };

export function resumoPlantel(r) {
  if (r.erro) return `Não deu: ${r.erro}`;

  const fixos = new Set(r.fixos.map((j) => j.id));
  const linhas = [`*Plantel sugerido* — ${r.custoTotal.toFixed(2)}M, sobra ${r.sobra.toFixed(2)}M`];

  for (const posicao of ORDEM) {
    const grupo = r.plantel.filter((j) => j.posicao === posicao);
    if (!grupo.length) continue;
    linhas.push('', `*${NOME_POSICAO[posicao]}*`);
    for (const j of grupo) {
      const marca = fixos.has(j.id) ? '📌 ' : '';
      linhas.push(`${marca}${j.nome} (${j.equipa}) ${j.custo.toFixed(2)}M · ${j.pontos}pts`);
    }
  }

  if (r.naoEncontrados?.length) {
    linhas.push('', `Não encontrei: ${r.naoEncontrados.join(', ')}`);
  }

  linhas.push('', '📌 = fixado por ti. Pontos são os da época, não previsão.');
  return linhas.join('\n');
}

// -----------------------------------------------------------------------------
// A mensagem de sexta de manha.
//
// E a unica que chega sempre, e tem uma unica funcao: dizer-te se precisas
// de ir ao site mexer na equipa. Por isso comeca pela resposta a essa
// pergunta, e so depois dá o contexto da liga.
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// O que as noticias dizem e as tabelas nao.
//
// Separado em dois porque sao coisas diferentes e merecem peso diferente:
//
//   LESAO   noticia concreta de indisponibilidade que a tabela do
//           Transfermarkt nao apanhou. Isto e quase um facto e tem de te
//           saltar a vista — foi o caso do Zaidu, com lesao confirmada pelo
//           clube e ausente da tabela.
//
//   DUVIDA  sinal de risco sem confirmacao. Contexto, nao decisao.
//
// Nem um nem outro se somam a contagem dos que estao de fora, e nenhum entra
// nas substituicoes sugeridas. A troca da ronda e uma so; nao se gasta com
// base num palpite de modelo. O que isto faz e dizer-te onde ir confirmar.
// -----------------------------------------------------------------------------
// Escapa os caracteres que o Markdown "legacy" do Telegram usa como
// formatacao: _ * ` [. Sem isto, um destes caracteres vindo de texto que
// nao controlamos — as noticias que a IA le, um URL, a mensagem de um erro
// da API — pode fechar ou abrir uma formatacao a meio da mensagem, e o
// Telegram recusa a mensagem INTEIRA com "can't parse entities". Ja
// aconteceu: o /actualizar falhou por causa de um caracter algures dentro
// do bloco de noticias.
//
// Escapado, o caracter aparece tal e qual na mensagem — o Telegram remove
// a barra ao mostrar, nao fica um "\_" visivel.
function escaparMD(texto) {
  return String(texto ?? '').replace(/([_*`[])/g, '\\$1');
}

function blocoIA(boletim) {
  const ia = boletim.duvidasIA;
  if (!ia) return [];

  const achados = ia.achados ?? ia.duvidas ?? [];

  // Estado antes de conteudo. Uma mensagem sem bloco nenhum era
  // indistinguivel de "verifiquei e esta tudo bem" — e as duas coisas
  // levam-te a decisoes opostas.
  if (ia.estado && ia.estado !== 'ok') {
    const explicacao = {
      desligado: 'a verificação nas notícias está desligada',
      'sem-plantel': 'não há plantel registado para verificar',
      falhou: 'a verificação nas notícias falhou',
    };
    // ia.razao pode vir do corpo de um erro da API — texto que nao controlamos.
    const razao = ia.razao ? ` (${escaparMD(ia.razao)})` : '';
    return [
      '',
      `⚠️ _${explicacao[ia.estado] ?? 'verificação nas notícias indisponível'}${razao}._`,
      '_A tabela de lesionados sozinha deixa jogadores de fora. Confirma à mão._',
    ];
  }

  // Verificou e nao achou nada. Vale a pena dize-lo: silencio nao e prova
  // de que se procurou.
  if (!achados.length) {
    return ['', '📰 _Notícias verificadas: nada de novo sobre os teus jogadores._'];
  }

  const linhas = [];
  const lesoes = achados.filter((d) => d.tipo === 'lesao');
  const duvidas = achados.filter((d) => d.tipo !== 'lesao');

  const linha = (d) => {
    const confianca = d.confianca === 'alta' ? '' : ` _(confiança ${d.confianca})_`;
    // O nome das noticias so aparece quando difere do do plantel: e o que
    // te permite procurar a noticia sem ficares a pensar se e a mesma pessoa.
    // d.nome vem do plantel (controlado); nomeNaNoticia, motivo e fonte vem
    // do modelo a ler noticias — nao controlado, tem de ser escapado.
    const alias = d.nomeNaNoticia ? ` _(nas notícias: ${escaparMD(d.nomeNaNoticia)})_` : '';
    // A data do artigo, quando o modelo a conseguiu determinar. Sem isto so
    // tu podias apanhar um artigo velho, abrindo a fonte um a um — com a
    // data à frente, salta logo à vista.
    const data = d.dataNoticia ? ` _(${escaparMD(d.dataNoticia)})_` : '';
    const out = [`• *${d.nome}*${alias} — ${escaparMD(d.motivo)}${confianca}${data}`];
    if (d.fonte) out.push(`  ${escaparMD(d.fonte)}`);
    return out;
  };

  if (lesoes.length) {
    linhas.push(
      '',
      `🔴 *Nas notícias, mas fora da tabela de lesionados (${lesoes.length})*`
    );
    for (const d of lesoes) linhas.push(...linha(d));
    linhas.push('_A tabela do Transfermarkt não os tem. Confirma antes de decidir._');
  }

  if (duvidas.length) {
    linhas.push('', `📰 *Em dúvida nas notícias (${duvidas.length})*`);
    for (const d of duvidas) linhas.push(...linha(d));
    linhas.push('_Sinais de risco, não confirmações._');
  }

  return linhas;
}

export function resumoSemanal(boletim) {
  const jornada = boletim.jornada?.numero;
  const plantel = boletim.equipa?.plantel ?? [];

  const meusFora = boletim.emRisco.filter(
    (j) => j.ausencia && j.ausencia.tipo !== 'duvida'
  );
  const meusDuvida = boletim.emRisco.filter((j) => j.ausencia?.tipo === 'duvida');

  const nomes = new Set(plantel.map((j) => j.nome));
  const meusPertoDoCastigo = (boletim.emRiscoDeCastigo ?? []).filter((c) =>
    nomes.has(c.nome)
  );

  const linhas = [`*Jornada ${jornada ?? '?'}*`];

  // 1. A decisao, primeiro.
  if (meusFora.length) {
    linhas.push('', `⚠️ *Tens ${meusFora.length} jogador${meusFora.length > 1 ? 'es' : ''} de fora.*`);
    linhas.push('Vai ao site actualizar a equipa antes do fecho.');
    linhas.push('');
    for (const j of meusFora) {
      const motivo = j.ausencia.tipo === 'castigo' ? 'castigado' : 'lesionado';
      const regresso = j.ausencia.dataRegresso
        ? `, regresso ${j.ausencia.dataRegresso}`
        : '';
      const duracao = j.ausencia.duracaoIncerta ? ', duração por decidir' : '';
      linhas.push(`• *${j.nome}* (${j.equipa}) — ${motivo}${regresso}${duracao}`);
    }
  } else {
    linhas.push('', '✅ *Nenhum dos teus jogadores está de fora.*');
  }

  // 1b. O que as noticias apanharam e as tabelas nao. Fica AQUI, logo a
  //     seguir a decisao, e nao no fim: uma lesao confirmada pelo clube que
  //     o Transfermarkt nao lista muda o que vais fazer, e um "nenhum dos
  //     teus jogadores esta de fora" seguido de silencio e enganador quando
  //     as noticias dizem o contrario.
  linhas.push(...blocoIA(boletim));

  // 2. A troca sugerida, se houver alguem para trocar.
  const troca = boletim.sugestoes?.melhorTroca;
  if (meusFora.length && troca) {
    linhas.push(
      '',
      '*Troca sugerida* (só tens uma)',
      `${troca.sai.nome} → *${troca.entra.nome}* (${troca.entra.custo.toFixed(1)}M)`
    );
    if (boletim.sugestoes.ficamNoPlantel?.length) {
      linhas.push(
        `Ficam sem troca: ${boletim.sugestoes.ficamNoPlantel.map((j) => j.nome).join(', ')}.`
      );
    }
  }

  if (meusDuvida.length) {
    linhas.push('', `❓ Em dúvida: ${meusDuvida.map((j) => j.nome).join(', ')}`);
  }

  if (meusPertoDoCastigo.length) {
    linhas.push(
      '',
      `🟡 A um amarelo do castigo: ${meusPertoDoCastigo.map((c) => c.nome).join(', ')}`
    );
  }

  // 3. O contexto da liga, no fim.
  const naLiga = boletim.ligaInteira ?? [];
  const lesionados = naLiga.filter((j) => j.ausencia?.tipo === 'lesao').length;
  const castigados = naLiga.filter((j) => j.ausencia?.tipo === 'castigo').length;

  // 4. A analise da jornada: adversarios, quem nao tem jogo, quem esta a um
  //    amarelo. Fica antes do lembrete final porque e o que te faz mexer no
  //    onze — o lembrete e so o empurrao para ires ao site.
  const analise = blocoAnalise(boletim);
  if (analise) linhas.push(analise);

  // Se os valores do mercado nao sao desta recolha, diz-lo. Um plantel
  // avaliado com precos de ha uma semana leva a decisoes erradas, e o pior
  // e nao se saber que estao velhos.
  if (boletim.mercadoActual === false && boletim.mercadoRecolhidoEm) {
    const dias = Math.round(
      (Date.now() - new Date(boletim.mercadoRecolhidoEm).getTime()) / 86400000
    );
    linhas.push(
      '',
      `⏳ _Valores e pontuações de ${new Date(boletim.mercadoRecolhidoEm).toLocaleDateString('pt-PT')}` +
        `${dias > 0 ? ` (${dias} dia${dias > 1 ? 's' : ''})` : ''}. O resto está actualizado._`
    );
  }

  linhas.push('', `_Na liga: ${lesionados} lesionados, ${castigados} castigados._`);

  if (boletim.avisos?.length) {
    linhas.push('', boletim.avisos.map((a) => '⚠️ ' + a).join('\n'));
  }

  // O lembrete vai SEMPRE, mesmo quando nao ha nada de errado com o plantel.
  // O objectivo da mensagem de sexta e levar-te ao site; se so aparecesse
  // quando ha problemas, uma semana calma passava despercebida e o fecho
  // apanhava-te distraido.
  linhas.push('', '👉 Vai à Liga Record confirmar a equipa antes do fecho.');
  // O www.record.pt/liga-record nao existe — o jogo vive noutro host. Usamos
  // o mesmo BASE que o worker usa para ler os dados, e quando ha id de
  // equipa vai direito a pagina onde mexes mesmo no plantel.
  linhas.push(ligacaoLigaRecord());

  return linhas.join('\n');
}
