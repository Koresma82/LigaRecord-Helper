import { useEffect, useState } from 'react';
import { CartaoJogador, Troca, Vazio, Resumo, Grelha } from './componentes/Cartoes.jsx';
import Entrada from './componentes/Entrada.jsx';
import Construtor from './componentes/Construtor.jsx';
import Disciplina from './componentes/Disciplina.jsx';
import Campeonato from './componentes/Campeonato.jsx';
import { euros, contagem } from './lib/formatar.js';
import { auth, onAuthStateChanged, escutarBoletim, sair } from './lib/firebase.js';

const ORDEM = ['GR', 'DEF', 'MED', 'AVA'];
const NOME_POSICAO = { GR: 'Guarda-redes', DEF: 'Defesas', MED: 'Médios', AVA: 'Avançados' };

export default function App() {
  const [utilizador, setUtilizador] = useState(undefined);
  const [boletim, setBoletim] = useState(null);
  const [erro, setErro] = useState(null);
  const [vista, setVista] = useState('equipa');

  useEffect(() => onAuthStateChanged(auth, setUtilizador), []);

  useEffect(() => {
    if (!utilizador) return;
    setErro(null);
    return escutarBoletim(utilizador.uid, setBoletim, (e) =>
      setErro(
        e.code === 'permission-denied'
          ? 'Esta conta não tem acesso. Confirma as regras do Firestore.'
          : `O boletim não carregou: ${e.message}`
      )
    );
  }, [utilizador]);

  if (utilizador === undefined) {
    return (
      <main className="app">
        <div className="vazio">A verificar sessão…</div>
      </main>
    );
  }

  if (!utilizador) return <Entrada erro={erro} />;

  if (erro) {
    return (
      <main className="app">
        <div className="seccao">
          <Vazio titulo="Sem acesso">{erro}</Vazio>
          <button className="aba" onClick={() => sair(auth)}>Sair</button>
        </div>
      </main>
    );
  }

  if (!boletim) {
    return (
      <main className="app">
        <div className="seccao">
          <Vazio titulo="Ainda não há boletim">
            Corre <code>npm run recolher</code> no worker.
          </Vazio>
        </div>
      </main>
    );
  }

  const jornada = boletim.jornada?.numero;
  const plantel = boletim.equipa?.plantel ?? [];
  const fora = boletim.emRisco.filter((j) => j.ausencia && j.ausencia.tipo !== 'duvida');
  const duvida = boletim.emRisco.filter(
    (j) => (j.ausencia && j.ausencia.tipo === 'duvida') || j.hipoteses
  );

  const naLiga = boletim.ligaInteira ?? [];
  const castigados = naLiga.filter((j) => j.ausencia?.tipo === 'castigo');
  const lesionados = naLiga.filter((j) => j.ausencia?.tipo === 'lesao');

  const relogio = contagem(boletim.jornada?.fechoMercado);
  const sug = boletim.sugestoes;
  const temMercado = Boolean(boletim.mercado?.length);

  const abas = [
    { id: 'equipa', rotulo: 'A minha equipa', bolha: fora.length || null },
    { id: 'castigos', rotulo: 'Castigados', bolha: castigados.length || null },
    { id: 'lesoes', rotulo: 'Lesionados', bolha: lesionados.length || null },
    { id: 'campeonato', rotulo: 'Campeonato' },
    ...(temMercado ? [{ id: 'construir', rotulo: 'Construir' }] : []),
  ];

  return (
    <main className="app">
      <header className="cabecalho">
        <div className="topo">
          <h1 className="jornada">
            <span>Jornada</span>
            <em>{jornada ?? '—'}</em>
          </h1>
          <button className="sair" onClick={() => sair(auth)}>Sair</button>
        </div>
        <p className={`fecho${relogio?.urgente ? ' urgente' : ''}`}>
          <span>
            {relogio ? <>fecha em <strong>{relogio.texto}</strong></> : 'fecho por determinar'}
          </span>
          <span>
            saldo <strong>{euros(boletim.equipa.saldo)}</strong>
          </span>
        </p>
      </header>

      {boletim.avisos?.map((a) => (
        <div className="aviso" key={a}>{a}</div>
      ))}

      <div className="abas">
        {abas.map((a) => (
          <button
            key={a.id}
            className="aba"
            aria-pressed={vista === a.id}
            onClick={() => setVista(a.id)}
          >
            {a.rotulo}
            {a.bolha ? <span className="bolha">{a.bolha}</span> : null}
          </button>
        ))}
      </div>

      {vista === 'equipa' && (
        <VistaEquipa
          plantel={plantel}
          fora={fora}
          duvida={duvida}
          sug={sug}
          boletim={boletim}
        />
      )}

      {vista === 'castigos' && (
        <>
          <VistaLista
            titulo={jornada ? `Castigados na jornada ${jornada}` : 'Castigados'}
            jogadores={castigados}
            plantel={plantel}
            vazio="Nenhum castigo confirmado nesta jornada."
          />
          <Disciplina cartoes={boletim.cartoes} plantel={plantel} />
        </>
      )}

      {vista === 'lesoes' && (
        <VistaLista
          titulo="Lesionados na liga"
          jogadores={lesionados}
          plantel={plantel}
          vazio="Nenhum lesionado registado."
        />
      )}

      {vista === 'campeonato' && (
        <Campeonato
          classificacao={boletim.classificacao}
          jogos={boletim.proximosJogos}
          plantel={plantel}
          jornada={jornada}
        />
      )}

      {vista === 'construir' && (
        <Construtor
          mercado={boletim.mercado}
          jaComprados={plantel.map((j) => j.id)}
          uid={utilizador.uid}
        />
      )}

      <details className="detalhe">
        <summary>Diagnóstico</summary>
        <pre>
{`gerado           ${new Date(boletim.geradoEm).toLocaleString('pt-PT')}
jornada          ${jornada ?? '?'} (${boletim.jornada?.origem ?? '?'})
ronda Liga Record ${boletim.ronda?.numero ?? '?'}
jogadores lidos  ${boletim.diagnostico?.jogadoresLidos ?? '?'}
ausências lidas  ${boletim.diagnostico?.ausenciasLidas ?? '?'}
emparelhadas     ${boletim.diagnostico?.emparelhadas ?? '?'}`}
        </pre>
      </details>
    </main>
  );
}

