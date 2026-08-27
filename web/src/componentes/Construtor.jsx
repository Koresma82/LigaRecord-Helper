import { useMemo, useState } from 'react';
import { montarPlantel, FORMACAO } from '../../../partilhado/montar-plantel.js';
import { euros } from '../lib/formatar.js';

const ORDEM = ['GR', 'DEF', 'MED', 'AVA'];
const NOME_POSICAO = { GR: 'Guarda-redes', DEF: 'Defesas', MED: 'Médios', AVA: 'Avançados' };

export default function Construtor({ mercado, jaComprados = [] }) {
  const [fixos, setFixos] = useState(() => new Set(jaComprados.map(String)));
  const [procura, setProcura] = useState('');
  const [posicaoAberta, setPosicaoAberta] = useState('GR');

  const resultado = useMemo(
    () => montarPlantel({ todosJogadores: mercado, fixos: [...fixos] }),
    [mercado, fixos]
  );

  const alternar = (id) => {
    const novo = new Set(fixos);
    novo.has(String(id)) ? novo.delete(String(id)) : novo.add(String(id));
    setFixos(novo);
  };

  const porPosicao = useMemo(() => {
    const alvo = procura.trim().toLowerCase();
    return mercado
      .filter((j) => j.posicao === posicaoAberta)
      .filter((j) => !alvo || j.nome.toLowerCase().includes(alvo) || j.equipa.toLowerCase().includes(alvo))
      .sort((a, b) => b.pontos - a.pontos)
      .slice(0, 60);
  }, [mercado, posicaoAberta, procura]);

  const contagemFixos = useMemo(() => {
    const c = { GR: 0, DEF: 0, MED: 0, AVA: 0 };
    for (const id of fixos) {
      const j = mercado.find((m) => String(m.id) === id);
      if (j) c[j.posicao] += 1;
    }
    return c;
  }, [fixos, mercado]);

  const custoFixos = useMemo(
    () =>
      [...fixos].reduce((s, id) => {
        const j = mercado.find((m) => String(m.id) === id);
        return s + (j?.custo ?? 0);
      }, 0),
    [fixos, mercado]
  );

  return (
    <section className="seccao">
      <h2>
        Construir plantel <span className="contagem">{fixos.size} fixos</span>
      </h2>

      <p className="fecho">
        <span>
          escolhidos por ti <strong>{euros(custoFixos)}</strong>
        </span>
        <span>
          restam <strong>{euros(40 - custoFixos)}</strong>
        </span>
      </p>

      <div className="abas">
        {ORDEM.map((p) => (
          <button
            key={p}
            className="aba"
            aria-pressed={posicaoAberta === p}
            onClick={() => setPosicaoAberta(p)}
          >
            {p} {contagemFixos[p]}/{FORMACAO[p]}
          </button>
        ))}
      </div>

      <input
        className="procura"
        type="search"
        placeholder="Procurar por nome ou clube"
        value={procura}
        onChange={(e) => setProcura(e.target.value)}
      />

      <div className="lista-escolha">
        {porPosicao.map((j) => {
          const fixo = fixos.has(String(j.id));
          return (
            <button
              key={j.id}
              className={`escolha${fixo ? ' escolha--fixo' : ''}`}
              onClick={() => alternar(j.id)}
              aria-pressed={fixo}
            >
              <span className="escolha-nome">{j.nome}</span>
              <span className="escolha-clube">{j.equipa}</span>
              <span className="escolha-numeros">
                {euros(j.custo)} · {j.pontos}pts
              </span>
            </button>
          );
        })}
        {!porPosicao.length && (
          <p className="vazio">Nenhum jogador corresponde a “{procura}”.</p>
        )}
      </div>

      <h2 style={{ marginTop: 28 }}>Plantel sugerido</h2>

      {resultado.erro ? (
        <div className="aviso">{resultado.erro}</div>
      ) : (
        <>
          <p className="delta sem-linha">
            <span>custo {euros(resultado.custoTotal)}</span>
            <span>sobra {euros(resultado.sobra)}</span>
          </p>

          {ORDEM.map((posicao) => {
            const grupo = resultado.plantel.filter((j) => j.posicao === posicao);
            if (!grupo.length) return null;
            return (
              <div key={posicao} className="bloco-opcoes">
                <h2>{NOME_POSICAO[posicao]}</h2>
                {grupo.map((j) => (
                  <article className="cartao" key={j.id}>
                    <div
                      className={`espinha espinha--${
                        fixos.has(String(j.id)) ? 'duvida' : 'entra'
                      }`}
                      aria-hidden="true"
                    />
                    <div className="cartao-corpo">
                      <h3 className="cartao-nome">{j.nome}</h3>
                      <p className="cartao-meta">
                        <span className="posicao">{j.posicao}</span>
                        <span>{j.equipa}</span>
                        {fixos.has(String(j.id)) && <span>· escolhido por ti</span>}
                      </p>
                    </div>
                    <div className="cartao-numeros">
                      <span className="custo">{euros(j.custo)}</span>
                      <span className="media">{j.pontos} pts</span>
                    </div>
                  </article>
                ))}
              </div>
            );
          })}

          <p className="entrada-nota">
            Os pontos são os da época passada, não uma previsão. O optimizador
            gasta o orçamento todo por defeito — se preferires guardar folga
            para trocas, fixa jogadores mais baratos.
          </p>
        </>
      )}
    </section>
  );
}
