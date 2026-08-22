# Backend - Bloque 1

## Stack recomendado

### Opción 1: Node + NestJS

Recomendado si quieres mantener todo en TypeScript y encajar bien con Angular.

#### Ventajas
- mismo lenguaje que frontend
- arquitectura limpia
- muy buena para APIs
- fácil integración con n8n y servicios externos

### Opción 2: Python + FastAPI

Recomendado si quieres más aprendizaje de automatizaciones y IA.

#### Ventajas
- muy rápido para prototipos
- excelente para trabajo con datos y automatizaciones
- ideal para futuras integraciones con OpenAI o scripts de análisis

## Recomendación para tu caso

Si tu backend está abierto en otro VS Code y quieres empezar rápido, yo recomiendo:

- Node + NestJS si quieres continuidad con Angular
- Python + FastAPI si quieres aprender automatizaciones y buena manipulación de datos

Para este proyecto personal, mi recomendación final es:

- Frontend: Angular
- Backend: NestJS
- DB: PostgreSQL
- n8n: orquestador

## Objetivo del Bloque 1

Debe permitir:

- crear cuentas
- listar cuentas
- crear transacciones
- listar transacciones
- ver resumen del mes
- categorizar transacciones con categorias base

## Modelo de datos

### Account

```ts
{
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit';
  balance: number;
  currency: 'EUR';
  createdAt: string;
}
```

### Category

```ts
{
  id: string;
  name: string;
  type: 'income' | 'expense';
  color: string;
}
```

### Transaction

```ts
{
  id: string;
  accountId: string;
  categoryId: string;
  date: string; // YYYY-MM-DD
  amount: number;
  description: string;
  type: 'income' | 'expense';
  source: 'manual' | 'bank' | 'n8n';
  createdAt: string;
}
```

## Endpoints

### GET /api/accounts

Respuesta:

```json
[
  {
    "id": "acc_001",
    "name": "Cuenta principal",
    "type": "checking",
    "balance": 2450.75,
    "currency": "EUR",
    "createdAt": "2026-08-22T10:00:00.000Z"
  }
]
```

### POST /api/accounts

Body:

```json
{
  "name": "Cuenta conjunta",
  "type": "checking",
  "balance": 0,
  "currency": "EUR"
}
```

### GET /api/categories

Respuesta:

```json
[
  {
    "id": "cat_001",
    "name": "Supermercado",
    "type": "expense",
    "color": "#39b5e0"
  },
  {
    "id": "cat_002",
    "name": "Nomina",
    "type": "income",
    "color": "#22c55e"
  }
]
```

### GET /api/transactions

Respuesta:

```json
[
  {
    "id": "txn_001",
    "accountId": "acc_001",
    "categoryId": "cat_001",
    "date": "2026-08-20",
    "amount": 84.5,
    "description": "Compra supermercado",
    "type": "expense",
    "source": "manual",
    "createdAt": "2026-08-22T08:14:00.000Z"
  },
  {
    "id": "txn_002",
    "accountId": "acc_001",
    "categoryId": "cat_002",
    "date": "2026-08-01",
    "amount": 2200,
    "description": "Nomina",
    "type": "income",
    "source": "manual",
    "createdAt": "2026-08-02T09:00:00.000Z"
  }
]
```

### POST /api/transactions

Body:

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

### GET /api/dashboard

Respuesta:

```json
{
  "totalIncome": 2200,
  "totalExpense": 184.5,
  "balance": 2015.5,
  "monthlyTransactions": 4
}
```

## Base de datos sugerida

### Tablas mínimas

- accounts
- categories
- transactions

### Ejemplo SQL simple

```sql
CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  balance DECIMAL(12,2) DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'EUR',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE categories (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(20) NOT NULL,
  color VARCHAR(20) DEFAULT '#000000'
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY,
  account_id UUID REFERENCES accounts(id),
  category_id UUID REFERENCES categories(id),
  date DATE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  description VARCHAR(255),
  type VARCHAR(20) NOT NULL,
  source VARCHAR(20) DEFAULT 'manual',
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Datos iniciales de ejemplo

### Cuentas

```json
[
  {
    "id": "acc_001",
    "name": "Cuenta principal",
    "type": "checking",
    "balance": 2450.75,
    "currency": "EUR",
    "createdAt": "2026-08-22T10:00:00.000Z"
  }
]
```

### Categorías

```json
[
  { "id": "cat_001", "name": "Supermercado", "type": "expense", "color": "#39b5e0" },
  { "id": "cat_002", "name": "Nomina", "type": "income", "color": "#22c55e" },
  { "id": "cat_003", "name": "Transporte", "type": "expense", "color": "#f59e0b" },
  { "id": "cat_004", "name": "Ocio", "type": "expense", "color": "#a855f7" }
]
```

### Transacciones

```json
[
  {
    "id": "txn_001",
    "accountId": "acc_001",
    "categoryId": "cat_001",
    "date": "2026-08-20",
    "amount": 84.5,
    "description": "Compra supermercado",
    "type": "expense",
    "source": "manual",
    "createdAt": "2026-08-22T08:14:00.000Z"
  },
  {
    "id": "txn_002",
    "accountId": "acc_001",
    "categoryId": "cat_002",
    "date": "2026-08-01",
    "amount": 2200,
    "description": "Nomina",
    "type": "income",
    "source": "manual",
    "createdAt": "2026-08-02T09:00:00.000Z"
  }
]
```

## Reglas del backend

- Todo el dinero se gestiona en EUR por ahora.
- `amount` puede ser positivo siempre, y `type` define si es ingreso o gasto.
- `source` admite: `manual`, `bank`, `n8n`.
- Las fechas deben ir en formato ISO `YYYY-MM-DD` en la API.
- El backend debe devolver siempre JSON con estos nombres para no romper el frontend.

## Tareas del backend para este bloque

1. Crear la estructura del proyecto
2. Crear modelos de cuenta, categoría y transacción
3. Crear endpoints básicos
4. Añadir base de datos local
5. Añadir datos demo
6. Validar que el frontend puede consumir la API

## Lista de verificaciones del bloque 1

- Se puede crear una cuenta
- Se puede listar cuentas
- Se puede crear una transacción
- Se puede listar transacciones
- Se puede calcular el resumen del mes
- La respuesta JSON coincide con el contrato

## Siguiente bloque recomendado

- filtros por fecha
- gastos por categorías
- reglas del mes
- alertas
- n8n integration
- Open Banking
