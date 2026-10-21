# Tahoe Dock

Um dock para o Cinnamon e o GNOME Shell no estilo do macOS Tahoe: ampliação suave sob o
cursor, indicadores de apps abertos, pilhas de pastas, badges de notificação
e um painel de vidro que flutua sobre a área de trabalho.

Escrito do zero em GJS, sem dependências além do próprio ambiente. Um só
código atende os dois: o que muda entre eles fica em `lib/platform.js`
(Cinnamon) e `gnome/` (GNOME Shell).

> Projeto independente, sem relação com a Apple. macOS é marca registrada da
> Apple Inc.; o nome indica apenas a referência visual.

## Recursos

- **Ampliação** gaussiana dos ícones sob o cursor, com o dock crescendo de
  forma proporcional e sem tremer.
- **Apps fixados, abertos e recentes**, com indicador de janela aberta,
  quique ao abrir e quando um app pede atenção.
- **Clique como no macOS:** abre o app ou traz a última janela usada; no app
  em foco, minimiza. O menu de contexto lista as janelas e permite fixar,
  desafixar e fechar.
- **Arrastar e soltar** para reordenar, fixar e desafixar apps, inclusive
  vindos do menu do Cinnamon ou da grade de apps do GNOME.
- **Pilhas de pastas** (Downloads e as pastas que você escolher) em leque,
  grade ou lista, atualizadas em tempo real.
- **Lixeira** que mostra se está vazia ou cheia, com opção de esvaziar.
- **Janelas minimizadas** no ícone do app ou como miniaturas ao lado da
  lixeira.
- **Badges de notificação** pelo protocolo `LauncherEntry` do Unity (o
  mesmo do Plank e do Dash to Dock).
- **Aparência dos ícones:** padrão, clara, escura, tonalizada (cor à sua
  escolha) ou transparente.
- **Vidro** com borda, brilho e sombra; desfoque e refração do fundo
  opcionais (experimental).
- **Posição** inferior, esquerda ou direita; ocultação automática; um dock
  por monitor, que some no monitor em tela cheia.
- **Teclado:** `Super+Alt+D` (configurável) foca o dock; setas, `Home`,
  `End`, `Enter`, `Menu` e `Esc` navegam.
- Respeita a opção de desativar animações do Cinnamon e do GNOME.

## Requisitos

- Cinnamon 6.6, sessão X11; ou
- GNOME Shell 46 (Ubuntu 24.04), Wayland ou X11.

## Instalação

