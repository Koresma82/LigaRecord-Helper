import 'dotenv/config';
import * as lr from './fontes/ligarecord.js';
import { recolherAusencias } from './fontes/zerozero.js';
import { EQUIPAS_ZEROZERO } from './config/equipas.js';
import { emparelhar } from './emparelhar.js';
import { sugerirSubstituicoes } from './sugerir.js';
import { guardarBoletim, lerBoletim } from './firestore.js';
import { montarPlantel } from '../../partilhado/montar-plantel.js';

// Menos ausencias do que isto em toda a liga significa quase de certeza
// que o scraping partiu, nao que a liga esta saudavel.
const MINIMO_PLAUSIVEL = 8;

export async function recolher({ log = console.log } = {}) {
  const avisos = [];

  log('A ler a Liga Record...');
  // Em serie, nao em paralelo: partilham a mesma sessao e quatro logins
  // simultaneos so servem para nos porem na lista negra.
  const todosJogadores = await lr.obterTodosJogadores({ log });
  const minhaEquipa = await lr.obterMinhaEquipa();
  const jornada = await lr.obterJornada();
  log(`  ${todosJogadores.length} jogadores, ${minhaEquipa.jogadores.length} no plantel`);

  // Antes da 1a ronda o plantel esta vazio e nao ha nada para avisar.
  if (!minhaEquipa.jogadores.length) {
    log(`  Plantel por construir — faltam ${minhaEquipa.faltam} jogadores.`);
  }

  log('A ler o boletim de ausencias...');
  const { ausencias, falhadas } = await recolherAusencias(EQUIPAS_ZEROZERO);
  log(`  ${ausencias.length} ausencias`);

  if (falhadas.length) {
    avisos.push(
      `Falharam ${falhadas.length} equipas no Zerozero: ${falhadas.map((f) => f.equipa).join(', ')}. ` +
        'Os jogadores destas equipas podem estar de fora sem aparecer aqui.'
    );
  }

  if (ausencias.length < MINIMO_PLAUSIVEL) {
    throw new Error(
      `So ${ausencias.length} ausencias em toda a liga — nao e credivel.\n` +
        'Os selectores do Zerozero mudaram. Corre `npm run inspect` e ajusta\n' +
        'SELECTORES em src/fontes/zerozero.js. O boletim anterior fica intacto.'
    );
  }

  const emparelhado = emparelhar(todosJogadores, ausencias);

  const indisponiveis = new Set(
    emparelhado.ligados.filter((j) => j.ausencia.tipo !== 'duvida').map((j) => j.id)
  );

  const emRisco = minhaEquipa.jogadores
    .map((j) => {
      const ligado = emparelhado.ligados.find((l) => l.id === j.id);
      const ambiguo = emparelhado.ambiguos.find((a) => a.jogador.id === j.id);
      if (ligado) return { ...j, ausencia: ligado.ausencia, confianca: ligado.confianca };
      if (ambiguo) return { ...j, ausencia: null, hipoteses: ambiguo.hipoteses, confianca: 0 };
      return null;
    })
    .filter(Boolean);

  const forasCertos = emRisco.filter((j) => j.ausencia && j.ausencia.tipo !== 'duvida');

  const sugestoes = sugerirSubstituicoes({
    plantel: minhaEquipa.jogadores,
    todosJogadores,
    saldo: minhaEquipa.saldo,
    emRisco: forasCertos,
    idsIndisponiveis: indisponiveis,
  });

  const limpar = ({ bruto, ...resto }) => resto;

  // Antes da 1a ronda ninguem tem plantel. O que serve nessa altura nao e o
  // boletim de lesoes — e ajuda a gastar os 40M. Guardamos o mercado inteiro
  // para a app poder refazer contas no browser com os jogadores que fixares.
  const mercado = todosJogadores.map((j) => ({
    id: j.id,
    nome: j.nome,
    equipa: j.equipa,
    posicao: j.posicao,
    custo: j.custo,
    pontos: j.pontosTotais,
    percentagemEquipas: j.percentagemEquipas ?? null,
  }));

  const fixos = minhaEquipa.jogadores.map((j) => j.id);
  const sugestaoPlantel = minhaEquipa.completo
    ? null
    : montarPlantel({ todosJogadores: mercado, fixos });

  const boletim = {
    geradoEm: new Date().toISOString(),
    jornada,
    avisos,
    equipa: {
      saldo: minhaEquipa.saldo,
      valorEquipa: minhaEquipa.valorEquipa,
      plantel: minhaEquipa.jogadores.map(limpar),
    },
    emRisco: emRisco.map(limpar),
    sugestoes,
    ligaInteira: emparelhado.ligados.map(limpar),
    mercado,
    sugestaoPlantel,
    porConfirmar: emparelhado.ambiguos.map((a) => ({
      jogador: a.jogador.nome,
      equipa: a.jogador.equipa,
      hipoteses: a.hipoteses,
    })),
    diagnostico: {
      jogadoresLidos: todosJogadores.length,
      ausenciasLidas: ausencias.length,
      emparelhadas: emparelhado.ligados.length,
      ambiguas: emparelhado.ambiguos.length,
      equipasFalhadas: falhadas,
    },
  };

  await guardarBoletim(boletim);
  log(`Boletim guardado. ${forasCertos.length} de fora, ${emRisco.length - forasCertos.length} em duvida.`);

  return boletim;
}

// Compara com o boletim anterior para so avisar quando ha novidade.
export async function recolherEDetectarNovidades() {
  const anterior = await lerBoletim();
  const idsAntes = new Set((anterior?.emRisco ?? []).map((j) => j.id));
  const novo = await recolher();

  const novidades = novo.emRisco.filter((j) => !idsAntes.has(j.id));
  const recuperados = (anterior?.emRisco ?? []).filter(
    (a) => !novo.emRisco.some((j) => j.id === a.id)
  );

  return { boletim: novo, novidades, recuperados };
}

// Permite correr so a recolha: `npm run recolher`
if (import.meta.url === `file://${process.argv[1]}`) {
  recolher().catch((e) => {
    console.error('\n' + e.message);
    process.exit(1);
  });
}
