/**
 * Tipos de nodos admitidos en el Scene Graph
 */
export type NodeType = 'document' | 'layer' | 'group' | 'rectangle' | 'ellipse' | 'path' | 'text';

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
 * Alineación horizontal para nodos de texto
 */
export type TextAlign = 'left' | 'center' | 'right';

/**
 * Estilo tipográfico para nodos de texto
 */
export type FontStyle = 'normal' | 'italic';

/**
 * Peso o grosor tipográfico para nodos de texto
 */
export type FontWeight = 'normal' | 'bold' | string | number;

/**
 * Propiedades geométricas, tipográficas y visuales para nodos de tipo Text (texto de punto)
 */
export interface Text extends BaseNode {
  readonly type: 'text';
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: FontWeight;
  readonly fontStyle?: FontStyle;
  readonly textAlign?: TextAlign;
  readonly fill?: string;
  readonly rotation?: number;
  readonly opacity?: number;
}

/**
 * Tipo discriminado para cualquier figura (Shape)
 */
export type Shape = Rectangle | Ellipse | Path | Text;

/**
 * Nodo contenedor Group (grupo), que alberga una colección de figuras y/o subgrupos
 * sin transformación propia (coordenadas absolutas en sus descendientes).
 */
export interface Group extends BaseNode {
  readonly type: 'group';
  readonly opacity?: number;
  readonly children: readonly LayerChildNode[];
}

/**
 * Nodos que pueden ser hijos directos de una Capa o de un Grupo
 */
export type LayerChildNode = Shape | Group;

/**
 * Nodos que admiten ser seleccionados en el editor (figuras o grupos)
 */
export type SelectableNode = Shape | Group;

/**
 * Nodo contenedor Layer (capa), que alberga una colección de figuras y grupos
 */
export interface Layer extends BaseNode {
  readonly type: 'layer';
  readonly opacity?: number;
  readonly children: readonly LayerChildNode[];
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
export type SceneNode = Document | Layer | LayerChildNode;

/**
 * Nodos contenedores con hijos en el Scene Graph
 */
export type ParentNode = Document | Layer | Group;

/**
 * Nodos que pueden ser hijos de algún contenedor
 */
export type ChildNode = Layer | LayerChildNode;

// Alias descriptivos para conveniencia
export type DocumentNode = Document;
export type LayerNode = Layer;
export type GroupNode = Group;
export type ShapeNode = Shape;
export type RectangleNode = Rectangle;
export type EllipseNode = Ellipse;
export type PathNode = Path;
export type TextNode = Text;

/**
 * Funciones de guardia de tipos (Type Guards)
 */
export function isDocument(node: SceneNode): node is Document {
  return node.type === 'document';
}

export function isLayer(node: SceneNode): node is Layer {
  return node.type === 'layer';
}

export function isGroup(node: SceneNode): node is Group {
  return node.type === 'group';
}

export function isShape(node: SceneNode): node is Shape {
  return (
    node.type === 'rectangle' ||
    node.type === 'ellipse' ||
    node.type === 'path' ||
    node.type === 'text'
  );
}

export function isSelectable(node: SceneNode): node is SelectableNode {
  return isShape(node) || isGroup(node);
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

export function isText(node: SceneNode): node is Text {
  return node.type === 'text';
}
