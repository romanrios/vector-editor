import type { SelectableNode, Text, Polygon, Star } from '../types/scene-graph.ts';
import { isGroup, isText, isPolygon, isStar } from '../types/scene-graph.ts';
import { getLeafShapes } from '../state/StateManager.ts';
import { getSelectionBounds } from '../utils/geometry.ts';
import type { PropertiesPanelControllerOptions, PropertiesPanelController } from './properties/types.ts';
import { queryPropertiesPanelElements } from './properties/domElements.ts';
import { StyleSnapshotManager } from './properties/StyleSnapshotManager.ts';
import { TransformSectionController } from './properties/TransformSectionController.ts';
import { AppearanceSectionController } from './properties/AppearanceSectionController.ts';
import { DropShadowSectionController } from './properties/DropShadowSectionController.ts';
import { TypographySectionController } from './properties/TypographySectionController.ts';
import { ParametricSectionController } from './properties/ParametricSectionController.ts';
import { ArtboardSectionController } from './properties/ArtboardSectionController.ts';
import { ActionButtonsController } from './properties/ActionButtonsController.ts';

export type { PropertiesPanelControllerOptions, PropertiesPanelController } from './properties/types.ts';

export function setupPropertiesPanelBindings(options: PropertiesPanelControllerOptions): PropertiesPanelController {
  const { stateManager, commandManager, inputController, canvas, onSelectionChanged, onAlign, onDistribute, onPathfinder } = options;

  const elements = queryPropertiesPanelElements();
  const styleSnapshotManager = new StyleSnapshotManager(stateManager);

  let syncPropertiesPanel: (selectedNodes?: readonly SelectableNode[]) => void;

  const transformController = new TransformSectionController(
    stateManager,
    commandManager,
    elements,
    () => syncPropertiesPanel()
  );

  const appearanceController = new AppearanceSectionController(
    stateManager,
    commandManager,
    elements,
    styleSnapshotManager,
    () => syncPropertiesPanel()
  );

  const dropShadowController = new DropShadowSectionController(
    stateManager,
    commandManager,
    elements,
    styleSnapshotManager
  );

  const typographyController = new TypographySectionController(
    stateManager,
    commandManager,
    elements,
    () => syncPropertiesPanel(),
    inputController
  );

  const parametricController = new ParametricSectionController(
    stateManager,
    commandManager,
    elements
  );


  const artboardController = new ArtboardSectionController(
    stateManager,
    commandManager,
    elements,
    () => syncPropertiesPanel()
  );

  const actionButtonsController = new ActionButtonsController({
    stateManager,
    inputController,
    canvas,
    elements,
    syncPropertiesPanel: () => syncPropertiesPanel(),
    onAlign,
    onDistribute,
    onPathfinder,
  });

  transformController.bind();
  appearanceController.bind();
  dropShadowController.bind();
  typographyController.bind();
  parametricController.bind();
  artboardController.bind();
  actionButtonsController.bind();

  let lastSelectionKey: string = '';

  syncPropertiesPanel = (selectedNodes: readonly SelectableNode[] = stateManager.getSelectedNodes()): void => {
    const currentSelectionKey = selectedNodes.map((n) => n.id).sort().join(',');
    if (currentSelectionKey !== lastSelectionKey) {
      lastSelectionKey = currentSelectionKey;
      styleSnapshotManager.clear();
      typographyController.clearSnapshot();
      parametricController.clearSnapshot();
      transformController.clearSnapshot();
      appearanceController.clearSnapshot();
      dropShadowController.clearSnapshot();
    }

    const leafShapes = getLeafShapes(selectedNodes);
    const hasSelection = selectedNodes.length > 0;
    const selectionBounds = hasSelection ? getSelectionBounds(selectedNodes) : null;
    const firstLeafRotation = leafShapes.length > 0 ? leafShapes[0].rotation ?? 0 : null;
    const isSingleTextSelected = selectedNodes.length === 1 && isText(selectedNodes[0]);
    const singleTextNode = isSingleTextSelected ? (selectedNodes[0] as Text) : null;
    const isSinglePolygonSelected = selectedNodes.length === 1 && isPolygon(selectedNodes[0]);
    const singlePolygonNode = isSinglePolygonSelected ? (selectedNodes[0] as Polygon) : null;
    const isSingleStarSelected = selectedNodes.length === 1 && isStar(selectedNodes[0]);
    const singleStarNode = isSingleStarSelected ? (selectedNodes[0] as Star) : null;

    if (elements.sectionAppearance) {
      elements.sectionAppearance.style.display = 'block';
    }

    if (hasSelection) {
      if (elements.selectionState) {
        elements.selectionState.style.display = 'block';
      }
      if (elements.noSelectionState) {
        elements.noSelectionState.style.display = 'none';
      }

      if (elements.panelTitle) {
        if (selectedNodes.length === 1) {
          const single = selectedNodes[0];
          elements.panelTitle.textContent = isGroup(single) ? 'Grupo' : 'PROPIEDADES';
        } else {
          const hasGroup = selectedNodes.some(isGroup);
          elements.panelTitle.textContent = hasGroup
            ? `${selectedNodes.length} elementos seleccionados`
            : `${selectedNodes.length} figuras seleccionadas`;
        }
      }
    } else {
      if (elements.selectionState) {
        elements.selectionState.style.display = 'none';
      }
      if (elements.noSelectionState) {
        elements.noSelectionState.style.display = 'block';
      }
      if (elements.panelTitle) {
        elements.panelTitle.textContent = 'ESTILO DE DIBUJO';
      }

      styleSnapshotManager.clear();
      typographyController.clearSnapshot();
      parametricController.clearSnapshot();
      transformController.clearSnapshot();
      appearanceController.clearSnapshot();
      dropShadowController.clearSnapshot();
    }

    transformController.sync(selectedNodes, leafShapes, selectionBounds, firstLeafRotation);
    typographyController.sync(singleTextNode);
    parametricController.sync(singlePolygonNode, singleStarNode);
    appearanceController.sync(leafShapes, hasSelection);
    dropShadowController.sync(leafShapes);
    artboardController.sync(hasSelection);
    actionButtonsController.sync(selectedNodes, leafShapes);

    onSelectionChanged?.();
  };

  return {
    syncPropertiesPanel,
    cleanup: () => {
      transformController.cleanup();
      appearanceController.cleanup();
      dropShadowController.cleanup();
      typographyController.cleanup();
      parametricController.cleanup();
      artboardController.cleanup();
      actionButtonsController.cleanup();
    },
  };
}
