import { entrarComGoogle } from '../lib/firebase.js';

export default function Entrada({ erro }) {
  return (
    <main className="app entrada">
      <h1 className="jornada">
        <span>Boletim</span>
        da jornada
      </h1>

      <p className="entrada-texto">
        Quem do teu plantel não joga, e por quem o podes trocar sem estourar
        o saldo.
      </p>

      <button className="botao-google" onClick={() => entrarComGoogle()}>
        Entrar com Google
      </button>

      {erro && <div className="aviso">{erro}</div>}

      <p className="entrada-nota">
        Esta conta serve para abrir a app. O acesso à Liga Record é separado
        e vive no servidor.
      </p>
    </main>
  );
}