Enquanto não está no [Cinnamon Spices](https://cinnamon-spices.linuxmint.com/extensions),
instale a partir do código:

```sh
git clone https://github.com/vduggen/dock-tahoe.git
cd dock-tahoe
./scripts/install.sh
```

O script reconhece o ambiente pela sessão atual (ou use `--cinnamon` /
`--gnome`).

### Cinnamon

O script cria um link simbólico em `~/.local/share/cinnamon/extensions`.
Depois, ative **Tahoe Dock** em *Configurações do Sistema → Extensões*. Se
você usa um painel inferior com lista de janelas, o dock flutua acima dele;
para o visual completo, mova ou oculte o painel.

Para remover, desative a extensão e apague o link
`~/.local/share/cinnamon/extensions/dock-tahoe@vduggen`.

### GNOME Shell

O script gera o pacote do GNOME em `build/gnome/` e cria um link simbólico em
`~/.local/share/gnome-shell/extensions`. No Wayland, o GNOME só encontra
extensões novas depois de encerrar a sessão e entrar de novo; então:

```sh
gnome-extensions enable dock-tahoe@vduggen
```

O Ubuntu já traz o próprio dock (Ubuntu Dock). O Tahoe Dock não mexe em
outras extensões, então desative-o você mesmo para não ter dois docks:

```sh
gnome-extensions disable ubuntu-dock@ubuntu.com
```

Para voltar, faça `gnome-extensions enable ubuntu-dock@ubuntu.com`. Com o
Tahoe Dock ativo, o dash do Panorama fica escondido e o dock continua visível
nele.

Para remover, desative a extensão e apague o link
`~/.local/share/gnome-shell/extensions/dock-tahoe@vduggen`. Depois de
atualizar o código, rode `./scripts/install.sh` de novo para refazer o
pacote.

## Configurações

No Cinnamon, em *Extensões → Tahoe Dock → Configurar*; no GNOME, no app
*Extensões* ou com `gnome-extensions prefs dock-tahoe@vduggen`:

| Opção | O que faz |
| --- | --- |
| Posição na tela | Inferior, esquerda ou direita |
| Tamanho dos ícones | Tamanho base; os espaçamentos acompanham |
| Ampliar ícones sob o cursor | Liga a ampliação e define o tamanho máximo |
| Aparência dos ícones | Padrão, clara, escura, tonalizada ou transparente |
| Desfocar o fundo do vidro | Desfoque e refração do fundo (experimental, usa mais GPU) |
| Qualidade do desfoque | **Econômico** desfoca só o papel de parede (para máquinas mais fracas); **Alta qualidade** também desfoca as janelas atrás do Dock, com mais amostras |
| Ocultar automaticamente | O dock sai da tela e volta ao tocar a borda |
| Apenas apps da área de trabalho atual | Filtra os apps abertos pela área de trabalho |
| Mostrar apps recentes | Até 3 apps fechados há pouco |
| Minimizar janelas no ícone do app | Ou como miniaturas ao lado da lixeira |
| Pasta Downloads e Pastas no Dock | Pilhas de pastas |
| Focar o Dock pelo teclado | Atalho de teclado |

## Limitações conhecidas

- Arrastar um arquivo do Nemo para um ícone (abrir com o app) ainda não é
  suportado: o Cinnamon não repassa às extensões o conteúdo de arrastos
  entre aplicativos.
- No Cinnamon, Wayland não foi testado.
- No GNOME, só a versão 46 é suportada, e o painel superior continua no
  lugar.

## Desenvolvimento

```sh
./scripts/check.sh            # sintaxe, metadados, testes (cjs ou gjs) e o pacote do GNOME
./scripts/install.sh          # link simbólico para testar na sessão atual
node scripts/build-gnome.js   # só gera o pacote do GNOME em build/gnome/
```

O código em `lib/` é escrito para o Cinnamon (`imports.*` e `require()`);
`scripts/build-gnome.js` o converte em módulos ES para o GNOME, troca
`lib/platform.js` e `lib/settings.js` pelas versões de `gnome/lib/` e gera o
schema do GSettings a partir de `settings-schema.json`. Tudo que difere entre
os dois ambientes passa por `lib/platform.js`.

No Cinnamon, recarregue a extensão desativando e ativando, ou pelo Looking
Glass (`Alt+F2`, `lg`); erros aparecem em `~/.xsession-errors`. No GNOME com
Wayland, teste num shell aninhado, com configurações separadas das suas:

```sh
export XDG_CONFIG_HOME=/tmp/tahoe/config XDG_DATA_HOME=/tmp/tahoe/data
mkdir -p $XDG_DATA_HOME/gnome-shell/extensions
ln -s "$PWD/build/gnome/dock-tahoe@vduggen" $XDG_DATA_HOME/gnome-shell/extensions/
dbus-run-session -- sh -c 'gsettings set org.gnome.shell enabled-extensions "[\"dock-tahoe@vduggen\"]"; gnome-shell --nested --wayland'
```

As variáveis precisam estar definidas antes do `dbus-run-session`: é ele que
inicia o serviço do dconf, e é com elas que o serviço sabe onde gravar.
Erros aparecem na saída do próprio shell e em `journalctl -f -o cat
/usr/bin/gnome-shell`.

- [`SPEC.md`](SPEC.md): especificação do comportamento e dos tokens visuais.
- [`PLAN.md`](PLAN.md): plano por etapas e decisões de implementação.
- [`docs/VALIDACAO.md`](docs/VALIDACAO.md): roteiro de validação, com os
  scripts de captura e comparação.

### Versões

O projeto segue o [Versionamento Semântico](https://semver.org/lang/pt-BR/).
A versão fica em `metadata.json`, e o que muda em cada uma, no
[`CHANGELOG.md`](CHANGELOG.md). Anote as mudanças na seção
**Não publicado** e, para lançar, a partir do `main` limpo:

```sh
./scripts/release.sh 0.2.0   # atualiza metadata e changelog, testa, faz commit e tag v0.2.0
git push origin main v0.2.0
```

Contribuições são bem-vindas: abra uma issue descrevendo o problema ou a
ideia antes de um pull request grande, e mantenha `./scripts/check.sh`
passando.

## Licença

[GPL-3.0-or-later](LICENSE). © 2026 Vitor Duggen.
