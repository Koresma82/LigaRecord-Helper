import { euros, sinal, rotulo, espinha } from '../lib/formatar.js';

export function CartaoJogador({ jogador, variante }) {
  const tipo = jogador.ausencia?.tipo;
  const classe = variante ?? espinha(tipo);

  return (
    <article className="cartao">
      <div className={`espinha espinha--${classe}`} aria-hidden="true" />
      <div className="cartao-corpo">
        <h3 className="cartao-nome">{jogador.nome}</h3>
        <p className="cartao-meta">
          <span className="posicao">{jogador.posicao}</span>
          <span>{jogador.equipa}</span>
        </p>

        {jogador.ausencia && (
          <p className="motivo">
            <strong>{rotulo(jogador.ausencia.tipo)}.</strong>{' '}
            {jogador.ausencia.motivo}
          </p>
        )}

        {jogador.hipoteses && (
          <p className="motivo">
            <strong>Nome ambíguo.</strong> O boletim tem{' '}
            {jogador.hipoteses.map((h) => h.nome).join(' ou ')} nesta equipa e
            não dá para saber qual é. Confirma antes de trocar.
          </p>
        )}
      </div>
      <div className="cartao-numeros">
        <span className="custo">{euros(jogador.custo)}</span>
        <span className="media">{(jogador.mediaPontos ?? 0).toFixed(1)} méd.</span>
      </div>
    </article>
  );
}

export function Troca({ sai, entra }) {
  const diferenca = entra.custo - sai.custo;
  const ganho = entra.mediaPontos - sai.mediaPontos;

  return (
    <div className="troca">
      <div className="troca-linha">
        <span className="seta">−</span>
        <span className="troca-nome sai">{sai.nome}</span>
        <span className="troca-valor">{euros(sai.custo)}</span>
      </div>
      <div className="troca-linha">
        <span className="seta">+</span>
        <span className="troca-nome">{entra.nome}</span>
        <span className="troca-valor">{euros(entra.custo)}</span>
      </div>
      <div className="delta">
        <span>
          custo {sinal(diferenca)}M
        </span>
        <span className={ganho >= 0 ? 'positivo' : 'negativo'}>
          média {sinal(ganho)}
        </span>
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
