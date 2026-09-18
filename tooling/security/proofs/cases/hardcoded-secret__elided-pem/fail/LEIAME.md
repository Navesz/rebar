# exemplo-multilinha

Se voce precisa de variaveis multilinha, chaves privadas por exemplo, elas sao
suportadas com quebra de linha:

```ini
PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIBOgIBAAJBAK7fQ2mR9xK4vL1nD6sW8yC3fZ0jP5aE7gU2iO4tHb3Vn6Xq8Zd1
Ct5Ym0Rp4Jw7Gs2Lf9Bk3Nh6Tv1Qe8Xz0Ac5Dr7Yu2Ip4Ow6Ke9Sg1Mb3Vn8Xq5Zd
...
AiEA9Kt2Lm7Qp4Xr8Tv3Zb6Nc1Hd5Ws0Yj7Gf2Ue4Rn6Ic8Ka0Mv3Xp5Zq7Bd9Tw
-----END RSA PRIVATE KEY-----"
```

Ou, com aspas duplas e o caractere `\n`:

```ini
PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK7fQ2mR9xK4vL1nD6sW8yC3fZ0jP5aE7gU2iO4tHb3Vn6Xq8Zd1\n...\n-----END RSA PRIVATE KEY-----\n"
```
