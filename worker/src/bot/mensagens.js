const euros = (v) => `${Number(v ?? 0).toFixed(1)}M`;

const ROTULO = {
  lesao: 'lesionado',
  castigo: 'castigado',
  duvida: 'em dúvida',
};

// O Telegram corta mensagens acima de 4096 caracteres, por isso
// mantemos isto curto de proposito. O detalhe esta na app.
export function resumoJornada(boletim) {
  const fora = boletim.emRisco.filter((j) => j.ausencia?.tipo !== 'duvida' && j.ausencia);
  const duvida = boletim.emRisco.filter((j) => j.ausencia?.tipo === 'duvida' || j.hipoteses);

  const linhas = [`*Jornada ${boletim.jornada?.numero ?? '?'}*`];

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

  if (boletim.avisos?.length) {
    linhas.push('', '⚠️ ' + boletim.avisos.join(' '));
  }

  return linhas.join('\n');
}

export function alertaNovidade({ novidades, recuperados }) {
  const linhas = [];
  for (const j of novidades) {
    const motivo = j.ausencia ? ROTULO[j.ausencia.tipo] ?? 'indisponível' : 'a confirmar';
    linhas.push(`🔴 *${j.nome}* passou a ${motivo}.`);
  }
  for (const j of recuperados) {
    linhas.push(`🟢 *${j.nome}* saiu do boletim, já pode jogar.`);
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
