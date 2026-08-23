# Contrato de API compartido

## Alcance general

Este documento es la fuente de verdad para la integración entre frontend y backend. Si se modifica cualquier endpoint, payload o respuesta, debe reflejarse aquí y en el repositorio paralelo antes de continuar con el siguiente bloque.

## Bloque 1

### Entidades

#### Account

```json
{
  "id": "acc_001",
  "name": "Cuenta principal",
  "type": "checking",
  "balance": 2450.75,
  "currency": "EUR",
  "createdAt": "2026-08-22T10:00:00.000Z"
}
```

#### Category

```json
{
  "id": "cat_001",
  "name": "Supermercado",
  "type": "expense",
  "color": "#39b5e0"
}
```

#### Transaction

```json
{
  "id": "txn_001",
  "accountId": "acc_001",
  "categoryId": "cat_001",
  "date": "2026-08-20",
  "amount": 84.5,
  "description": "Compra supermercado",
  "type": "expense",
  "source": "manual",
  "createdAt": "2026-08-22T10:00:00.000Z"
}
```

#### DashboardSummary

```json
{
  "totalIncome": 2200,
  "totalExpense": 184.5,
  "balance": 2015.5,
  "monthlyTransactions": 4
}
```

### Endpoints del bloque 1

- GET /api/accounts
- POST /api/accounts
- GET /api/categories
- GET /api/transactions
- POST /api/transactions
- GET /api/dashboard

## Bloque 5: n8n y Open Banking

### Endpoints

- POST /api/bank-sync
- POST /api/transactions/import
- GET /api/sync-history

### Respuestas esperadas

#### POST /api/bank-sync

```json
{
  "status": "queued",
  "provider": "open-banking",
  "message": "Sincronización programada"
}
```

#### POST /api/transactions/import

```json
{
  "imported": 12,
  "source": "n8n"
}
```

#### GET /api/sync-history

```json
[
  {
    "id": "sync_001",
    "provider": "open-banking",
    "status": "success",
    "syncAt": "2026-08-22T10:00:00.000Z"
  }
]
```

### Concepto Open Banking

Open Banking describe el acceso seguro a los datos bancarios del cliente a través de APIs autorizadas. En este proyecto, n8n actúa como orquestador que solicita transacciones, normaliza los datos y los envía a la API interna para su carga.

## Bloque 8: Conexión multi-banco (Enable Banking)

### Concepto

Cada banco objetivo (definido en `ENABLE_BANKING_TARGET_BANKS`, ej. `Bankinter,Unicaja,Caja Rural del Sur`) tiene su propia conexión OAuth independiente. El usuario conecta cada banco una única vez desde la app; a partir de ahí n8n dispara la sincronización diaria llamando al backend, que hace el trabajo real contra Enable Banking (firma JWT, gestiona sesiones, mapea movimientos). n8n **no** habla directamente con Enable Banking — solo actúa como scheduler.

### Account (ampliada)

```json
{
  "id": "acc_bankinter_7b9f2af2",
  "name": "Bankinter · Cuenta 1",
  "type": "checking",
  "balance": 0,
  "currency": "EUR",
  "createdAt": "2026-08-23T10:00:00.000Z",
  "bankKey": "bankinter",
  "bankName": "Bankinter",
  "externalAccountId": "7b9f2af2-fd25-4a60-8294-c431f82acda3"
}
```

`bankKey`/`bankName`/`externalAccountId` solo están presentes en cuentas creadas automáticamente desde una sincronización bancaria; las cuentas manuales no los incluyen. Enable Banking no expone IBAN ni nombre real de cuenta en claro (van hasheados por privacidad), por eso el nombre se genera como `"{banco} · Cuenta N"`. El saldo (`balance`) es la suma de los movimientos importados, no el saldo real reportado por el banco (evita gastar cuota extra del banco en una llamada de saldo).

### EnableBankingConnection

```json
{
  "bankKey": "bankinter",
  "bankName": "Bankinter",
  "status": "connected",
  "connected": true,
  "sessionCreatedAt": "2026-08-23T13:30:14.000Z",
  "lastSyncAt": "2026-08-24T07:00:03.000Z",
  "lastSyncStatus": "success",
  "lastSyncImported": 4,
  "lastSyncSkipped": 12,
  "lastSyncError": null,
  "accountCount": 2,
  "lastExchangeError": null
}
```

`status` es uno de: `not_connected`, `pending`, `connected`, `error`.

### Endpoints

- `GET /api/enablebanking/target-banks` — lista los bancos objetivo y si Enable Banking los tiene en su directorio para el país configurado.
- `GET /api/enablebanking/connections` — devuelve un `EnableBankingConnection[]`, uno por cada banco en `ENABLE_BANKING_TARGET_BANKS`.
- `GET /api/enablebanking/connect-url?bank=<bankKey>` — genera la URL de autorización OAuth para ese banco concreto. Responde `{ configured, authUrl, bankKey, bank, ... }` o `{ configured: false, error }`.
- `GET /api/enablebanking/callback` (y alias `/api/enable-banking/callback`) — recibe el `code`/`state` de Enable Banking, intercambia la sesión y la asocia al banco correspondiente (buscado por `state`). Si `FRONTEND_APP_URL` está configurada, redirige (302) a `${FRONTEND_APP_URL}?bank_connected=success|error&bank=<bankKey>` en lugar de devolver JSON.
- `POST /api/bank-sync` — dispara la sincronización de **todos** los bancos conectados (uso desde la app, sin autenticación, igual que el resto de la API). Responde `{ status, syncAt, message, banks: string[] }` de forma inmediata; el trabajo real ocurre en segundo plano y se refleja en `sync-history` y `connections`.
- `POST /api/bank-sync/scheduled` — mismo comportamiento que `POST /api/bank-sync`, pero requiere cabecera `x-api-key` igual a `BANK_INGEST_API_KEY`. Pensado para que n8n lo llame una vez al día vía Schedule Trigger.
- `GET /api/enablebanking/debug-pull?bank=<bankKey>` — diagnóstico: hace una única llamada real a Enable Banking para ese banco y devuelve el detalle crudo. Consume cuota de acceso del banco; usar solo para depurar.

### Respuesta de POST /api/bank-sync

```json
{
  "status": "running",
  "syncAt": "2026-08-24T07:00:00.000Z",
  "message": "Sincronización iniciada para 3 banco(s)",
  "banks": ["Bankinter", "Unicaja", "Caja Rural del Sur"]
}
```

Si no hay ningún banco conectado, `status` es `"error"` y `banks` es `[]`.

### GET /api/sync-history (actualizado)

`provider` ahora contiene el nombre del banco (no un valor genérico como `open-banking`):

```json
[
  {
    "id": "sync_1787500000000_bankinter",
    "provider": "Bankinter",
    "status": "success",
    "syncAt": "2026-08-24T07:00:00.000Z"
  }
]
```

## Reglas de integración

- El backend debe responder con JSON compatible con este contrato.
- El frontend debe consumir solo los campos definidos aquí.
- Los nombres de propiedades no pueden cambiar sin actualizar ambos repos.
- Los endpoints de sincronización deben respetar el mismo patrón de respuesta que el resto de la API.
- La documentación del proyecto debe reflejar la lógica implementada antes de pasar al siguiente bloque.

## Checklist del bloque 7

- Actualizar `docs/api-contract.md` en backend.
- Reflejar el mismo contenido en el frontend.
- Validar que ambos repos mantienen idéntico contexto.
- Documentar cambios de API, endpoints y decisiones de negocio.
- Dejar claro qué quedó implementado y qué está pendiente para el siguiente bloque.
