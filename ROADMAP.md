# Hoja de Ruta (Roadmap) - Vectedit

Este documento define la planificación estratégica y técnica para el desarrollo futuro de **Vectedit**. Establece las prioridades funcionales y arquitecturales organizadas por fases para expandir las capacidades del editor gráfico vectorial 2D interactivo.

---

## Estado Actual y Base Consolidada

A la fecha, el editor cuenta con una base sólida, modular y probada con **1080 tests unitarios**:

- **Arquitectura Inmutable**: Scene Graph (`Document > Layer > Group* > Shape`) bajo congelación profunda (`Object.freeze`) y persistencia estructural (`StateManager`).
- **Renderizado Reactivo**: Bucle *dirty-loop* en Canvas 2D nativo acoplado a `requestAnimationFrame`.
- **Historial Completo**: Deshacer/Rehacer mediante el patrón Command con soporte para transacciones compuestas (`BatchCommand`) y fusión temporal de micro-transformaciones (`mergeWith`).
- **Motor Bézier y Geometría**: Edición de anclas y tiradores (`corner`, `smooth`, `symmetric`), cálculo de AABB/OBB, matrices locales rotadas y operaciones booleanas (Unión, Intersección, Diferencia, Exclusión).
- **Herramientas**: Selección (`V`), Selección Directa (`A`), Mano (`H`), Pluma (`P`), Rectángulo (`R`), Elipse (`E`), Línea (`L`) y Texto (`T`).
- **Tipografía Avanzada**: Cajas de texto con salto automático (*box width*), tirador interactivo, interlineado (*line-height*) y espaciado de caracteres (*letter-spacing*).
- **Interoperabilidad**: Importación/Exportación SVG completa (soporte de gradientes `userSpaceOnUse` / `objectBoundingBox`, estilos CSS y multi-subtrazados), exportación ráster (PNG/WebP con escala 1x, 2x, 3x) y serialización JSON.

---

## Fases de Desarrollo Planificadas

### Fase 1: Herramientas Creativas Esenciales

El objetivo de esta fase es dotar al editor de herramientas interactivas estándar de creación y muestreo visual.

- [x] **1.1. Herramienta Lápiz / Pincel a mano alzada (Pencil Tool - `B` / `N`)**:
  - Captura continua de trazo libre sobre el canvas con ratón o stylus/touch.
  - Algoritmo de simplificación geométrica (Ramer-Douglas-Peucker) y ajuste de curvas suaves (interpolación Bézier cúbica o algoritmo de Chaikin).
  - Generación de un nodo `Path` estándar con puntos de ancla optimizados.
  - Historial reversible encapsulado en `AddShapeCommand`.

- [x] **1.2. Herramienta Cuentagotas (Eyedropper Tool - `I`)**:
  - Muestreo del color de relleno, borde o gradiente al hacer clic sobre cualquier figura del canvas.
  - Soporte de muestreo por inspección de propiedades del Scene Graph o lectura directa de píxeles (`ctx.getImageData`).
  - Aplicación automática a la figura activa o selección actual.

- [x] **1.3. Primitivas Paramétricas Adicionales (Polígono Regular y Estrella)**:
  - **Polígono regular**: Control dinámico de radio y cantidad de vértices ($n \ge 3$).
  - **Estrella**: Control de número de puntas, radio exterior y radio interior.
  - Controles visuales en el panel de propiedades para alterar los parámetros de la figura en vivo.

---

### Fase 2: Manipulación Vectorial Avanzada

El objetivo de esta fase es ampliar las capacidades de composición gráfica y modificación de trazados.

- [x] **2.1. Máscaras de Recorte (Clipping Masks / `clipPath`)**:
  - Capacidad de usar una figura o trazado superior como máscara delimitadora de un grupo o conjunto de figuras inferiores.
  - Renderizado mediante `ctx.clip()` en Canvas 2D nativo y exportación/importación correspondiente como `<clipPath>` en SVG.
  - Comandos dedicados para crear y liberar máscaras en el historial (`MakeClipMaskCommand`, `ReleaseClipMaskCommand`).

- [x] **2.2. Contornear Trazado (*Stroke to Path* / *Outline Stroke*)**:
  - Conversión de bordes y trazos abiertos o con grosor en trazados cerrados (`fill`).
  - Permite someter los trazos a operaciones booleanas (ej. restar una línea gruesa de un rectángulo).

