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
