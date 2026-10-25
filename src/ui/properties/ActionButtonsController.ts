import type { StateManager } from '../../state/StateManager.ts';
import type { InputController } from '../../input/InputController.ts';
import type { SelectableNode, Shape, Path } from '../../types/scene-graph.ts';
import { getPointType, type AlignmentMode, type DistributionAxis } from '../../utils/geometry.ts';
import { isClosedShape, type BooleanOp } from '../../utils/booleanOperations.ts';
import type { PropertiesPanelElements } from './types.ts';

export interface ActionButtonsControllerOptions {
  readonly stateManager: StateManager;
  readonly inputController: InputController;
  readonly canvas: HTMLCanvasElement | null;
  readonly elements: PropertiesPanelElements;
  readonly syncPropertiesPanel: () => void;
  readonly onAlign?: (mode: AlignmentMode) => void;
  readonly onDistribute?: (axis: DistributionAxis) => void;
  readonly onPathfinder?: (op: BooleanOp) => void;
}

export class ActionButtonsController {
  private readonly sectionToggleHandlers: Array<{ element: HTMLElement; handler: () => void }> = [];
  private readonly options: ActionButtonsControllerOptions;

  constructor(options: ActionButtonsControllerOptions) {
    this.options = options;
  }


  private readonly onBringToFrontClick = (): void => {
    this.options.inputController.bringToFront();
  };

  private readonly onSendToBackClick = (): void => {
    this.options.inputController.sendToBack();
  };

  private readonly onDuplicateClick = (): void => {
    this.options.inputController.duplicate();
  };

  private readonly onDeleteSelectionClick = (): void => {
    if (this.options.stateManager.getSelection().length > 0) {
      this.options.inputController.deleteSelected();
    }
  };

  private readonly onPointCornerClick = (): void => {
    this.options.inputController.setSelectedPathPointType('corner');
    this.options.syncPropertiesPanel();
  };

  private readonly onPointSmoothClick = (): void => {
    this.options.inputController.setSelectedPathPointType('smooth');
    this.options.syncPropertiesPanel();
  };

  private readonly onPointSymmetricClick = (): void => {
    this.options.inputController.setSelectedPathPointType('symmetric');
    this.options.syncPropertiesPanel();
  };

  private readonly onDeleteAnchorClick = (): void => {
    this.options.inputController.deleteSelected();
    this.options.syncPropertiesPanel();
  };

  private readonly onOutlineStrokeClick = (): void => {
    this.options.inputController.outlineStroke();
    this.options.syncPropertiesPanel();
  };

  private readonly onCanvasClickOrPointerUp = (): void => {
    this.options.syncPropertiesPanel();
  };

  private readonly onTogglePanelClick = (): void => {
    if (typeof document !== 'undefined' && document.body) {
      const isPanelOpen = document.body.classList.toggle('panel-open');
      this.options.elements.btnTogglePanel?.setAttribute('aria-expanded', String(isPanelOpen));
    }
  };

  private readonly handleAlign = (mode: AlignmentMode) => (): void => {
    if (this.options.stateManager.getSelection().length >= 2) {
      this.options.inputController.alignSelection(mode);
      this.options.syncPropertiesPanel();
      this.options.onAlign?.(mode);
    }
  };

  private readonly handleDistribute = (axis: DistributionAxis) => (): void => {
    if (this.options.stateManager.getSelection().length >= 3) {
      this.options.inputController.distributeSelection(axis);
      this.options.syncPropertiesPanel();
      this.options.onDistribute?.(axis);
    }
  };

  private readonly handlePathfinder = (op: BooleanOp) => (): void => {
    this.options.inputController.applyBooleanOperation(op);
    this.options.syncPropertiesPanel();
    this.options.onPathfinder?.(op);
  };

  private readonly onAlignLeft = this.handleAlign('left');
  private readonly onAlignCenterH = this.handleAlign('center-h');
  private readonly onAlignRight = this.handleAlign('right');
  private readonly onAlignTop = this.handleAlign('top');
  private readonly onAlignCenterV = this.handleAlign('center-v');
  private readonly onAlignBottom = this.handleAlign('bottom');
  private readonly onDistributeH = this.handleDistribute('horizontal');
  private readonly onDistributeV = this.handleDistribute('vertical');

  private readonly onPathfinderUnion = this.handlePathfinder('union');
  private readonly onPathfinderSubtract = this.handlePathfinder('subtract');
  private readonly onPathfinderIntersect = this.handlePathfinder('intersect');
  private readonly onPathfinderExclude = this.handlePathfinder('exclude');

