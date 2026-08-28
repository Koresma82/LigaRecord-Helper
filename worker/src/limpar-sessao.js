import 'dotenv/config';
import { bd } from './firestore.js';

// Apaga os cookies guardados, para forcar um login novo na proxima recolha.
//   npm run limpar-sessao

const uid = process.env.UID_DONO ?? 'dono';

await bd().collection('segredos').doc(uid).delete();
console.log(`Sessao apagada (segredos/${uid}).`);
console.log('A proxima recolha vai autenticar de raiz.');
