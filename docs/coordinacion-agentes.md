# Coordinación de agentes - contexto global

## Agente de backend

Responsabilidades:

- Definir y crear modelos de `Account`, `Category` y `Transaction`
- Crear endpoints CRUD mínimos
- Guardar datos persistentes
- Proveer JSON consistente
- No introducir nombres raros o campos no acordados
- Implementar la integración con flujos de n8n y Open Banking
- Mantener documentación y contrato actualizados

## Agente de frontend

Responsabilidades:

- Mostrar resumen del saldo
- Mostrar lista de transacciones
- Crear formulario para añadir gasto o ingreso
- Consumir la API del backend con la estructura compartida
- No asumir un formato que no esté definido en el contrato
- Integrar botones y estados de sincronización para Open Banking
- Usar fallback local solo si la API no está disponible

## Regla de coordinación

Se trabaja por contrato, no por improvisación:

1. Se define o actualiza la entidad o endpoint.
2. Se documenta el cambio en el contrato compartido.
3. Se implementa la parte correspondiente.
4. Se valida la integración.
5. Se pasa al siguiente bloque.
6. Si el comportamiento cambia, la documentación se actualiza en el mismo ciclo.

## Estado de bloques

### Bloque 1

- Cuenta principal
- Categorías base
- Transacciones
- Resumen mensual
- Formulario manual

### Bloque 5

- Open Banking
- n8n
- sincronización programada
- importación automática de transacciones

### Bloque 6

- UI de sincronización
- historial de sincronización
- integración visual desde frontend

### Bloque 7

- gobernanza de documentación
- sincronización de contexto entre repos
- alineación de reglas para futuros agentes

## Reglas obligatorias del proyecto

- La documentación no es opcional; es parte del producto.
- Los cambios de API deben reflejarse tanto en backend como en frontend.
- Cuando se crea un bloque nuevo, se actualiza el contrato antes de seguir.
- Los agentes deben basarse en la documentación viva y no en suposiciones.
