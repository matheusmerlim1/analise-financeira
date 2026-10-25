/*
 * Prateleira de renda fixa usada pelo buscador.
 *
 * XP, BTG e as outras plataformas não publicam as ofertas em API aberta (exige login),
 * então esta lista é mantida à mão. As taxas abaixo são REFERÊNCIAS típicas de out/2026;
 * troque pelas que aparecem no app da sua corretora. Para editar no GitHub: abra este
 * arquivo, clique no lápis, altere e salve — o site publica a nova versão em ~1 minuto.
 *
 * Campos:
 *   plat     plataforma ("Tesouro Direto" = disponível em todas)
 *   tipo     LCA, LCI, CDB, CRA, CRI, Debênture incentivada, Tesouro Selic, Tesouro Pré, Tesouro IPCA+
 *   emissor  quem emite (o FGC cobre até R$ 250 mil por emissor)
 *   idx      "CDI" (taxa = % do CDI), "Pré" (taxa = % a.a.), "IPCA" (taxa = IPCA + x% a.a.)
 *   taxa     número, ex. 92 (= 92% do CDI) ou 13.8 (= 13,8% a.a.)
 *   prazo    dias até o vencimento
 *   min      aplicação mínima em R$
 *   liq      true se tem liquidez diária
 *   atual    data em que você conferiu a taxa (AAAA-MM-DD)
 */
