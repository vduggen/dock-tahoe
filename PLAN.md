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

### Etapa 4 — P1: movimento

- Ampliação contínua ligada ao `motion-event` da cápsula, com suavização por
  frame (`Clutter.Timeline` ou `ease`), sem saltos em movimento rápido.
- Bounce de abertura e de atenção; entrada e saída de itens; auto-ocultação
  com zona de gatilho na borda.
- Preferência de reduzir animações (`org.cinnamon` / `desktop-effects`).

### Etapa 5 — P1: conteúdo e drag-and-drop

- Grupos: recentes (até 3), minimizadas separadas (opcional), pastas e lixeira
  (`Gio.FileMonitor`), com confirmação ao esvaziar a lixeira.
- DnD: reordenar, fixar ao soltar `.desktop`, remover ao arrastar para fora,
  encaminhar arquivo ao app.
- Pilhas de pasta: leque, grade e lista.

### Etapa 6 — P2: vidro e acabamento

- Prova de conceito antes de qualquer outra coisa nesta etapa:
  `St.BackgroundBlurEffect` na cápsula, medindo FPS durante hover contínuo
  (meta: ≥ 55 FPS em 60 Hz, §10).
- Se passar: `Clutter.ShaderEffect` para refração, tint por luminância do
  backdrop, contorno e reflexos especulares. Se não passar: fallback com blur
  simples + gradiente + contorno (§3, "aparência simplificada").
- Variantes de ícone (clara, escura, tonalizada, clear) via efeitos de cor.
- Modo de calibração (§9) escondido atrás de uma chave de desenvolvimento.

### Etapa 7 — Validação

- Roteiro com os 18 cenários da §10 e a planilha de critérios.
- Capturas do Cinnamon com `gnome-screenshot`/`import`, comparadas por
  sobreposição com as capturas do Tahoe, quando estiverem disponíveis.

## Hipóteses de geometria a calibrar

Decisões da Etapa 1 (`lib/layout.js`, `lib/magnification.js`) que não vêm da
spec e precisam ser comparadas com gravações do Tahoe:

- **Âncora da ampliação:** o ponto sob o cursor fica fixo e os vizinhos são
  empurrados para os dois lados; perto das bordas da tela, o dock inteiro é
  deslocado para não sair dela.
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
  - `highlight.inset` = 7, metade do padding: o ícone em foco tem 7 px
    dentro do destaque e o destaque 7 px até a borda, os vizinhos e o
    separador. Com 4 / 10 o ícone ativo parecia apertado.
  - `dock.cornerRadius` = 26 (SPEC §2: 20), ~55% do ícone; os raios
    concêntricos (`Layout.radii`) derivam daí.
  - `indicator.edgeGap` = 2: a bolinha fica na faixa de 7 px abaixo do
    destaque, sem encostar nele (centro a 4 px da borda; referência ~5). Diâmetro fica 4, o menor que o St
    desenha redondo (referência: ~3,3).

## Notas de comportamento do Muffin

- `demands-attention` só é aceito para janelas que não estão visíveis (por
  exemplo, minimizadas ou cobertas); para janelas visíveis o Muffin ignora o
  pedido. O estado `ATTENTION` segue o que o Muffin decide.
- `wmctrl -b add,hidden` não minimiza no Muffin; para testes manuais use
  `Meta.Window.minimize()` via `org.Cinnamon.Eval`.
- `Meta.Window.unminimize()` não recebe timestamp no Muffin 6.6.

## Notas da API do Cinnamon

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
   app. Fica para a etapa 5 ou 6.
5. **Wayland.** O Cinnamon no Wayland ainda é experimental. Struts, input
   region e foco precisam de validação própria; não fazem parte do escopo até
   a etapa 7.
