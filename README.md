# Dock Tahoe para Cinnamon

Extensão do Cinnamon que recria o Dock do macOS Tahoe 26. A especificação está
em [`SPEC.md`](SPEC.md) e o plano por etapas em [`PLAN.md`](PLAN.md).

Alvo atual: Cinnamon 6.6, sessão X11. Sem dependências em tempo de execução.

## Desenvolvimento

```sh
./scripts/check.sh     # sintaxe, metadados e testes
./scripts/install.sh   # link simbólico em ~/.local/share/cinnamon/extensions
```

O `install.sh` não ativa a extensão: ative `tahoe-dock@unimestre.local` em
Configurações do Sistema → Extensões. O UUID é diferente do protótipo
`macos-dock@unimestre.local`, então os dois podem ficar instalados, mas não
devem ficar ativos ao mesmo tempo.
