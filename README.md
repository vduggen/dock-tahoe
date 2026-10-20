# Tahoe Dock

Um dock para o Cinnamon no estilo do macOS Tahoe: ampliação suave sob o
cursor, indicadores de apps abertos, pilhas de pastas, badges de notificação
e um painel de vidro que flutua sobre a área de trabalho.

Escrito do zero em GJS, sem dependências além do próprio Cinnamon.

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
  vindos do menu do Cinnamon.
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
- Respeita a opção de desativar efeitos do Cinnamon.

## Requisitos

- Cinnamon 6.6, sessão X11.

## Instalação

Enquanto não está no [Cinnamon Spices](https://cinnamon-spices.linuxmint.com/extensions),
instale a partir do código:

```sh
git clone https://github.com/vduggen/tahoe-dock.git
cd tahoe-dock
./scripts/install.sh
```

O script cria um link simbólico em `~/.local/share/cinnamon/extensions`.
Depois, ative **Tahoe Dock** em *Configurações do Sistema → Extensões*. Se
você usa um painel inferior com lista de janelas, o dock flutua acima dele;
para o visual completo, mova ou oculte o painel.

Para remover, desative a extensão e apague o link
`~/.local/share/cinnamon/extensions/tahoe-dock@vduggen`.

## Configurações

Em *Extensões → Tahoe Dock → Configurar*:

| Opção | O que faz |
| --- | --- |
| Posição na tela | Inferior, esquerda ou direita |
| Tamanho dos ícones | Tamanho base; os espaçamentos acompanham |
| Ampliar ícones sob o cursor | Liga a ampliação e define o tamanho máximo |
| Aparência dos ícones | Padrão, clara, escura, tonalizada ou transparente |
| Desfocar o fundo do vidro | Desfoque e refração do fundo (experimental, usa mais GPU) |
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
- Wayland não foi testado.

## Desenvolvimento

```sh
./scripts/check.sh     # sintaxe, metadados e testes (cjs)
./scripts/install.sh   # link simbólico para testar na sessão atual
```

Depois de editar, recarregue a extensão desativando e ativando, ou pelo
Looking Glass (`Alt+F2`, `lg`). Erros aparecem em `~/.xsession-errors`.

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
