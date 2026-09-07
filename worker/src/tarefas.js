import { avisar } from './bot/bot.js';
import { recolherLeve } from './recolher.js';
import { resumoSemanal, erroRecolha } from './bot/mensagens.js';

// -----------------------------------------------------------------------------
// A rotina de sexta, num sitio so.
//
// Vive aqui em vez de dentro do servidor.js para o cron e o comando manual
// (`npm run sexta`) correrem EXACTAMENTE o mesmo codigo. Se fossem duas
// copias, testar a mao deixaria de provar que a automatica funciona — que e
// o unico motivo para haver um comando manual.
//
// A analise vai nas tres mensagens da semana (quarta, quinta e sexta), mas
// a chamada paga a IA NAO. So a de sexta a faz.
//
// A razao e de custo, nao de utilidade: correr as duvidas por IA tres vezes
// por semana triplica a factura para acrescentar pouco — as noticias de
// quarta ainda sao as mesmas de terca. A sexta e a que decide, e e essa que
// leva tudo.
// -----------------------------------------------------------------------------
export async function enviarResumoSemanal({ log = () => {}, comIA = true } = {}) {
  try {
    const boletim = await recolherLeve({ log, duvidasIA: comIA });
    const texto = resumoSemanal(boletim);
    await avisar(texto);
    return { ok: true, boletim, texto };
  } catch (erro) {
    // O aviso de erro tambem vai para o Telegram: uma sexta silenciosa
    // porque a recolha rebentou e pior do que uma sexta com mas noticias.
    await avisar(erroRecolha(erro.message)).catch(() => {});
    return { ok: false, erro: erro.message };
  }
}
