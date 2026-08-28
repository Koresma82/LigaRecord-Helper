import { useMemo, useState } from 'react';

const SERIE = 5;

// Quantos amarelos faltam para o próximo castigo.
const faltam = (amarelos) => (SERIE - (amarelos % SERIE)) % SERIE;

function nota(amarelos) {
  const restam = faltam(amarelos);
  if (amarelos === 0) return null;
  if (restam === 0) return { texto: 'castigo cumprido ou a cumprir', tom: 'fora' };
  if (restam === 1) return { texto: 'a um do castigo', tom: 'duvida' };
  if (restam === 2) return { texto: 'a dois do castigo', tom: 'neutro' };
  return null;
}

export default function Cartoes({ cartoes = [], plantel = [] }) {
  const [apenasMeus, setApenasMeus] = useState(false);
  const [procura, setProcura] = useState('');

  const nomesDoPlantel = useMemo(
    () => new Set(plantel.map((j) => j.nome.toLowerCase())),
    [plantel]
  );

  const porEquipa = useMemo(() => {
    const alvo = procura.trim().toLowerCase();

    const filtrados = cartoes
      .filter((c) => c.amarelos > 0 || c.vermelhos > 0)
      .filter((c) => !apenasMeus || nomesDoPlantel.has(c.nome.toLowerCase()))
      .filter(
        (c) =>
          !alvo ||
          c.nome.toLowerCase().includes(alvo) ||
          c.equipa.toLowerCase().includes(alvo)
      );

    const mapa = new Map();
    for (const c of filtrados) {
      if (!mapa.has(c.equipa)) mapa.set(c.equipa, []);
      mapa.get(c.equipa).push(c);
    }

    // Dentro de cada equipa, quem está mais perto do castigo primeiro.
    for (const lista of mapa.values()) {
      lista.sort((a, b) => b.amarelos - a.amarelos || a.nome.localeCompare(b.nome, 'pt'));
    }

    return [...mapa].sort((a, b) => a[0].localeCompare(b[0], 'pt'));
  }, [cartoes, apenasMeus, procura, nomesDoPlantel]);

  const total = porEquipa.reduce((s, [, lista]) => s + lista.length, 0);
  const noLimite = cartoes.filter((c) => c.amarelos > 0 && faltam(c.amarelos) === 1).length;

  if (!cartoes.length) {
    return (
      <section className="seccao">
        <h2>Cartões</h2>
        <div className="aviso">
          Ainda não há cartões recolhidos. Corre a recolha no worker.
        </div>
      </section>
    );
  }

  return (
    <section className="seccao">
      <h2>
        Amarelos por equipa <span className="contagem">{total}</span>
      </h2>

      <div className="aviso">
        Cinco amarelos dão um jogo de suspensão. Estão assinalados os que
        ficam a um cartão — <strong>{noLimite}</strong> na liga. Amarelos da
        Taça não contam para esta série.
      </div>

      <div className="filtros">
        <input
          className="procura"
          type="search"
          placeholder="Procurar por jogador ou clube"
          value={procura}
          onChange={(e) => setProcura(e.target.value)}
        />
        <button
          className="aba"
          aria-pressed={apenasMeus}
          onClick={() => setApenasMeus((v) => !v)}
        >
          Só os meus
        </button>
      </div>

      {porEquipa.length === 0 && (
        <div className="vazio">Nenhum jogador corresponde a esse filtro.</div>
      )}

      {porEquipa.map(([equipa, jogadores]) => (
        <div key={equipa} className="clube">
          <h3 className="clube-nome">
            {equipa} <span className="contagem">{jogadores.length}</span>
          </h3>
          <ul className="cartoes-lista">
            {jogadores.map((c) => {
              const marca = nota(c.amarelos);
              const meu = nomesDoPlantel.has(c.nome.toLowerCase());
              return (
                <li className={`cartao-linha${meu ? ' cartao-linha--meu' : ''}`} key={c.nome + equipa}>
                  <span className="cartao-linha-nome">
                    {c.nome}
                    {meu && <span className="selo selo--ok">teu</span>}
                  </span>

                  <span className="cartao-linha-contas">
                    {c.amarelos > 0 && (
                      <span className="pastilha pastilha--amarelo">{c.amarelos}</span>
                    )}
                    {c.vermelhos > 0 && (
                      <span className="pastilha pastilha--vermelho">{c.vermelhos}</span>
                    )}
                  </span>

                  {marca && <span className={`nota nota--${marca.tom}`}>{marca.texto}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
