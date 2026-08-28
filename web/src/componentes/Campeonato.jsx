import { euros } from '../lib/formatar.js';

// Classificação e jogos da próxima jornada.
//
// O clube do próprio plantel fica destacado: numa tabela de 18 linhas, o que
// interessa é encontrar depressa as equipas onde tens jogadores.
export default function Campeonato({ classificacao = [], jogos = [], plantel = [], jornada }) {
  const meusClubes = new Set(plantel.map((j) => j.equipa));

  // Quantos jogadores tenho em cada clube. Num jogo com quatro dos meus
  // vale a pena estar atento; num com zero, não.
  const quantosEm = (clube) => plantel.filter((j) => j.equipa === clube).length;

  // Agrupar por jornada. A pagina do zerozero e por jornada, e misturar
  // duas numa lista so tornava a informacao inutil — nao dava para saber
  // que jogos contam para a decisao desta semana.
  const porJornada = jogos.reduce((mapa, j) => {
    const n = j.jornada ?? 0;
    (mapa[n] ??= []).push(j);
    return mapa;
  }, {});

  const numeros = Object.keys(porJornada)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <>
      {numeros.map((n) => (
        <section className="seccao" key={n}>
          <h2>
            {n === jornada ? 'Esta jornada' : `Jornada ${n}`}{' '}
            <span className="contagem">{porJornada[n].length}</span>
          </h2>

          <div className={`jogos${n === jornada ? ' jogos--destaque' : ''}`}>
            {porJornada[n].map((j) => {
              const nCasa = quantosEm(j.casa);
              const nFora = quantosEm(j.fora);
              const meus = nCasa + nFora;

              return (
                <div
                  className={`jogo${meus ? ' jogo--meu' : ''}`}
                  key={`${j.casa}-${j.fora}`}
                >
                  <span className={`jogo-equipa${nCasa ? ' jogo-equipa--meu' : ''}`}>
                    {j.casa}
                    {nCasa > 0 && <span className="quantos">{nCasa}</span>}
                  </span>

                  <span className="jogo-meio">
                    {j.hora ?? 'vs'}
                    {j.data && <em>{j.data}</em>}
                  </span>

                  <span className={`jogo-equipa${nFora ? ' jogo-equipa--meu' : ''}`}>
                    {nFora > 0 && <span className="quantos">{nFora}</span>}
                    {j.fora}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {!jogos.length && (
        <section className="seccao">
          <h2>Jogos</h2>
          <div className="aviso">
            Não consegui ler o calendário. Corre <code>npm run inspect-zerozero</code>
            {' '}no worker para ver o que a fonte devolveu.
          </div>
        </section>
      )}

      <section className="seccao">
        <h2>
          Classificação <span className="contagem">{classificacao.length}</span>
        </h2>

        {classificacao.length ? (
          <table className="tabela">
            <thead>
              <tr>
                <th />
                <th>Equipa</th>
                <th>J</th>
                <th>V</th>
                <th>E</th>
                <th>D</th>
                <th>Pts</th>
              </tr>
            </thead>
            <tbody>
              {classificacao.map((e) => (
                <tr key={e.equipa} className={meusClubes.has(e.equipa) ? 'linha--meu' : ''}>
                  <td className="pos">{e.posicao}</td>
                  <td className="equipa">{e.equipa}</td>
                  <td>{e.jogos}</td>
                  <td>{e.vitorias}</td>
                  <td>{e.empates}</td>
                  <td>{e.derrotas}</td>
                  <td className="pts">{e.pontos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="aviso">
            Não consegui ler a classificação. As fontes estão em
            {' '}<code>worker/src/fontes/campeonato.js</code>.
          </div>
        )}
      </section>
    </>
  );
}
