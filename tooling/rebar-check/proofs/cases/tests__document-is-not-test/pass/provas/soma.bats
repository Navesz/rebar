#!/usr/bin/env bats

@test "somar dois numeros" {
  run node -e "import('./soma.mjs').then(m => process.exit(m.somar(2, 2) === 4 ? 0 : 1))"
  [ "$status" -eq 0 ]
}
