# n8n + Open Banking Quickstart (primer uso)

## Flujo actual (multi-banco, recomendado)

Desde el bloque 8 del contrato de API, la app soporta conectar varios bancos (Bankinter, Unicaja, Caja Rural del Sur, configurables vía `ENABLE_BANKING_TARGET_BANKS`) de forma independiente. El backend hace **todo** el trabajo con Enable Banking (JWT, sesiones, mapeo de movimientos); n8n solo actúa como reloj despertador diario.

1. Desde la app, pulsa "Conectar" en cada tarjeta de banco (una vez por banco). Enable Banking te redirige a autorizar y vuelve a la app.
2. Importa `docs/n8n-workflow-finanzas-daily-sync.json` en n8n: un Schedule Trigger (07:00 por defecto) que llama a `POST /api/bank-sync/scheduled` con cabecera `x-api-key: BANK_INGEST_API_KEY`.
3. Activa el workflow. Cada día, n8n dispara el sync; el backend sincroniza todos los bancos conectados y actualiza `sync-history` y `enablebanking/connections`.
4. Puedes forzar un sync manual en cualquier momento con el botón "Sincronizar ahora" en la app (llama a `POST /api/bank-sync`, sin cabecera).

Ver `docs/api-contract.md` (Bloque 8) para el detalle de payloads. El resto de este documento describe el flujo original de un solo banco/demo, útil como referencia histórica.

---

Este documento te deja un camino simple para lograr comunicacion real entre tu backend y n8n aunque no hayas usado n8n antes.

## Objetivo de hoy

Conseguir este flujo real minimo:

1. Tu app llama a POST /api/bank-sync.
2. El backend dispara un webhook de n8n.
3. n8n genera o recupera transacciones bancarias.
4. n8n envia esas transacciones a POST /api/transactions/import.
5. El backend importa sin duplicar por externalId.

## 1) Preparar variables en backend

Copia .env.example a .env y define:

- MONGODB_URI
- PORT
- BANK_INGEST_API_KEY
- N8N_SYNC_WEBHOOK_URL
- N8N_SYNC_WEBHOOK_TOKEN

Valores recomendados local:

MONGODB_URI=mongodb://127.0.0.1:27017/finanzas
PORT=3000
BANK_INGEST_API_KEY=finanzas-bank-ingest-local
N8N_SYNC_WEBHOOK_URL=http://localhost:5678/webhook/finanzas-sync
N8N_SYNC_WEBHOOK_TOKEN=finanzas-n8n-trigger-local

## 2) Arrancar backend

Desde finanzas-back:

- npm install
- npm run start:dev

## 3) Crear flujo en n8n (sin proveedor, prueba de comunicacion)

Si prefieres no montarlo a mano, importa este archivo directamente en n8n:

- docs/n8n-workflow-finanzas-sync.json

Despues de importarlo, revisa dos valores dentro del workflow para que coincidan con tu .env:

- Token de trigger recibido por n8n en el nodo IF: finanzas-n8n-trigger-local
- Header x-api-key del nodo HTTP Request a backend: finanzas-bank-ingest-local

En n8n crea un workflow nuevo con estos nodos:

1. Webhook
- Method: POST
- Path: finanzas-sync
- Response mode: Using Respond to Webhook node (o Last node si prefieres)

2. IF (validar clave enviada por backend)
- Condicion izquierda (Expression): {{$json.headers["x-api-key"]}}
- Operador: equals
- Condicion derecha: finanzas-n8n-trigger-local

3. Set (rama true) con campo transactions
- Keep only set: true
- Añade campo source = bank
- Añade campo transactions con este array:
[
  {
    "accountId": "acc_001",
    "categoryId": "cat_003",
    "date": "2026-08-23",
    "amount": 24.9,
    "description": "Internet mensual",
    "type": "expense",
    "source": "bank",
    "externalId": "demo-bank-2026-08-23-001"
  },
  {
    "accountId": "acc_001",
    "categoryId": "cat_001",
    "date": "2026-08-23",
    "amount": 11.5,
    "description": "Compra rapida",
    "type": "expense",
    "source": "bank",
    "externalId": "demo-bank-2026-08-23-002"
  }
]

4. HTTP Request (importar en backend)
- Method: POST
- URL: http://localhost:3000/api/transactions/import
- Send body: JSON
- JSON Body: {{$json}}
- Header x-api-key: finanzas-bank-ingest-local

5. Respond to Webhook
- Status code: 200
- Response body: {{$json}}

En la rama false del IF, responde 401 con un mensaje de token invalido.

Activa el workflow.

## 4) Ejecutar la prueba desde tu app

Opcion A desde frontend:

- Pulsa el boton de sincronizar banco.

Opcion B por terminal:

- curl -X POST http://localhost:3000/api/bank-sync -H "Content-Type: application/json" -d "{\"provider\":\"open-banking\"}"

Resultado esperado:

- /api/bank-sync devuelve status running (si n8n webhook responde OK).
- /api/transactions/import recibe y guarda transacciones.
- Si repites sync con mismos externalId, imported baja y skipped sube.

## 5) Verificar que no hay duplicados

Haz dos sync seguidas. En la segunda:

- imported deberia ser 0 para esos mismos externalId.
- skipped deberia aumentar.

## 6) Paso a Open Banking real (GoCardless/Tink/TrueLayer)

Cuando la comunicacion basica funcione, sustituye el nodo Set por:

1. Nodo HTTP Request para autenticacion del proveedor.
2. Nodo HTTP Request para listar cuentas.
3. Nodo HTTP Request para listar transacciones.
4. Nodo Code para mapear a contrato del backend:
   - accountId
   - categoryId
   - date
   - amount
   - description
   - type
   - source=bank
   - externalId (id unico del proveedor)
5. Nodo HTTP Request final a /api/transactions/import.

## 7) Problemas comunes

- 401 en /api/transactions/import:
  La x-api-key no coincide con BANK_INGEST_API_KEY.

- /api/bank-sync queda en error:
  N8N_SYNC_WEBHOOK_URL no responde o token incorrecto.

- Se duplican transacciones:
  Falta externalId o cambia en cada ejecucion.

- n8n no recibe llamadas:
  Revisa URL, puerto y que el workflow este activo.

## 8) Siguiente mejora recomendada

Añadir endpoint de callback para que n8n marque cada sync como success/error con detalle de importados y errores. Eso permite historial de sync completamente real y trazable.
