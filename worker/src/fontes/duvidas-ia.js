import { criarIndice, procurar } from '../emparelhar-jogador.js';

// -----------------------------------------------------------------------------
// Verificacao do plantel nas noticias, via API da Anthropic com pesquisa web.
//
// PORQUE E QUE ISTO E DIFERENTE DE TUDO O RESTO NESTE WORKER:
//
// As lesoes do Transfermarkt e os cartoes da Liga Portugal sao FACTOS lidos
// de tabelas. Isto nao. Sai de interpretar noticias e conferencias de
// imprensa. Um modelo a ler noticias acerta em muita coisa e inventa alguma.
//
// Por isso o resultado NUNCA se mistura com as ausencias confirmadas: vai
// para um campo proprio do boletim (duvidasIA), a mensagem mostra-o
// etiquetado, e nunca entra no calculo das substituicoes sugeridas. A troca
// da ronda e uma so — nao se gasta com base num palpite de modelo.
//
// -----------------------------------------------------------------------------
// PORQUE E QUE ISTO DEIXOU DE SER SO "DUVIDAS"
//
// O prompt tinha uma regra que dizia ao modelo para NAO reportar lesoes ja
// confirmadas, "porque o utilizador ja sabe por outras vias". Essa premissa
// era falsa e custou caro descobri-lo.
//
// O Zaidu (FC Porto) tinha lesao no adutor confirmada pelo clube, com
// semanas de paragem e noticia em todo o lado. A tabela de lesionados do
// Transfermarkt tinha cinco jogadores do FC Porto nesse dia — e nao o
// tinha a ele. O mesmo com o Liziero, do Nacional. A tabela nao falha em
// bloco, falha jogador a jogador, e um buraco parcial parece exactamente
// igual a boa noticia.
//
// Ou seja: a unica fonte capaz de apanhar o que a tabela deixa cair estava
// proibida por prompt de o fazer.
//
// Agora reporta os dois casos, com `tipo` a distinguir:
//   'lesao'  — noticia concreta de lesao ou indisponibilidade confirmada
//   'duvida' — sinal de risco sem confirmacao (treino condicionado, poupanca)
//
// E recebe a lista do que a app JA sabe, para nao repetir o que ja esta no
// boletim e gastar a resposta a dizer o obvio.
// -----------------------------------------------------------------------------

const MODELO = process.env.IA_MODELO ?? 'claude-sonnet-5';
const URL_API = 'https://api.anthropic.com/v1/messages';

const INSTRUCOES = `Es um assistente que investiga noticias de futebol portugues.

Vais receber a lista de jogadores da equipa de fantasy de um utilizador, na
Liga Portugal, o numero da proxima jornada, e a lista de jogadores que a
aplicacao JA sabe que estao de fora.

Pesquisa noticias RECENTES (ultimos 10 dias) em portugues sobre estes
jogadores e os seus clubes. O objectivo e responder a uma pergunta so:
algum destes jogadores corre o risco de nao jogar a proxima jornada?

Procura os dois tipos de sinal:

1. LESAO OU INDISPONIBILIDADE CONFIRMADA — o clube comunicou lesao, o
   jogador saiu de campo lesionado e ha exames, o treinador disse que esta
   fora, ha noticia de castigo, expulsao ou convocatoria para a seleccao que
   o faca falhar o jogo. Marca tipo "lesao".

2. DUVIDA — treino condicionado, queixas fisicas sem diagnostico, poupanca
   anunciada para jogo europeu, castigo interno, rumor de transferencia,
   declaracoes ambiguas do treinador sobre a disponibilidade. Marca tipo
   "duvida".

REGRAS QUE NAO PODES QUEBRAR:
- So incluis um jogador se encontrares uma noticia concreta que o justifique.
  Se nao encontraste nada sobre um jogador, ele NAO aparece na resposta.
- NAO repitas jogadores que ja constam da lista "a aplicacao ja sabe". Essa
  lista existe para nao gastares a resposta a confirmar o que ja e sabido.
  A tua utilidade esta exactamente no que NAO esta la.
- Nao inventes fontes. O campo "fonte" tem de ser um URL que abriste.
- Se nao encontrares nada sobre nenhum jogador, devolve uma lista vazia.
  Uma lista vazia e uma resposta correcta e util. Nao inventes para encher.
- Usa o nome pelo qual o jogador e conhecido, tal como aparece na lista do
  plantel que recebeste.

Responde APENAS com JSON valido, sem markdown, sem texto antes ou depois,
neste formato exacto:

{"achados":[{"nome":"...","equipa":"...","tipo":"lesao|duvida","motivo":"...","confianca":"alta|media|baixa","fonte":"https://..."}]}

O "motivo" e uma frase curta em portugues de Portugal, com o facto concreto
(por exemplo: "lesao no adutor confirmada pelo clube, varias semanas de
paragem").

Depois de pesquisares, a tua ULTIMA mensagem tem de ser so o objecto JSON.
Nao escrevas um resumo do que encontraste, nao expliques o que pesquisaste,
nao uses blocos de codigo. So o JSON.`;

function extrairJSON(texto) {
  const limpo = texto.replace(/```json|```/g, '').trim();
  const inicio = limpo.indexOf('{');
  const fim = limpo.lastIndexOf('}');
  if (inicio === -1 || fim === -1) throw new Error('A resposta nao continha JSON.');
  return JSON.parse(limpo.slice(inicio, fim + 1));
}

