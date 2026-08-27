// -----------------------------------------------------------------------------
// Normalizacao de nomes.
//
// Este e o ficheiro que decide se o projecto funciona ou nao. A Liga Record
// diz "J. Silva", o Zerozero diz "Joao Pedro da Silva", e alguem tem de
// perceber que sao o mesmo homem. Aqui e onde isso acontece.
// -----------------------------------------------------------------------------

const APELIDOS_COMUNS = new Set([
  'junior', 'jr', 'filho', 'neto', 'da', 'de', 'do', 'dos', 'das', 'e',
]);

export function normalizar(nome = '') {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // tira acentos
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')          // tira pontuacao
    .replace(/\s+/g, ' ')
    .trim();
}

export function fichas(nome) {
  return normalizar(nome)
    .split(' ')
    .filter((t) => t.length > 1 && !APELIDOS_COMUNS.has(t));
}

// Distancia de Levenshtein, para apanhar gralhas ("Guedes" vs "Guedez").
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let anterior = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const actual = [i];
    for (let j = 1; j <= n; j++) {
      actual[j] = Math.min(
        anterior[j] + 1,
        actual[j - 1] + 1,
        anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    anterior = actual;
  }
  return anterior[n];
}

function parecidas(a, b) {
  if (a === b) return 1;
  // "j" contra "joao": inicial abreviada conta como parcial.
  if (a.length === 1 && b.startsWith(a)) return 0.6;
  if (b.length === 1 && a.startsWith(b)) return 0.6;
  const d = levenshtein(a, b);
  const max = Math.max(a.length, b.length);
  const sim = 1 - d / max;
  return sim >= 0.82 ? sim : 0;
}

// Devolve 0..1. Acima de 0.7 consideramos o mesmo jogador,
// mas so se a equipa tambem bater certo.
export function semelhanca(nomeA, nomeB) {
  let a = fichas(nomeA);
  let b = fichas(nomeB);
  if (!a.length || !b.length) return 0;

  // O nome mais curto manda. "Silva" contra "Joao Pedro da Silva" e o caso
  // normal, nao a excepcao: a Liga Record abrevia, o Zerozero escreve tudo.
  if (a.length > b.length) [a, b] = [b, a];

  let soma = 0;
  const usadas = new Set();

  for (const fa of a) {
    let melhor = 0;
    let melhorIdx = -1;
    b.forEach((fb, i) => {
      if (usadas.has(i)) return;
      const s = parecidas(fa, fb);
      if (s > melhor) {
        melhor = s;
        melhorIdx = i;
      }
    });
    if (melhorIdx >= 0) usadas.add(melhorIdx);
    soma += melhor;
  }

  const base = soma / a.length;

  // O ultimo apelido pesa mais: e o que quase sempre coincide.
  const ultimoIgual = parecidas(a[a.length - 1], b[b.length - 1]) > 0;
  return Math.min(1, ultimoIgual ? base : base * 0.8);
}

const ALCUNHAS_EQUIPAS = {
  // A chave e o nome como aparece na Liga Record; os valores sao as
  // variantes que o Zerozero e a imprensa usam.
  'sporting': ['sporting cp', 'scp', 'sporting clube de portugal', 'leoes'],
  'fc porto': ['porto', 'fcp', 'dragoes', 'futebol clube do porto'],
  'benfica': ['sl benfica', 'slb', 'aguias', 'sport lisboa e benfica'],
  'sp. braga': ['braga', 'sc braga', 'scb', 'sporting clube de braga'],
  'v. guimaraes': ['vitoria sc', 'vitoria guimaraes', 'vsc', 'guimaraes', 'vitoria'],
  'e. amadora': ['estrela da amadora', 'estrela', 'cf estrela da amadora'],
  'academico viseu': ['academico de viseu', 'av', 'academico viseu fc'],
  'maritimo': ['cs maritimo', 'maritimo da madeira'],
  'alverca': ['fc alverca'],
  'casa pia': ['casa pia ac', 'casapia'],
  'rio ave': ['rio ave fc'],
  'gil vicente': ['gil vicente fc', 'gil'],
  'santa clara': ['cd santa clara'],
  'famalicao': ['fc famalicao'],
  'moreirense': ['moreirense fc'],
  'arouca': ['fc arouca'],
  'estoril': ['estoril praia', 'gd estoril praia'],
  'nacional': ['cd nacional', 'nacional da madeira'],
};

// As chaves tem pontos ("e. amadora") que a normalizacao remove, por isso
// comparamos sempre normalizado dos dois lados.
const INDICE = new Map();
for (const [canonico, alcunhas] of Object.entries(ALCUNHAS_EQUIPAS)) {
  INDICE.set(normalizar(canonico), canonico);
  for (const a of alcunhas) INDICE.set(normalizar(a), canonico);
}

export function equipaCanonica(nome = '') {
  const n = normalizar(nome);
  if (!n) return '';

  const exacto = INDICE.get(n);
  if (exacto) return exacto;

  // Correspondencia parcial, para nomes com sufixos ("FC Porto SAD").
  for (const [chave, canonico] of INDICE) {
    if (n.includes(chave) || chave.includes(n)) return canonico;
  }

  return n;
}
