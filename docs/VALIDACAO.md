# Validação do Dock Tahoe

Roteiro da etapa 7 (`PLAN.md`): os 18 cenários obrigatórios e os critérios
internos de aceite da `SPEC.md` §10. Cada rodada copia as tabelas de
resultado abaixo, preenche o ambiente e marca cada linha.

Status: **✅ aprovado**, **❌ reprovado** (anotar o desvio), **— não se
aplica** (justificar) ou **⏳ pendente**.

## Ambiente da rodada

Os mesmos campos das capturas de referência do Tahoe (§10), para que uma
captura do Cinnamon e uma do Tahoe só sejam comparadas quando baterem.

| Campo | Valor |
|---|---|
| Data | |
| Commit (`git rev-parse --short HEAD`) | |
| Cinnamon (`cinnamon --version`) e sessão (X11/Wayland) | |
| Monitores: resolução, escala, taxa de atualização | |
| Posição do Dock | |
| Tamanho dos ícones / ampliação máxima | |
| Ampliação ligada | |
| Aparência dos ícones | |
| Desfoque do vidro (`glass-blur`) | |
| Tema do Cinnamon (claro/escuro) | |
| Papel de parede (claro, escuro ou detalhado) | |
| Apps em execução | |
| Referência do Tahoe usada (macOS, captura) | |

## Preparação

1. `./scripts/check.sh` passa.
2. A extensão está ativa e o protótipo `macos-dock@unimestre.local`, não.
3. Para capturas: `gnome-screenshot -f <arquivo>` (tela inteira) ou
   `import -window root` (ImageMagick). Vídeos com a mesma taxa da referência,
   para comparar quadro a quadro.
4. Para ajustar tokens e tempos durante a comparação:
   `./scripts/calibration.sh on` e a seção "Calibração (desenvolvimento)"
   nas configurações da extensão. Ao terminar, `off`.
5. Erros: `~/.xsession-errors` (ou `journalctl --user -b`) e o Looking Glass
   (`Alt+F2`, `lg`) antes e depois de cada cenário.

## Cenários obrigatórios

"Testes" aponta o que `scripts/check.sh` já garante na geometria; o resto é
conferido na tela.

### 1. Dock em repouso

- **Passos:** cursor longe do Dock; capturar.
- **Esperado:** ícones no tamanho base, alinhados pela base; espaçamento
  uniforme (`icon.gap` = margens); cantos concêntricos; Dock centrado no
  monitor, a `dock.bottomOffset` da borda; separadores entre fixados,
  recentes e a seção da lixeira.
- **Testes:** `testScenarios` 1; `testLayout` "rest dock is centered…",
  "spacing is uniform…", "corner radii are concentric".

### 2. Cursor sobre o ícone central

- **Passos:** parar o cursor no centro do ícone do meio; capturar após 300 ms.
- **Esperado:** esse ícone no tamanho máximo, vizinhos menores e simétricos;
  bases alinhadas; Dock cresce igualmente para os dois lados.
- **Testes:** `testScenarios` 2.

### 3. Cursor entre dois ícones

- **Passos:** cursor no ponto médio entre dois ícones vizinhos.
- **Esperado:** os dois do mesmo tamanho, menores que o máximo e maiores que
  os vizinhos seguintes.
- **Testes:** `testScenarios` 3.

### 4. Cursor sobre o primeiro e o último ícones

- **Passos:** cursor no centro do primeiro ícone; depois do último.
- **Esperado:** ícone da ponta no máximo e sob o cursor; nada sai da tela
  nem se sobrepõe.
- **Testes:** `testScenarios` 4 e "edge-clamped dock stays on screen".

### 5. Entrada e saída rápida do cursor

- **Passos:** varrer o Dock de ponta a ponta em menos de 0,5 s; entrar e sair
  pela borda várias vezes seguidas.
- **Esperado:** sem saltos nem vai-e-vem das pontas; a ampliação entra e sai
  em ~200 ms (`hoverMs`) e muda de destino sem reiniciar; ≥ 55 FPS.
- **Testes:** `testScenarios` "pointer sweep…" (sem saltos, sem balanço);
  `testAnimation` "approach can be redirected…".

### 6. Abertura e encerramento de aplicativo

- **Passos:** clicar num app fixado fechado; esperar a janela; fechar pelo
  menu "Fechar".