  public sync(selectedNodes: readonly SelectableNode[], leafShapes: readonly Shape[]): void {
    const hasSelection = selectedNodes.length > 0;
    const pathEdit = this.options.inputController?.pathEditState ?? null;
    const hasSelectedAnchors = Boolean(
      pathEdit && pathEdit.selectedAnchors && pathEdit.selectedAnchors.size > 0
    );

    if (this.options.elements.sectionPathPoint) {
      this.options.elements.sectionPathPoint.style.display = hasSelectedAnchors ? 'block' : 'none';
      if (hasSelectedAnchors && pathEdit) {
        const pathNode = this.options.stateManager.findNode(pathEdit.pathId) as Path | null;
        if (pathNode) {
          const firstIndex = pathEdit.selectedAnchors.values().next().value;
          const pt = firstIndex !== undefined ? pathNode.points[firstIndex] : undefined;
          const ptType = pt ? (pt.pointType ?? getPointType(pt)) : 'corner';

          this.options.elements.btnPointCorner?.classList.toggle('active', ptType === 'corner');
          this.options.elements.btnPointSmooth?.classList.toggle('active', ptType === 'smooth');
          this.options.elements.btnPointSymmetric?.classList.toggle('active', ptType === 'symmetric');
        }
      }
    }

    if (hasSelection) {
      const canAlign = selectedNodes.length >= 2;
      const canDistribute = selectedNodes.length >= 3;

      if (this.options.elements.sectionAlign) {
        this.options.elements.sectionAlign.style.display = canAlign ? 'block' : 'none';
      }

      const closedShapes = leafShapes.filter(isClosedShape);
      const canPathfinder = closedShapes.length >= 2;
      if (this.options.elements.sectionPathfinder) {
        this.options.elements.sectionPathfinder.style.display = canPathfinder ? 'block' : 'none';
      }

      const pathfinderPanelButtons = [
        this.options.elements.btnPathfinderUnion,
        this.options.elements.btnPathfinderSubtract,
        this.options.elements.btnPathfinderIntersect,
        this.options.elements.btnPathfinderExclude,
      ];
      for (let i = 0; i < pathfinderPanelButtons.length; i++) {
        const btn = pathfinderPanelButtons[i];
        if (btn) {
          btn.disabled = !canPathfinder;
          btn.setAttribute('aria-disabled', String(!canPathfinder));
        }
      }

      const alignPanelButtons = [
        this.options.elements.btnAlignLeft,
        this.options.elements.btnAlignCenterH,
        this.options.elements.btnAlignRight,
        this.options.elements.btnAlignTop,
        this.options.elements.btnAlignCenterV,
        this.options.elements.btnAlignBottom,
      ];
      for (let i = 0; i < alignPanelButtons.length; i++) {
        const btn = alignPanelButtons[i];
        if (btn) {
          btn.disabled = !canAlign;
          btn.setAttribute('aria-disabled', String(!canAlign));
        }
      }

      const distributePanelButtons = [this.options.elements.btnDistributeH, this.options.elements.btnDistributeV];
      for (let i = 0; i < distributePanelButtons.length; i++) {
        const btn = distributePanelButtons[i];
        if (btn) {
          btn.disabled = !canDistribute;
          btn.setAttribute('aria-disabled', String(!canDistribute));
        }
      }
    } else {
      if (this.options.elements.sectionAlign) {
        this.options.elements.sectionAlign.style.display = 'none';
      }
      if (this.options.elements.sectionPathfinder) {
        this.options.elements.sectionPathfinder.style.display = 'none';
      }
      if (this.options.elements.sectionPathPoint) {
        this.options.elements.sectionPathPoint.style.display = 'none';
      }
    }
  }

