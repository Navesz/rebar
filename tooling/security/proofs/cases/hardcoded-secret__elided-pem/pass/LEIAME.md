# exemplo-multilinha

Se voce precisa de variaveis multilinha, chaves privadas por exemplo, elas sao
suportadas com quebra de linha:

```ini
PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...
Kh9NV...
...
-----END RSA PRIVATE KEY-----"
```

Ou, com aspas duplas e o caractere `\n`:

```ini
PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nKh9NV...\n-----END RSA PRIVATE KEY-----\n"
```
