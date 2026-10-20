# Plano de implementação — Dock Tahoe para Cinnamon

Plano de lacunas entre a [`SPEC.md`](SPEC.md) (v0.1) e o protótipo existente
em `../dock-macos-cinnamon` (v0.2.1). O protótipo não será alterado: este
projeto começa do zero e reaproveita trechos dele quando servirem.

## Ambiente alvo

| Item | Valor |
|---|---|
| Cinnamon | 6.6.9 |
| Sessão | X11 (Wayland fica para validação posterior, §8 da spec) |
| Runtime | GJS + St/Clutter/Muffin, sem dependências externas |

Capacidades confirmadas nesta máquina:

- `St.BackgroundBlurEffect` está exposto no `St-1.0.typelib`
  (`/usr/lib/x86_64-linux-gnu/cinnamon/`). É o candidato para a camada
  **Backdrop** do vidro (§3). O `background-blur` usado no `stylesheet.css` do
  protótipo não aparece como propriedade CSS no `libst.so`; provavelmente é
  ignorado e precisa ser verificado.
- `cjs` 115.1 (o GJS do Cinnamon) está em `/usr/bin/cjs`: roda os testes dos
  módulos puros sem precisar do Cinnamon.
- `Clutter.ShaderEffect` (`set_shader_source`) existe na Clutter do Muffin.
  É o caminho candidato para refração, tint e reflexos via GLSL.
- `actor.ease({...})` é usado pelo próprio Cinnamon (`ui/osdWindow.js` etc.):
  animações interrompíveis sem `Tweener`.
- `grouped-window-list@cinnamon.org` está em
  `/usr/share/cinnamon/applets/` como referência de agrupamento de janelas e
  de `settings-schema.json`.

## O que o protótipo já resolve

| Área da spec | Protótipo (`../dock-macos-cinnamon/extension.js`) | Reaproveitar? |
|---|---|---|
| Container por monitor | `DockView` com cápsula St + reserva de strut via `addChrome`/`trackChrome` | Sim, a ideia de reserva separada da cápsula |
| Rastreamento | Sinais de `global.display`, `WindowTracker`, `switch-workspace`, `monitors-changed` | Sim, a lista de sinais |
| Agrupamento | `_findPinned` por `WM_CLASS` antes do `desktopId` (separa web apps do Chrome) | Sim |
| Indicadores | `running` e `focused` já são distintos | Sim, o conceito |
| Clique | Abre ou ativa; não minimiza app ativo | Sim |
| Ciclo de vida | `disable()` desconecta sinais e destrói atores | Sim |

## Lacunas

| Spec | Lacuna no protótipo |
|---|---|
| §2 Tokens | Medidas espalhadas entre `config.js` e `stylesheet.css` |
| §4 Estados | Flags soltas (`runningHere`, `activeHere`); sem `minimized`, `attention`, `launching` etc. |
| §5 Ampliação | Degraus fixos por índice (`HOVER_SCALES`), com `scale_x/y`: não desloca vizinhos nem segue o cursor continuamente |
| §1 Layout | Sem encolhimento automático, sem posições esquerda/direita, sem garantia de "nenhum ícone fora da tela" |
| §1 Grupos | Só fixados e em execução; sem recentes, minimizadas, pastas ou lixeira |
| §6 Animações | Sem bounce, auto-ocultação, entrada/saída de itens; reconstrói todos os atores quando a lista muda |
| §7 Interações | Sem menu contextual, drag-and-drop, teclado ou arrastar arquivo sobre o app |
| §9 Configurações | Lançadores fixos no código; sem `settings-schema.json` |
| §8 Testes | Geometria acoplada ao St, sem testes fora do Cinnamon |

## Arquitetura do novo projeto

