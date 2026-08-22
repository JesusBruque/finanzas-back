# Contrato API - Bloque 1

## Objetivo

Este contrato define la base mínima para que el frontend y el backend trabajen coordinados desde el primer momento.

## Entidades

### Account

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

### Category

```json
{
  "id": "cat_001",
  "name": "Supermercado",
  "type": "expense",
  "color": "#39b5e0"
}
```

### Transaction

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

## Endpoints mínimos

### GET /api/accounts

Devuelve todas las cuentas.

### POST /api/accounts

Crea una cuenta.

Body ejemplo:

```json
{
  "name": "Cuenta conjunta",
  "type": "checking",
  "balance": 0,
  "currency": "EUR"
}
```

### GET /api/categories

Devuelve todas las categorías.

### GET /api/transactions

Devuelve todas las transacciones.

### POST /api/transactions

Crea una transacción.

Body ejemplo:

```json
{
  "accountId": "acc_001",
  "categoryId": "cat_001",
  "date": "2026-08-20",
  "amount": 84.5,
  "description": "Compra supermercado",
  "type": "expense",
  "source": "manual"
}
```

## Reglas de trabajo

- El frontend solo debe consumir los nombres y campos definidos aquí.
- Si se añade un campo nuevo, hay que avisar al otro agente.
- Las transacciones deben tener siempre `amount` con valor positivo y `type` para saber si es ingreso o gasto.
- La categoría es opcional por compatibilidad, pero se recomienda que exista siempre.

## Objetivo del primer entregable

- Una cuenta
- Categorías base
- Lista de transacciones
- Formulario de creación manual
- Resumen de saldo y gastos
