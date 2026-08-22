# Roles del equipo

## Agente backend

Responsable de:

- mantener la API REST coherente con el contrato compartido
- definir y mantener DTOs y validaciones
- implementar bloques funcionales: cuentas, categorías, transacciones, dashboard, Open Banking y n8n
- conservar compatibilidad con endpoints ya existentes
- responder a peticiones de sincronización, importación y historial de sincronización
- actualizar la documentación del contrato cuando cambia la lógica del backend

## Agente frontend

Responsable de:

- consumir solo el contrato publicado en `docs/api-contract.md`
- renderizar dashboard, listas y formularios
- conectar la UI con los endpoints de sincronización y importación
- manejar loading, errores y fallback local sin inventar contratos propios
- mantener el contenido visual alineado con la lógica ya documentada

## Agente de documentación / coordinación

Responsable de:

- revisar que ambos repos tengan la misma visión del proyecto
- mantener `docs/api-contract.md`, `docs/agent-roles.md`, `docs/coordinacion-agentes.md` y `docs/contract-sync.md` sincronizados
- dejar claro el estado global de bloques, decisiones y contexto para el siguiente agente

## Regla de coordinación

- Ambos agentes usan el mismo contrato de API.
- El backend no puede romper endpoints antiguos que ya existen.
- El frontend solo debe consumir lo definido en `docs/api-contract.md`.
- Cada bloque tiene una validación clara antes de pasar al siguiente.
- Si se modifica comportamiento o rutas, también se actualiza la documentación del mismo día.

## Bloque 1 objetivo

- crear y listar cuentas
- crear y listar transacciones
- listar categorías
- obtener resumen del dashboard
- conectar frontend con backend

## Bloque 5 objetivo

- preparar la capa de integración con n8n
- habilitar la sincronización de Open Banking
- añadir endpoints de programación e importación desde flujos automáticos

## Bloque 6 objetivo

- mostrar la sincronización desde la UI
- conectar la app con los endpoints de `bank-sync`, `transactions/import` y `sync-history`
- soportar fallback visual si la API no responde

## Bloque 7 objetivo

- consolidar el contexto del proyecto para los agentes
- mantener documentación viva y alineada con la lógica real
- asegurar que ambos repos aporten la misma información a futuros bloques
