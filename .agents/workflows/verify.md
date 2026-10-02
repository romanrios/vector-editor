# Workflow: Verificación de Código

Ejecuta la comprobación estática de tipos con `tsc` y la suite de pruebas:

```bash
npx tsc --noEmit; npm test
```

Si se produce algún fallo:
1. Revisa la salida del comando e identifica el archivo afectado y la línea exacta.
2. Resume el motivo del fallo (error de tipos TS o aserción de test no cumplida).
3. Corrige el código respetando las reglas de `AGENTS.md` y repite este workflow.
