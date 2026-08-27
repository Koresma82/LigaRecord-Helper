// -----------------------------------------------------------------------------
// As 18 equipas, tiradas da dropdown "Clube" da propria Liga Record.
//
// CORRECCAO: a lista que eu tinha antes estava errada — tinha Tondela e AFS,
// que nao estao nesta edicao, e faltavam Academico de Viseu e Maritimo.
// Isto importa: uma equipa a mais so gera pedidos falhados, mas uma equipa
// a menos significa jogadores lesionados que nunca aparecem no boletim.
//
// Os ids do Zerozero PRECISAM DE SER CONFIRMADOS. Corre:
//   npm run inspect "<nome>"
// e ve se a pagina que abre e a certa. Os que marquei com "?" sao palpites.
// -----------------------------------------------------------------------------

export const EQUIPAS = [
  { nome: 'Académico Viseu',    zerozero: 'https://www.zerozero.pt/equipa/academico-viseu/1497', confirmado: false },
  { nome: 'Alverca',            zerozero: 'https://www.zerozero.pt/equipa/alverca/1531',         confirmado: false },
  { nome: 'Arouca',             zerozero: 'https://www.zerozero.pt/equipa/arouca/1585',          confirmado: false },
  { nome: 'Benfica',            zerozero: 'https://www.zerozero.pt/equipa/benfica/8',            confirmado: false },
  { nome: 'Casa Pia',           zerozero: 'https://www.zerozero.pt/equipa/casa-pia/1503',        confirmado: false },
  { nome: 'E. Amadora',         zerozero: 'https://www.zerozero.pt/equipa/estrela-amadora/22',   confirmado: false },
  { nome: 'Estoril',            zerozero: 'https://www.zerozero.pt/equipa/estoril-praia/23',     confirmado: false },
  { nome: 'Famalicão',          zerozero: 'https://www.zerozero.pt/equipa/famalicao/24',         confirmado: false },
  { nome: 'FC Porto',           zerozero: 'https://www.zerozero.pt/equipa/fc-porto/50',          confirmado: false },
  { nome: 'Gil Vicente',        zerozero: 'https://www.zerozero.pt/equipa/gil-vicente/27',       confirmado: false },
  { nome: 'Marítimo',           zerozero: 'https://www.zerozero.pt/equipa/maritimo/34',          confirmado: false },
  { nome: 'Moreirense',         zerozero: 'https://www.zerozero.pt/equipa/moreirense/36',        confirmado: false },
  { nome: 'Nacional',           zerozero: 'https://www.zerozero.pt/equipa/nacional/38',          confirmado: false },
  { nome: 'Rio Ave',            zerozero: 'https://www.zerozero.pt/equipa/rio-ave/45',           confirmado: false },
  { nome: 'Santa Clara',        zerozero: 'https://www.zerozero.pt/equipa/santa-clara/48',       confirmado: false },
  { nome: 'Sp. Braga',          zerozero: 'https://www.zerozero.pt/equipa/sc-braga/2',           confirmado: false },
  { nome: 'Sporting',           zerozero: 'https://www.zerozero.pt/equipa/sporting-cp/17',       confirmado: false },
  { nome: 'V. Guimarães',       zerozero: 'https://www.zerozero.pt/equipa/vitoria-sc/20',        confirmado: false },
];

// Compatibilidade com o codigo que ja usava este nome.
export const EQUIPAS_ZEROZERO = EQUIPAS.map((e) => ({
  nome: e.nome,
  urlPlantel: e.zerozero,
}));