  public bind(): void {
    const el = this.options.elements;
    el.btnBringToFront?.addEventListener('click', this.onBringToFrontClick);
    el.btnSendToBack?.addEventListener('click', this.onSendToBackClick);
    el.btnDuplicate?.addEventListener('click', this.onDuplicateClick);
    el.btnDeleteSelection?.addEventListener('click', this.onDeleteSelectionClick);

    el.btnPointCorner?.addEventListener('click', this.onPointCornerClick);
    el.btnPointSmooth?.addEventListener('click', this.onPointSmoothClick);
    el.btnPointSymmetric?.addEventListener('click', this.onPointSymmetricClick);
    el.btnDeleteAnchor?.addEventListener('click', this.onDeleteAnchorClick);

    el.btnOutlineStroke?.addEventListener('click', this.onOutlineStrokeClick);
    this.options.canvas?.addEventListener('pointerup', this.onCanvasClickOrPointerUp);
    el.btnTogglePanel?.addEventListener('click', this.onTogglePanelClick);

    el.btnAlignLeft?.addEventListener('click', this.onAlignLeft);
    el.btnAlignCenterH?.addEventListener('click', this.onAlignCenterH);
    el.btnAlignRight?.addEventListener('click', this.onAlignRight);
    el.btnAlignTop?.addEventListener('click', this.onAlignTop);
    el.btnAlignCenterV?.addEventListener('click', this.onAlignCenterV);
    el.btnAlignBottom?.addEventListener('click', this.onAlignBottom);
    el.btnDistributeH?.addEventListener('click', this.onDistributeH);
    el.btnDistributeV?.addEventListener('click', this.onDistributeV);

    el.btnPathfinderUnion?.addEventListener('click', this.onPathfinderUnion);
    el.btnPathfinderSubtract?.addEventListener('click', this.onPathfinderSubtract);
    el.btnPathfinderIntersect?.addEventListener('click', this.onPathfinderIntersect);
    el.btnPathfinderExclude?.addEventListener('click', this.onPathfinderExclude);

    const collapsibleSections: HTMLElement[] =
      typeof document !== 'undefined' && typeof document.querySelectorAll === 'function'
        ? Array.from(document.querySelectorAll<HTMLElement>('.collapsible-section'))
        : [];

    collapsibleSections.forEach((section) => {
      if (!section.id) return;
      try {
        if (typeof sessionStorage !== 'undefined') {
          const saved = sessionStorage.getItem(`panel-section-${section.id}`);
          if (saved !== null && 'open' in section) {
            (section as HTMLDetailsElement).open = saved === 'true';
          }
        }
      } catch (_) {}

      const onToggle = (): void => {
        try {
          if (typeof sessionStorage !== 'undefined' && 'open' in section) {
            sessionStorage.setItem(`panel-section-${section.id}`, String((section as HTMLDetailsElement).open));
          }
        } catch (_) {}
      };

      section.addEventListener('toggle', onToggle);
      this.sectionToggleHandlers.push({ element: section, handler: onToggle });
    });
  }

  public cleanup(): void {
    const el = this.options.elements;
    el.btnBringToFront?.removeEventListener('click', this.onBringToFrontClick);
    el.btnSendToBack?.removeEventListener('click', this.onSendToBackClick);
    el.btnDuplicate?.removeEventListener('click', this.onDuplicateClick);
    el.btnDeleteSelection?.removeEventListener('click', this.onDeleteSelectionClick);
    el.btnPointCorner?.removeEventListener('click', this.onPointCornerClick);
    el.btnPointSmooth?.removeEventListener('click', this.onPointSmoothClick);
    el.btnPointSymmetric?.removeEventListener('click', this.onPointSymmetricClick);
    el.btnDeleteAnchor?.removeEventListener('click', this.onDeleteAnchorClick);
    el.btnOutlineStroke?.removeEventListener('click', this.onOutlineStrokeClick);
    this.options.canvas?.removeEventListener('pointerup', this.onCanvasClickOrPointerUp);
    el.btnTogglePanel?.removeEventListener('click', this.onTogglePanelClick);

    el.btnAlignLeft?.removeEventListener('click', this.onAlignLeft);
    el.btnAlignCenterH?.removeEventListener('click', this.onAlignCenterH);
    el.btnAlignRight?.removeEventListener('click', this.onAlignRight);
    el.btnAlignTop?.removeEventListener('click', this.onAlignTop);
    el.btnAlignCenterV?.removeEventListener('click', this.onAlignCenterV);
    el.btnAlignBottom?.removeEventListener('click', this.onAlignBottom);
    el.btnDistributeH?.removeEventListener('click', this.onDistributeH);
    el.btnDistributeV?.removeEventListener('click', this.onDistributeV);

    el.btnPathfinderUnion?.removeEventListener('click', this.onPathfinderUnion);
    el.btnPathfinderSubtract?.removeEventListener('click', this.onPathfinderSubtract);
    el.btnPathfinderIntersect?.removeEventListener('click', this.onPathfinderIntersect);
    el.btnPathfinderExclude?.removeEventListener('click', this.onPathfinderExclude);

    for (const { element, handler } of this.sectionToggleHandlers) {
      element.removeEventListener('toggle', handler);
    }
    this.sectionToggleHandlers.length = 0;
  }
}
