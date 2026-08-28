import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as sair,
  onAuthStateChanged,
} from 'firebase/auth';
import { getFirestore, doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';

// Estas chaves sao publicas por desenho — quem protege os dados sao as
// regras do Firestore (ver firestore.rules), nao o segredo da config.
//
// O Vite substitui os import.meta.env.VITE_* pelo valor literal no momento
// do BUILD. Se a variavel nao existir nessa altura, fica undefined no
// bundle e nao ha nada em runtime que a salve.
const VARIAVEIS = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID',
};

// Aspas coladas ao valor sao o erro classico: o dotenv tira-as em local, o
// painel do Netlify nao. Tiramo-las aqui para o mesmo copy-paste funcionar
// nos dois sitios.
const limpar = (v) =>
  typeof v === 'string' ? v.trim().replace(/^['"]|['"]$/g, '') : v;

const bruto = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const config = Object.fromEntries(
  Object.entries(bruto).map(([k, v]) => [k, limpar(v)])
);

// Quais e que faltam. Sem isto o Firebase rebenta com auth/invalid-api-key
// e um ecra preto, que nao diz a ninguem qual das seis e que falhou.
export const emFalta = Object.keys(VARIAVEIS).filter((k) => !config[k]);

const app = emFalta.length === 0 ? initializeApp(config) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

const google = new GoogleAuthProvider();

export const entrarComGoogle = () => signInWithPopup(auth, google);
export { sair, onAuthStateChanged };

// Um so projeto Firebase para os tres ambientes: o sufixo separa os dados.
export const AMBIENTE = import.meta.env.VITE_AMBIENTE ?? 'dev';

const documento = (uid) => (AMBIENTE === 'prod' ? uid : `${uid}_${AMBIENTE}`);

// O plantel e a unica coisa que a app escreve. O worker le-o na recolha
// seguinte e passa a saber quais sao os teus jogadores.
export async function guardarPlantel(uid, ids, saldo = 0) {
  await setDoc(
    doc(db, 'plantel', documento(uid)),
    { ids: ids.map(String), saldo, actualizadoEm: new Date().toISOString() },
    { merge: true }
  );
}

export async function lerPlantel(uid) {
  const d = await getDoc(doc(db, 'plantel', documento(uid)));
  return d.exists() ? d.data() : null;
}

// Escuta o boletim em tempo real. Quando o worker gravar uma versao nova,
// a app actualiza-se sozinha sem refresh.
export function escutarBoletim(uid, aoMudar, aoFalhar) {
  return onSnapshot(
    doc(db, 'boletins', documento(uid)),
    (snap) => aoMudar(snap.exists() ? snap.data() : null),
    (erro) => aoFalhar(erro)
  );
}
