import { Bot } from 'grammy';
import { lerBoletim, guardarPerfil, lerPerfil } from '../firestore.js';
import { recolher, recolherLeve } from '../recolher.js';
import { montarPlantel } from '../partilhado/montar-plantel.js';
import { resumoJornada, resumoPlantel, resumoSemanal } from './mensagens.js';

const TOKEN = process.env.TELEGRAM_TOKEN;

// -----------------------------------------------------------------------------
// Rede de seguranca contra "can't parse entities".
//
// Ja aconteceu uma vez: um caracter de formatacao do Telegram (_ * ` [)
// dentro de texto que nao controlamos — nomeadamente as noticias que a IA
// le — desalinhou o Markdown e o Telegram recusou a mensagem INTEIRA. A
// correcao foi escapar esse texto na origem (blocoIA, em mensagens.js).
//
// Isto aqui e a segunda camada, nao um substituto da primeira. Escapar bem
// exige apanhar TODOS os pontos de entrada de texto externo, e um projecto
// deste tamanho tende a ganhar mais pontos desses ao longo do tempo — uma
// nova fonte de noticias, um novo campo scraped. Se algum escapar, preferimos
// entregar a mensagem sem negritos a nao entregar mensagem nenhuma: a
// informacao (quem esta de fora, antes do fecho do mercado) interessa mais
// do que o estilo.
// Detecta pelo CODIGO HTTP, nao pelo texto exacto do erro.
//
// A primeira versao disto procurava "can't parse entities" em erro.message,
// e mesmo assim a mensagem continuou a falhar em producao. A explicacao mais
// provavel: o grammy pode expor o detalhe do erro noutra propriedade
// consoante a versao ou o tipo de falha, e um padrao de texto que nao bate
// certo falha CALADO — o erro original escapa por cima da rede de seguranca
// sem nunca se tentar a segunda vez.
//
// Um 400 do Telegram a um sendMessage e QUASE SEMPRE um problema com o
// TEXTO que mandamos (Markdown mal formado, mensagem vazia ou longa de mais)
// e nunca um problema de rede ou autenticacao — esses vêm com outros
// codigos. O error_code e mais estavel do que qualquer frase.
function eErroDeFormatacao(erro) {
  const codigo =
    erro?.error_code ?? erro?.response?.error_code ?? erro?.parameters?.error_code ?? null;
  if (codigo === 400) return true;

  // Sem error_code disponivel (biblioteca ou versao diferente), tenta o
  // texto em qualquer sitio onde possa estar.
  const texto = [erro?.message, erro?.description, String(erro ?? '')].join(' ');
  return /can't parse entities|400.*bad request/i.test(texto);
}

