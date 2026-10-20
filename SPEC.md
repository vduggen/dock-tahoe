# Dock Tahoe para Linux Mint Cinnamon
**Especificação técnica de design e comportamento — v0.1**

**Referência:** macOS Tahoe 26  
**Plataforma:** Linux Mint / Cinnamon  
**Objetivo:** alta fidelidade visual e funcional

## 1. Estrutura e composição

O Dock deve ser um componente flutuante, centralizado horizontalmente, com largura adaptável à quantidade de itens.

**Grupos:**

1. Aplicativos fixados e aplicativos em execução
2. Aplicativos recentes não fixados (até 3)
3. Janelas minimizadas, quando exibidas separadamente
4. Arquivos e pastas
5. Lixeira

Separadores visuais delimitam os grupos aplicáveis. Sua presença depende do conteúdo e das configurações.

O Dock pode ser posicionado nas bordas inferior, esquerda ou direita.

### Regras de layout

- Centralização dinâmica.
- Ícones alinhados pela base quando houver ampliação.
- Indicadores associados ao centro visual de cada ícone.
- Separadores dimensionados proporcionalmente.
- Largura recalculada ao adicionar/remover itens.
- Redução automática dos ícones quando o conteúdo não couber na tela.
- Suporte a diferentes fatores de escala.
- Nenhum ícone deve ultrapassar os limites da tela.

## 2. Dimensões e espaçamentos

Os números abaixo são **valores experimentais de inicialização**, derivados de recriações anteriores do Dock. Não são medidas oficiais confirmadas para o Tahoe.

| Token | Inicial | Regra |
|---|---:|---|
| `icon.baseSize` | 48 | Configurável |
| `icon.maxSize` | 72 | Configurável |
| `icon.gap` | 7 | Proporcional |
| `dock.paddingX` | 10 | Proporcional |
| `dock.paddingY` | 8 | Proporcional |
| `dock.bottomOffset` | 5 | Calibrar |
| `dock.cornerRadius` | 20 | Calibrar |
| `indicator.diameter` | 4 | Calibrar |
| `separator.width` | 1 | Calibrar |
| `separator.height` | 36 | Calibrar |
| `glass.blurRadius` | 20 | Aproximação inicial |

Unidades: pontos lógicos de interface, exceto quando uma propriedade exigir pixels físicos.

**Regra:** nenhuma dessas dimensões deve ser considerada definitiva antes de comparar capturas do Tahoe real.

O tamanho, o deslocamento, o raio dos cantos e o espaçamento devem ser armazenados como tokens independentes.

## 3. Aparência Liquid Glass

### Camadas de renderização

1. **Backdrop:** amostragem do conteúdo atrás do Dock.
2. **Translucidez:** composição de fundo com transparência variável.
3. **Refração:** distorção sutil do conteúdo nas regiões do vidro.
4. **Tint:** adaptação à luminosidade e às cores do ambiente.
5. **Contorno:** borda suave e dependente do contraste.
6. **Reflexos:** realces especulares discretos.
7. **Sombra:** separação visual entre o Dock e o desktop.

### Requisitos

- O fundo não deve ser representado apenas por uma cor sólida com opacidade.
- O material deve permanecer legível sobre papéis de parede claros e escuros.
- O efeito deve acompanhar mudanças no conteúdo atrás do Dock.
- A renderização não pode introduzir cintilação, manchas ou artefatos.
- Quando os efeitos avançados não forem suportados, utilizar uma aparência simplificada, mas consistente.

### Ícones

Suportar as aparências:

- Padrão/colorida
- Clara
- Escura
- Tonalizada
- Transparente (Clear)

Os ícones originais das aplicações Linux continuam sendo a fonte primária. Variantes personalizadas só devem ser usadas quando disponíveis e autorizadas.

Não aplicar uma máscara arredondada indiscriminadamente a todos os ícones: a composição visual de cada ícone precisa ser respeitada.

## 4. Modelo de estados

Os estados de aplicativos devem ser **independentes e combináveis**, não um único enum.

### Estado dos aplicativos

| Estado | Comportamento visual |
|---|---|
| `pinned` | Permanece no Dock |
| `running` | Mostra indicador de execução |
| `focused` | Aplicativo em primeiro plano |
| `launching` | Animação de abertura |
| `minimized` | Janela minimizada |
| `attention` | Solicitação de atenção |
| `badged` | Indicador de notificação |
| `dragging` | Item sendo reposicionado |
| `dropTarget` | Alvo de arrastar arquivo |
| `contextMenuOpen` | Menu contextual aberto |

Um aplicativo pode estar simultaneamente fixado, em execução, minimizado e com uma notificação.

`focused` não deve ser confundido com `running`: o indicador de execução não é, por si só, um indicador de foco.

### Estado global do Dock

- Visível / oculto
- Entrando / saindo
- Hover ativo / inativo
- Ampliação ativada / desativada
- Horizontal / vertical
- Menu ou pasta expandida
- Monitor ativo
- Aplicação em fullscreen
- Modo claro / escuro
- Preferência de redução de movimento

