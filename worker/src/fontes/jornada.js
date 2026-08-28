import * as cheerio from 'cheerio';
import { pedido } from '../lib-http.js';

// -----------------------------------------------------------------------------
// A jornada da Primeira Liga.
//
// A pagina da Liga Record mostra a RONDA do jogo deles, que so arranca na
// 6.a jornada do campeonato — nao serve para saber a que jornada se referem
// as lesoes e os castigos.
//
// A classificacao do Maisfutebol traz os jogos disputados por equipa. A
// jornada a decorrer e a seguinte ao maximo de jogos ja realizados.
// -----------------------------------------------------------------------------

// Varias fontes, por ordem. A primeira que der um numero plausivel ganha.
// Depender de uma so pagina foi o que fez a jornada ficar em branco sem
// ninguem perceber porque.
const FONTES = [
  process.env.MF_URL_CLASSIFICACAO,
  'https://www.zerozero.pt/competicao/liga-portuguesa',
  'https://www.transfermarkt.pt/liga-portugal/tabelle/wettbewerb/PO1',
  'https://www.abola.pt/futebol/competicao/liga-portugal-betclic-13/classificacao',
].filter(Boolean);

export function jornadaPelaClassificacao(html) {
  const $ = cheerio.load(html);

  // Recolher a matriz de numeros, linha a linha.
  const linhas = [];
  $('tr').each((_, tr) => {
    const numeros = $(tr)
      .find('td, th')
      .map((_, celula) =>
        $(celula)
          .text()
          .replace(/\u00a0/g, ' ')
          .trim()
      )
      .get()
      .filter((v) => /^-?\d+$/.test(v))
      .map(Number);
    if (numeros.length >= 4) linhas.push(numeros);
  });

  if (linhas.length < 10) return null;

  // Qual das colunas e a dos jogos disputados?
  //
  // Duas tentativas falharam antes desta. "O maior dos tres primeiros"
  // apanhou os pontos; "a coluna mais uniforme" apanhou uma coluna de
  // valores constantes. O sinal fiavel e aritmetico e nao posicional:
  //
  //     jogos = vitorias + empates + derrotas
  //
  // Isso e verdade em todas as linhas de qualquer classificacao, e nao ha
  // outra combinacao de colunas que o cumpra por acaso.
  const colunas = Math.min(...linhas.map((l) => l.length));
  const candidatas = [];

  for (let j = 0; j < colunas; j++) {
    const valores = linhas.map((l) => l[j]);
    if (Math.min(...valores) < 1 || Math.max(...valores) > 34) continue;

    for (let a = 0; a < colunas; a++) {
      if (a === j) continue;
      for (let b = a + 1; b < colunas; b++) {
        if (b === j) continue;
        for (let c = b + 1; c < colunas; c++) {
          if (c === j) continue;
          const bate = linhas.every((l) => l[a] + l[b] + l[c] === l[j]);
          if (bate) candidatas.push(j);
        }
      }
    }
  }

  if (!candidatas.length) return null;

  // A coluna que mais vezes satisfaz a identidade e a dos jogos.
  const votos = new Map();
  for (const c of candidatas) votos.set(c, (votos.get(c) ?? 0) + 1);
  const coluna = [...votos].sort((x, y) => y[1] - x[1])[0][0];

  const melhor = { max: Math.max(...linhas.map((l) => l[coluna])) };

  // A jornada a decorrer e a seguinte a que a maioria ja disputou.
  return melhor.max + 1;
}

// Uma jornada da Primeira Liga vai de 1 a 34. Qualquer valor fora disto e
// erro de leitura — foi assim que a app anunciou "JORNADA 428".
const plausivel = (n) => Number.isInteger(n) && n >= 1 && n <= 34;

export async function jornadaActual({ log = () => {} } = {}) {
  const manual = Number(process.env.LR_JORNADA);
  if (plausivel(manual)) {
    log(`  Jornada ${manual} (definida no .env)`);
    return { numero: manual, origem: 'manual' };
  }

  // Primeiro perguntamos directamente. Contar jogos disputados funciona,
  // mas e uma inferencia; a pagina do zerozero diz o numero.
  const { jornadaNoZerozero } = await import('./zerozero.js');
  const directa = await jornadaNoZerozero({ log });
  if (directa) return { numero: directa, origem: 'zerozero' };

  const tentativas = [];

  for (const url of FONTES) {
    try {
      const r = await pedido(url, {
        headers: { 'accept-language': 'pt-PT,pt;q=0.9' },
        seguir: 4,
      });

      if (r.status !== 200) {
        tentativas.push(`${new URL(url).host} -> HTTP ${r.status}`);
        continue;
      }

      const numero = jornadaPelaClassificacao(r.texto);
      if (!plausivel(numero)) {
        tentativas.push(`${new URL(url).host} -> tabela nao reconhecida (${r.texto.length} chars)`);
        continue;
      }

      log(`  Jornada ${numero} (${new URL(url).host})`);
      return { numero, origem: new URL(url).host };
    } catch (erro) {
      tentativas.push(`${new URL(url).host} -> ${erro.message.split('\n')[0]}`);
    }
  }

  log('  Jornada: nao determinada.');
  for (const t of tentativas) log(`    ${t}`);
  log('    Define LR_JORNADA no .env para resolver ja.');

  return { numero: null, origem: 'desconhecida', tentativas };
}