- **Esperado:** o ícone quica até a primeira janela aparecer (no máximo
  10 s), terminando o quique no ar; o indicador aparece; ao fechar, o
  indicador some. Um app não fixado entra animado depois dos fixados e, ao
  fechar, vai para os recentes (se `show-recent-apps`).

### 7. Aplicativo aberto, mas sem foco

- **Passos:** abrir dois apps; focar um.
- **Esperado:** os dois com o ponto de execução; só o focado com o ponto azul
  (§4: execução não é foco). Clicar no não focado ativa a janela usada mais
  recentemente neste monitor. Clicar no focado minimiza as janelas dele
  (desvio aprovado da §7).

### 8. Aplicativo minimizado

- **Passos:** minimizar uma janela com `minimize-into-icon` ligado; repetir
  desligado.
- **Esperado:** ligado, a janela vai para o ícone do app e o clique a
  restaura. Desligado, ela ganha uma miniatura própria antes da lixeira, com
  o ícone do app no canto, e some dali ao ser restaurada.

### 9. Solicitação de atenção

- **Passos:** fazer um app sem foco pedir atenção: um chat recebendo
  mensagem, ou um terminal com a campainha marcando urgência rodando
  `sleep 3; printf '\a'` enquanto outra janela está focada.
- **Esperado:** o ícone quica 3 vezes (`attentionBounces`) a cada pedido, sem
  reiniciar um quique já no ar.

### 10. Badge de notificação

- **Passos:** app com `com.canonical.Unity.LauncherEntry` (ex.: Telegram,
  Thunderbird) recebendo mensagens.
- **Esperado:** pílula vermelha no canto superior direito, redonda com um
  dígito e mais larga com mais; contagens longas abreviadas; o nome
  acessível inclui a contagem.
- **Testes:** `testBadges`.

### 11. Reorganização de itens

- **Passos:** arrastar um app fixado para outra posição; soltar fora de
  qualquer alvo para cancelar.
- **Esperado:** os vizinhos abrem espaço só quando o cursor passa do centro
  deles; ao soltar, a ordem é salva; ao cancelar, a cópia volta ao lugar.
- **Testes:** `testLayout` "a dragged icon moves only past a neighbour's
  center"; `testGrouping` "a reorder keeps saved ids…".

### 12. Adição e remoção de aplicativo

- **Passos:** arrastar um app do menu do Cinnamon para o Dock; "Remover do
  Dock" pelo menu; arrastar um recente para depois dos fixados.
- **Esperado:** entrada e saída animadas em ~220 ms (`reorderMs`), sem
  saltos dos vizinhos; a lista salva em `pinned-apps` acompanha.

### 13. Menu contextual

- **Passos:** clique direito num app aberto, num fechado, numa pasta e na
  lixeira; `Shift+F10` com o foco de teclado num ícone.
- **Esperado:** balão com seta apontando o ícone; janelas do app listadas;
  "Nova janela"/"Abrir", "Manter no Dock"/"Remover do Dock", "Fechar"; na
  lixeira, "Esvaziar Lixeira" só habilitado quando cheia e pedindo
  confirmação; o tooltip some enquanto o menu está aberto.

### 14. Abertura de pasta

- **Passos:** clicar em Downloads e numa pasta adicionada; trocar a
  visualização (leque, grade, lista) e a ordem pelo menu; criar um arquivo
  na pasta com a pilha fechada.
- **Esperado:** leque com até 12 itens só com o Dock embaixo, nítido; grade
  e lista com rolagem quando não cabem, sem cortar nomes; abre e fecha
  animado; Esc, clique fora ou no ícone fecham; setas e Tab navegam; o
  arquivo novo aparece na próxima abertura.
- **Testes:** `testStacks`.

### 15. Ocultação automática

- **Passos:** ligar `autohide`; tirar o cursor do Dock; encostar na borda.
- **Esperado:** some 300 ms depois de o cursor sair (`hideDelayMs`),
  deslizando para a borda em ~260 ms (`revealMs`); volta ao encostar na
  borda; não reserva espaço (janelas maximizadas vão até a borda).

### 16. Troca de monitor, resolução e escala

- **Passos:** conectar/desconectar um monitor; mudar a resolução; mudar a
  escala (100% ↔ 200%).
- **Esperado:** um Dock por monitor, refeito a cada mudança, sem Docks
  órfãos; geometria em pixels físicos proporcional à escala; acima de um
  painel do Cinnamon na mesma borda.