## 5. Ampliação (Magnification)

A ampliação deve responder continuamente à posição do cursor.

### Requisitos

1. O ícone diretamente sob o cursor recebe a maior ampliação.
2. Os ícones vizinhos também são afetados, conforme a distância.
3. A influência diminui suavemente com o afastamento.
4. Os elementos se deslocam para preservar espaçamento e evitar sobreposição.
5. A base visual dos ícones permanece alinhada.
6. O layout retorna suavemente ao repouso ao sair do Dock.
7. Movimentar rapidamente o cursor não deve produzir saltos ou oscilações excessivas.

### Modelo matemático inicial

Pode-se testar uma função gaussiana:

`size(i) = baseSize + (maxSize - baseSize) × exp(-0.5 × (distance(i) / sigma)²)`

Onde:

- `distance(i)` é a distância do cursor ao centro do ícone no eixo principal.
- `sigma` controla o alcance sobre os ícones vizinhos.
- `baseSize` e `maxSize` vêm das configurações.

**Importante:** a gaussiana é uma hipótese de implementação. A curva original do macOS não foi confirmada. É necessário comparar o resultado com gravações do Tahoe.

Os deslocamentos devem ser calculados com as larguras renderizadas, evitando sobreposição.

## 6. Animações

| Evento | Efeito | Parâmetro inicial |
|---|---|---|
| Entrada do cursor | Ampliação progressiva | 160–240 ms |
| Saída do cursor | Retorno ao tamanho normal | 160–240 ms |
| Inicialização de aplicativo | Bounce | Medir no Tahoe |
| Pedido de atenção | Bounce de alerta | Medir no Tahoe |
| Adicionar aplicativo | Reorganização animada | 180–260 ms |
| Remover aplicativo | Retirada e reorganização | 180–260 ms |
| Ocultar Dock | Deslocamento para a borda | 220–300 ms |
| Exibir Dock | Deslocamento para fora da borda | 220–300 ms |
| Minimizar janela | Efeito selecionado | Medir no Tahoe |
| Tooltip | Fade e posicionamento | Medir no Tahoe |

As durações propostas são pontos de partida internos, não valores oficiais.

Usar animações interrompíveis: uma nova interação deve poder alterar o destino sem reiniciar a transição bruscamente.

As animações devem acompanhar a taxa de atualização do monitor.

## 7. Interações

### Aplicativos

| Ação | Resultado |
|---|---|
| Clique em app fechado | Inicia o aplicativo |
| Clique em app aberto | Ativa o aplicativo |
| App com várias janelas | Ativa a janela apropriada, preservando o comportamento esperado do Dock |
| Clique direito | Abre menu contextual |
| Arrastar para o Dock | Adiciona/fixa o aplicativo |
| Arrastar dentro do Dock | Reorganiza |
| Arrastar para fora | Remove o atalho quando permitido |
| Arrastar arquivo sobre app | Encaminha o arquivo ao aplicativo, quando suportado |

O clique em um aplicativo já ativo não deve minimizá-lo automaticamente como comportamento padrão.

### Janelas

- Identificar todas as janelas relacionadas ao aplicativo.
- Diferenciar aplicação em execução e existência de janela.
- Suportar janelas minimizadas dentro do ícone ou em área separada.
- Restaurar uma janela minimizada ao selecioná-la.
- Respeitar workspaces e monitores.
- Ignorar janelas que não devem aparecer em listas de tarefas.

### Pastas e Lixeira

- Abrir e fechar pilhas.
- Suportar visualizações em leque, grade e lista.
- Oferecer menus contextuais aplicáveis.
- Atualizar conteúdo quando os arquivos mudarem.
- Proteger operações destrutivas, especialmente esvaziar a lixeira.

### Teclado e acessibilidade

- Navegação entre ícones pelo teclado.
- Ativação sem mouse.
- Nomes acessíveis para os itens.
- Indicação de foco de teclado.
- Alvos clicáveis suficientes mesmo quando a ampliação estiver desligada.
- Opção de reduzir animações.

## 8. Arquitetura no Cinnamon

### Módulos propostos

| Módulo | Responsabilidade |
|---|---|
| `DockController` | Ciclo de vida e coordenação |
| `ApplicationTracker` | Aplicativos instalados, abertos e fixados |
| `WindowTracker` | Janelas, foco, minimização e workspace |
| `DockLayout` | Geometria, distribuição e separadores |
| `MagnificationEngine` | Cálculo da influência do cursor |
| `AnimationEngine` | Transições e bounce |
| `GlassRenderer` | Material, blur e demais efeitos |
| `DragDropController` | Reordenação e abertura de arquivos |
| `MonitorController` | Resolução, escala e múltiplos monitores |
| `DockSettings` | Configurações persistentes |

### Diretrizes de integração