- [x] **2.3. Redondeo de Esquinas en Vértices Arbitrarios (Corner Smoothing)**:
  - Tiradores de radio en vértices de trazados poligonales (no solo en primitivas `Rectangle`).
  - Generación matemática de arcos tangentes o curvas Bézier en cada vértice.

---

### Fase 3: Productividad y UX de Estudio

El objetivo de esta fase es optimizar el flujo de trabajo continuo, la precisión de diseño y la seguridad ante fallos.

- [x] **3.1. Reglas Graduadas y Guías de Usuario (Rulers & Guides)**:
  - Reglas horizontal y vertical en los bordes del canvas con escala métrica o en píxeles.
  - Marcador de posición del cursor en tiempo real sobre ambas reglas.
  - Posibilidad de arrastrar guías horizontales y verticales desde las reglas hacia la mesa de trabajo.
  - Imantación (*snapping*) de figuras a las guías de usuario con opción de bloquear/ocultar guías.

- [x] **3.2. Soporte Móvil Completo y Experiencia Táctil (Mobile & Touch UX)**:
  - **Fase 1 (Motor Táctil y Gestos)**: Soporte multitáctil nativo con `TouchGestureController`, *pinch-to-zoom* y paneo fluido con 2 dedos, *lift-off protection*, pulsación prolongada (*long-press*) con feedback háptico para menú contextual, doble toque (*double-tap*), hit-testing ampliado a 22px para manipulación precisa de tiradores con los dedos, y proxy invisible de teclado virtual para edición de texto sin zoom involuntario.
  - **Fase 2 (Viewport Seguro y Layout)**: Adaptación a `viewport-fit=cover`, soporte de muescas (*safe area insets* `env(safe-area-inset-*)`), supresión de *overscroll* elástico y eventos sintéticos duplicados de ratón.
  - **Fase 3 (Rediseño Responsivo de Interfaz)**: Header compacto con botón Hamburguesa (☰), cajón de navegación lateral *off-canvas* (`MobileNavigationController`), barra de herramientas inferior tipo *Bottom Dock* accesible al pulgar, panel de propiedades como *Bottom Sheet* emergente que solo se despliega a petición explícita mediante el botón "Panel", y ocultamiento automático de reglas y barra de estado en pantallas `< 600px`.

- [x] **3.3. Persistencia y Autoguardado Local (Auto-Save & Recovery)**:
  - Guardado en segundo plano en `IndexedDB` o `LocalStorage` ante cada mutación o por intervalos temporales (debounce).
  - Detección y diálogo de restauración automática de sesión si la pestaña se cierra o recarga accidentalmente.

- [x] **3.4. Múltiples Mesas de Trabajo (Multi-Artboards)**:
  - Soporte en el Scene Graph para definir múltiples lienzos de trabajo independientes (`Artboard`).
  - Herramienta para crear, redimensionar y nombrar mesas de trabajo.
  - Exportación individual o en lote por mesa de trabajo.

---

### Fase 4: Rendimiento y Optimización a Gran Escala

El objetivo de esta fase es garantizar fluidez a 60 FPS en documentos con miles de elementos complejos.

- [x] **4.1. Indexación Espacial (R-Tree / BVH)**:
  - Estructura de aceleración espacial para búsqueda de colisiones y *hit-testing* en tiempo $O(\log n)$ en lugar de $O(n)$ lineal.
  - Actualización incremental de AABBs al transformar nodos.

- [ ] **4.2. Caching de Capas en OffscreenCanvas**:
  - Rasterización temporal de grupos o capas estáticas en lienzos fuera de pantalla para acelerar el redibujado durante navegación (pan/zoom).

---

## Criterios de Implementación y Reglas de Calidad

Cualquier funcionalidad añadida a través de esta hoja de ruta debe cumplir estrictamente con los principios arquitecturales del proyecto:

1. **Inmutabilidad**: Jamás mutar el árbol de escena directamente; canalizar todo cambio a través de `StateManager`.
2. **Historial Atómico**: Toda acción interactiva debe tener su correspondiente `Command` registrable en `CommandManager` (o encapsulado en `BatchCommand` si involucra múltiples elementos).
3. **Desacoplamiento DOM / Canvas**: La lógica matemática y de estado no debe manipular el DOM directamente; la interfaz se conecta mediante observabilidad en `setupUIBindings`.
4. **Verificación Automatizada**: Toda nueva herramienta o utilidad matemática debe acompañarse de su suite de tests unitarios en `test/` ejecutables con `npm test`.
