import { euros } from '../lib/formatar.js';

const ROTULO = {
  fora: 'Fora',
  lesao: 'Lesionado',
  castigo: 'Castigado',
  duvida: 'Em dúvida',
};

export function CartaoJogador({ jogador, estado }) {
  const tipo = jogador.ausencia?.tipo;
  const situacao = estado ?? (tipo === 'duvida' ? 'duvida' : tipo ? 'fora' : 'ok');

  return (
    <article className={`cartao cartao--${jogador.posicao} cartao--${situacao}`}>
      <div className="cartao-topo">
        <div>
          <h3 className="cartao-nome">{jogador.nome}</h3>
          <p className="cartao-meta">
            <span className="etiqueta-posicao">{jogador.posicao}</span>
            <span>{jogador.equipa}</span>
          </p>
        </div>
        <div className="cartao-numeros">
          <span className="custo">{euros(jogador.custo)}</span>
          <span className="media">{jogador.pontosTotais ?? jogador.mediaPontos ?? 0} pts</span>
        </div>
      </div>

      {jogador.ausencia && (
        <>
          <span className={`selo selo--${situacao}`}>
            {ROTULO[jogador.ausencia.tipo] ?? 'Indisponível'}
          </span>
          <p className="motivo">
            {jogador.ausencia.motivo}
            {jogador.ausencia.dataRegresso && (
              <>
                {' '}
                <span className="regresso">
                  regresso {new Date(jogador.ausencia.dataRegresso).toLocaleDateString('pt-PT')}
                </span>
              </>
            )}
          </p>
        </>
      )}

      <Estatisticas jogador={jogador} />
    </article>
  );
}

// A tira de estatisticas por baixo de cada jogador do plantel.
//
// So aparece o que existe: um jogador sem golos nem cartoes nao leva zeros
// a encher espaco. O adversario da proxima jornada e o mais util para
// decidir o onze, por isso fica em linha propria.
function Estatisticas({ jogador }) {
  const { golos, amarelos, vermelhos, pontosUltimaRonda, proximoJogo, posicao } = jogador;

  // Os golos vêm da lista de marcadores da liga, que é de golos MARCADOS.
  // Não há golos sofridos em lado nenhum, por isso um guarda-redes com
  // golos é quase de certeza um erro de correspondência de nomes — e mais
  // vale não mostrar do que mostrar uma coisa que não se percebe.
  const mostraGolos = golos > 0 && posicao !== 'GR';

  const temAlgum =
    mostraGolos || amarelos > 0 || vermelhos > 0 || pontosUltimaRonda !== undefined;

  if (!temAlgum && !proximoJogo) return null;

  return (
    <div className="estatisticas">
      {temAlgum && (
        <div className="estatisticas-linha">
          {mostraGolos && (
            <span className="estatistica" title="golos marcados">
              ⚽ {golos}
            </span>
          )}
          {amarelos > 0 && (
            <span className="estatistica" title="cartões amarelos">
              <i className="quadrado quadrado--amarelo" /> {amarelos}
            </span>
          )}
          {vermelhos > 0 && (
            <span className="estatistica" title="cartões vermelhos">
              <i className="quadrado quadrado--vermelho" /> {vermelhos}
            </span>
          )}
          {pontosUltimaRonda !== undefined && pontosUltimaRonda !== null && (
            <span
              className={`estatistica ${pontosUltimaRonda < 0 ? 'negativo' : ''}`}
              title="pontos na última ronda"
            >
              {pontosUltimaRonda > 0 ? '+' : ''}
              {pontosUltimaRonda} última
            </span>
          )}
        </div>
      )}

      {jogador.naoJoga && (
        <div className="alerta alerta--fora">
          <span className="ponto" /> Não joga esta jornada
        </div>
      )}

      {!jogador.naoJoga && jogador.emRiscoProxima && (
        <div className="alerta alerta--duvida">
          <span className="ponto" /> Um amarelo e falha a próxima
        </div>
      )}

      {proximoJogo && (
        <div className={`proximo${jogador.naoJoga ? ' proximo--apagado' : ''}`}>
          <span className={`local local--${proximoJogo.casa ? 'casa' : 'fora'}`}>
            {proximoJogo.casa ? 'casa' : 'fora'}
          </span>
          <span className="adversario">{proximoJogo.adversario}</span>
          <span className="quando">
            {[proximoJogo.data, proximoJogo.hora].filter(Boolean).join(' ')}
          </span>
        </div>
      )}
    </div>
  );
}

export function Troca({ sai, entra }) {
  const diferenca = entra.custo - sai.custo;
  const ganho = (entra.pontosTotais ?? 0) - (sai.pontosTotais ?? 0);
  const sinal = (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));

  return (
    <div className="troca">
      <div className="troca-linha sai">
        <span className="seta">−</span>
        <span className="troca-nome riscado">{sai.nome}</span>
        <span className="troca-valor">{euros(sai.custo)}</span>
      </div>
      <div className="troca-linha entra">
        <span className="seta">+</span>
        <span className="troca-nome">{entra.nome}</span>
        <span className="troca-valor">{euros(entra.custo)}</span>
      </div>
      <div className="delta">
        <span>custo {sinal(diferenca)}M</span>
        <span className={ganho >= 0 ? 'positivo' : 'negativo'}>pontos {sinal(ganho)}</span>
      </div>
    </div>
  );
}

export function Vazio({ titulo, children }) {
  return (
    <div className="vazio">
      <strong>{titulo}</strong>
      {children}
    </div>
  );
}

export function Resumo({ itens }) {
  return (
    <div className="resumo">
      {itens.map(({ valor, rotulo, tom }) => (
        <div className={`resumo-item resumo-item--${tom ?? 'neutro'}`} key={rotulo}>
          <span className="resumo-valor">{valor}</span>
          <span className="resumo-rotulo">{rotulo}</span>
        </div>
      ))}
    </div>
  );
}

export function Grelha({ children }) {
  return <div className="grelha">{children}</div>;
}
