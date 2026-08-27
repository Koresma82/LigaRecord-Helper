import * as cheerio from 'cheerio';
import { getHTML, pausa } from '../lib-http.js';

// -----------------------------------------------------------------------------
// AVISO HONESTO
//
// Os selectores abaixo sao a parte fragil de todo o projecto. Partem no dia
// em que o Zerozero mexer no HTML. Por isso:
//   1. Cada selector esta isolado nesta constante, para se corrigir num sitio.
//   2. Se a extraccao devolver zero resultados, o run.js ABORTA em vez de
//      escrever um boletim vazio. Uma lista vazia parece "nao ha lesoes"
//      e e exactamente assim que se perde uma jornada.
//   3. `npm run inspect` grava o HTML em bruto para se afinarem os selectores.
// -----------------------------------------------------------------------------

const SELECTORES = {
  linhaJogador: 'table.zztable tr',
  nome: 'td a[href*="/jogador/"]',
  motivo: 'td:last-child',
};

const PALAVRAS_CASTIGO = ['castig', 'suspens', 'expuls', 'vermelh', 'disciplin'];
const PALAVRAS_DUVIDA = ['duvida', 'dúvida', 'condicion', 'incerto'];

function classificar(texto = '') {
  const t = texto.toLowerCase();
  if (PALAVRAS_CASTIGO.some((p) => t.includes(p))) return 'castigo';
  if (PALAVRAS_DUVIDA.some((p) => t.includes(p))) return 'duvida';
  return 'lesao';
}

export async function ausenciasDaEquipa({ nome, urlPlantel }) {
  const html = await getHTML(urlPlantel);
  const $ = cheerio.load(html);
  const encontradas = [];

  $(SELECTORES.linhaJogador).each((_, linha) => {
    const $l = $(linha);
    const nomeJogador = $l.find(SELECTORES.nome).first().text().trim();
    if (!nomeJogador) return;

    const texto = $l.text().replace(/\s+/g, ' ').trim();
    const temMarca =
      /lesion|contus|rotur|entors|castig|suspens|duvida|dúvida|indispon/i.test(texto);
    if (!temMarca) return;

    encontradas.push({
      nome: nomeJogador,
      equipa: nome,
      tipo: classificar(texto),
      motivo: texto.slice(0, 160),
      fonte: urlPlantel,
    });
  });

  await pausa();
  return encontradas;
}

export async function recolherAusencias(equipas) {
  const todas = [];
  const falhadas = [];

  for (const equipa of equipas) {
    try {
      const r = await ausenciasDaEquipa(equipa);
      todas.push(...r);
    } catch (erro) {
      falhadas.push({ equipa: equipa.nome, erro: erro.message });
    }
  }

  return { ausencias: todas, falhadas };
}

// Penaltis marcados e falhados por jogador na epoca. Nao existe em lado
// nenhum uma lista oficial de "batedor titular" — isto e a melhor
// aproximacao possivel: quem bate, aparece aqui.
export async function penaltisPorJogador(urlEstatisticas) {
  const html = await getHTML(urlEstatisticas);
  const $ = cheerio.load(html);
  const linhas = [];

  $('table.zztable tr').each((_, linha) => {
    const $l = $(linha);
    const nome = $l.find('a[href*="/jogador/"]').first().text().trim();
    if (!nome) return;
    const numeros = $l
      .find('td')
      .map((_, td) => $(td).text().trim())
      .get()
      .filter((v) => /^\d+$/.test(v))
      .map(Number);
    if (!numeros.length) return;
    linhas.push({ nome, numeros });
  });

  await pausa();
  return linhas;
}
