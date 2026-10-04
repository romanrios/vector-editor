/**
 * Tipos de nodos admitidos en el Scene Graph
 */
export type NodeType = 'document' | 'layer' | 'rectangle' | 'ellipse' | 'path';

/**
 * Punto o vector bidimensional
 */
export interface Vector2D {
  readonly x: number;
  readonly y: number;
}

/**
 * Punto de ancla para un trazado con puntos de control Bézier cúbicos opcionales
 */
export interface PathPoint {
  readonly x: number;
  readonly y: number;
  readonly handleIn?: Vector2D;
  readonly handleOut?: Vector2D;
}

/**
 * Propiedades geométricas y visuales para nodos de tipo Path (trazados vectoriales de Bézier)
 */
export interface Path extends BaseNode {
  readonly type: 'path';
  readonly x: number;
  readonly y: number;
  readonly points: readonly PathPoint[];
  readonly closed?: boolean;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly rotation?: number;
  readonly opacity?: number;
}

/**
 * Propiedades base compartidas por todos los nodos del árbol
 */
export interface BaseNode {
  readonly id: string;
  readonly type: NodeType;
  readonly name: string;
  readonly visible?: boolean;
  readonly locked?: boolean;
  readonly zIndex?: number;
}

/**
 * Axis-Aligned Bounding Box (caja delimitadora alineada con los ejes)
 */
export interface AABB {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Propiedades geométricas y visuales para nodos de tipo Rectangle
 */
export interface Rectangle extends BaseNode {
  readonly type: 'rectangle';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly cornerRadius?: number;
  readonly rotation?: number;
  readonly opacity?: number;
}

/**
 * Propiedades geométricas y visuales para nodos de tipo Ellipse
 */
export interface Ellipse extends BaseNode {
  readonly type: 'ellipse';
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly rotation?: number;
  readonly opacity?: number;
}

/**
 * Tipo discriminado para cualquier figura (Shape)
 */
export type Shape = Rectangle | Ellipse | Path;

/**
 * Nodo contenedor Layer (capa), que alberga una colección de figuras (Shape)
 */
export interface Layer extends BaseNode {
  readonly type: 'layer';
  readonly opacity?: number;
  readonly children: readonly Shape[];
}

/**
 * Nodo raíz Document, que alberga una colección de capas (Layer) y metadatos del lienzo
 */
export interface Document extends BaseNode {
  readonly type: 'document';
  readonly width: number;
  readonly height: number;
  readonly children: readonly Layer[];
}

/**
 * Unión de todos los nodos que pueden existir en el Scene Graph
 */
export type SceneNode = Document | Layer | Shape;

/**
 * Nodos contenedores con hijos en el Scene Graph
 */
export type ParentNode = Document | Layer;

/**
 * Nodos que pueden ser hijos de algún contenedor
 */
export type ChildNode = Layer | Shape;

// Alias descriptivos para conveniencia
export type DocumentNode = Document;
export type LayerNode = Layer;
export type ShapeNode = Shape;
export type RectangleNode = Rectangle;
export type EllipseNode = Ellipse;
export type PathNode = Path;

/**
 * Funciones de guardia de tipos (Type Guards)
 */
export function isDocument(node: SceneNode): node is Document {
  return node.type === 'document';
}

export function isLayer(node: SceneNode): node is Layer {
  return node.type === 'layer';
}

export function isShape(node: SceneNode): node is Shape {
  return node.type === 'rectangle' || node.type === 'ellipse' || node.type === 'path';
}

export function isRectangle(node: SceneNode): node is Rectangle {
  return node.type === 'rectangle';
}

export function isEllipse(node: SceneNode): node is Ellipse {
  return node.type === 'ellipse';
}

export function isPath(node: SceneNode): node is Path {
  return node.type === 'path';
}