```
dock-tahoe-cinnamon/
├── metadata.json
├── settings-schema.json        # DockSettings (§9)
├── stylesheet.css              # só aparência; medidas vêm dos tokens
├── extension.js                # init/enable/disable → DockController
├── lib/
│   ├── tokens.js               # §2, valores iniciais e escala
│   ├── layout.js               # DockLayout: puro, sem imports de GI
│   ├── magnification.js        # MagnificationEngine: puro
│   ├── state.js                # flags combináveis de app e de dock (§4)
│   ├── appTracker.js           # ApplicationTracker + WindowTracker
│   ├── dockView.js             # atores St, aplica a geometria calculada
│   ├── animation.js            # AnimationEngine sobre actor.ease
│   ├── glass.js                # GlassRenderer com fallback (§3)
│   ├── dnd.js                  # DragDropController
│   └── monitors.js             # MonitorController
├── tests/                      # executados com `cjs -m`, sem Cinnamon
└── scripts/                    # check, install, version
```

Regra central: `layout.js` e `magnification.js` recebem números e devolvem
retângulos. A view só aplica o resultado. Assim, as regras de integridade (sem
sobreposição, sem ícone fora da tela) são testadas sem Cinnamon.

## Etapas

Cada etapa termina com a extensão habilitável e com `scripts/check.sh` passando.

### Etapa 0 — Fundação ✅

- `metadata.json`, `extension.js` mínimo, `scripts/check.sh` e `install.sh`
  com outro UUID (`tahoe-dock@unimestre.local`), para conviver com o protótipo.
- `lib/tokens.js` com os tokens da §2 e um fator de escala do monitor.
- Teste: habilitar e desabilitar 20 vezes sem erro no `~/.xsession-errors`.

### Etapa 1 — P0: geometria pura ✅

- `layout.js`: largura total, centralização, separadores, posições
  inferior/esquerda/direita, encolhimento para caber na área do monitor.
- `magnification.js`: gaussiana da §5 sobre a distância contínua do cursor;
  devolve o tamanho de cada item e o deslocamento acumulado, com a base
  alinhada.
- `tests/`: invariantes (sem sobreposição, dentro do monitor, base alinhada,
  simetria no centro, primeiro e último ícone), mais os cenários 1–4 da §10.

### Etapa 2 — P0: dados e estados ✅

- `state.js`: bitflags de app (`pinned`, `running`, `focused`, `minimized`,
  `attention`, `launching`…) e o estado global do dock.
- `appTracker.js`: portar os sinais e o casamento por `WM_CLASS` do protótipo;
  acrescentar `minimized`, `demands-attention`/`urgent` e o filtro
  `skip_taskbar`. Sem polling.
- Fixados lidos de `settings-schema.json` (lista de `desktopId`).

### Etapa 3 — P0: view e interações básicas ✅

- `dockView.js`: um ator por item, **atualizado por chave** em vez de
  reconstruir tudo; indicadores no centro visual do ícone.
- Clique abre o app ou traz a janela usada por último, preferindo o monitor
  do dock, conforme a §7. Em vez de ciclar janelas, o menu lista todas.
  Desvio pedido em relação à §7: clicar no app em foco minimiza as janelas
  dele naquele monitor.
- Menu contextual com `PopupMenu`: janelas, Abrir/Nova janela, Manter
  no/Remover do Dock (persistido em `pinned-apps`), Fechar. Tooltip com o
  nome no hover e no foco do teclado.
- Teclado: `Super+Alt+D` (configurável) foca o dock do monitor atual sob grab
  modal; setas, `Home`/`End`, `Enter`, `Menu`/`Shift+F10` e `Esc`.
- Posição configurável: inferior, esquerda ou direita.
- Reserva de strut; o dock flutua acima dos painéis fixos da mesma borda e
  some apenas no monitor em tela cheia.

### Etapa 4 — P1: movimento ✅

- `lib/animation.js` (puro, testado): aproximação exponencial independente
  da taxa de quadros, curva do bounce e easing; durações iniciais da §6 em
  `TIMING`.