// Remove os caracteres de formatacao em vez de os escapar: uma vez que o
// Telegram ja recusou a mensagem, nao vale a pena adivinhar ONDE partiu para
// os escapar cirurgicamente. Tirar todos e sempre seguro.
function semFormatacao(texto) {
  return texto.replace(/[_*`[\]]/g, '');
}

async function responderSeguro(ctx, texto, opcoes = {}) {
  try {
    return await ctx.reply(texto, { parse_mode: 'Markdown', ...opcoes });
  } catch (erro) {
    // O erro completo, nao so a mensagem: se isto voltar a falhar, o log do
    // Railway tem de chegar para perceber porque sem outra ronda de
    // screenshots.
    console.error('ctx.reply com Markdown falhou:', erro);
    if (!eErroDeFormatacao(erro)) throw erro;
    try {
      return await ctx.reply(semFormatacao(texto));
    } catch (segundoErro) {
      // Se ATE a versao sem formatacao falhar, algo mais serio se passa
      // (mensagem vazia, demasiado longa). Nao esconder — sobe o erro da
      // SEGUNDA tentativa, que e o que interessa diagnosticar agora.
      console.error('Reenvio sem formatação também falhou:', segundoErro);
      throw segundoErro;
    }
  }
}



// So o dono fala com o bot. Sem isto, qualquer pessoa que descubra o
// nome do bot ve o teu plantel.
const CHAT_AUTORIZADO = process.env.TELEGRAM_CHAT_ID;

export const bot = TOKEN ? new Bot(TOKEN) : null;

function autorizado(ctx) {
  if (!CHAT_AUTORIZADO) return true; // primeira execucao, para descobrires o id
  return String(ctx.chat?.id) === String(CHAT_AUTORIZADO);
}

if (bot) {
  bot.use(async (ctx, next) => {
    if (!autorizado(ctx)) {
      await ctx.reply('Este bot é privado.');
      return;
    }
    await next();
  });

  bot.command('start', async (ctx) => {
    await guardarPerfil({ telegramChatId: String(ctx.chat.id) });
    await ctx.reply(
      `Ligado. O teu chat id é ${ctx.chat.id} — mete-o em TELEGRAM_CHAT_ID no Railway.\n\n` +
        'Comandos:\n' +
        '/boletim — o estado da tua equipa agora\n' +
        '/semana — recolhe e manda o resumo de sexta\n' +
        '/lesoes — lesionados da liga, os teus a vermelho\n' +
        '/actualizar — recolha completa (demora)\n' +
        '/montar — sugere um plantel de 23 dentro dos 40M\n' +
        '/montar Trubin, Otávio — fixa esses e sugere o resto\n' +
        '/saldo — saldo e valor da equipa'
    );
  });

  bot.command('boletim', async (ctx) => {
    const b = await lerBoletim();
    if (!b) return ctx.reply('Ainda não há boletim. Corre /actualizar.');
    await responderSeguro(ctx, resumoSemanal(b));
  });

  // A mesma mensagem que chega à sexta, mas a pedido.
  bot.command('semana', async (ctx) => {
    await ctx.reply('A recolher…');
    try {
      // Pedido a mao e para mandar mensagem, por isso leva a verificacao
      // nas noticias — que e a unica coisa que apanha o que a tabela de
      // lesionados deixa cair.
      const b = await recolherLeve({ log: () => {}, duvidasIA: true });
      await responderSeguro(ctx, resumoSemanal(b));
    } catch (erro) {
      await ctx.reply(`Falhou: ${erro.message.split('\n')[0]}`);
    }
  });

  bot.command('lesoes', async (ctx) => {
    const b = await lerBoletim();
    if (!b) return ctx.reply('Ainda não há boletim.');

    const lesionados = (b.ligaInteira ?? []).filter((j) => j.ausencia?.tipo === 'lesao');
    if (!lesionados.length) return ctx.reply('Sem lesionados registados.');

    const meus = new Set((b.equipa?.plantel ?? []).map((j) => j.id));
    const linhas = ['*Lesionados na liga*', ''];

    for (const j of lesionados.slice(0, 40)) {
      const marca = meus.has(j.id) ? '🔴 ' : '• ';
      const regresso = j.ausencia.dataRegresso ? ` (até ${j.ausencia.dataRegresso})` : '';
      linhas.push(`${marca}${j.nome} — ${j.equipa}${regresso}`);
    }
    if (lesionados.length > 40) linhas.push(`… e mais ${lesionados.length - 40}`);

    await responderSeguro(ctx, linhas.join('\n'));
  });

  bot.command('saldo', async (ctx) => {
    const b = await lerBoletim();
    if (!b) return ctx.reply('Ainda não há boletim.');
    await ctx.reply(
      `Saldo ${b.equipa.saldo.toFixed(1)}M · equipa ${b.equipa.valorEquipa.toFixed(1)}M`
    );
  });

  // /montar               -> sugere os 23 dentro dos 40M
  // /montar Trubin, Otavio -> fixa esses e sugere o resto
  bot.command('montar', async (ctx) => {
    const b = await lerBoletim();
    if (!b?.mercado?.length) {
      return ctx.reply('Ainda nao tenho o mercado. Corre /actualizar primeiro.');
    }

    const pedidos = (ctx.match ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const fixos = [];
    const desconhecidos = [];

    for (const termo of pedidos) {
      const alvo = termo.toLowerCase();
      const achados = b.mercado.filter((j) => j.nome.toLowerCase().includes(alvo));
      if (achados.length === 1) fixos.push(achados[0].id);
      else if (!achados.length) desconhecidos.push(termo);
      else {
        return ctx.reply(
          `"${termo}" da varios: ${achados.slice(0, 6).map((j) => j.nome).join(', ')}. Se mais especifico.`
        );
      }
    }

    if (desconhecidos.length) {
      return ctx.reply(`Nao encontrei: ${desconhecidos.join(', ')}`);
    }

    const r = montarPlantel({ todosJogadores: b.mercado, fixos });
    await responderSeguro(ctx, resumoPlantel(r));
  });

  // Recolha COMPLETA a pedido: mercado, valores, classificacao, jogos.
  // Demora bem mais do que a leve, por isso avisa antes de comecar.
  bot.command('actualizar', async (ctx) => {
    await ctx.reply('A fazer a recolha completa. Demora um minuto ou dois…');
    try {
      const b = await recolher({ log: () => {}, duvidasIA: true });
      await responderSeguro(ctx, resumoSemanal(b));
    } catch (e) {
      await ctx.reply(`Falhou: ${e.message.split('\n')[0]}`);
    }
  });

  bot.catch((erro) => console.error('Erro no bot:', erro.message));
}

export async function avisar(texto) {
  if (!bot || !texto?.trim()) return;
  const destino = CHAT_AUTORIZADO ?? (await lerPerfil()).telegramChatId;
  if (!destino) return;

  // As mensagens de quarta, quinta e sexta passam por aqui. E a que menos
  // se pode dar ao luxo de falhar caladas — nao ha ninguem a ver o ecra
  // do bot para reparar num erro e correr /actualizar a mao.
  try {
    await bot.api.sendMessage(destino, texto, { parse_mode: 'Markdown' });
  } catch (erro) {
    console.error('Aviso automático com Markdown falhou:', erro);
    if (!eErroDeFormatacao(erro)) throw erro;
    try {
      await bot.api.sendMessage(destino, semFormatacao(texto));
    } catch (segundoErro) {
      console.error('Reenvio do aviso sem formatação também falhou:', segundoErro);
      throw segundoErro;
    }
  }
}
