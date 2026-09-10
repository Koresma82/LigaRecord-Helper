// Achados obtidos por consulta a um modelo de linguagem com pesquisa web.
//
// Isto NÃO é um facto como os cartões, que saem de tabelas. É interpretação
// de notícias, e um modelo acerta em muita coisa e inventa alguma. Por isso
// vive numa secção própria, com a origem à vista e um link para a fonte,
// para se poder confirmar antes de decidir seja o que for.
//
// Passou a separar dois casos, e a distinção importa:
//
//   lesão   notícia concreta de indisponibilidade que a tabela do
//           Transfermarkt não apanhou. Quase um facto, e tem de saltar à
//           vista — a tabela falha jogador a jogador e um buraco parcial
//           parece exactamente igual a boa notícia.
//
//   dúvida  sinal de risco sem confirmação. Contexto, não decisão.
export default function DuvidasIA({ duvidasIA }) {
  if (!duvidasIA) return null;

  const { achados, duvidas, consultadoEm, jornada } = duvidasIA;
  // `duvidas` é o nome antigo do campo. Um boletim gravado antes desta
  // versão continua a ler-se.
  const lista = achados ?? duvidas ?? [];

  const lesoes = lista.filter((d) => d.tipo === 'lesao');
  const naDuvida = lista.filter((d) => d.tipo !== 'lesao');

  const item = (d) => (
    <li key={`${d.nome}-${d.fonte}`} className={`duvida duvida--${d.confianca}`}>
      <div className="duvida__topo">
        <strong>{d.nome}</strong>
        {d.equipa && <span className="duvida__equipa">{d.equipa}</span>}
        <span className={`duvida__confianca duvida__confianca--${d.confianca}`}>
          {d.confianca}
        </span>
      </div>
      <p className="duvida__motivo">{d.motivo}</p>
      {d.nomeNaNoticia && (
        <p className="duvida__alias">nas notícias: {d.nomeNaNoticia}</p>
      )}
      <a href={d.fonte} target="_blank" rel="noreferrer" className="duvida__fonte">
        ver notícia
      </a>
    </li>
  );

  return (
    <section className="duvidas-ia">
      <div className="duvidas-ia__cabecalho">
        <h2>Segundo as notícias</h2>
        <span className="etiqueta-ia">não confirmado</span>
      </div>

      <p className="duvidas-ia__nota">
        Recolhido por IA a partir de notícias recentes, para a jornada {jornada}.
        Serve para apanhar o que a tabela de lesionados deixa cair. Confirma
        antes de mexer na equipa.
      </p>

      {lista.length === 0 ? (
        <p className="duvidas-ia__vazio">
          Nada encontrado sobre os teus jogadores.
        </p>
      ) : (
        <>
          {lesoes.length > 0 && (
            <>
              <h3 className="duvidas-ia__subtitulo">
                Lesionados fora da tabela ({lesoes.length})
              </h3>
              <ul className="duvidas-ia__lista">{lesoes.map(item)}</ul>
            </>
          )}

          {naDuvida.length > 0 && (
            <>
              <h3 className="duvidas-ia__subtitulo">Em dúvida ({naDuvida.length})</h3>
              <ul className="duvidas-ia__lista">{naDuvida.map(item)}</ul>
            </>
          )}
        </>
      )}

      {consultadoEm && (
        <p className="duvidas-ia__data">
          consultado {new Date(consultadoEm).toLocaleString('pt-PT')}
        </p>
      )}
    </section>
  );
}
