import { bd, chave, AMBIENTE } from '../firestore.js';
import { REGRAS } from '../config/endpoints.js';

// -----------------------------------------------------------------------------
// O plantel sem login.
//
// O SSO da Liga Record faz a entrega de sessao por iframe e postMessage
// entre dominios. Isso exige um browser a serio; nenhum cliente HTTP o
// consegue reproduzir.
//
// Mas a pergunta que interessa e outra: o que e que precisamos mesmo do
// login? So uma coisa — saber quais sao os teus 23 jogadores. Todo o resto
// (mercado, valores, pontos) vem do playersearch.ashx, que responde sem
// sessao nenhuma.
//
// E o teu plantel muda no maximo uma vez por ronda, porque so tens uma troca.
// Guardar 23 ids e actualizar um por semana e trivial — e elimina a parte
// mais fragil do projecto inteiro.
// -----------------------------------------------------------------------------

// chave() aplica o sufixo do ambiente (_dev, _test), tal como no boletim.
// Sem isto o worker le "uid" e a app escreve "uid_dev".
const doc = () => bd().collection('plantel').doc(chave());

export async function lerPlantelGuardado({ log = () => {} } = {}) {
  const d = await doc().get();

  if (!d.exists) {
    // Antes de desistir, ver se o plantel esta noutro ambiente. E o erro
    // mais provavel: gravaste na app em dev e corres o worker em prod, ou
    // ao contrario.
    const uid = process.env.UID_DONO ?? 'dono';
    for (const sufixo of ['', '_dev', '_test']) {
      const alternativo = `${uid}${sufixo}`;
      if (alternativo === chave()) continue;
      const outro = await bd().collection('plantel').doc(alternativo).get();
      if (outro.exists) {
        log(
          `  Ha um plantel guardado em plantel/${alternativo}, mas este worker ` +
            `le plantel/${chave()}.`
        );
        log(`  Alinha o AMBIENTE do worker com o da app (agora: ${AMBIENTE}).`);
        break;
      }
    }
    return null;
  }

  const dados = d.data();
  if (!Array.isArray(dados.ids) || !dados.ids.length) return null;

  return {
    ids: dados.ids.map(String),
    actualizadoEm: dados.actualizadoEm ?? null,
    saldo: Number(dados.saldo ?? 0),
  };
}

export async function guardarPlantel({ ids, saldo = 0 }) {
  await doc().set(
    {
      ids: ids.map(String),
      saldo,
      actualizadoEm: new Date().toISOString(),
    },
    { merge: true }
  );
}

// Junta os ids guardados aos dados do mercado, que trazem nome, clube,
// posicao, custo e pontos actualizados.
export function montarEquipa(idsGuardados, mercado) {
  const porId = new Map(mercado.map((j) => [String(j.id), j]));

  const jogadores = [];
  const desaparecidos = [];

  for (const id of idsGuardados.ids) {
    const j = porId.get(id);
    if (j) jogadores.push(j);
    else desaparecidos.push(id);
  }

  const valorEquipa = jogadores.reduce((s, j) => s + j.custo, 0);

  return {
    jogadores,
    saldo: idsGuardados.saldo || Number((REGRAS.orcamentoTotal - valorEquipa).toFixed(2)),
    valorEquipa: Number(valorEquipa.toFixed(2)),
    completo: jogadores.length === REGRAS.tamanhoPlantel,
    faltam: Math.max(0, REGRAS.tamanhoPlantel - jogadores.length),
    desaparecidos,
    origem: 'guardado',
    actualizadoEm: idsGuardados.actualizadoEm,
  };
}
