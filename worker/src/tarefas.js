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
// `comIA` decide se esta chamada verifica as noticias. Quem decide QUANDO
// isso acontece e o servidor.js (quarta, quinta e sexta por defeito, so
// sexta se IA_SO_SEXTA=1) — este ficheiro so obedece ao que lhe mandam.
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
