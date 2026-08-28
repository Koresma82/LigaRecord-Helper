// Dúvidas obtidas por consulta a um modelo de linguagem com pesquisa web.
//
// Isto NÃO é um facto como as lesões ou os cartões, que saem de tabelas.
// É interpretação de notícias, e um modelo acerta em muita coisa e inventa
// alguma. Por isso vive numa secção própria, com a origem à vista e um link
// para a fonte, para se poder confirmar antes de decidir seja o que for.
export default function DuvidasIA({ duvidasIA }) {
  if (!duvidasIA) return null;

  const { duvidas = [], consultadoEm, jornada } = duvidasIA;

  return (
    <section className="duvidas-ia">
      <div className="duvidas-ia__cabecalho">
        <h2>Dúvidas segundo as notícias</h2>
        <span className="etiqueta-ia">não confirmado</span>
      </div>

      <p className="duvidas-ia__nota">
        Recolhido por IA a partir de notícias da semana, para a jornada {jornada}.
        Confirma antes de mexer na equipa.
      </p>

      {duvidas.length === 0 ? (
        <p className="duvidas-ia__vazio">
          Nada encontrado sobre os teus jogadores esta semana.
        </p>
      ) : (
        <ul className="duvidas-ia__lista">
          {duvidas.map((d) => (
            <li key={`${d.nome}-${d.fonte}`} className={`duvida duvida--${d.confianca}`}>
              <div className="duvida__topo">
                <strong>{d.nome}</strong>
                {d.equipa && <span className="duvida__equipa">{d.equipa}</span>}
                <span className={`duvida__confianca duvida__confianca--${d.confianca}`}>
                  {d.confianca}
                </span>
              </div>
              <p className="duvida__motivo">{d.motivo}</p>
              <a href={d.fonte} target="_blank" rel="noreferrer" className="duvida__fonte">
                ver notícia
              </a>
            </li>
          ))}
        </ul>
      )}

      {consultadoEm && (
        <p className="duvidas-ia__data">
          consultado {new Date(consultadoEm).toLocaleString('pt-PT')}
        </p>
      )}
    </section>
  );
}
