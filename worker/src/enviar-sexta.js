import 'dotenv/config';
import { enviarResumoSemanal } from './tarefas.js';

// Dispara a rotina de sexta a pedido, para testar em producao sem esperar
// pelo cron. Corre o MESMO codigo que o cron corre — se isto funcionar, a
// sexta automatica funciona.
//
//   npm run sexta
//
// Imprime a mensagem que enviou, para se poder rever o texto sem ter de ir
// ao Telegram.

const r = await enviarResumoSemanal({ log: console.log });

if (r.ok) {
  console.log('\n===== MENSAGEM ENVIADA =====\n');
  console.log(r.texto);
  console.log('\nSe nao chegou ao Telegram, falta TELEGRAM_TOKEN ou TELEGRAM_CHAT_ID.');
} else {
  console.error(`\nFalhou: ${r.erro}`);
  process.exitCode = 1;
}

// O bot fica com uma ligacao aberta; sem isto o comando nao termina.
process.exit(process.exitCode ?? 0);
