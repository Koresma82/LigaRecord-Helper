import { useEffect, useState } from 'react';
import { CartaoJogador, Troca, Vazio } from './componentes/Cartoes.jsx';
import Entrada from './componentes/Entrada.jsx';
import Construtor from './componentes/Construtor.jsx';
import { euros, contagem } from './lib/formatar.js';
import {
  auth,
  onAuthStateChanged,
  escutarBoletim,
  sair,
} from './lib/firebase.js';

export default function App() {
  const [utilizador, setUtilizador] = useState(undefined); // undefined = a carregar
  const [boletim, setBoletim] = useState(null);
  const [erro, setErro] = useState(null);
  const [vista, setVista] = useState('minha');

  useEffect(() => onAuthStateChanged(auth, setUtilizador), []);

  useEffect(() => {
    if (!utilizador) return;
    setErro(null);
    return escutarBoletim(
      utilizador.uid,
      setBoletim,
      (e) =>
        setErro(
          e.code === 'permission-denied'
            ? 'Esta conta não tem acesso. Confirma o uid nas regras do Firestore.'
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
          <button className="aba" onClick={() => sair(auth)}>
            Sair
          </button>
        </div>
      </main>
    );
  }

  if (!boletim) {
    return (
      <main className="app">
        <div className="seccao">
          <Vazio titulo="Ainda não há boletim">
            O worker ainda não gravou nada. Manda <code>/actualizar</code> ao
            bot, ou corre <code>npm run recolher</code> no worker.
          </Vazio>
        </div>
      </main>
    );
  }

  const fora = boletim.emRisco.filter(
    (j) => j.ausencia && j.ausencia.tipo !== 'duvida'
  );
  const duvida = boletim.emRisco.filter(
    (j) => (j.ausencia && j.ausencia.tipo === 'duvida') || j.hipoteses
  );

  const relogio = contagem(boletim.jornada?.fechoMercado);
  const sug = boletim.sugestoes;
  const temMercado = Boolean(boletim.mercado?.length);
  const plantelPorFazer = (boletim.equipa.plantel?.length ?? 0) < 23;

  return (
    <main className="app">
      <header className="cabecalho">
        <div className="topo">
          <h1 className="jornada">
            <span>Jornada</span>
            {boletim.jornada?.numero ?? '—'}
          </h1>
          <button className="sair" onClick={() => sair(auth)}>
            Sair
          </button>
        </div>
        <p className={`fecho${relogio?.urgente ? ' urgente' : ''}`}>
          <span>
            Mercado fecha em <strong>{relogio?.texto ?? 'data desconhecida'}</strong>
          </span>
          <span>
            saldo <strong>{euros(boletim.equipa.saldo)}</strong>
          </span>
        </p>
      </header>

      {boletim.avisos?.map((a) => (
        <div className="aviso" key={a}>
          {a}
        </div>
      ))}

      <div className="abas">
        <button
          className="aba"
          aria-pressed={vista === 'minha'}
          onClick={() => setVista('minha')}
        >
          A minha equipa
        </button>
        {temMercado && (
          <button
            className="aba"
            aria-pressed={vista === 'construir'}
            onClick={() => setVista('construir')}
          >
            Construir
          </button>
        )}
        <button
          className="aba"
          aria-pressed={vista === 'liga'}
          onClick={() => setVista('liga')}
        >
          Liga inteira
        </button>
      </div>

      {vista === 'construir' && temMercado ? (
        <Construtor
          mercado={boletim.mercado}
          jaComprados={(boletim.equipa.plantel ?? []).map((j) => j.id)}
        />
      ) : vista === 'minha' ? (
        <>
          {plantelPorFazer && temMercado && (
            <div className="aviso">
              O teu plantel tem {boletim.equipa.plantel?.length ?? 0} dos 23
              jogadores. Até estar completo não há lesões para verificar —
              abre <strong>Construir</strong> para gastar os 40M.
            </div>
          )}
          <section className="seccao">
            <h2>
              Não jogam <span className="contagem">{fora.length}</span>
            </h2>
            {fora.length ? (
              fora.map((j) => <CartaoJogador key={j.id} jogador={j} />)
            ) : (
              <Vazio titulo="Plantel inteiro disponível">
                Nenhum dos teus jogadores aparece no boletim desta jornada.
              </Vazio>
            )}
          </section>

          {duvida.length > 0 && (
            <section className="seccao">
              <h2>
                A confirmar <span className="contagem">{duvida.length}</span>
              </h2>
              {duvida.map((j) => (
                <CartaoJogador key={j.id} jogador={j} variante="duvida" />
              ))}
            </section>
          )}

          {fora.length > 0 && (
            <section className="seccao">
              <h2>
                A troca da ronda{' '}
                <span className="contagem">{sug?.trocasPermitidas ?? 1} permitida</span>
              </h2>

              {sug?.melhorTroca ? (
                <>
                  <Troca sai={sug.melhorTroca.sai} entra={sug.melhorTroca.entra} />
                  {sug.ficamNoPlantel?.length > 0 && (
                    <div className="aviso">
                      Só podes fazer uma troca por ronda.{' '}
                      {sug.ficamNoPlantel.map((j) => j.nome).join(', ')}{' '}
                      {sug.ficamNoPlantel.length > 1 ? 'ficam' : 'fica'} no
                      plantel — tira{sug.ficamNoPlantel.length > 1 ? '-os' : '-o'} do
                      onze e mete suplentes.
                    </div>
                  )}
                </>
              ) : (
                <Vazio titulo="Nada comportável">
                  Com {euros(boletim.equipa.saldo)} de saldo não há substitutos
                  na mesma posição que caibam no orçamento.
                </Vazio>
              )}

              <details className="detalhe">
                <summary>Outras opções por jogador</summary>
                {sug.porJogador.map(({ sai, opcoes }) => (
                  <div key={sai.id} className="bloco-opcoes">
                    <h2>
                      Em vez de {sai.nome}{' '}
                      <span className="contagem">
                        {euros(sai.custo + boletim.equipa.saldo)}
                      </span>
                    </h2>
                    {opcoes.slice(0, 5).map((o) => (
                      <CartaoJogador key={o.id} jogador={o} variante="entra" />
                    ))}
                  </div>
                ))}
              </details>
            </section>
          )}
        </>
      ) : (
        <section className="seccao">
          <h2>
            Ausências na liga{' '}
            <span className="contagem">{boletim.ligaInteira.length}</span>
          </h2>
          {boletim.ligaInteira
            .slice()
            .sort((a, b) => a.equipa.localeCompare(b.equipa, 'pt'))
            .map((j) => (
              <CartaoJogador key={j.id} jogador={j} />
            ))}
        </section>
      )}

      {boletim.porConfirmar?.length > 0 && (
        <section className="seccao">
          <h2>
            Nomes que não deram para resolver{' '}
            <span className="contagem">{boletim.porConfirmar.length}</span>
          </h2>
          {boletim.porConfirmar.map((p) => (
            <div className="aviso" key={p.jogador + p.equipa}>
              <strong>{p.jogador}</strong> ({p.equipa}) pode ser{' '}
              {p.hipoteses.map((h) => h.nome).join(' ou ')}.
            </div>
          ))}
        </section>
      )}

      <details className="detalhe">
        <summary>Diagnóstico</summary>
        <pre>
{`gerado           ${new Date(boletim.geradoEm).toLocaleString('pt-PT')}
jogadores lidos  ${boletim.diagnostico.jogadoresLidos}
ausências lidas  ${boletim.diagnostico.ausenciasLidas}
emparelhadas     ${boletim.diagnostico.emparelhadas}
ambíguas         ${boletim.diagnostico.ambiguas}
equipas falhadas ${boletim.diagnostico.equipasFalhadas.length}`}
        </pre>
      </details>
    </main>
  );
}
