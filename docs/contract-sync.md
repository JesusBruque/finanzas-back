# Sincronización de contrato

## Regla obligatoria

- Todo cambio del contrato de la API debe hacerse en el archivo base del backend: `docs/api-contract.md`.
- Cuando se actualiza ese contrato, el frontend debe reflejarlo en `finanzas/docs/api-contract.md`.
- El cambio se considera válido solo cuando ambos repos tienen el mismo contenido.
- Las decisiones de bloques, endpoints y ejemplos deben replicarse en `docs/agent-roles.md`, `docs/coordinacion-agentes.md` y cualquier documento de contexto relevante.

## Procedimiento

1. Modificar o ampliar el contrato en el backend.
2. Reflotar el mismo contenido en el frontend.
3. Actualizar la documentación de roles y coordinación.
4. Validar que ambos repos son idénticos y que el contexto del bloque queda reflejado.
5. Continuar con la siguiente fase del bloque.

## Bloques activos

- Bloque 1: cuentas, categorías, transacciones, dashboard
- Bloque 5: n8n + Open Banking + sincronización
- Bloque 6: UI y experiencia de sincronización
- Bloque 7: gobernanza documental y contexto para agentes

## Checklist del bloque 7

- El contrato del backend está actualizado.
- El frontend refleja exactamente ese contrato.
- Los roles del equipo describen las responsabilidades actuales.
- La coordinación del bloque deja claro qué se ha implementado y qué queda pendiente.
- La documentación sirve como memoria de proyecto para el siguiente agente.
