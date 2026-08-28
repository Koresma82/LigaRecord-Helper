import 'dotenv/config';
import http from 'node:http';
import cron from 'node-cron';
import { bot, avisar } from './bot/bot.js';
import { recolher, recolherLeve } from './recolher.js';
import { lerBoletim } from './firestore.js';
import { alertaNovidade, resumoSemanal, erroRecolha } from './bot/mensagens.js';

const PORTA = process.env.PORT || 3000;
const FUSO = 'Europe/Lisbon';

let ultimaRecolha = null;
let ultimoErro = null;
const arrancouEm = new Date().toISOString();

// -----------------------------------------------------------------------------
// Calendario
//
//   Todos os dias 07:00   recolha LEVE: so lesoes e cartoes, reaproveitando
//                         o mercado da ultima completa. Silenciosa, excepto
//                         se alguem do TEU plantel mudar de estado.
//
//   Quarta 08:00          recolha COMPLETA: mercado, valores, classificacao,
//                         jogos, golos. Os valores da Liga Record sao
//                         actualizados a quarta, no maximo.
//
//   Sexta 08:00           A MENSAGEM. Lesionados e castigados, quais sao
//                         teus, e o aviso para ires actualizar a equipa.
//
// A diaria e leve de proposito: varrer 538 jogadores todos os dias para
// descobrir que ninguem se lesionou seria desperdicio, e mais uma
// oportunidade de sermos barrados.
// -----------------------------------------------------------------------------

async function completa() {
  try {
    await recolher();
    ultimaRecolha = new Date().toISOString();
    ultimoErro = null;
    console.log('Recolha completa concluida.');
  } catch (erro) {
    ultimoErro = erro.message;
    console.error(erro.message);
    await avisar(erroRecolha(erro.message)).catch(() => {});
  }
}

async function diaria() {
  try {
    const anterior = await lerBoletim();
    const antes = new Set((anterior?.emRisco ?? []).map((j) => j.id));

    const boletim = await recolherLeve({ log: () => {} });
    ultimaRecolha = new Date().toISOString();
    ultimoErro = null;

    const novidades = boletim.emRisco.filter((j) => !antes.has(j.id));
    const recuperados = (anterior?.emRisco ?? []).filter(
      (a) => !boletim.emRisco.some((j) => j.id === a.id)
    );

    // So falamos se algo mudou no TEU plantel. Uma mensagem diaria a dizer
    // "esta tudo na mesma" deixa de ser lida ao fim de uma semana.
    const texto = alertaNovidade({ novidades, recuperados });
    if (texto) await avisar(texto);
  } catch (erro) {
    ultimoErro = erro.message;
    console.error(erro.message);
    await avisar(erroRecolha(erro.message)).catch(() => {});
  }
}

async function mensagemDeSexta() {
  try {
    // Recolhe primeiro, para a mensagem levar o que ha de mais recente.
    const boletim = await recolherLeve({ log: () => {} });
    ultimaRecolha = new Date().toISOString();
    ultimoErro = null;
    await avisar(resumoSemanal(boletim));
  } catch (erro) {
    ultimoErro = erro.message;
    console.error(erro.message);
    await avisar(erroRecolha(erro.message)).catch(() => {});
  }
}

cron.schedule('0 7 * * *', diaria, { timezone: FUSO });
cron.schedule('0 8 * * 3', completa, { timezone: FUSO });
cron.schedule('0 8 * * 5', mensagemDeSexta, { timezone: FUSO });

// O Railway mata servicos sem porta a escutar. Isto tambem serve de
// pagina de saude para saberes se o worker esta vivo.
//
// Responde SEMPRE 200 quando o processo esta de pe, mesmo com a ultima
// recolha falhada. Sao duas perguntas diferentes: "o worker esta vivo?" e
// "a ultima recolha correu bem?". O Railway so sabe fazer a primeira, e
// devolver-lhe 503 por causa da segunda punha-o a reiniciar o servico em
// ciclo de cada vez que o Zerozero mudasse um selector — exactamente
// quando o worker precisa de ficar de pe para o poderes inspeccionar.
// O estado da recolha vai no corpo, para tu o leres.
http
  .createServer((req, res) => {
    if (req.url === '/saude') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify(
          {
            estado: 'vivo',
            ultimaRecolha,
            ultimaRecolhaOk: !ultimoErro,
            ultimoErro,
            bot: Boolean(bot),
            ambiente: process.env.AMBIENTE ?? 'dev',
            arrancouEm,
          },
          null,
          2
        )
      );
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('boletim-worker\n');
  })
  .listen(PORTA, '0.0.0.0', () => console.log(`Worker a escutar na porta ${PORTA}`));

if (bot) {
  bot.start();
  console.log('Bot do Telegram ligado.');
} else {
  console.log('Sem TELEGRAM_TOKEN — o bot fica desligado, o cron continua.');
}

// Uma recolha leve ao arrancar, para nao esperar pelo proximo cron.
// Sem await de proposito: o servidor ja esta a escutar e o healthcheck do
// Railway nao pode ficar a espera de uma recolha completa para responder.
diaria();

// Uma excepcao solta nao pode derrubar o worker: perder-se-ia o cron todo
// por causa de um pedido HTTP que correu mal.
process.on('unhandledRejection', (e) => {
  ultimoErro = e?.message ?? String(e);
  console.error('Promessa rejeitada sem tratamento:', ultimoErro);
});
