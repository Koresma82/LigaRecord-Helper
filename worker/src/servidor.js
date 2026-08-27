import 'dotenv/config';
import http from 'node:http';
import cron from 'node-cron';
import { bot, avisar } from './bot/bot.js';
import { recolherEDetectarNovidades } from './recolher.js';
import { alertaNovidade, resumoJornada, erroRecolha } from './bot/mensagens.js';

const PORTA = process.env.PORT || 3000;
const FUSO = 'Europe/Lisbon';

let ultimaRecolha = null;
let ultimoErro = null;

async function ciclo({ resumoCompleto = false } = {}) {
  try {
    const { boletim, novidades, recuperados } = await recolherEDetectarNovidades();
    ultimaRecolha = new Date().toISOString();
    ultimoErro = null;

    if (resumoCompleto) {
      await avisar(resumoJornada(boletim));
    } else {
      // Durante a semana so avisamos quando muda alguma coisa.
      // Uma mensagem por dia a dizer o mesmo deixa de ser lida.
      const texto = alertaNovidade({ novidades, recuperados });
      if (texto) await avisar(texto);
    }
  } catch (erro) {
    ultimoErro = erro.message;
    console.error(erro.message);
    await avisar(erroRecolha(erro.message)).catch(() => {});
  }
}

// Quinta 18:00 — saiu o mapa de castigos.
cron.schedule('0 18 * * 4', () => ciclo(), { timezone: FUSO });
// Sexta 12:00 e 19:00 — conferencias de imprensa.
cron.schedule('0 12,19 * * 5', () => ciclo(), { timezone: FUSO });
// Sabado 09:00 — resumo completo antes do fecho do mercado.
cron.schedule('0 9 * * 6', () => ciclo({ resumoCompleto: true }), { timezone: FUSO });

// O Railway mata servicos sem porta a escutar. Isto tambem serve de
// pagina de saude para saberes se o worker esta vivo.
http
  .createServer((req, res) => {
    if (req.url === '/saude') {
      res.writeHead(ultimoErro ? 503 : 200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({ ultimaRecolha, ultimoErro, bot: Boolean(bot) }, null, 2)
      );
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('boletim-worker\n');
  })
  .listen(PORTA, () => console.log(`Worker a escutar na porta ${PORTA}`));

if (bot) {
  bot.start();
  console.log('Bot do Telegram ligado.');
} else {
  console.log('Sem TELEGRAM_TOKEN — o bot fica desligado, o cron continua.');
}

// Uma recolha ao arrancar, para nao esperar pelo proximo cron.
ciclo();
