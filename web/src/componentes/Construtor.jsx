import { useMemo, useState } from 'react';
import { montarPlantel, FORMACAO } from '../../../partilhado/montar-plantel.js';
import { euros } from '../lib/formatar.js';
import { guardarPlantel } from '../lib/firebase.js';
import { Grelha } from './Cartoes.jsx';

const ORDEM = ['GR', 'DEF', 'MED', 'AVA'];
const NOME_POSICAO = { GR: 'Guarda-redes', DEF: 'Defesas', MED: 'Médios', AVA: 'Avançados' };

export default function Construtor({ mercado, jaComprados = [], uid }) {
  const [fixos, setFixos] = useState(() => new Set(jaComprados.map(String)));
  const [procura, setProcura] = useState('');
  const [posicaoAberta, setPosicaoAberta] = useState('GR');
  const [aGravar, setAGravar] = useState(false);
  const [gravado, setGravado] = useState(null);

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

      <RegistarPlantel
        fixos={fixos}
        mercado={mercado}
        uid={uid}
        aGravar={aGravar}
        setAGravar={setAGravar}
        gravado={gravado}
        setGravado={setGravado}
      />

      <div className="lista-escolha">
        {porPosicao.map((j) => {
          const fixo = fixos.has(String(j.id));
          return (
            <button
              key={j.id}
              className={`escolha escolha--${j.posicao}${fixo ? ' escolha--fixo' : ''}`}
              onClick={() => alternar(j.id)}
              aria-pressed={fixo}
            >
              <span className="escolha-corpo">
                <span className="escolha-nome">{j.nome}</span>
                <span className="escolha-clube">{j.equipa}</span>
              </span>
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
                <Grelha>{grupo.map((j) => (
                  <article className={`cartao cartao--${j.posicao}`} key={j.id}>
                    <div className="cartao-topo">
                      <div>
                        <h3 className="cartao-nome">{j.nome}</h3>
                        <p className="cartao-meta">
                          <span className="etiqueta-posicao">{j.posicao}</span>
                          <span>{j.equipa}</span>
                        </p>
                      </div>
                      <div className="cartao-numeros">
                        <span className="custo">{euros(j.custo)}</span>
                        <span className="media">{j.pontos} pts</span>
                      </div>
                    </div>
                    {fixos.has(String(j.id)) && (
                      <span className="selo selo--ok">escolhido por ti</span>
                    )}
                  </article>
                ))}</Grelha>
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

// -----------------------------------------------------------------------------
// Registar o plantel.
//
// Isto substitui a leitura do plantel no site. O login da Liga Record usa
// SSO por iframe entre dominios, que nenhum cliente HTTP reproduz — e era a
// unica coisa para que precisavamos dele. Marcas aqui os teus 23 jogadores,
// o worker le-os na recolha seguinte, e o resto (valores, pontos, lesoes)
// continua a vir sozinho.
//
// Como so tens uma troca por ronda, isto e um clique por semana.
// -----------------------------------------------------------------------------

function RegistarPlantel({ fixos, mercado, uid, aGravar, setAGravar, gravado, setGravado }) {
  const contagem = useMemo(() => {
    const c = { GR: 0, DEF: 0, MED: 0, AVA: 0 };
    for (const id of fixos) {
      const j = mercado.find((m) => String(m.id) === id);
      if (j) c[j.posicao] += 1;
    }
    return c;
  }, [fixos, mercado]);

  const completo = ORDEM.every((p) => contagem[p] === FORMACAO[p]);

  const gravar = async () => {
    setAGravar(true);
    setGravado(null);
    try {
      const custo = [...fixos].reduce((s, id) => {
        const j = mercado.find((m) => String(m.id) === id);
        return s + (j?.custo ?? 0);
      }, 0);
      await guardarPlantel(uid, [...fixos], Number((40 - custo).toFixed(2)));
      setGravado('ok');
    } catch (erro) {
      setGravado(erro.code === 'permission-denied' ? 'sem-permissao' : 'erro');
    } finally {
      setAGravar(false);
    }
  };

  return (
    <div className="registar">
      <p className="registar-texto">
        {completo
          ? 'Os 23 estão escolhidos. Grava para o boletim passar a seguir estes jogadores.'
          : `Marca os teus 23 jogadores reais e grava. Faltam ${ORDEM.filter(
              (p) => contagem[p] !== FORMACAO[p]
            )
              .map((p) => `${FORMACAO[p] - contagem[p]} ${p}`)
              .join(', ')}.`}
      </p>
      <button className="botao-google" onClick={gravar} disabled={!completo || aGravar}>
        {aGravar ? 'A gravar…' : 'Gravar como o meu plantel'}
      </button>
      {gravado === 'ok' && (
        <p className="registar-nota">
          Gravado. Na próxima recolha o boletim passa a verificar estes jogadores.
        </p>
      )}
      {gravado === 'sem-permissao' && (
        <div className="aviso">
          As regras do Firestore recusaram a escrita. Publica a versão actual do
          <code> firestore.rules</code> na consola do Firebase.
        </div>
      )}
      {gravado === 'erro' && <div className="aviso">Não consegui gravar. Tenta outra vez.</div>}
    </div>
  );
}
