import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// A chave da conta de servico vem inteira numa variavel de ambiente.
// No Railway cola-se o JSON todo em FIREBASE_SERVICE_ACCOUNT.
function credenciais() {
  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!bruto) {
    throw new Error(
      'Falta FIREBASE_SERVICE_ACCOUNT.\n' +
        'Consola Firebase > Definicoes do projeto > Contas de servico >\n' +
        'Gerar nova chave privada. Cola o JSON inteiro na variavel.'
    );
  }
  try {
    return JSON.parse(bruto);
  } catch {
    // O Railway as vezes escapa as newlines da chave privada.
    return JSON.parse(bruto.replace(/\\n/g, '\n'));
  }
}

// Inicializacao preguicosa: se isto corresse no import, nao daria para
// testar nem correr `npm run inspect` sem credenciais do Firebase.
let _db = null;

export function bd() {
  if (!_db) {
    if (!getApps().length) initializeApp({ credential: cert(credenciais()) });
    _db = getFirestore();
  }
  return _db;
}

export { FieldValue };

// Com um so projeto Firebase e tres ambientes, o sufixo e o que impede o
// worker em dev de escrever por cima dos dados que estas a usar a serio.
export const AMBIENTE = process.env.AMBIENTE ?? 'dev';

// Exportada de proposito: qualquer coleccao com um documento por
// utilizador tem de usar esta chave. O plantel foi criado sem ela e ficou a
// ler de "uid" enquanto a app escrevia em "uid_dev" — gravava bem e o
// worker nao via nada.
export const chave = () => (AMBIENTE === 'prod' ? UID() : `${UID()}_${AMBIENTE}`);

const UID = () => {
  const uid = process.env.UID_DONO;
  if (!uid) {
    throw new Error(
      'Falta UID_DONO.\n' +
        'E o teu uid do Firebase Auth. Faz login na app uma vez e le-o\n' +
        'na consola: Authentication > Users > User UID.'
    );
  }
  return uid;
};

export async function guardarBoletim(boletim) {
  await bd().collection('boletins').doc(chave()).set({
    ...boletim,
    actualizadoEm: FieldValue.serverTimestamp(),
  });
}

export async function lerBoletim() {
  const doc = await bd().collection('boletins').doc(chave()).get();
  return doc.exists ? doc.data() : null;
}

export async function lerPerfil() {
  const doc = await bd().collection('utilizadores').doc(chave()).get();
  return doc.exists ? doc.data() : {};
}

export async function guardarPerfil(dados) {
  await bd().collection('utilizadores').doc(chave()).set(dados, { merge: true });
}

// -----------------------------------------------------------------------------
// Cache dos jogos, por jornada, independente do boletim.
//
// Ate agora, se os jogos de uma jornada faltassem numa recolha, so havia um
// sitio para os ir buscar: o BOLETIM anterior. Isso tem um problema: o
// boletim e uma fotografia de UMA recolha, e cada recolha nova reescreve-a.
// Se a jornada 6 faltar duas recolhas seguidas, a segunda ja nao tem onde
// a encontrar — o boletim "anterior" que ela ve ja e o da recolha em que
// tambem faltou.
//
// Esta coleccao e diferente: cada jornada guarda-se sozinha, e SO se
// reescreve quando chegam jogos plausiveis a serio. Uma recolha que falhe
// nunca apaga o que uma recolha anterior conseguiu — o merge por campo
// (`porJornada.6`) garante isso.
// -----------------------------------------------------------------------------

export async function guardarJogosDaJornada(jornada, dados) {
  if (!jornada || !dados?.length) return;
  // Objecto aninhado, nao uma chave com ponto — o merge:true do Admin SDK
  // funde mapas aninhados a serio quando a forma e esta. Uma chave
  // "porJornada.6" no nivel de topo ficaria gravada literalmente com o
  // ponto no nome, e a leitura (que espera `porJornada['6']` aninhado)
  // nunca a encontraria.
  await bd()
    .collection('jogosPorJornada')
    .doc(chave())
    .set(
      { porJornada: { [String(jornada)]: { dados, recolhidoEm: new Date().toISOString() } } },
      { merge: true }
    );
}

export async function lerJogosDaJornada(jornada) {
  if (!jornada) return null;
  const doc = await bd().collection('jogosPorJornada').doc(chave()).get();
  if (!doc.exists) return null;
  const entrada = doc.data()?.porJornada?.[String(jornada)];
  return entrada?.dados?.length ? entrada : null;
}
