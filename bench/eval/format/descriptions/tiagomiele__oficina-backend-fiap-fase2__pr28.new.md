feat(os): endpoints da Fase 2: OS Recebida, relatório, cancelar, status

Implementa os 4 ajustes pedidos no documento da Fase 2 usando só os 8 status existentes, com as regras no domínio (`OrdemServico`), a orquestração no service e os endpoints nos controllers de perfil.

- `POST /ordens-servico/recebida` (Perfil 02) cria a OS só com dados básicos, em `RECEBIDA`, como na Fase 1; o `POST /ordens-servico` unificado não muda
- `GET /relatorios/os-por-status` passa do Perfil 03 para o 02 e substitui `GET /ordens-servico/ativas`, que foi removido: mesma ordem de grupos (`EM_EXECUCAO > AGUARDANDO_APROVACAO > EM_DIAGNOSTICO > RECEBIDA`), agora com `criadoEm` crescente dentro de cada grupo
- `POST /ordens-servico/{numeroOs}/cancelar-diagnostico` (Perfil 03) só vale em `EM_DIAGNOSTICO`: cancela todos os orçamentos, devolve as peças ao estoque e move a OS para `CANCELADA`
- `PATCH /ordens-servico/{numeroOs}/status` (Perfil 02, contingência) valida o destino: `RECEBIDA` só sem orçamento, `EM_EXECUCAO` só com serviço ou peça, `AGUARDANDO_PAGAMENTO` e `ENTREGUE` só com o último orçamento encerrado, `CANCELADA` só com todos cancelados, e `PAGA` é rejeitado; regra violada retorna 409
- Os novos métodos também notificam o cliente, como as transições do #26

A remoção de `/ordens-servico/ativas` quebra quem ainda chama essa rota.

Testado: `./mvnw verify` local, com 119 testes, ArchUnit e o gate do JaCoCo verdes, incluindo os novos testes em `OrdemServicoTest` e `EndpointsAdminTecnicoFase2IntegrationTest`.
