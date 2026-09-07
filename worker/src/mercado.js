import 'dotenv/config';
import { recolher } from './recolher.js';

// npm run mercado
//
// A recolha completa, para correr NA TUA MAQUINA quando os valores da Liga
// Record precisarem de ser refrescados.
//
// O Railway nao consegue: a Liga Record bloqueia servidores de datacenter e
// a ligacao morre sem sequer se estabelecer. Tudo o resto — jornadas,
// classificacao, golos, assistencias, cartoes, lesoes — o Railway recolhe
// bem sozinho, todos os dias.
//
// Confirma que tens AMBIENTE=prod no .env, senao escreves no ambiente de
// desenvolvimento e o site de producao nao ve nada.

const ambiente = process.env.AMBIENTE ?? 'dev';

console.log(`Ambiente: ${ambiente}`);
if (ambiente !== 'prod') {
  console.log('');
  console.log('AVISO: nao estas em prod. Isto escreve no ambiente de');
  console.log('desenvolvimento e o site de producao NAO vai ver estes dados.');
  console.log('Poe AMBIENTE=prod no .env se querias actualizar a producao.');
  console.log('');
}

try {
  const boletim = await recolher({ log: console.log });

  console.log('');
  console.log(`Mercado: ${boletim.mercado?.length ?? 0} jogadores`);
  console.log(`Plantel: ${boletim.equipa?.plantel?.length ?? 0}/23`);
  console.log(
    `Lido em: ${new Date(boletim.mercadoRecolhidoEm).toLocaleString('pt-PT')}` +
      (boletim.mercadoActual ? '' : '  (NAO foi actualizado nesta recolha)')
  );

  if (!boletim.mercadoActual) {
    console.log('');
    console.log('A Liga Record nao respondeu tambem daqui. Se estiveres numa');
    console.log('VPN ou rede de empresa, tenta sem ela.');
    process.exit(1);
  }
} catch (erro) {
  console.error('');
  console.error(erro.message);
  process.exit(1);
}
