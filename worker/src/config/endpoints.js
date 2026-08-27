// -----------------------------------------------------------------------------
// A Liga Record e ASP.NET WebForms. Nao ha API JSON — os dados vem
// renderizados no HTML das paginas .aspx. Por isso isto sao URLs de paginas,
// nao endpoints.
//
// Confirmado pela captura: Microsoft-IIS, X-Aspnet-Version 4.0.30319,
// paginas .aspx, sessao por cookie (LigaRecordUser + cof_site_user).
// -----------------------------------------------------------------------------

export const BASE = process.env.LR_BASE ?? 'https://liga.record.pt';

export const URLS = {
  // Formulario de login. E o SSO do grupo Medialivre; a pagina que
  // apanhaste na captura. Confirma o URL exacto na barra de endereco.
  login: process.env.LR_URL_LOGIN ?? 'https://liga.record.pt/login/default.aspx',

  // Painel principal, confirmado na captura.
  gerirEquipas: `${BASE}/gerir-equipas/default.aspx`,

  // Confirmado: plantel.aspx?id_team=NNNNNN e ao mesmo tempo o plantel e o
  // mercado. Nao ha pagina separada de compras — o mesmo ecra lista todos os
  // jogadores e marca com COMPRAR os que ainda nao tens.
  plantel: `${BASE}/gerir-equipas/plantel.aspx`,
  equipas: `${BASE}/gerir-equipas/equipas.aspx`,
};

// -----------------------------------------------------------------------------
// REGRAS DA LIGA RECORD (do regulamento oficial)
//
// Sao diferentes do Fantasy da Liga Portugal, e isso muda as sugestoes.
// -----------------------------------------------------------------------------

export const REGRAS = {
  orcamentoTotal: 40,          // milhoes
  tamanhoPlantel: 23,
  porPosicao: { GR: 3, DEF: 8, MED: 8, AVA: 4 },
  titulares: 11,
  suplentes: 4,

  // O ponto que muda tudo: UMA troca por ronda. Vende um, compra um.
  trocasPorRonda: 1,

  // Excepto na reabertura do mercado em fevereiro.
  trocasNaReabertura: 6,
};