- **Testes:** `testLayout` "scale factor doubles the geometry", "edge inset
  lifts the dock above a panel", "too many icons shrink to fit the monitor".

### 17. Aplicativo em fullscreen

- **Passos:** pôr um vídeo ou o navegador em tela cheia (F11) no monitor do
  Dock; depois em outro monitor.
- **Esperado:** o Dock some só no monitor em fullscreen e volta ao sair;
  nenhum espaço reservado fica sobrando.

### 18. Tema claro, escuro e aparências alternativas de ícones

- **Passos:** papel de parede claro, escuro e detalhado; com e sem
  `glass-blur`; cada valor de "Aparência dos ícones" (padrão, clara, escura,
  tonalizada com duas cores, transparente).
- **Esperado:** o vidro nunca é só uma cor chapada; ícones e indicadores
  legíveis em todos os fundos; com `glass-blur`, o desfoque some quando uma
  janela encosta no Dock e volta depois; nenhuma cintilação ou mancha; os
  ícones mantêm o próprio formato (sem máscara imposta).

### Resultado dos cenários

| # | Cenário | Status | Captura/vídeo | Observações |
|---|---|---|---|---|
| 1 | Dock em repouso | ⏳ | | |
| 2 | Cursor sobre o ícone central | ⏳ | | |
| 3 | Cursor entre dois ícones | ⏳ | | |
| 4 | Primeiro e último ícones | ⏳ | | |
| 5 | Entrada e saída rápida | ⏳ | | |
| 6 | Abertura e encerramento de app | ⏳ | | |
| 7 | App aberto sem foco | ⏳ | | |
| 8 | App minimizado | ⏳ | | |
| 9 | Solicitação de atenção | ⏳ | | |
| 10 | Badge de notificação | ⏳ | | |
| 11 | Reorganização | ⏳ | | |
| 12 | Adição e remoção | ⏳ | | |
| 13 | Menu contextual | ⏳ | | |
| 14 | Abertura de pasta | ⏳ | | |
| 15 | Ocultação automática | ⏳ | | |
| 16 | Monitor, resolução e escala | ⏳ | | |
| 17 | Fullscreen | ⏳ | | |
| 18 | Temas e aparências de ícones | ⏳ | | |

## Planilha de critérios

Metas internas da §10, não tolerâncias da Apple. "Como medir" descreve o
procedimento; "Resultado" guarda o número da rodada.

| Área | Critério | Como medir | Resultado | Status |
|---|---|---|---|---|
| Geometria | Desvio ≤ 2 unidades lógicas no cenário calibrado | Sobrepor captura do Cinnamon e do Tahoe com o mesmo ambiente (cenários 1–4); medir bordas do Dock, centros e tamanhos dos ícones, indicador | | ⏳ sem referência do Tahoe |
| Animação | Diferença ≤ 2 quadros | Gravar Cinnamon e Tahoe à mesma taxa; comparar quadro a quadro ampliação, quique, reordenação, ocultação (cenários 5, 6, 9, 12, 15) | | ⏳ sem referência do Tahoe |
| Fluidez | ≥ 55 FPS a 60 Hz em hover contínuo | Contar quadros do stage (`after-paint`) durante 3 s de varredura do cursor, com e sem `glass-blur` | | ⏳ |
| Integridade | Nenhuma sobreposição ou ícone fora da tela | `scripts/check.sh` (`checkIntegrity` em todas as posições, ampliado, varrendo e com 34 ícones) e cenários 1–4, 16 na tela | | ⏳ |
| Funcionalidade | 100% dos cenários aplicáveis aprovados | Tabela "Resultado dos cenários" | | ⏳ |
| Estabilidade | Nenhum erro ao habilitar/desabilitar repetidamente | Habilitar e desabilitar 20 vezes; conferir `~/.xsession-errors` e o Looking Glass | | ⏳ |
| Memória | Sem crescimento contínuo | Anotar a memória do processo `cinnamon` (`ps -o rss`), repetir 100 hovers, 50 menus e 50 pilhas, forçar GC no Looking Glass (`global.gc()`) e anotar de novo; repetir o ciclo 3 vezes | | ⏳ |
| Aparência | Revisão visual em fundos claros, escuros e detalhados | Cenário 18 | | ⏳ |
