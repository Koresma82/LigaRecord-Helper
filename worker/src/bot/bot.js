import { Bot } from 'grammy';
import { lerBoletim, guardarPerfil, lerPerfil } from '../firestore.js';
import { recolher, recolherLeve } from '../recolher.js';
import { montarPlantel } from '../../../partilhado/montar-plantel.js';
import { resumoJornada, resumoPlantel, resumoSemanal } from './mensagens.js';

const TOKEN = process.env.TELEGRAM_TOKEN;

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
    await ctx.reply(resumoSemanal(b), { parse_mode: 'Markdown' });
  });

  // A mesma mensagem que chega à sexta, mas a pedido.
  bot.command('semana', async (ctx) => {
    await ctx.reply('A recolher…');
    try {
      const b = await recolherLeve({ log: () => {} });
      await ctx.reply(resumoSemanal(b), { parse_mode: 'Markdown' });
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

    await ctx.reply(linhas.join('\n'), { parse_mode: 'Markdown' });
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
    await ctx.reply(resumoPlantel(r), { parse_mode: 'Markdown' });
  });

  // Recolha COMPLETA a pedido: mercado, valores, classificacao, jogos.
  // Demora bem mais do que a leve, por isso avisa antes de comecar.
  bot.command('actualizar', async (ctx) => {
    await ctx.reply('A fazer a recolha completa. Demora um minuto ou dois…');
    try {
      const b = await recolher({ log: () => {} });
      await ctx.reply(resumoSemanal(b), { parse_mode: 'Markdown' });
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
  await bot.api.sendMessage(destino, texto, { parse_mode: 'Markdown' });
}
