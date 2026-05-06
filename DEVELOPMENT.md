# Desenvolvimento local

## Subir o app

```bash
npm run dev
```

## URL e porta

- **Abra:** [http://127.0.0.1:3030](http://127.0.0.1:3030)
- A porta **padrão é 3030**, não 3000.
- Se `http://localhost:3030` falhar no macOS, use **`127.0.0.1`** (alguns sistemas resolvem `localhost` para IPv6 primeiro).

## Scripts

| Comando        | Uso |
|----------------|-----|
| `npm run dev`  | Next em `127.0.0.1:3030` |
| `npm run dev:turbo` | Igual, com Turbopack |
| `npm run dev:lan`   | Escuta em `0.0.0.0:3030` (acesso pelo IP na rede local) |
| `npm run dev:clean` | Limpa `.next` / cache e sobe o dev |

Antes de cada um destes, `dev:free-port` liberta as portas **3000**, **3022** e **3030** (evita processos presos).

## Variáveis opcionais

Ver bloco “Servidor local” em `.env.example`: `NEXT_DEV_PORT`, `NEXT_DEV_HOSTNAME`.