function VistaEquipa({ plantel, fora, duvida, sug, boletim }) {
  const disponiveis = plantel.length - fora.length - duvida.length;

  return (
    <>
      <Resumo
        itens={[
          { valor: disponiveis, rotulo: 'disponíveis', tom: 'ok' },
          { valor: fora.length, rotulo: 'não jogam', tom: 'fora' },
          { valor: duvida.length, rotulo: 'em dúvida', tom: 'duvida' },
          { valor: euros(boletim.equipa.valorEquipa), rotulo: 'valor' },
        ]}
      />

      {fora.length > 0 && (
        <section className="seccao">
          <h2>Não jogam <span className="contagem">{fora.length}</span></h2>
          <Grelha>
            {fora.map((j) => <CartaoJogador key={j.id} jogador={j} />)}
          </Grelha>
        </section>
      )}

      {duvida.length > 0 && (
        <section className="seccao">
          <h2>A confirmar <span className="contagem">{duvida.length}</span></h2>
          <Grelha>
            {duvida.map((j) => <CartaoJogador key={j.id} jogador={j} estado="duvida" />)}
          </Grelha>
        </section>
      )}

      {fora.length > 0 && sug?.melhorTroca && (
        <section className="seccao">
          <h2>
            A troca da ronda <span className="contagem">{sug.trocasPermitidas} permitida</span>
          </h2>
          <Troca sai={sug.melhorTroca.sai} entra={sug.melhorTroca.entra} />
          {sug.ficamNoPlantel?.length > 0 && (
            <div className="aviso">
              Só podes trocar um por ronda.{' '}
              {sug.ficamNoPlantel.map((j) => j.nome).join(', ')} fica no plantel —
              tira do onze e mete suplentes.
            </div>
          )}
        </section>
      )}

      <section className="seccao">
        <h2>O plantel <span className="contagem">{plantel.length}/23</span></h2>
        {plantel.length ? (
          ORDEM.map((posicao) => {
            const grupo = plantel.filter((j) => j.posicao === posicao);
            if (!grupo.length) return null;
            return (
              <div key={posicao} className="bloco-opcoes">
                <h2>{NOME_POSICAO[posicao]}</h2>
                <Grelha>
                  {grupo.map((j) => {
                    const problema = [...fora, ...duvida].find((x) => x.id === j.id);
                    return <CartaoJogador key={j.id} jogador={problema ?? j} />;
                  })}
                </Grelha>
              </div>
            );
          })
        ) : (
          <Vazio titulo="Plantel por registar">
            Abre o separador Construir, marca os teus 23 jogadores e grava.
          </Vazio>
        )}
      </section>
    </>
  );
}

function VistaLista({ titulo, jogadores, plantel, vazio, extra }) {
  const [apenasMeus, setApenasMeus] = useState(false);
  const [procura, setProcura] = useState('');

  const meus = new Set(plantel.map((j) => j.id));

  const filtrados = jogadores.filter((j) => {
    const alvo = procura.trim().toLowerCase();
    if (alvo && !j.nome.toLowerCase().includes(alvo) && !j.equipa.toLowerCase().includes(alvo)) {
      return false;
    }
    return true;
  });

  const teus = filtrados
    .filter((j) => meus.has(j.id))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));

  const outros = filtrados
    .filter((j) => !meus.has(j.id))
    .sort((a, b) => a.equipa.localeCompare(b.equipa, 'pt'));

  return (
    <>
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

      {teus.length > 0 && (
        <section className="seccao">
          <h2>Teus <span className="contagem">{teus.length}</span></h2>
          <Grelha>{teus.map((j) => <CartaoJogador key={j.id} jogador={j} />)}</Grelha>
        </section>
      )}

      {!apenasMeus && (
        <section className="seccao">
          <h2>{titulo} <span className="contagem">{outros.length}</span></h2>
          {outros.length ? (
            <Grelha>{outros.map((j) => <CartaoJogador key={j.id} jogador={j} />)}</Grelha>
          ) : (
            !teus.length && <Vazio titulo="Nada a assinalar">{vazio}</Vazio>
          )}
        </section>
      )}

      {apenasMeus && !teus.length && (
        <Vazio titulo="Nenhum dos teus">
          Nenhum jogador do teu plantel está nesta lista.
        </Vazio>
      )}

      {extra?.length > 0 && (
        <section className="seccao">
          <h2>A um amarelo do castigo <span className="contagem">{extra.length}</span></h2>
          <div className="aviso">
            Não faltam a esta jornada, mas o próximo amarelo tira-os da seguinte.
          </div>
          <Grelha>
            {extra.map((c) => (
              <CartaoJogador
                key={c.nome + c.equipa}
                jogador={{ ...c, id: c.nome, custo: 0, posicao: c.posicao || 'MED' }}
                estado="duvida"
              />
            ))}
          </Grelha>
        </section>
      )}
    </>
  );
}