window.OFERTAS = [
  // ---------- XP ----------
  { plat: 'XP', tipo: 'LCA', emissor: 'Banco médio A', idx: 'CDI', taxa: 92, prazo: 720, min: 1000, liq: false },
  { plat: 'XP', tipo: 'LCA', emissor: 'Banco grande A', idx: 'CDI', taxa: 88, prazo: 365, min: 1000, liq: false },
  { plat: 'XP', tipo: 'LCA', emissor: 'Banco médio B', idx: 'Pré', taxa: 12.1, prazo: 730, min: 1000, liq: false },
  { plat: 'XP', tipo: 'LCI', emissor: 'Banco médio C', idx: 'CDI', taxa: 90, prazo: 730, min: 1000, liq: false },
  { plat: 'XP', tipo: 'CDB', emissor: 'Banco médio A', idx: 'CDI', taxa: 110, prazo: 720, min: 1000, liq: false },
  { plat: 'XP', tipo: 'CDB', emissor: 'Banco médio D', idx: 'Pré', taxa: 13.9, prazo: 1080, min: 1000, liq: false },
  { plat: 'XP', tipo: 'CDB', emissor: 'Banco médio D', idx: 'IPCA', taxa: 7.8, prazo: 1440, min: 1000, liq: false },
  { plat: 'XP', tipo: 'CDB', emissor: 'Banco grande A', idx: 'CDI', taxa: 100, prazo: 1080, min: 100, liq: true },
  { plat: 'XP', tipo: 'CRA', emissor: 'Agronegócio AA', idx: 'IPCA', taxa: 7.2, prazo: 1825, min: 1000, liq: false },
  { plat: 'XP', tipo: 'Debênture incentivada', emissor: 'Energia AAA', idx: 'IPCA', taxa: 7.0, prazo: 2555, min: 1000, liq: false },
  // ---------- BTG Pactual ----------
  { plat: 'BTG Pactual', tipo: 'LCA', emissor: 'BTG Pactual', idx: 'CDI', taxa: 90, prazo: 360, min: 1000, liq: false },
  { plat: 'BTG Pactual', tipo: 'LCA', emissor: 'Banco médio E', idx: 'CDI', taxa: 93, prazo: 1080, min: 5000, liq: false },
  { plat: 'BTG Pactual', tipo: 'LCA', emissor: 'Banco médio A', idx: 'CDI', taxa: 91, prazo: 540, min: 1000, liq: false },
  { plat: 'BTG Pactual', tipo: 'LCI', emissor: 'Banco médio C', idx: 'CDI', taxa: 91, prazo: 720, min: 5000, liq: false },
  { plat: 'BTG Pactual', tipo: 'CDB', emissor: 'BTG Pactual', idx: 'CDI', taxa: 102, prazo: 1080, min: 100, liq: true },
  { plat: 'BTG Pactual', tipo: 'CDB', emissor: 'Banco médio E', idx: 'CDI', taxa: 112, prazo: 1080, min: 1000, liq: false },
  { plat: 'BTG Pactual', tipo: 'CDB', emissor: 'Banco médio B', idx: 'IPCA', taxa: 7.9, prazo: 1440, min: 1000, liq: false },
  { plat: 'BTG Pactual', tipo: 'CDB', emissor: 'Banco médio F', idx: 'Pré', taxa: 14.0, prazo: 720, min: 1000, liq: false },
  { plat: 'BTG Pactual', tipo: 'CRA', emissor: 'Agronegócio AAA', idx: 'IPCA', taxa: 7.4, prazo: 1825, min: 1000, liq: false },
  { plat: 'BTG Pactual', tipo: 'CRI', emissor: 'Imobiliário AA', idx: 'CDI', taxa: 98, prazo: 1460, min: 1000, liq: false },
  // ---------- Rico ----------
  { plat: 'Rico', tipo: 'LCA', emissor: 'Banco médio A', idx: 'CDI', taxa: 91, prazo: 720, min: 1000, liq: false },
  { plat: 'Rico', tipo: 'LCI', emissor: 'Banco médio C', idx: 'CDI', taxa: 89, prazo: 400, min: 1000, liq: false },
  { plat: 'Rico', tipo: 'CDB', emissor: 'Banco médio A', idx: 'CDI', taxa: 108, prazo: 720, min: 1000, liq: false },
  { plat: 'Rico', tipo: 'CDB', emissor: 'Banco médio D', idx: 'Pré', taxa: 13.8, prazo: 1080, min: 1000, liq: false },
  { plat: 'Rico', tipo: 'CDB', emissor: 'Banco grande A', idx: 'CDI', taxa: 100, prazo: 1080, min: 100, liq: true },
  // ---------- Inter ----------
  { plat: 'Inter', tipo: 'LCI', emissor: 'Banco Inter', idx: 'CDI', taxa: 86, prazo: 365, min: 50, liq: false },
  { plat: 'Inter', tipo: 'LCA', emissor: 'Banco médio B', idx: 'CDI', taxa: 89, prazo: 540, min: 500, liq: false },
  { plat: 'Inter', tipo: 'CDB', emissor: 'Banco Inter', idx: 'CDI', taxa: 100, prazo: 1080, min: 1, liq: true },
  { plat: 'Inter', tipo: 'CDB', emissor: 'Banco Inter', idx: 'CDI', taxa: 104, prazo: 720, min: 100, liq: false },
  // ---------- NuInvest ----------
  { plat: 'NuInvest', tipo: 'CDB', emissor: 'Nubank', idx: 'CDI', taxa: 100, prazo: 1080, min: 1, liq: true },
  { plat: 'NuInvest', tipo: 'LCA', emissor: 'Banco médio A', idx: 'CDI', taxa: 88, prazo: 365, min: 1000, liq: false },
  { plat: 'NuInvest', tipo: 'CDB', emissor: 'Banco médio F', idx: 'Pré', taxa: 13.7, prazo: 720, min: 1000, liq: false },
  { plat: 'NuInvest', tipo: 'CDB', emissor: 'Banco médio E', idx: 'CDI', taxa: 109, prazo: 1080, min: 1000, liq: false },
  // ---------- Genial ----------
  { plat: 'Genial', tipo: 'LCA', emissor: 'Banco médio E', idx: 'CDI', taxa: 92, prazo: 730, min: 1000, liq: false },
  { plat: 'Genial', tipo: 'CDB', emissor: 'Banco médio F', idx: 'CDI', taxa: 113, prazo: 1080, min: 1000, liq: false },
  { plat: 'Genial', tipo: 'CDB', emissor: 'Banco médio B', idx: 'IPCA', taxa: 8.0, prazo: 1800, min: 1000, liq: false },
  // ---------- Itaú ----------
  { plat: 'Itaú', tipo: 'CDB', emissor: 'Itaú', idx: 'CDI', taxa: 100, prazo: 1080, min: 1, liq: true },
  { plat: 'Itaú', tipo: 'LCA', emissor: 'Itaú', idx: 'CDI', taxa: 85, prazo: 365, min: 1000, liq: false },
  { plat: 'Itaú', tipo: 'LCI', emissor: 'Itaú', idx: 'CDI', taxa: 84, prazo: 365, min: 1000, liq: false },
  // ---------- Tesouro Direto (mesma taxa em todas as plataformas) ----------
  { plat: 'Tesouro Direto', tipo: 'Tesouro Selic', emissor: 'Tesouro Nacional', idx: 'CDI', taxa: 100.5, prazo: 1590, min: 150, liq: true },
  { plat: 'Tesouro Direto', tipo: 'Tesouro Pré', emissor: 'Tesouro Nacional', idx: 'Pré', taxa: 13.6, prazo: 1160, min: 35, liq: false },
  { plat: 'Tesouro Direto', tipo: 'Tesouro Pré', emissor: 'Tesouro Nacional', idx: 'Pré', taxa: 13.4, prazo: 2620, min: 35, liq: false },
  { plat: 'Tesouro Direto', tipo: 'Tesouro IPCA+', emissor: 'Tesouro Nacional', idx: 'IPCA', taxa: 7.6, prazo: 2190, min: 35, liq: false },
  { plat: 'Tesouro Direto', tipo: 'Tesouro IPCA+', emissor: 'Tesouro Nacional', idx: 'IPCA', taxa: 7.3, prazo: 3290, min: 35, liq: false },
];
