// Interfaces y Tipos del Scene Graph
export * from './types/scene-graph.ts';

// Utilidades de Inmutabilidad, Geometría y Traversal
export * from './utils/immutable.ts';
export * from './utils/geometry.ts';
export * from './utils/cloneShape.ts';

// Gestor de Estado Inmutable
export * from './state/StateManager.ts';

// Inyección de Figuras de Prueba
export * from './state/injectSampleShapes.ts';

// Motor de Renderizado Canvas 2D
export * from './render/RenderEngine.ts';

// Controlador de Entrada e Interactividad
export * from './input/InputController.ts';

// Patrón Command e Historial de Deshacer / Rehacer
export * from './commands/Command.ts';
export * from './commands/CommandManager.ts';
export * from './commands/TranslateCommand.ts';
export * from './commands/ResizeCommand.ts';
export * from './commands/StyleCommand.ts';
export * from './commands/DeleteCommand.ts';
export * from './commands/AddShapeCommand.ts';
export * from './commands/RotateCommand.ts';
export * from './commands/PointCommand.ts';
export * from './commands/ReorderCommand.ts';

// Serialización y Exportación de Documentos
export * from './state/Serializer.ts';
