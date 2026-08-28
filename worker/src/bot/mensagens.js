const euros = (v) => `${Number(v ?? 0).toFixed(1)}M`;

const ROTULO = {
  lesao: 'lesionado',
  castigo: 'castigado',
  duvida: 'em dúvida',
};

// O Telegram corta mensagens acima de 4096 caracteres, por isso
// mantemos isto curto de proposito. O detalhe esta na app.
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
      linhas.push(`• ${j.nome} — ${ROTULO[j.ausencia.tipo] ?? 'fora'}`);
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
      linhas.push(`• *${j.nome}* (${j.equipa}) — ${motivo}${regresso}`);
    }
  } else {
    linhas.push('', '✅ *Nenhum dos teus jogadores está de fora.*');
  }

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

  linhas.push('', `_Na liga: ${lesionados} lesionados, ${castigados} castigados._`);

  if (boletim.avisos?.length) {
    linhas.push('', boletim.avisos.map((a) => '⚠️ ' + a).join('\n'));
  }

  return linhas.join('\n');
}
