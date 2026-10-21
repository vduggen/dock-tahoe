# Changelog

Mudanças relevantes de cada versão. O formato segue o
[Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões, o
[Versionamento Semântico](https://semver.org/lang/pt-BR/):

- **MAJOR** quando uma mudança quebra configurações salvas ou exige outra
  versão do Cinnamon;
- **MINOR** para recursos novos;
- **PATCH** para correções.

Anote as mudanças em **Não publicado** conforme forem entrando;
`scripts/release.sh` transforma essa seção na versão nova.

## [Não publicado]

### Adicionado

- Suporte ao GNOME Shell 46 (Wayland e X11), com o mesmo código do Cinnamon:
  `scripts/build-gnome.js` gera o pacote, o schema do GSettings e a janela de
  configurações a partir de `settings-schema.json`. Na primeira vez, o dock
  começa com os favoritos do GNOME. O dash do Panorama fica escondido
  enquanto o dock está ativo.
- `scripts/install.sh` reconhece o ambiente (ou aceita `--cinnamon` /
  `--gnome`).
- Qualidade do desfoque do vidro (`glass-quality`): **Econômico**, como
  antes, ou **Alta qualidade**, que clona as janelas atrás do Dock no fundo
  desfocado (o vidro não some mais quando há uma janela atrás) e usa o dobro
  de amostras por passada.

### Corrigido

- GNOME: o modo teclado (`Super+Alt+D`) e as pilhas de pastas prendiam
  teclado e mouse. O grab do Clutter manda todos os eventos ao ator
  agarrado, e o `captured-event` do palco e os atores não reativos ficavam
  sem nada, então Esc e clique fora não fechavam. Agora os eventos chegam
  pelo próprio ator, que fica reativo durante o grab.
- GNOME: o menu de contexto mostrava uma moldura retangular em volta do
  balão, a borda que o tema (Yaru/Adwaita) põe em `.popup-menu-content`.

### Alterado

- O que difere entre Cinnamon e GNOME foi para `lib/platform.js`; o
  controlador saiu de `extension.js` para `lib/controller.js`.
- `scripts/check.sh` usa o `gjs` quando não há `cjs` e também verifica o
  pacote do GNOME.

## [0.1.0] - 2026-10-20

### Adicionado

- Dock flutuante para o Cinnamon 6.6 no estilo do macOS Tahoe, um por
  monitor, embaixo, à esquerda ou à direita.
- Ampliação gaussiana dos ícones sob o cursor, ancorada de forma
  proporcional.
- Apps fixados, abertos e recentes, com indicadores, quique ao abrir e ao
  pedir atenção, menu de contexto e navegação pelo teclado.
- Arrastar e soltar para reordenar, fixar e desafixar.
- Pilhas de pastas (leque, grade e lista), lixeira e janelas minimizadas como
  miniaturas.
- Badges de notificação pelo protocolo `LauncherEntry`.
- Aparências dos ícones: clara, escura, tonalizada e transparente.
- Vidro com desfoque e refração opcionais (experimental).
- Ocultação automática.
- Modo de calibração e scripts de captura e comparação para desenvolvimento.
