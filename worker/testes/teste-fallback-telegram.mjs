// -----------------------------------------------------------------------------
// A rede de seguranca contra "can't parse entities".
//
// Nao chama o Telegram a serio — testa so a logica de decisao. Replica as
// mesmas funcoes que o bot.js usa; nao consegue importa-las directamente
// porque o bot.js constroi um Bot do grammy ao ser carregado, o que exigiria
// um TELEGRAM_TOKEN real.
//   npm run teste-fallback
// -----------------------------------------------------------------------------

let falhas = 0;
const ok = (c, nome) => {
  console.log(`${c ? 'OK   ' : 'FALHA'} ${nome}`);
  if (!c) falhas++;
};

// Deteccao pelo CODIGO HTTP, nao pelo texto exacto do erro — e o que
// corrigiu o caso real: a primeira versao so olhava para `erro.message`, e
// em producao isso nao chegou a apanhar o erro (a mensagem continuou a
// falhar). O codigo e mais estavel do que qualquer frase.
function eErroDeFormatacao(erro) {
  const codigo =
    erro?.error_code ?? erro?.response?.error_code ?? erro?.parameters?.error_code ?? null;
  if (codigo === 400) return true;
  const texto = [erro?.message, erro?.description, String(erro ?? '')].join(' ');
  return /can't parse entities|400.*bad request/i.test(texto);
}

function semFormatacao(texto) {
  return texto.replace(/[_*`[\]]/g, '');
}

async function responderSeguroSimulado(enviar, texto) {
  try {
    return await enviar(texto, true);
  } catch (erro) {
    if (!eErroDeFormatacao(erro)) throw erro;
    return enviar(semFormatacao(texto), false);
  }
}

// --- 1. Erro de parse com a mensagem no formato do grammy -------------------
{
  const chamadas = [];
  const enviar = async (texto, comFormatacao) => {
    chamadas.push({ texto, comFormatacao });
    if (comFormatacao) {
      const erro = new Error(
        "Call to 'sendMessage' failed! (400: Bad Request: can't parse entities: " +
          'Can\'t find end of the entity starting at byte offset 1687)'
      );
      erro.error_code = 400;
      throw erro;
    }
    return 'enviado';
  };

  const resultado = await responderSeguroSimulado(enviar, '*Jornada 6*\n\ntexto_com_erro');

  ok(resultado === 'enviado', 'a segunda tentativa entrega a mensagem');
  ok(chamadas.length === 2, 'houve exactamente duas tentativas');
  ok(chamadas[1].comFormatacao === false, 'a segunda foi sem formatação');
  ok(!chamadas[1].texto.includes('_'), 'o texto reenviado já não tem os caracteres problemáticos');
  ok(
    chamadas[1].texto.includes('Jornada 6') && chamadas[1].texto.includes('textocomerro'),
    'a informação sobrevive, só a formatação é que se perde'
  );
}

// --- 2. O CASO REAL: error_code presente, mas a .message NAO tem o texto ----
//
// E este teste que teria apanhado o bug de producao. Uma versao do grammy,
// ou um tipo de erro diferente, pode nao escrever "can't parse entities" em
// erro.message — mas o error_code 400 esta sempre la, porque vem
// directamente da resposta HTTP do Telegram. Se a deteccao dependesse so do
// texto, este erro escaparia por cima da rede de seguranca.
{
  const enviar = async (texto, comFormatacao) => {
    if (comFormatacao) {
      const erro = new Error('Bad Request');
      erro.error_code = 400; // sem "can't parse entities" nenhures
      throw erro;
    }
    return 'enviado';
  };

  const resultado = await responderSeguroSimulado(enviar, '*texto*');
  ok(
    resultado === 'enviado',
    'um 400 sem o texto "can\'t parse entities" na mensagem ainda assim aciona o reenvio'
  );
}

// --- 3. Um erro de outra natureza NAO e engolido -----------------------------
{
  const enviar = async () => {
    const erro = new Error('403: Forbidden: bot was blocked by the user');
    erro.error_code = 403;
    throw erro;
  };

  let apanhado = null;
  try {
    await responderSeguroSimulado(enviar, 'qualquer coisa');
  } catch (erro) {
    apanhado = erro;
  }

  ok(apanhado?.error_code === 403, 'um 403 (bloqueado pelo utilizador) continua a subir sem reenvio');
}

// --- 4. Sem erro nenhum, so uma tentativa -----------------------------------
{
  let tentativas = 0;
  const enviar = async () => {
    tentativas += 1;
    return 'ok';
  };
  await responderSeguroSimulado(enviar, 'mensagem normal');
  ok(tentativas === 1, 'quando não há erro, não há segunda tentativa');
}

// --- 5. Se ATE a segunda tentativa falhar, o erro da segunda e o que sobe ---
{
  const enviar = async (texto, comFormatacao) => {
    const erro = new Error(comFormatacao ? "can't parse entities" : 'message is too long');
    erro.error_code = 400;
    throw erro;
  };

  let apanhado = null;
  try {
    await responderSeguroSimulado(enviar, '*texto*');
  } catch (erro) {
    apanhado = erro;
  }

  ok(
    apanhado?.message === 'message is too long',
    'quando as duas tentativas falham, sobe o erro da SEGUNDA — o que interessa diagnosticar'
  );
}

console.log('');
console.log(falhas ? `${falhas} teste(s) a falhar.` : 'Todos os testes da rede de segurança passam.');
process.exit(falhas ? 1 : 0);
