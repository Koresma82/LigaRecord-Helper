// -----------------------------------------------------------------------------
// Duvidas para a proxima jornada, via API da Anthropic com pesquisa web.
//
// PORQUE E QUE ISTO E DIFERENTE DE TUDO O RESTO NESTE WORKER:
//
// As lesoes e os cartoes sao FACTOS lidos de tabelas. Isto nao. "Em duvida"
// nao existe em tabela nenhuma — sai de interpretar noticias e conferencias
// de imprensa. Um modelo a ler noticias acerta em muita coisa e inventa
// alguma.
//
// Por isso o resultado NUNCA se mistura com as ausencias confirmadas: vai
// para um campo proprio do boletim (duvidasIA) e a app mostra-o etiquetado
// como nao confirmado. Nunca entra no calculo das substituicoes sugeridas.
//
// Corre uma vez por jornada, nao uma vez por dia — quem chama e que garante
// isso (ver recolher.js).
// -----------------------------------------------------------------------------

const MODELO = process.env.IA_MODELO ?? 'claude-sonnet-5';
const URL_API = 'https://api.anthropic.com/v1/messages';

const INSTRUCOES = `Es um assistente que investiga noticias de futebol portugues.

Vais receber a lista de jogadores da equipa de fantasy de um utilizador, na
Liga Portugal, e o numero da proxima jornada.

Pesquisa noticias RECENTES (ultimos 7 dias) em portugues sobre estes
jogadores e os seus clubes. Procura sinais de que possam nao ser utilizados
na proxima jornada: treino condicionado, saida de campo com queixas,
poupanca para jogo europeu, castigo interno, rumor de transferencia,
declaracoes do treinador sobre a disponibilidade.

REGRAS QUE NAO PODES QUEBRAR:
- So incluis um jogador se encontrares uma noticia concreta que o justifique.
  Se nao encontraste nada sobre um jogador, ele NAO aparece na resposta.
- Nao incluas jogadores por lesao ja confirmada nem por castigo — isso o
  utilizador ja sabe por outras vias. So duvidas.
- Nao inventes fontes. O campo "fonte" tem de ser um URL que abriste.
- Se nao encontrares nada sobre nenhum jogador, devolve uma lista vazia.
  Uma lista vazia e uma resposta correcta e util.

Responde APENAS com JSON valido, sem markdown, sem texto antes ou depois,
neste formato exacto:

{"duvidas":[{"nome":"...","equipa":"...","motivo":"...","confianca":"alta|media|baixa","fonte":"https://..."}]}

O "motivo" e uma frase curta em portugues de Portugal.`;

function extrairJSON(texto) {
  const limpo = texto.replace(/```json|```/g, '').trim();
  const inicio = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (inicio === -1 || fim === -1) throw new Error('A resposta nao continha JSON.');
  return JSON.parse(limpo.slice(inicio, fim + 1));
}

// So aceitamos o que tem a forma certa. Um modelo que devolva um campo a
// mais ou um valor estranho nao pode contaminar o boletim.
function validar(bruto, plantel) {
  const nomesDoPlantel = new Set(plantel.map((j) => j.nome.toLowerCase()));

  return (Array.isArray(bruto?.duvidas) ? bruto.duvidas : [])
    .filter((d) => d && typeof d.nome === 'string' && typeof d.motivo === 'string')
    // Se o modelo devolver um jogador que nao esta no plantel, alucinou.
    .filter((d) => nomesDoPlantel.has(d.nome.toLowerCase()))
    .map((d) => ({
      nome: d.nome,
      equipa: typeof d.equipa === 'string' ? d.equipa : '',
      motivo: d.motivo.slice(0, 200),
      confianca: ['alta', 'media', 'baixa'].includes(d.confianca) ? d.confianca : 'baixa',
      // Sem URL nao ha como confirmar, e uma duvida sem fonte nao vale nada.
      fonte: typeof d.fonte === 'string' && d.fonte.startsWith('http') ? d.fonte : null,
    }))
    .filter((d) => d.fonte);
}

export async function duvidasDaJornada(plantel, jornada, { log = () => {} } = {}) {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) {
    log('  Duvidas IA: desligado (sem ANTHROPIC_API_KEY)');
    return null;
  }
  if (!plantel?.length) return null;

  const lista = plantel.map((j) => `- ${j.nome} (${j.equipa})`).join('\n');

  const resposta = await fetch(URL_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': chave,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 2000,
      system: INSTRUCOES,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [
        {
          role: 'user',
          content: `Proxima jornada: ${jornada}.\n\nPlantel:\n${lista}`,
        },
      ],
    }),
  });

  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(`API da Anthropic devolveu ${resposta.status}: ${corpo.slice(0, 200)}`);
  }

  const dados = await resposta.json();

  // A resposta traz blocos de varios tipos (texto, uso da pesquisa,
  // resultados). O JSON esta nos blocos de texto — juntamo-los todos em vez
  // de assumir que e o primeiro.
  const texto = (dados.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const duvidas = validar(extrairJSON(texto), plantel);

  const custo = dados.usage
    ? ` (${dados.usage.input_tokens} in / ${dados.usage.output_tokens} out)`
    : '';
  log(`  Duvidas IA: ${duvidas.length} jogadores${custo}`);

  return {
    jornada,
    consultadoEm: new Date().toISOString(),
    modelo: MODELO,
    duvidas,
  };
}
