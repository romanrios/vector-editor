import type { StateManager } from '../../state/StateManager.ts';
import type { CommandManager } from '../../commands/CommandManager.ts';
import { UpdateParametricShapeCommand } from '../../commands/UpdateParametricShapeCommand.ts';
import {
  isPolygon,
  isStar,
  type Polygon,
  type Star,
} from '../../types/scene-graph.ts';
import type { PropertiesPanelElements, ParametricShapeSnapshot } from './types.ts';

export class ParametricSectionController {
  private initialParametricShapeSnapshot: ParametricShapeSnapshot | null = null;
  private readonly roundToFourDecimals = (value: number): number => Number(value.toFixed(4));

  private readonly stateManager: StateManager;
  private readonly commandManager: CommandManager;
  private readonly elements: PropertiesPanelElements;

  constructor(
    stateManager: StateManager,
    commandManager: CommandManager,
    elements: PropertiesPanelElements
  ) {
    this.stateManager = stateManager;
    this.commandManager = commandManager;
    this.elements = elements;
  }


  public captureInitialParametricShape(): void {
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1) {
      const node = selectedNodes[0];
      if (isPolygon(node)) {
        this.initialParametricShapeSnapshot = {
          sides: node.sides,
          radius: node.radius,
        };
        return;
      }
      if (isStar(node)) {
        this.initialParametricShapeSnapshot = {
          points: node.points,
          outerRadius: node.outerRadius,
          innerRadius: node.innerRadius,
        };
        return;
      }
    }
    this.initialParametricShapeSnapshot = null;
  }

  public clearSnapshot(): void {
    this.initialParametricShapeSnapshot = null;
  }


  private onPolygonSidesFocus = () => this.captureInitialParametricShape();
  private onPolygonSidesInput = () => {
    if (!this.elements.inputPolygonSides) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isPolygon(selectedNodes[0])) {
      const node = selectedNodes[0];
      if (!this.initialParametricShapeSnapshot) this.captureInitialParametricShape();
      const parsed = parseInt(this.elements.inputPolygonSides.value, 10);
      if (!isNaN(parsed) && parsed >= 3) {
        this.stateManager.updateShape<Polygon>(node.id, { sides: Math.min(100, parsed) });
      }
    }
  };
  private onPolygonSidesChange = () => {
    if (!this.elements.inputPolygonSides) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isPolygon(selectedNodes[0])) {
      const node = selectedNodes[0];
      const parsed = parseInt(this.elements.inputPolygonSides.value, 10);
      const after = isNaN(parsed) || parsed < 3 ? 3 : Math.min(100, parsed);
      this.elements.inputPolygonSides.value = String(after);
      const before = this.initialParametricShapeSnapshot?.sides ?? node.sides ?? 5;
      this.stateManager.updateShape<Polygon>(node.id, { sides: after });
      if (before !== after) {
        const cmd = new UpdateParametricShapeCommand(this.stateManager, node.id, { sides: before }, { sides: after });
        this.commandManager.recordCommand(cmd);
      }
      this.initialParametricShapeSnapshot = null;
    }
  };

  private onPolygonRadiusFocus = () => this.captureInitialParametricShape();
  private onPolygonRadiusInput = () => {
    if (!this.elements.inputPolygonRadius) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isPolygon(selectedNodes[0])) {
      const node = selectedNodes[0];
      if (!this.initialParametricShapeSnapshot) this.captureInitialParametricShape();
      const parsed = parseFloat(this.elements.inputPolygonRadius.value);
      if (!isNaN(parsed) && parsed > 0) {
        this.stateManager.updateShape<Polygon>(node.id, { radius: parsed });
      }
    }
  };
  private onPolygonRadiusChange = () => {
    if (!this.elements.inputPolygonRadius) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isPolygon(selectedNodes[0])) {
      const node = selectedNodes[0];
      const parsed = parseFloat(this.elements.inputPolygonRadius.value);
      const after = isNaN(parsed) || parsed < 1 ? 10 : this.roundToFourDecimals(parsed);
      this.elements.inputPolygonRadius.value = String(after);
      const before = this.initialParametricShapeSnapshot?.radius ?? node.radius ?? 50;
      this.stateManager.updateShape<Polygon>(node.id, { radius: after });
      if (before !== after) {
        const cmd = new UpdateParametricShapeCommand(this.stateManager, node.id, { radius: before }, { radius: after });
        this.commandManager.recordCommand(cmd);
      }
      this.initialParametricShapeSnapshot = null;
    }
  };

  private onStarPointsFocus = () => this.captureInitialParametricShape();
  private onStarPointsInput = () => {
    if (!this.elements.inputStarPoints) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isStar(selectedNodes[0])) {
      const node = selectedNodes[0];
      if (!this.initialParametricShapeSnapshot) this.captureInitialParametricShape();
      const parsed = parseInt(this.elements.inputStarPoints.value, 10);
      if (!isNaN(parsed) && parsed >= 3) {
        this.stateManager.updateShape<Star>(node.id, { points: Math.min(100, parsed) });
      }
    }
  };
  private onStarPointsChange = () => {
    if (!this.elements.inputStarPoints) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isStar(selectedNodes[0])) {
      const node = selectedNodes[0];
      const parsed = parseInt(this.elements.inputStarPoints.value, 10);
      const after = isNaN(parsed) || parsed < 3 ? 3 : Math.min(100, parsed);
      this.elements.inputStarPoints.value = String(after);
      const before = this.initialParametricShapeSnapshot?.points ?? node.points ?? 5;
      this.stateManager.updateShape<Star>(node.id, { points: after });
      if (before !== after) {
        const cmd = new UpdateParametricShapeCommand(this.stateManager, node.id, { points: before }, { points: after });
        this.commandManager.recordCommand(cmd);
      }
      this.initialParametricShapeSnapshot = null;
    }
  };

  private onStarOuterRadiusFocus = () => this.captureInitialParametricShape();
  private onStarOuterRadiusInput = () => {
    if (!this.elements.inputStarOuterRadius) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isStar(selectedNodes[0])) {
      const node = selectedNodes[0];
      if (!this.initialParametricShapeSnapshot) this.captureInitialParametricShape();
      const parsed = parseFloat(this.elements.inputStarOuterRadius.value);
      if (!isNaN(parsed) && parsed > 0) {
        this.stateManager.updateShape<Star>(node.id, { outerRadius: parsed });
      }
    }
  };
  private onStarOuterRadiusChange = () => {
    if (!this.elements.inputStarOuterRadius) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isStar(selectedNodes[0])) {
      const node = selectedNodes[0];
      const parsed = parseFloat(this.elements.inputStarOuterRadius.value);
      const after = isNaN(parsed) || parsed < 1 ? 50 : this.roundToFourDecimals(parsed);
      this.elements.inputStarOuterRadius.value = String(after);
      const before = this.initialParametricShapeSnapshot?.outerRadius ?? node.outerRadius ?? 50;
      this.stateManager.updateShape<Star>(node.id, { outerRadius: after });
      if (before !== after) {
        const cmd = new UpdateParametricShapeCommand(this.stateManager, node.id, { outerRadius: before }, { outerRadius: after });
        this.commandManager.recordCommand(cmd);
      }
      this.initialParametricShapeSnapshot = null;
    }
  };

  private onStarInnerRadiusFocus = () => this.captureInitialParametricShape();
  private onStarInnerRadiusInput = () => {
    if (!this.elements.inputStarInnerRadius) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isStar(selectedNodes[0])) {
      const node = selectedNodes[0];
      if (!this.initialParametricShapeSnapshot) this.captureInitialParametricShape();
      const parsed = parseFloat(this.elements.inputStarInnerRadius.value);
      if (!isNaN(parsed) && parsed > 0) {
        this.stateManager.updateShape<Star>(node.id, { innerRadius: parsed });
      }
    }
  };
  private onStarInnerRadiusChange = () => {
    if (!this.elements.inputStarInnerRadius) return;
    const selectedNodes = this.stateManager.getSelectedNodes();
    if (selectedNodes.length === 1 && isStar(selectedNodes[0])) {
      const node = selectedNodes[0];
      const parsed = parseFloat(this.elements.inputStarInnerRadius.value);
      const after = isNaN(parsed) || parsed < 1 ? 25 : this.roundToFourDecimals(parsed);
      this.elements.inputStarInnerRadius.value = String(after);
      const before = this.initialParametricShapeSnapshot?.innerRadius ?? node.innerRadius ?? 25;
      this.stateManager.updateShape<Star>(node.id, { innerRadius: after });
      if (before !== after) {
        const cmd = new UpdateParametricShapeCommand(this.stateManager, node.id, { innerRadius: before }, { innerRadius: after });
        this.commandManager.recordCommand(cmd);
      }
      this.initialParametricShapeSnapshot = null;
    }
  };

  public sync(singlePolygonNode: Polygon | null, singleStarNode: Star | null): void {
    const isSinglePolygonSelected = singlePolygonNode !== null;
    const isSingleStarSelected = singleStarNode !== null;

    if (this.elements.sectionPolygon) {
      this.elements.sectionPolygon.style.display = isSinglePolygonSelected ? 'block' : 'none';
    }
    if (this.elements.sectionStar) {
      this.elements.sectionStar.style.display = isSingleStarSelected ? 'block' : 'none';
    }

    if (isSinglePolygonSelected && singlePolygonNode) {
      const isParamEditing = this.initialParametricShapeSnapshot !== null;
      if (this.elements.inputPolygonSides && (!isParamEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.inputPolygonSides))) {
        this.elements.inputPolygonSides.value = String(singlePolygonNode.sides);
      }
      if (this.elements.inputPolygonRadius && (!isParamEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.inputPolygonRadius))) {
        this.elements.inputPolygonRadius.value = String(this.roundToFourDecimals(singlePolygonNode.radius));
      }
    }

    if (isSingleStarSelected && singleStarNode) {
      const isParamEditing = this.initialParametricShapeSnapshot !== null;
      if (this.elements.inputStarPoints && (!isParamEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.inputStarPoints))) {
        this.elements.inputStarPoints.value = String(singleStarNode.points);
      }
      if (this.elements.inputStarOuterRadius && (!isParamEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.inputStarOuterRadius))) {
        this.elements.inputStarOuterRadius.value = String(this.roundToFourDecimals(singleStarNode.outerRadius));
      }
      if (this.elements.inputStarInnerRadius && (!isParamEditing || (typeof document !== 'undefined' && document.activeElement !== this.elements.inputStarInnerRadius))) {
        this.elements.inputStarInnerRadius.value = String(this.roundToFourDecimals(singleStarNode.innerRadius));
      }
    }
  }

  public bind(): void {
    this.elements.inputPolygonSides?.addEventListener('focus', this.onPolygonSidesFocus);
    this.elements.inputPolygonSides?.addEventListener('input', this.onPolygonSidesInput);
    this.elements.inputPolygonSides?.addEventListener('change', this.onPolygonSidesChange);
    this.elements.inputPolygonSides?.addEventListener('blur', this.onPolygonSidesChange);

    this.elements.inputPolygonRadius?.addEventListener('focus', this.onPolygonRadiusFocus);
    this.elements.inputPolygonRadius?.addEventListener('input', this.onPolygonRadiusInput);
    this.elements.inputPolygonRadius?.addEventListener('change', this.onPolygonRadiusChange);
    this.elements.inputPolygonRadius?.addEventListener('blur', this.onPolygonRadiusChange);

    this.elements.inputStarPoints?.addEventListener('focus', this.onStarPointsFocus);
    this.elements.inputStarPoints?.addEventListener('input', this.onStarPointsInput);
    this.elements.inputStarPoints?.addEventListener('change', this.onStarPointsChange);
    this.elements.inputStarPoints?.addEventListener('blur', this.onStarPointsChange);

    this.elements.inputStarOuterRadius?.addEventListener('focus', this.onStarOuterRadiusFocus);
    this.elements.inputStarOuterRadius?.addEventListener('input', this.onStarOuterRadiusInput);
    this.elements.inputStarOuterRadius?.addEventListener('change', this.onStarOuterRadiusChange);
    this.elements.inputStarOuterRadius?.addEventListener('blur', this.onStarOuterRadiusChange);

    this.elements.inputStarInnerRadius?.addEventListener('focus', this.onStarInnerRadiusFocus);
    this.elements.inputStarInnerRadius?.addEventListener('input', this.onStarInnerRadiusInput);
    this.elements.inputStarInnerRadius?.addEventListener('change', this.onStarInnerRadiusChange);
    this.elements.inputStarInnerRadius?.addEventListener('blur', this.onStarInnerRadiusChange);
  }

  public cleanup(): void {
    this.elements.inputPolygonSides?.removeEventListener('focus', this.onPolygonSidesFocus);
    this.elements.inputPolygonSides?.removeEventListener('input', this.onPolygonSidesInput);
    this.elements.inputPolygonSides?.removeEventListener('change', this.onPolygonSidesChange);
    this.elements.inputPolygonSides?.removeEventListener('blur', this.onPolygonSidesChange);

    this.elements.inputPolygonRadius?.removeEventListener('focus', this.onPolygonRadiusFocus);
    this.elements.inputPolygonRadius?.removeEventListener('input', this.onPolygonRadiusInput);
    this.elements.inputPolygonRadius?.removeEventListener('change', this.onPolygonRadiusChange);
    this.elements.inputPolygonRadius?.removeEventListener('blur', this.onPolygonRadiusChange);

    this.elements.inputStarPoints?.removeEventListener('focus', this.onStarPointsFocus);
    this.elements.inputStarPoints?.removeEventListener('input', this.onStarPointsInput);
    this.elements.inputStarPoints?.removeEventListener('change', this.onStarPointsChange);
    this.elements.inputStarPoints?.removeEventListener('blur', this.onStarPointsChange);

    this.elements.inputStarOuterRadius?.removeEventListener('focus', this.onStarOuterRadiusFocus);
    this.elements.inputStarOuterRadius?.removeEventListener('input', this.onStarOuterRadiusInput);
    this.elements.inputStarOuterRadius?.removeEventListener('change', this.onStarOuterRadiusChange);
    this.elements.inputStarOuterRadius?.removeEventListener('blur', this.onStarOuterRadiusChange);

    this.elements.inputStarInnerRadius?.removeEventListener('focus', this.onStarInnerRadiusFocus);
    this.elements.inputStarInnerRadius?.removeEventListener('input', this.onStarInnerRadiusInput);
    this.elements.inputStarInnerRadius?.removeEventListener('change', this.onStarInnerRadiusChange);
    this.elements.inputStarInnerRadius?.removeEventListener('blur', this.onStarInnerRadiusChange);
  }
}
