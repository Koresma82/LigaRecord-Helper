import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as sair,
  onAuthStateChanged,
} from 'firebase/auth';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';

// Estas chaves sao publicas por desenho — quem protege os dados sao as
// regras do Firestore (ver firestore.rules), nao o segredo da config.
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);

const google = new GoogleAuthProvider();

export const entrarComGoogle = () => signInWithPopup(auth, google);
export { sair, onAuthStateChanged };

// Um so projeto Firebase para os tres ambientes: o sufixo separa os dados.
export const AMBIENTE = import.meta.env.VITE_AMBIENTE ?? 'dev';

const documento = (uid) => (AMBIENTE === 'prod' ? uid : `${uid}_${AMBIENTE}`);

// Escuta o boletim em tempo real. Quando o worker gravar uma versao nova,
// a app actualiza-se sozinha sem refresh.
export function escutarBoletim(uid, aoMudar, aoFalhar) {
  return onSnapshot(
    doc(db, 'boletins', documento(uid)),
    (snap) => aoMudar(snap.exists() ? snap.data() : null),
    (erro) => aoFalhar(erro)
  );
}
