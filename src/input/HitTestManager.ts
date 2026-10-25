import type { StateManager } from '../state/StateManager.ts';
import {
  isGroup,
  isLayer,
  isShape,
  type Group,
  type LayerChildNode,
  type Path,
  type SelectableNode,
  type Shape,
} from '../types/scene-graph.ts';
import {
  isPointInPath,
  isPointInShape,
  isPointInText,
} from '../utils/geometry.ts';

export class HitTestManager {
  private readonly stateManager: StateManager;
  private readonly getIsTouch: () => boolean;

  constructor(stateManager: StateManager, getIsTouch: () => boolean) {
    this.stateManager = stateManager;
    this.getIsTouch = getIsTouch;
  }

  public hitTestNode(
    node: LayerChildNode,
    x: number,
    y: number,
    ctx: CanvasRenderingContext2D | null,
    zoom: number,
    activeTextEdit?: { textId: string; currentText: string } | null
  ): Shape | null {
    if (node.visible === false || node.locked === true) {
      return null;
    }

    if (isGroup(node)) {
      if (node.isClipMask) {
        const maskShape = node.clipChildId
          ? node.children.find((c) => c.id === node.clipChildId)
          : node.children[node.children.length - 1];
        if (maskShape && isShape(maskShape)) {
          let insideMask = false;
          if (maskShape.type === 'path') {
            insideMask = isPointInPath(x, y, maskShape as Path, ctx, 8 / zoom);
          } else {
            insideMask = isPointInShape(x, y, maskShape, 4 / zoom);
          }
          if (!insideMask) {
            return null;
          }
        }
      }

      for (let i = node.children.length - 1; i >= 0; i--) {
        const hit = this.hitTestNode(node.children[i], x, y, ctx, zoom, activeTextEdit);
        if (hit) {
          return hit;
        }
      }
      return null;
    }

    const isTouch = this.getIsTouch();

    if (isShape(node)) {
      if (node.type === 'path') {
        const tolerance = (isTouch ? 20 : 8) / zoom;
        if (isPointInPath(x, y, node as Path, ctx, tolerance)) {
          return node;
        }
      } else if (node.type === 'text') {
        const tolerance = (isTouch ? 16 : 4) / zoom;
        const currentText =
          activeTextEdit && activeTextEdit.textId === node.id
            ? activeTextEdit.currentText
            : node.text;
        const effectiveText = {
          ...node,
          text: currentText.length > 0 ? currentText : ' ',
        };
        if (isPointInText(x, y, effectiveText, tolerance, ctx)) {
          return node;
        }
      } else {
        const tolerance = (isTouch ? 16 : 4) / zoom;
        if (isPointInShape(x, y, node, tolerance)) {
          return node;
        }
      }
    }

    return null;
  }

  public getOutermostGroupOrSelf(node: SelectableNode): SelectableNode {
    let current: SelectableNode = node;
    while (true) {
      const parent = this.stateManager.findParent(current.id);
      if (parent && isGroup(parent)) {
        current = parent;
      } else {
        break;
      }
    }
    return current;
  }

  public findDirectChildInGroup(group: Group, target: SelectableNode): SelectableNode | null {
    let current: SelectableNode = target;
    while (true) {
      const parent = this.stateManager.findParent(current.id);
      if (!parent) return null;
      if (parent.id === group.id) {
        return current;
      }
      if (isLayer(parent) || !isGroup(parent)) {
        return null;
      }
      current = parent;
    }
  }

  public resolveNodeToSelect(hitShape: Shape): SelectableNode {
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1) {
      const currentSelected = selectedNodes[0];
      const parent = this.stateManager.findParent(currentSelected.id);
      if (parent && isGroup(parent)) {
        const directChild = this.findDirectChildInGroup(parent, hitShape);
        if (directChild) {
          return directChild;
        }
      }
    }
    return this.getOutermostGroupOrSelf(hitShape);
  }
}
