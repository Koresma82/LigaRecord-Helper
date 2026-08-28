import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { emFalta } from './lib/firebase.js';
import './estilos.css';

// Sem config do Firebase nao ha app nenhuma. Em vez de deixar o SDK rebentar
// com auth/invalid-api-key e um ecra preto, dizemos qual e a variavel que
// falta e onde e que ela se define.
const NOMES = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID',
};

function ConfigEmFalta({ chaves }) {
  return (
    <div className="config-em-falta">
      <h1>Falta a configuracao do Firebase</h1>
      <p>Este build saiu sem {chaves.length === 1 ? 'a variavel' : 'as variaveis'}:</p>
      <ul>
        {chaves.map((c) => (
          <li key={c}><code>{NOMES[c]}</code></li>
        ))}
      </ul>
      <p>
        O Vite escreve estes valores no bundle durante o <strong>build</strong>.
        Defini-los depois nao chega — e preciso um deploy novo.
      </p>
      <ol>
        <li>
          Netlify &rarr; <em>Site configuration &rarr; Environment variables</em>.
          As seis <code>VITE_FIREBASE_*</code> tem de existir, com o scope{' '}
          <em>Builds</em> e disponiveis no contexto <em>Production</em>.
        </li>
        <li>Os valores nao levam aspas nem espacos.</li>
        <li>
          Netlify &rarr; <em>Deploys &rarr; Trigger deploy &rarr; Clear cache and
          deploy site</em>.
        </li>
      </ol>
      <p className="nota">
        Em local o ficheiro e <code>web/.env.local</code>, e o servidor tem de
        ser reiniciado depois de o editares.
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {emFalta.length > 0 ? <ConfigEmFalta chaves={emFalta} /> : <App />}
  </React.StrictMode>
);