- Um `Clutter.Timeline` por dock, ligado só enquanto algo se move. Eventos
  de ponteiro no dock o acordam; cada quadro lê o ponteiro, suaviza a
  ampliação (200 ms) e o ponteiro (40 ms) e reaplica o layout. A região de
  entrada cresce para cobrir os ícones ampliados; um menu aberto congela a
  ampliação.
- Bounce: na abertura, até a primeira janela (termina o pulo em andamento,
  limite de 10 s); no pedido de atenção, 3 pulos.
- Entrada e saída de itens: quem fica desliza da posição antiga, quem entra
  cresce no lugar e quem sai encolhe antes de ser destruído (220 ms).
- Auto-ocultação (`autohide`): sem strut, o dock desliza para fora da borda
  e volta quando o ponteiro toca uma faixa de 2 px ao longo dele; some
  300 ms depois que ponteiro, menu ou modo teclado saem.
- Configurações da §9: tamanho dos ícones, ampliação ligada/desligada e
  tamanho máximo. Os espaçamentos escalam com o tamanho do ícone.
- Reduzir animações: segue `Main.animations_enabled` (efeitos do Cinnamon);
  sem ele tudo salta direto para o destino e não há bounce.

### Etapa 5 — P1: conteúdo e drag-and-drop

- ✅ Lixeira (`Gio.FileMonitor`), com confirmação ao esvaziar.
- ✅ Recentes: até 3 apps não fixados fechados há pouco, depois dos abertos
  e com linha própria; persistidos em `recent-apps`, desligáveis em
  `show-recent-apps`. Saem ao reabrir ou fixar.
- ✅ DnD: reordenar fixados; fixar ao soltar um app (aberto, recente, de
  outro dock ou do menu do Cinnamon) sobre os fixados; desafixar ou tirar
  dos Recentes ao soltar longe do dock ou depois do último fixado.
- Adiado: encaminhar arquivo ao app e fixar `.desktop` vindo do Nemo. O
  Cinnamon só repassa ao chrome o hover de arrastos XDND
  (`ui/xdndHandler.js`), sem os URIs nem o soltar; exigiria uma janela X
  auxiliar sobre o dock durante o arrasto.
- ✅ Minimizadas separadas: com `minimize-into-icon` desligado, cada janela
  minimizada vira uma miniatura viva (selo do app no canto) na seção da
  lixeira, em ordem de minimização; a animação mira a lixeira e o clique
  restaura.
- ✅ Pastas e pilhas: Downloads (`show-downloads`) e as pastas de
  `folders`, na seção da lixeira, vigiadas por `Gio.FileMonitor`. O clique
  abre a pilha em leque (até 12 itens, só com o dock embaixo), grade ou
  lista, com "Abrir em <gerenciador>" no fim; o menu de contexto escolhe a
  ordem e a visualização (`stack-options`). Esc, clique fora ou no próprio
  ícone fecham; setas e Tab navegam.

### Etapa 6 — P2: vidro e acabamento

- Prova de conceito antes de qualquer outra coisa nesta etapa:
  `St.BackgroundBlurEffect` na cápsula, medindo FPS durante hover contínuo
  (meta: ≥ 55 FPS em 60 Hz, §10).
  - ✅ Feita em 2026-10-20 (Cinnamon 6.6.9, X11, 60 Hz; base 59–60 FPS
    com hover varrendo o dock por 3 s):
    - `St.BackgroundBlurEffect` (CSS `background-blur: Npx`) **reprovado**:
      faz N leituras da tela pela CPU por quadro; 54 FPS com 2px, 40 com
      6px, 24 com 20px. Também fica preso no widget depois que o estilo
      sai.
    - `Clutter.ShaderEffect` (blur em uma passada) sobre um `Clutter.Clone`
      de `global.background_actor` **aprovado**: 54–57 FPS com raio 30 e
      59 com raio 10, desde que o ator tenha tamanho fixo (redimensionar a
      cada quadro recria a textura fora da tela e cai para ~36 FPS).
    - Limites: clonar `global.window_group` não pinta nada (sem volume de
      pintura), então o vidro borra só o papel de parede, não janelas
      atrás do dock. Faltam a máscara dos cantos e um kernel sem listras.
