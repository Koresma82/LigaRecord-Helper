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

// -----------------------------------------------------------------------------
// DUAS FALHAS REAIS APANHADAS EM PRODUCAO, e o porque de cada correccao.
//
// 1. NOTICIA DA EPOCA ERRADA.
//
//    O modelo devolveu o Zaidu como lesionado citando um artigo do
//    Soccerway com o TITULO "Ausencias da 6.a jornada da Liga Portugal" —
//    parecia perfeito. Mas o artigo era de 19.09.2024, duas epocas antes da
//    actual. Sites de futebol republicam este genero de peca todas as
//    epocas com o MESMO titulo generico; uma pesquisa por
//    "ausencias jornada 6" da liga sem mais contexto apanha qualquer uma
//    delas, e o titulo por si so nao distingue.
//
//    A correccao tem duas camadas. Ao modelo passamos a data de hoje e a
//    epoca actual, e uma instrucao explicita para confirmar a data do
//    artigo antes de o usar. Mas nao confiamos so nisso — pedimos tambem
//    que reporte essa data num campo `dataNoticia`, e o CODIGO (nao o
//    modelo) rejeita qualquer achado cuja data seja claramente de outra
//    epoca. Um modelo a interpretar noticias erra; uma comparacao de datas
//    no codigo nao.
//
// 2. LESAO CONHECIDA QUE NAO APARECEU.
//
//    O Liziero (Nacional) estava lesionado e nao foi apanhado, apesar de
//    haver noticia facil de encontrar. A pesquisa generica "ausencias da
//    jornada" tende a devolver so os casos que fazem manchete — os clubes
//    grandes. Um jogador de um emblema mais pequeno fica de fora se a
//    pesquisa nao for, tambem, jogador a jogador.
// -----------------------------------------------------------------------------


const INSTRUCOES_BASE = `Es um assistente que investiga noticias de futebol portugues.

Vais receber a DATA DE HOJE, a EPOCA actual da Liga Portugal, a lista de
jogadores da equipa de fantasy de um utilizador, o numero da proxima
jornada, e a lista de jogadores que a aplicacao JA sabe que estao de fora.

Pesquisa noticias RECENTES em portugues sobre estes jogadores e os seus
clubes. O objectivo e responder a uma pergunta so: algum destes jogadores
corre o risco de nao jogar a proxima jornada?

Procura os dois tipos de sinal:

1. LESAO OU INDISPONIBILIDADE CONFIRMADA — o clube comunicou lesao, o
   jogador saiu de campo lesionado e ha exames, o treinador disse que esta
   fora, ha noticia de castigo, expulsao ou convocatoria para a seleccao que
   o faca falhar o jogo. Marca tipo "lesao".

2. DUVIDA — treino condicionado, queixas fisicas sem diagnostico, poupanca
   anunciada para jogo europeu, castigo interno, rumor de transferencia,
   declaracoes ambiguas do treinador sobre a disponibilidade. Marca tipo
   "duvida".

COMO PESQUISAR, PARA NAO PERDERES CASOS:
- Uma pesquisa generica do tipo "ausencias jornada X liga portugal" NAO
  chega. Sites de futebol dao destaque aos clubes grandes; um jogador de
  um emblema mais pequeno so aparece se procurares o NOME DELE
  directamente. Para jogadores de clubes que nao sejam os quatro grandes,
  faz pelo menos uma pesquisa pelo nome do jogador mais o nome do clube.
- Um titulo generico do tipo "Ausencias da jornada X da Liga Portugal" e
  frequentemente um FORMATO RECORRENTE que sites como o Flashscore ou o
  Soccerway publicam TODAS AS EPOCAS com o mesmo titulo. O titulo, por si
  so, nao prova que o artigo e desta epoca. Confirma sempre a data.

SOBRE DATAS — ISTO E CRITICO E JA CAUSOU UM ERRO REAL:
- So podes usar uma noticia se conseguires confirmar que foi publicada ou
  actualizada DENTRO DOS ULTIMOS 14 DIAS a contar da data de hoje que te foi
  dada, E que se refere a EPOCA actual que te foi dada.
- A maioria das paginas mostra a data de publicacao ou de actualizacao
  perto do titulo. Le-a. Se a pagina disser uma data de uma epoca anterior
  (por exemplo, ha dois anos), ou se e um artigo sobre uma jornada 6 de
  uma epoca diferente da actual, DESCARTA-O — nao serve, mesmo que o
  jogador e a lesao pareçam correctos. Pode ser um evento antigo que nao
  tem nada a ver com agora.
- Se nao conseguires determinar a data do artigo com confianca, usa o
  artigo na mesma SO se o confianca for "baixa" e digas isso no motivo.
- Preenche sempre "dataNoticia" com a data que encontraste no formato
  AAAA-MM-DD. Se nao conseguires determinar a data, escreve null.

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

{"achados":[{"nome":"...","equipa":"...","tipo":"lesao|duvida","motivo":"...","confianca":"alta|media|baixa","fonte":"https://...","dataNoticia":"AAAA-MM-DD ou null"}]}

O "motivo" e uma frase curta em portugues de Portugal, com o facto concreto
(por exemplo: "lesao no adutor confirmada pelo clube, varias semanas de
paragem").

Depois de pesquisares, a tua ULTIMA mensagem tem de ser so o objecto JSON.
Nao escrevas um resumo do que encontraste, nao expliques o que pesquisaste,
nao uses blocos de codigo. So o JSON.`;

