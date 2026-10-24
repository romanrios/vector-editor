// Interfaces y Tipos del Scene Graph
export * from './types/scene-graph.ts';
export * from './types/engine.ts';

// Utilidades de Inmutabilidad, Geometría y Traversal
export * from './utils/immutable.ts';
export * from './utils/geometry.ts';
export * from './utils/transform.ts';
export * from './utils/cloneShape.ts';
export * from './utils/viewport.ts';
export * from './utils/color.ts';

// Gestor de Estado Inmutable
export * from './state/StateManager.ts';

// Aceleración Espacial e Indexación (R-Tree / BVH)
export * from './spatial/RTree.ts';
export * from './spatial/SpatialIndex.ts';

// Inyección de Figuras de Prueba
export * from './state/injectSampleShapes.ts';
export * from './state/defaultDocument.ts';

// Motor de Renderizado Canvas 2D
export * from './render/RenderEngine.ts';

// Controlador de Entrada e Interactividad
export * from './input/InputController.ts';
export * from './input/TextEditManager.ts';
export * from './input/tools/ToolHandler.ts';
export * from './input/tools/SelectToolHandler.ts';
export * from './input/tools/PenToolHandler.ts';
export * from './input/tools/DirectSelectToolHandler.ts';
export * from './input/tools/CreationToolHandler.ts';
export * from './input/tools/LineToolHandler.ts';
export * from './input/tools/TextToolHandler.ts';
export * from './input/tools/PencilToolHandler.ts';
export * from './input/tools/EyedropperToolHandler.ts';
export * from './input/tools/ArtboardToolHandler.ts';

export * from './utils/booleanOperations.ts';

// Patrón Command e Historial de Deshacer / Rehacer
export * from './commands/Command.ts';
export * from './commands/CommandManager.ts';
export * from './commands/TranslateCommand.ts';
export * from './commands/ResizeCommand.ts';
export * from './commands/TransformShapesCommand.ts';
export * from './commands/StyleCommand.ts';
export * from './commands/StyleShapesCommand.ts';
export * from './commands/DeleteCommand.ts';
export * from './commands/AddShapeCommand.ts';
export * from './commands/CreateTextCommand.ts';
export * from './commands/RotateCommand.ts';
export * from './commands/PointCommand.ts';
export * from './commands/ReorderCommand.ts';
export * from './commands/BatchCommand.ts';
export * from './commands/GroupCommand.ts';
export * from './commands/UngroupCommand.ts';
export * from './commands/UpdateTextCommand.ts';
export * from './commands/UpdateTextTypographyCommand.ts';
export * from './commands/UpdateParametricShapeCommand.ts';
export * from './commands/SetVisibilityCommand.ts';
export * from './commands/SetLockedCommand.ts';
export * from './commands/MoveStepCommand.ts';
export * from './commands/MoveNodeCommand.ts';
export * from './commands/AddLayerCommand.ts';
export * from './commands/DeleteLayerCommand.ts';
export * from './commands/RenameNodeCommand.ts';
export * from './commands/InsertPathPointCommand.ts';
export * from './commands/DeletePathPointCommand.ts';
export * from './commands/UpdatePathPointTypeCommand.ts';
export * from './commands/BooleanOperationCommand.ts';
export * from './commands/MakeClipMaskCommand.ts';
export * from './commands/ReleaseClipMaskCommand.ts';
export * from './commands/OutlineStrokeCommand.ts';
export * from './commands/AddGuideCommand.ts';
export * from './commands/RemoveGuideCommand.ts';
export * from './commands/MoveGuideCommand.ts';
export * from './commands/ClearGuidesCommand.ts';
export * from './commands/AddArtboardCommand.ts';
export * from './commands/DeleteArtboardCommand.ts';
export * from './commands/UpdateArtboardCommand.ts';
export * from './utils/strokeToPath.ts';
export * from './utils/cornerSmoothing.ts';

// Serialización y Exportación de Documentos
export * from './state/Serializer.ts';
export * from './utils/exportSvg.ts';
export * from './utils/exportRaster.ts';