- ✅ Blur experimental (`glass-blur`, desligado por padrão,
  `lib/glassBlur.js`): clone do papel de parede numa faixa fixa do
  comprimento do monitor, blur gaussiano em duas passadas (2 × 17 amostras,
  alcance `glass.blurRadius`) e máscara dos cantos no shader; o vidro
  simples continua por cima como tint e contorno. Some quando uma janela da
  área de trabalho atual encosta no dock (checagem a cada 250 ms). Hover a
  56–60 FPS. O ator interno precisa recortar os filhos: sem isso o efeito
  desenha o fundo inteiro e cai para ~33 FPS.
- ✅ Material na última passada do mesmo shader (só com `glass-blur`):
  refração (o fundo se curva para dentro numa faixa de
  `glass.refraction` px junto à borda), tint por luminância (clareia fundo
  escuro, escurece fundo claro, satura um pouco), contorno que contrasta
  com o fundo e reflexo especular nas bordas voltadas para cima. Hover a
  59–60 FPS. Sem `glass-blur`, fica o vidro simples do CSS (§3,
  "aparência simplificada").
- ✅ Aparência dos ícones (`icon-appearance`, `lib/iconAppearance.js`):
  padrão, clara, escura, tonalizada (cor em `icon-tint`) e transparente,
  por um `Clutter.ShaderEffect` no ícone original, sem máscara. Escura
  escurece só as áreas claras e sem cor; tonalizada mapeia a luminância na
  cor escolhida. Hover a 60 FPS com todos os ícones na escura.
- ✅ Modo de calibração (§9, `lib/calibration.js`): a chave oculta
  `calibration` (`scripts/calibration.sh on|off`) revela a seção
  "Calibração (desenvolvimento)" nas configurações, com espaçamentos,
  indicador, separador, alcance da ampliação, sombra, blur, refração,
  durações e a curva de reordenar. O padrão de cada chave é o valor que ela
  substitui (testado contra `Tokens.DEFAULTS` e `Animation.TIMING`); com a
  chave desligada, nada muda. O Cinnamon só relê o arquivo de configuração
  quando avisado por D-Bus (`updateSetting`), como a janela de configurações
  faz.

### Etapa 7 — Validação

- Roteiro com os 18 cenários da §10 e a planilha de critérios.
- Capturas do Cinnamon com `gnome-screenshot`/`import`, comparadas por
  sobreposição com as capturas do Tahoe, quando estiverem disponíveis.

## Hipóteses de geometria a calibrar

Decisões da Etapa 1 (`lib/layout.js`, `lib/magnification.js`) que não vêm da
spec e precisam ser comparadas com gravações do Tahoe:

- **Âncora da ampliação:** o dock cresce para longe do cursor na proporção
  de onde ele está (tudo para a direita na ponta esquerda, igual nos dois
  lados no meio), então as pontas não balançam a cada ícone; perto da borda
  de um ícone o cursor pode cair no vão ao lado. Perto das bordas da tela, o
  dock inteiro é deslocado para não sair dela.
- **Cápsula:** cresce no eixo principal junto com os ícones, mas mantém a
  altura de repouso; os ícones ampliados sobem além dela.
- **Alcance:** token `magnification.sigma` = 60, cerca de um slot de ícone.
- **Encolhimento:** padding, gap, ícones e separadores escalam juntos; a
  largura do separador (1 px) não escala.
- **Ampliação sem espaço:** quando não cabe, o excesso é reduzido
  uniformemente até caber na tela.

## Desvios aprovados da spec

