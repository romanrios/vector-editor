/**
 * Tipos de nodos admitidos en el Scene Graph
 */
export type NodeType = 'document' | 'layer' | 'group' | 'rectangle' | 'ellipse' | 'path' | 'text' | 'image' | 'polygon' | 'star';

/**
 * Punto o vector bidimensional
 */
export interface Vector2D {
  readonly x: number;
  readonly y: number;
}

/**
 * Modo o tipo de vértice para un punto de ancla de un trazado Bézier:
 * - 'corner': Manejadores independientes en ángulo y magnitud.
 * - 'smooth': Manejadores colineales (180° opuestos) con longitudes independientes.
 * - 'symmetric': Manejadores colineales de idéntica longitud.
 */
export type PathPointType = 'corner' | 'smooth' | 'symmetric';

/**
 * Punto de ancla para un trazado con puntos de control Bézier cúbicos opcionales
 */
export interface PathPoint {
  readonly x: number;
  readonly y: number;
  readonly handleIn?: Vector2D;
  readonly handleOut?: Vector2D;
  readonly pointType?: PathPointType;
  readonly moveTo?: boolean;
  readonly closeSubpath?: boolean;
  readonly cornerRadius?: number;
}

/**
 * Parada de color (stop) dentro de un degradado
 */
export interface GradientStop {
  readonly id: string;
  readonly offset: number; // Normalizado en el rango [0, 1]
  readonly color: string;
  readonly opacity?: number; // Normalizado en el rango [0, 1]
}

/**
 * Degradado lineal definido en coordenadas relativas/normalizadas [0, 1] de la caja base de la figura
 */
export interface LinearGradient {
  readonly type: 'linear';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly stops: readonly GradientStop[];
}

/**
 * Degradado radial definido en coordenadas relativas/normalizadas [0, 1] de la caja base de la figura
 */
export interface RadialGradient {
  readonly type: 'radial';
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly fx?: number;
  readonly fy?: number;
  readonly stops: readonly GradientStop[];
}

/**
 * Unión de tipos de degradados soportados
 */
export type Gradient = LinearGradient | RadialGradient;

/**
 * Tipo universal de pintura para rellenos y contornos (color sólido hex/css, degradado o 'none')
 */
export type FillType = string | Gradient;

/**
 * Propiedades geométricas y visuales para nodos de tipo Path (trazados vectoriales de Bézier)
 */
export interface Path extends BaseNode {
  readonly type: 'path';
  readonly x: number;
  readonly y: number;
  readonly points: readonly PathPoint[];
  readonly closed?: boolean;
  readonly fill?: FillType;
  readonly stroke?: FillType;
  readonly strokeWidth?: number;
  readonly rotation?: number;
  readonly opacity?: number;
  readonly fillRule?: 'nonzero' | 'evenodd';
  readonly cornerRadius?: number;
}

/**
 * Estilos de terminación de línea (cap)
 */
export type StrokeLineCap = 'butt' | 'round' | 'square';

/**
 * Estilos de unión de esquinas de línea (join)
 */
export type StrokeLineJoin = 'miter' | 'round' | 'bevel';

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
  readonly strokeDashArray?: readonly number[];
  readonly strokeLineCap?: StrokeLineCap;
  readonly strokeLineJoin?: StrokeLineJoin;
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
  readonly fill?: FillType;
  readonly stroke?: FillType;
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
  readonly fill?: FillType;
  readonly stroke?: FillType;
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
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly fill?: FillType;
  readonly stroke?: FillType;
  readonly strokeWidth?: number;
  readonly rotation?: number;
  readonly opacity?: number;
  readonly boxWidth?: number;
}

/**
 * Datos y metadatos de un recurso de medios externo (imagen raster o vector) almacenado
 * a nivel de documento para evitar redundancia y copias pesadas en memoria al clonar nodos.
 */
export interface AssetData {
  readonly id: string;
  readonly mimeType: string;
  readonly data: string; // Data-URL (base64) o URL accesible
  readonly width: number;
  readonly height: number;
}

/**
 * Propiedades geométricas y visuales para nodos de tipo Image (imágenes colocadas en el lienzo)
 */
export interface ImageNode extends BaseNode {
  readonly type: 'image';
  readonly assetId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly naturalWidth?: number;
  readonly naturalHeight?: number;
  readonly rotation?: number;
  readonly opacity?: number;
  readonly fill?: FillType;
  readonly stroke?: FillType;
  readonly strokeWidth?: number;
}

/**
 * Propiedades geométricas y visuales para nodos de tipo Polygon (polígono regular)
 */
export interface Polygon extends BaseNode {
  readonly type: 'polygon';
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly sides: number;
  readonly fill?: FillType;
  readonly stroke?: FillType;
  readonly strokeWidth?: number;
  readonly rotation?: number;
  readonly opacity?: number;
  readonly cornerRadius?: number;
}

/**
 * Propiedades geométricas y visuales para nodos de tipo Star (estrella regular)
 */
export interface Star extends BaseNode {
  readonly type: 'star';
  readonly x: number;
  readonly y: number;
  readonly points: number;
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly fill?: FillType;
  readonly stroke?: FillType;
  readonly strokeWidth?: number;
  readonly rotation?: number;
  readonly opacity?: number;
  readonly cornerRadius?: number;
  readonly innerCornerRadius?: number;
}

/**
 * Tipo discriminado para cualquier figura (Shape)
 */
export type Shape = Rectangle | Ellipse | Path | Text | ImageNode | Polygon | Star;

/**
 * Nodo contenedor Group (grupo), que alberga una colección de figuras y/o subgrupos
 * sin transformación propia (coordenadas absolutas en sus descendientes).
 */
export interface Group extends BaseNode {
  readonly type: 'group';
  readonly opacity?: number;
  readonly isClipMask?: boolean;
  readonly clipChildId?: string;
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
 * Nodo raíz Document, que alberga una colección de capas (Layer), activos multimedia y metadatos del lienzo
 */
export interface Document extends BaseNode {
  readonly type: 'document';
  readonly width: number;
  readonly height: number;
  readonly children: readonly Layer[];
  readonly assets?: Readonly<Record<string, AssetData>>;
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
export type PolygonNode = Polygon;
export type StarNode = Star;

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

export function isClipMaskGroup(node: SceneNode): node is Group & { isClipMask: true } {
  return isGroup(node) && node.isClipMask === true;
}

export function isShape(node: SceneNode): node is Shape {
  return (
    node.type === 'rectangle' ||
    node.type === 'ellipse' ||
    node.type === 'path' ||
    node.type === 'text' ||
    node.type === 'image' ||
    node.type === 'polygon' ||
    node.type === 'star'
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

export function isImage(node: SceneNode): node is ImageNode {
  return node.type === 'image';
}

export function isPolygon(node: SceneNode): node is Polygon {
  return node.type === 'polygon';
}

export function isStar(node: SceneNode): node is Star {
  return node.type === 'star';
}

export function isGradient(val: unknown): val is Gradient {
  if (typeof val !== 'object' || val === null) {
    return false;
  }
  const type = (val as { type?: unknown }).type;
  return type === 'linear' || type === 'radial';
}

export function isLinearGradient(val: unknown): val is LinearGradient {
  return isGradient(val) && val.type === 'linear';
}

export function isRadialGradient(val: unknown): val is RadialGradient {
  return isGradient(val) && val.type === 'radial';
}