// So aceitamos o que tem a forma certa. Um modelo que devolva um campo a
// mais ou um valor estranho nao pode contaminar o boletim.
//
// O EMPARELHAMENTO E DIFUSO, e isso e uma correccao, nao um capricho. A
// versao anterior fazia `nomesDoPlantel.has(d.nome.toLowerCase())`: uma
// igualdade exacta. As noticias escrevem "Zaidu Sanusi" e o plantel da Liga
// Record diz "Zaidu"; o achado certo era deitado fora por causa do apelido.
// Usamos o mesmo `procurar` que liga o plantel as outras fontes, que ja sabe
// lidar com nomes curtos, completos e acentos — sempre dentro do mesmo clube.
function validar(bruto, plantel) {
  const indice = criarIndice(plantel);

  const lista = Array.isArray(bruto?.achados)
    ? bruto.achados
    : // Aceita o formato antigo, para um boletim gravado antes desta versao
      // nao rebentar a leitura.
      Array.isArray(bruto?.duvidas)
      ? bruto.duvidas
      : [];

  return lista
    .filter((d) => d && typeof d.nome === 'string' && typeof d.motivo === 'string')
    .map((d) => {
      const jogador = procurar(indice, d.nome, d.equipa ?? '');
      return jogador ? { d, jogador } : null;
    })
    // Se o modelo devolver um jogador que nao esta no plantel, alucinou.
    .filter(Boolean)
    .map(({ d, jogador }) => ({
      // O nome do PLANTEL, nao o das noticias: e assim que aparece em todo o
      // resto da mensagem e da app, e ver dois nomes para a mesma pessoa
      // confunde mais do que ajuda.
      nome: jogador.nome,
      nomeNaNoticia: d.nome !== jogador.nome ? d.nome : null,
      equipa: jogador.equipa ?? '',
      tipo: d.tipo === 'lesao' ? 'lesao' : 'duvida',
      motivo: d.motivo.slice(0, 200),
      confianca: ['alta', 'media', 'baixa'].includes(d.confianca) ? d.confianca : 'baixa',
      // Sem URL nao ha como confirmar, e um achado sem fonte nao vale nada.
      fonte: typeof d.fonte === 'string' && d.fonte.startsWith('http') ? d.fonte : null,
    }))
    .filter((d) => d.fonte);
}

/**
 * @param plantel        os 23 jogadores registados
 * @param jornada        a proxima jornada por jogar
 * @param opcoes.jaConhecidos  jogadores que a app ja sabe que estao de fora,
 *                             para o modelo nao gastar a resposta a repeti-los
 */
export async function duvidasDaJornada(plantel, jornada, { log = () => {}, jaConhecidos = [] } = {}) {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) {
    log('  Verificacao IA: desligada (sem ANTHROPIC_API_KEY)');
    return null;
  }
  // Sair calado aqui deixava a impressao de que a consulta nem existia.
  // Sem plantel nao ha nada para perguntar, mas convem dize-lo.
  if (!plantel?.length) {
    log('  Verificacao IA: sem plantel registado, nao ha o que perguntar');
    return null;
  }

  const lista = plantel.map((j) => `- ${j.nome} (${j.equipa})`).join('\n');

  const conhecidos = jaConhecidos.length
    ? jaConhecidos.map((j) => `- ${j.nome} (${j.equipa ?? ''})`).join('\n')
    : '(nenhum)';

  // Com a pesquisa web activa a resposta vem em VOLTAS: o modelo pesquisa,
  // le, pesquisa outra vez, e so no fim escreve. Cada volta termina com
  // stop_reason "pause_turn" e temos de devolver o que veio para ele
  // continuar. Assumir uma volta so era o que dava "a resposta nao continha
  // JSON" — o texto final ainda nao tinha sido escrito.
  const mensagens = [
    {
      role: 'user',
      content:
        `Proxima jornada: ${jornada}.\n\nPlantel:\n${lista}\n\n` +
        `A aplicacao ja sabe que estes estao de fora (nao os repitas):\n${conhecidos}`,
    },
  ];

  let dados = null;
  let voltas = 0;
  const MAX_VOLTAS = 5;

  while (voltas < MAX_VOLTAS) {
    voltas += 1;

    const resposta = await fetch(URL_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': chave,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 4000,
        system: INSTRUCOES,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: mensagens,
      }),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      throw new Error(`API da Anthropic devolveu ${resposta.status}: ${corpo.slice(0, 200)}`);
    }

    dados = await resposta.json();

    if (dados.stop_reason !== 'pause_turn') break;

    // Devolvemos o turno tal e qual para ele retomar de onde ficou.
    mensagens.push({ role: 'assistant', content: dados.content });
    log(`  Verificacao IA: a continuar a pesquisa (volta ${voltas})`);
  }

  // A resposta traz blocos de varios tipos (texto, uso da pesquisa,
  // resultados). O JSON esta nos blocos de texto — juntamo-los todos em vez
  // de assumir que e o primeiro.
  const texto = (dados.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  let bruto;
  try {
    bruto = extrairJSON(texto);
  } catch (erro) {
    // Sem ver o que veio nao ha como afinar o prompt. 300 caracteres chegam
    // para perceber se ele respondeu em prosa, se ficou a meio, ou se nao
    // encontrou nada.
    throw new Error(
      `${erro.message} Recebido (${dados.stop_reason}): ${texto.slice(0, 300) || '(vazio)'}`
    );
  }

  const achados = validar(bruto, plantel);
  const lesoes = achados.filter((d) => d.tipo === 'lesao');

  const custo = dados.usage
    ? ` (${dados.usage.input_tokens} in / ${dados.usage.output_tokens} out)`
    : '';
  log(
    `  Verificacao IA: ${achados.length} achados — ` +
      `${lesoes.length} lesao/indisponibilidade, ${achados.length - lesoes.length} duvida${custo}`
  );

  return {
    jornada,
    consultadoEm: new Date().toISOString(),
    modelo: MODELO,
    achados,
    // Mantido para os boletins e a app que ainda leem `duvidas`.
    duvidas: achados,
  };
}