- Usar os recursos nativos de Cinnamon, St, Clutter e do gerenciador Muffin quando disponíveis.
- Reaproveitar conceitos do `grouped-window-list` para identificar e agrupar janelas.
- Não consultar processos continuamente para descobrir o estado dos aplicativos; preferir os sinais do sistema.
- Isolar o motor de geometria e ampliação para permitir testes sem Cinnamon.
- Desconectar sinais e liberar atores quando a extensão for desativada.
- Evitar bloquear o loop principal com processamento de imagem.
- Validar separadamente as capacidades nas sessões X11 e Wayland.

A extensão não deve interferir na estabilidade do painel, do compositor ou do gerenciador de janelas.

## 9. Configurações

### Aparência

- Tamanho base
- Ampliação máxima
- Ativar ampliação
- Posição do Dock
- Ocultação automática
- Aparência dos ícones
- Indicadores de aplicativos abertos

### Comportamento

- Mostrar aplicativos recentes
- Mostrar janelas minimizadas no próprio ícone
- Animar abertura
- Seleção de animação de minimização, quando suportada
- Comportamento em múltiplos monitores

### Desenvolvimento

Criar também um modo de calibração contendo controles para espaçamentos, sombras, blur, alcance de ampliação, duração e curvas de animação.

Esse modo não precisa ser exposto ao usuário final.

## 10. Validação de fidelidade

### Capturas de referência

Coletar imagens e vídeos do macOS Tahoe 26 real, registrando:

- Versão exata do macOS
- Resolução do monitor
- Fator de escala
- Tamanho configurado do Dock
- Nível de ampliação
- Aparência clara/escura
- Papel de parede
- Posição do Dock
- Estado de execução dos aplicativos

### Cenários obrigatórios

1. Dock em repouso.
2. Cursor sobre o ícone central.
3. Cursor entre dois ícones.
4. Cursor sobre o primeiro e último ícones.
5. Entrada e saída rápida do cursor.
6. Abertura e encerramento de aplicativo.
7. Aplicativo aberto, mas sem foco.
8. Aplicativo minimizado.
9. Solicitação de atenção.
10. Badge de notificação.
11. Reorganização de itens.
12. Adição e remoção de aplicativo.
13. Menu contextual.
14. Abertura de pasta.
15. Ocultação automática.
16. Troca de monitor, resolução e escala.
17. Aplicativo em fullscreen.
18. Tema claro, escuro e aparências alternativas de ícones.

### Critérios internos de aceite

São metas de engenharia propostas, não tolerâncias oficiais da Apple.

| Área | Critério |
|---|---|
| Geometria | Desvio máximo de 2 unidades lógicas no cenário calibrado |
| Animação | Diferença temporal alvo de até 2 frames, usando vídeos com mesma taxa |
| Fluidez | Manter pelo menos 55 FPS em monitor de 60 Hz durante hover contínuo |
| Integridade | Nenhuma sobreposição ou ícone fora da tela |
| Funcionalidade | 100% dos cenários obrigatórios aplicáveis aprovados |
| Estabilidade | Nenhum erro não tratado ao habilitar/desabilitar repetidamente |
| Memória | Sem crescimento contínuo ao repetir animações e abrir/fechar menus |
| Aparência | Revisão visual em fundos claros, escuros e detalhados |

Utilizar sobreposição de capturas, diferença de pixels e comparação quadro a quadro. Para Liquid Glass, a comparação também deve ser visual, pois o resultado depende dinamicamente do conteúdo de fundo.

## 11. Priorização

**P0 — Base funcional**

- Container e geometria
- Aplicativos fixados
- Rastreamento de aplicativos e janelas
- Indicadores
- Cliques e menus
- Layout responsivo

**P1 — Fidelidade das interações**

- Ampliação
- Animações
- Drag-and-drop
- Ocultação automática
- Minimização
- Pastas e separadores

**P2 — Fidelidade óptica e acabamento**

- Liquid Glass avançado
- Variantes de ícones
- Ajustes finos de curvas e tempos
- Múltiplos monitores e escalas especiais
- Acessibilidade completa
- Testes visuais automatizados

## 12. Pendências para fechar a versão 1.0

- Medidas reais do Tahoe 26 para cada tamanho do Dock.
- Curva de ampliação e alcance sobre os vizinhos.
- Perfil de bounce, minimização e auto-ocultação.
- Opacidade, blur, refração e sombras medidos.
- Versão exata do Cinnamon e tipo de sessão alvo.
- Comportamentos que diferem entre Cinnamon/X11 e Cinnamon/Wayland.

## Fontes

- [Apple Design Resources](https://developer.apple.com/design/resources/)
- [Apple — macOS Tahoe 26](https://www.apple.com/br/newsroom/2025/06/macos-tahoe-26-makes-the-mac-more-capable-productive-and-intelligent-than-ever/)
- [Apple — Liquid Glass](https://www.apple.com/br/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/)
- [Apple — Dock no macOS 26](https://support.apple.com/en-gb/guide/mac-help/mh35859/26/mac/26)
- [Apple — Ajustes do Dock](https://support.apple.com/pt-br/guide/mac-help/mchlp1119/26/mac/26)
- [Apple — Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)
- [Cinnamon — Código-fonte](https://github.com/linuxmint/cinnamon)