// A epoca legivel para o prompt: "20262027" -> "2026/2027". Reaproveita a
// mesma variavel que o resto do worker usa para pedir dados a API da Liga
// Portugal, para as duas fontes nunca poderem discordar sobre que epoca e
// "a actual".
function epocaLegivel() {
  const bruta = process.env.LP_EPOCA ?? '20262027';
  return bruta.length === 8 ? `${bruta.slice(0, 4)}/${bruta.slice(4)}` : bruta;
}

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
// Rejeita mecanicamente um achado cuja data seja claramente de outra epoca.
// Isto NAO substitui a instrucao ao modelo — e a segunda camada, para o caso
// de o modelo se enganar mesmo assim, como aconteceu com o artigo do
// Soccerway de ha duas epocas. Uma comparacao de datas no codigo nao erra.
//
// Deliberadamente GENEROSA: so rejeita o que e inequivocamente velho (mais
// de 45 dias) ou impossivel (no futuro). Datas que o modelo nao conseguiu
// determinar (null) ou que estao dentro da margem ficam — a intencao e
// apanhar o erro obvio da epoca trocada, nao filtrar tudo ao milimetro.
export function dataEProvavelmenteActual(dataNoticia, hoje) {
  if (!dataNoticia) return true;
  const d = new Date(dataNoticia);
  if (Number.isNaN(d.getTime())) return true;
  const diasDeDiferenca = (hoje.getTime() - d.getTime()) / 86_400_000;
  return diasDeDiferenca >= -2 && diasDeDiferenca <= 45;
}

export function validar(bruto, plantel, { hoje = new Date() } = {}) {
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
    // O artigo do Soccerway de 2024: titulo perfeito, jogador certo, epoca
    // errada. Esta e a linha que o teria apanhado.
    .filter((d) => dataEProvavelmenteActual(d.dataNoticia, hoje))
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
      dataNoticia: typeof d.dataNoticia === 'string' ? d.dataNoticia : null,
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
  // DEVOLVE SEMPRE UM ESTADO, nunca null.
  //
  // Devolver null fazia a mensagem omitir o bloco por completo — e uma
  // omissao e indistinguivel de "verifiquei e nao encontrei nada". Ficavas
  // a olhar para uma mensagem sem avisos sem saber se era boa noticia ou se
  // a chave da API nem estava configurada. E a mesma falha silenciosa que
  // este projecto todo existe para evitar.
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) {
    log('  Verificacao IA: desligada (sem ANTHROPIC_API_KEY)');
    return { jornada, estado: 'desligado', razao: 'ANTHROPIC_API_KEY não está definida', achados: [], duvidas: [] };
  }
  if (!plantel?.length) {
    log('  Verificacao IA: sem plantel registado, nao ha o que perguntar');
    return { jornada, estado: 'sem-plantel', razao: 'não há plantel registado', achados: [], duvidas: [] };
  }

  const hoje = new Date();
  // Formato longo em portugues, para o modelo nao ter de adivinhar o
  // separador da data ("10/9" podia ser 10 de Setembro ou 9 de Outubro).
  const hojeLegivel = hoje.toLocaleDateString('pt-PT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

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
        `Data de hoje: ${hojeLegivel} (${hoje.toISOString().slice(0, 10)}).\n` +
        `Epoca actual da Liga Portugal: ${epocaLegivel()}.\n` +
        `Proxima jornada: ${jornada}.\n\nPlantel:\n${lista}\n\n` +
        `A aplicacao ja sabe que estes estao de fora (nao os repitas):\n${conhecidos}`,
    },
  ];

  let dados = null;
  let voltas = 0;
  // 8, nao 5: verificar 23 jogadores individuais (o Liziero so foi
  // encontrado assim, nao por uma pesquisa generica da jornada) precisa de
  // mais idas e voltas de pesquisa do que uma so pergunta agregada.
  const MAX_VOLTAS = 8;

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
        system: INSTRUCOES_BASE,
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

  const achados = validar(bruto, plantel, { hoje });
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
    estado: 'ok',
    consultadoEm: new Date().toISOString(),
    modelo: MODELO,
    achados,
    // Mantido para os boletins e a app que ainda leem `duvidas`.
    duvidas: achados,
  };
}