- Espaçamento segue a referência do dock do macOS enviada pelo usuário
  (ícone de 110 px medido e escalado para 48 px):
  - `icon.gap` = `dock.paddingX` = `dock.paddingY` = 14 (SPEC §2: 7 / 10 / 8),
    ~30% do ícone. Com tudo igual, cada ícone tem o mesmo espaço em todos
    os lados.
  - `dock.cornerRadius` = 26 (SPEC §2: 20), ~55% do ícone; os raios
    concêntricos (`Layout.radii`) derivam daí.
  - `indicator.edgeGap` = 4: centro da bolinha a 7 px da borda, um leve
    respiro (referência ~5). Diâmetro 6, aumentado a pedido do usuário
    (referência: ~3,3).
- Sem fundo no app em foco, como no Dock do macOS: só a bolinha muda de
  cor (azul de destaque; abertos ficam brancos).

## Notas de comportamento do Muffin

- `demands-attention` só é aceito para janelas que não estão visíveis (por
  exemplo, minimizadas ou cobertas); para janelas visíveis o Muffin ignora o
  pedido. O estado `ATTENTION` segue o que o Muffin decide.
- `wmctrl -b add,hidden` não minimiza no Muffin; para testes manuais use
  `Meta.Window.minimize()` via `org.Cinnamon.Eval`.
- `Meta.Window.unminimize()` não recebe timestamp no Muffin 6.6.

## Notas da API do Cinnamon

- O Muffin do Cinnamon 6.6 usa o `Clutter.Timeline` antigo, sem a
  propriedade `actor`; `get_delta()` dá o intervalo do quadro.
- As regiões de entrada do chrome usam `get_transformed_position()`, mas
  só são recalculadas em `notify::allocation`/`notify::visible`; mexer só em
  `translation_*` não atualiza a região.
- Com a tela bloqueada, o protetor de tela recebe os eventos de ponteiro e
  cobre as capturas; os testes ao vivo leem a geometria via `Eval` e chamam
  `_wake()` à mão.

- `PopupMenu` com `St.Side.BOTTOM` encosta o menu na base da tela, como num
  painel. O `DockMenu` reposiciona o menu além da cápsula.
- `St.Widget` consome `Menu` e `Shift+F10` e emite `popup-menu`, então essas
  teclas não chegam ao `key-press-event` do contêiner.
- `navigate_focus` usa `Gtk.DirectionType`; `St.DirectionType` não existe.
- `visibleInFullscreen: false` age por `Main.uiGroup.set_skip_paint`, não por
  `visible`.
- Edições externas no JSON de configurações só valem depois de
  `org.Cinnamon.updateSetting(uuid, uuid, chave, valor)` no D-Bus.

## Riscos e decisões em aberto

1. **Referências do Tahoe.** Sem capturas e vídeos reais, os tokens, a curva
   de ampliação e o bounce são chutes calibráveis. Os itens da §12 seguem
   bloqueados até que alguém consiga capturas do Tahoe 26.
2. **Custo do blur.** `St.BackgroundBlurEffect` relê o framebuffer a cada
   frame. Em hover contínuo isso pode derrubar o FPS; por isso a etapa 6
   começa com uma medição.
3. **Ampliação e strut.** Ícones ampliados crescem acima da faixa reservada.
   Eles podem sobrepor janelas por um instante, mas a entrada (input region)
   precisa acompanhar o retângulo ampliado.
4. **Badges.** O Linux não tem uma API única de badge. Candidatos:
   `com.canonical.Unity.LauncherEntry` (D-Bus) e contagem de notificações por
   app. ✅ LauncherEntry implementado (`lib/badges.js`, `lib/launcherEntry.js`);
   a contagem por notificações do Cinnamon fica em aberto (o `messageTray`
   não emite sinal de fonte nova, exigiria monkey-patch).
5. **Wayland.** O Cinnamon no Wayland ainda é experimental. Struts, input
   region e foco precisam de validação própria; não fazem parte do escopo até
   a etapa 7.
