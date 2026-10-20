import type { StateManager } from '../state/StateManager.ts';
import { getDocumentIndex } from '../state/StateManager.ts';
import type { CommandManager } from '../commands/CommandManager.ts';
import type { InputController } from '../input/InputController.ts';
import { AddLayerCommand } from '../commands/AddLayerCommand.ts';
import { DeleteLayerCommand } from '../commands/DeleteLayerCommand.ts';
import { MoveStepCommand } from '../commands/MoveStepCommand.ts';
import { MoveNodeCommand } from '../commands/MoveNodeCommand.ts';
import { RenameNodeCommand } from '../commands/RenameNodeCommand.ts';
import { SetVisibilityCommand } from '../commands/SetVisibilityCommand.ts';
import { SetLockedCommand } from '../commands/SetLockedCommand.ts';
import { BatchCommand } from '../commands/BatchCommand.ts';
import {
  isDocument,
  isLayer,
  isGroup,
  isSelectable,
  isShape,
  type SceneNode,
} from '../types/scene-graph.ts';

export interface LayersPanelControllerOptions {
  readonly stateManager: StateManager;
  readonly commandManager: CommandManager;
  readonly inputController: InputController;
}

export interface LayersPanelController {
  readonly renderLayersTree: () => void;
  readonly syncLayersToolbar: () => void;
  readonly switchPanelTab: (tab: 'properties' | 'layers') => void;
  readonly cleanup: () => void;
}

export function setupLayersPanelBindings(options: LayersPanelControllerOptions): LayersPanelController {
  const { stateManager, commandManager, inputController } = options;

  const tabBtnProperties = document.querySelector<HTMLButtonElement>('#tab-btn-properties');
  const tabBtnLayers = document.querySelector<HTMLButtonElement>('#tab-btn-layers');
  const panelTabProperties = document.querySelector<HTMLElement>('#panel-tab-properties');
  const panelTabLayers = document.querySelector<HTMLElement>('#panel-tab-layers');

  const btnAddLayer = document.querySelector<HTMLButtonElement>('#btn-add-layer');
  const btnLayerMoveUp = document.querySelector<HTMLButtonElement>('#btn-layer-move-up');
  const btnLayerMoveDown = document.querySelector<HTMLButtonElement>('#btn-layer-move-down');
  const btnLayerDelete = document.querySelector<HTMLButtonElement>('#btn-layer-delete');
  const layersCountBadge = document.querySelector<HTMLElement>('#layers-count-badge');
  const layersTree = document.querySelector<HTMLElement>('#layers-tree');
  const layersEmptyState = document.querySelector<HTMLElement>('#layers-empty-state');

  const collapsedNodeIds = new Set<string>();
  let draggedNodeId: string | null = null;

  const switchPanelTab = (tab: 'properties' | 'layers') => {
    if (tab === 'properties') {
      tabBtnProperties?.classList.add('active');
      tabBtnProperties?.setAttribute('aria-selected', 'true');
      tabBtnProperties?.setAttribute('tabindex', '0');

      tabBtnLayers?.classList.remove('active');
      tabBtnLayers?.setAttribute('aria-selected', 'false');
      tabBtnLayers?.setAttribute('tabindex', '-1');

      if (panelTabProperties) panelTabProperties.style.display = 'flex';
      if (panelTabLayers) panelTabLayers.style.display = 'none';
    } else {
      tabBtnLayers?.classList.add('active');
      tabBtnLayers?.setAttribute('aria-selected', 'true');
      tabBtnLayers?.setAttribute('tabindex', '0');

      tabBtnProperties?.classList.remove('active');
      tabBtnProperties?.setAttribute('aria-selected', 'false');
      tabBtnProperties?.setAttribute('tabindex', '-1');

      if (panelTabLayers) panelTabLayers.style.display = 'flex';
      if (panelTabProperties) panelTabProperties.style.display = 'none';

      renderLayersTree();
    }
  };

  const onTabPropertiesClick = () => switchPanelTab('properties');
  const onTabLayersClick = () => switchPanelTab('layers');

  tabBtnProperties?.addEventListener('click', onTabPropertiesClick);
  tabBtnLayers?.addEventListener('click', onTabLayersClick);

  // Inicializar estado de pestañas por defecto
  switchPanelTab('properties');

  function syncLayersToolbar(): void {
    const selectedNodes = stateManager.getSelectedNodes();
    const hasSelection = selectedNodes.length > 0;
    const allLocked = hasSelection && selectedNodes.every((n) => stateManager.isEffectivelyLocked(n.id));
    const doc = stateManager.getState();

    if (btnLayerDelete) {
      if (hasSelection) {
        btnLayerDelete.disabled = allLocked;
      } else {
        btnLayerDelete.disabled = doc.children.length <= 1;
      }
    }

    if (hasSelection) {
      let canMoveUp = false;
      let canMoveDown = false;

      for (const node of selectedNodes) {
        const parent = stateManager.findParent(node.id);
        if (!parent) continue;
        let children: readonly { id: string }[] = [];
        if (isDocument(parent) || isLayer(parent) || isGroup(parent)) {
          children = parent.children;
        }
        const idx = children.findIndex((c) => c.id === node.id);
        if (idx !== -1) {
          if (idx < children.length - 1) canMoveUp = true;
          if (idx > 0) canMoveDown = true;
        }
      }

      if (btnLayerMoveUp) btnLayerMoveUp.disabled = !canMoveUp;
      if (btnLayerMoveDown) btnLayerMoveDown.disabled = !canMoveDown;
    } else {
      const activeLayerId = stateManager.getActiveLayerId();
      const layerIdx = doc.children.findIndex((l) => l.id === activeLayerId);
      if (btnLayerMoveUp) btnLayerMoveUp.disabled = layerIdx === -1 || layerIdx >= doc.children.length - 1;
      if (btnLayerMoveDown) btnLayerMoveDown.disabled = layerIdx === -1 || layerIdx <= 0;
    }
  }

  const onAddLayerClick = () => {
    const cmd = new AddLayerCommand(stateManager);
    commandManager.executeCommand(cmd);
  };

  const onLayerMoveUpClick = () => {
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 0) {
      const activeLayerId = stateManager.getActiveLayerId();
      if (activeLayerId) {
        const cmd = new MoveStepCommand(stateManager, activeLayerId, 'up');
        if (!cmd.isAlreadyAtTarget) {
          commandManager.executeCommand(cmd);
        }
      }
      return;
    }

    const docIndex = getDocumentIndex(stateManager.getState());
    const sorted = [...selectedNodes].sort((a, b) => {
      const parentA = docIndex.parentMap.get(a.id);
      const parentB = docIndex.parentMap.get(b.id);
      if (parentA && parentA === parentB && 'children' in parentA) {
        const idxA = (parentA.children as readonly { id: string }[]).findIndex((c) => c.id === a.id);
        const idxB = (parentA.children as readonly { id: string }[]).findIndex((c) => c.id === b.id);
        return idxB - idxA;
      }
      return 0;
    });

    const commands: MoveStepCommand[] = [];
    for (const node of sorted) {
      const cmd = new MoveStepCommand(stateManager, node.id, 'up');
      if (!cmd.isAlreadyAtTarget) {
        commands.push(cmd);
      }
    }

    if (commands.length === 1) {
      commandManager.executeCommand(commands[0]);
    } else if (commands.length > 1) {
      commandManager.executeCommand(new BatchCommand(commands, 'Subir selección'));
    }
  };

  const onLayerMoveDownClick = () => {
    const selectedNodes = stateManager.getSelectedNodes();
    if (selectedNodes.length === 0) {
      const activeLayerId = stateManager.getActiveLayerId();
      if (activeLayerId) {
        const cmd = new MoveStepCommand(stateManager, activeLayerId, 'down');
        if (!cmd.isAlreadyAtTarget) {
          commandManager.executeCommand(cmd);
        }
      }
      return;
    }

    const docIndex = getDocumentIndex(stateManager.getState());
    const sorted = [...selectedNodes].sort((a, b) => {
      const parentA = docIndex.parentMap.get(a.id);
      const parentB = docIndex.parentMap.get(b.id);
      if (parentA && parentA === parentB && 'children' in parentA) {
        const idxA = (parentA.children as readonly { id: string }[]).findIndex((c) => c.id === a.id);
        const idxB = (parentA.children as readonly { id: string }[]).findIndex((c) => c.id === b.id);
        return idxA - idxB;
      }
      return 0;
    });

    const commands: MoveStepCommand[] = [];
    for (const node of sorted) {
      const cmd = new MoveStepCommand(stateManager, node.id, 'down');
      if (!cmd.isAlreadyAtTarget) {
        commands.push(cmd);
      }
    }

    if (commands.length === 1) {
      commandManager.executeCommand(commands[0]);
    } else if (commands.length > 1) {
      commandManager.executeCommand(new BatchCommand(commands, 'Bajar selección'));
    }
  };

  const onLayerDeleteClick = () => {
    if (stateManager.getSelection().length > 0) {
      inputController.deleteSelected();
    } else {
      const doc = stateManager.getState();
      if (doc.children.length > 1) {
        const activeLayerId = stateManager.getActiveLayerId();
        if (activeLayerId) {
          const cmd = new DeleteLayerCommand(stateManager, activeLayerId);
          if (cmd.isAllowed) {
            commandManager.executeCommand(cmd);
          }
        }
      }
    }
  };

  btnAddLayer?.addEventListener('click', onAddLayerClick);
  btnLayerMoveUp?.addEventListener('click', onLayerMoveUpClick);
  btnLayerMoveDown?.addEventListener('click', onLayerMoveDownClick);
  btnLayerDelete?.addEventListener('click', onLayerDeleteClick);

  const onLayersTreeDragOver = (e: any) => {
    if (!draggedNodeId) return;
    e.preventDefault?.();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const onLayersTreeDrop = (e: any) => {
    if ((e as any)._rowHandled) return;
    e.preventDefault?.();
    const sourceId = draggedNodeId || e.dataTransfer?.getData?.('text/plain');
    if (!sourceId) return;
    const sourceNode = stateManager.findNode(sourceId);
    if (!sourceNode) return;

    const doc = stateManager.getState();
    if (isLayer(sourceNode)) {
      const cmd = new MoveNodeCommand(stateManager, sourceId, doc.id, 0);
      if (!cmd.isAlreadyAtTarget) {
        commandManager.executeCommand(cmd);
      }
    } else if (isSelectable(sourceNode)) {
      const targetLayerId = stateManager.getActiveLayerId() || doc.children[0]?.id;
      if (targetLayerId) {
        const cmd = new MoveNodeCommand(stateManager, sourceId, targetLayerId, 0);
        if (!cmd.isAlreadyAtTarget) {
          commandManager.executeCommand(cmd);
        }
      }
    }
  };

  layersTree?.addEventListener('dragover', onLayersTreeDragOver);
  layersTree?.addEventListener('drop', onLayersTreeDrop);

  function renderLayersTree(): void {
    if (!layersTree) return;

    const doc = stateManager.getState();
    const selectedIds = new Set(stateManager.getSelection());
    const activeLayerId = stateManager.getActiveLayerId();

    let totalLeafCount = 0;
    const countLeaves = (node: SceneNode) => {
      if (isShape(node)) {
        totalLeafCount++;
      } else if (isGroup(node) || isLayer(node)) {
        for (const child of node.children) {
          countLeaves(child);
        }
      }
    };
    for (const layer of doc.children) {
      countLeaves(layer);
    }

    if (layersCountBadge) {
      layersCountBadge.textContent = totalLeafCount === 1 ? '1 elemento' : `${totalLeafCount} elementos`;
    }

    if (totalLeafCount === 0 && doc.children.length === 0) {
      if (layersEmptyState) layersEmptyState.style.display = 'flex';
      layersTree.innerHTML = '';
      syncLayersToolbar();
      return;
    }

    if (layersEmptyState) {
      layersEmptyState.style.display = 'none';
    }

    layersTree.innerHTML = '';

    const handleDropOnNode = (
      sourceId: string,
      targetNode: SceneNode,
      dropPosition: 'top' | 'bottom' | 'inside'
    ) => {
      const sourceNode = stateManager.findNode(sourceId);
      const sourceParent = stateManager.findParent(sourceId);
      if (!sourceNode || !sourceParent) return;

      const doc = stateManager.getState();

      if (isLayer(sourceNode)) {
        if (!isLayer(targetNode)) return;
        const fromIndex = doc.children.findIndex((c) => c.id === sourceId);
        const targetIndex = doc.children.findIndex((c) => c.id === targetNode.id);
        if (fromIndex === -1 || targetIndex === -1 || fromIndex === targetIndex) return;

        let toIndex: number;
        if (fromIndex < targetIndex) {
          toIndex = dropPosition === 'top' ? targetIndex : targetIndex - 1;
        } else {
          toIndex = dropPosition === 'top' ? targetIndex + 1 : targetIndex;
        }
        toIndex = Math.max(0, Math.min(doc.children.length - 1, toIndex));
        if (toIndex !== fromIndex) {
          const cmd = new MoveNodeCommand(stateManager, sourceId, doc.id, toIndex);
          if (!cmd.isAlreadyAtTarget) {
            commandManager.executeCommand(cmd);
          }
        }
        return;
      }

      if (!isSelectable(sourceNode)) return;

      if (isLayer(targetNode)) {
        const targetIndex = dropPosition === 'bottom' ? 0 : targetNode.children.length;
        const cmd = new MoveNodeCommand(stateManager, sourceId, targetNode.id, targetIndex);
        if (!cmd.isAlreadyAtTarget) {
          commandManager.executeCommand(cmd);
          stateManager.setActiveLayerId(targetNode.id);
        }
        return;
      }

      if (isGroup(targetNode) && dropPosition === 'inside') {
        const targetIndex = targetNode.children.length;
        const cmd = new MoveNodeCommand(stateManager, sourceId, targetNode.id, targetIndex);
        if (!cmd.isAlreadyAtTarget) {
          commandManager.executeCommand(cmd);
        }
        return;
      }

      const targetParent = stateManager.findParent(targetNode.id);
      if (!targetParent || (!isLayer(targetParent) && !isGroup(targetParent))) return;

      const targetChildren = targetParent.children as readonly SceneNode[];
      const targetIndexInParent = targetChildren.findIndex((c) => c.id === targetNode.id);
      if (targetIndexInParent === -1) return;

      if (targetParent.id === sourceParent.id) {
        const fromIndex = targetChildren.findIndex((c) => c.id === sourceId);
        if (fromIndex === -1 || fromIndex === targetIndexInParent) return;

        let toIndex: number;
        if (fromIndex < targetIndexInParent) {
          toIndex = dropPosition === 'top' ? targetIndexInParent : targetIndexInParent - 1;
        } else {
          toIndex = dropPosition === 'top' ? targetIndexInParent + 1 : targetIndexInParent;
        }
        toIndex = Math.max(0, Math.min(targetChildren.length - 1, toIndex));
        if (toIndex !== fromIndex) {
          const cmd = new MoveNodeCommand(stateManager, sourceId, targetParent.id, toIndex);
          if (!cmd.isAlreadyAtTarget) {
            commandManager.executeCommand(cmd);
          }
        }
      } else {
        const toIndex = dropPosition === 'top' ? targetIndexInParent + 1 : targetIndexInParent;
        const clampedIndex = Math.max(0, Math.min(targetChildren.length, toIndex));
        const cmd = new MoveNodeCommand(stateManager, sourceId, targetParent.id, clampedIndex);
        if (!cmd.isAlreadyAtTarget) {
          commandManager.executeCommand(cmd);
          const newLayer = stateManager.findLayerOfNode(sourceId);
          if (newLayer) {
            stateManager.setActiveLayerId(newLayer.id);
          }
        }
      }
    };

    const createRow = (node: SceneNode, level: number): HTMLElement => {
      const isSelected = selectedIds.has(node.id);
      const isHidden = !stateManager.isEffectivelyVisible(node.id);
      const isLocked = stateManager.isEffectivelyLocked(node.id);
      const isSelfHidden = node.visible === false;
      const isSelfLocked = node.locked === true;
      const isContainer = isLayer(node) || isGroup(node);
      const isCollapsed = collapsedNodeIds.has(node.id);
      const isActiveLayer = isLayer(node) && node.id === activeLayerId;

      const row = document.createElement('div');
      row.className = `tree-row${isSelected ? ' is-selected' : ''}${isActiveLayer ? ' is-active-layer' : ''}${isHidden ? ' is-hidden' : ''}${isLocked ? ' is-locked' : ''}`;
      row.setAttribute('data-node-id', node.id);
      row.setAttribute('data-node-type', node.type);
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-selected', String(isSelected));
      row.setAttribute('draggable', 'true');
      row.style.paddingLeft = `${level * 16 + 6}px`;

      const dragHandle = document.createElement('span');
      dragHandle.className = 'tree-drag-handle';
      dragHandle.setAttribute('aria-hidden', 'true');
      dragHandle.setAttribute('title', 'Arrastrar para reordenar');
      dragHandle.innerHTML = `<svg width="8" height="12" viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="3" r="1.5"/><circle cx="7.5" cy="3" r="1.5"/><circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/><circle cx="2.5" cy="13" r="1.5"/><circle cx="7.5" cy="13" r="1.5"/></svg>`;
      row.appendChild(dragHandle);

      if (isContainer) {
        const chevronBtn = document.createElement('button');
        chevronBtn.type = 'button';
        chevronBtn.className = `tree-chevron${isCollapsed ? ' is-collapsed' : ''}`;
        chevronBtn.setAttribute('aria-label', isCollapsed ? 'Expandir' : 'Colapsar');
        chevronBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
        chevronBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (collapsedNodeIds.has(node.id)) {
            collapsedNodeIds.delete(node.id);
          } else {
            collapsedNodeIds.add(node.id);
          }
          renderLayersTree();
        });
        row.appendChild(chevronBtn);
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'tree-chevron-placeholder';
        placeholder.setAttribute('aria-hidden', 'true');
        row.appendChild(placeholder);
      }

      const typeIcon = document.createElement('span');
      typeIcon.className = 'tree-type-icon';
      typeIcon.setAttribute('aria-hidden', 'true');
      if (isLayer(node)) {
        typeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`;
      } else if (isGroup(node)) {
        if (node.isClipMask) {
          typeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="Máscara de recorte"><circle cx="12" cy="12" r="10" stroke-dasharray="3 3"></circle><path d="M12 2a10 10 0 0 1 10 10H2a10 10 0 0 1 10-10z" fill="currentColor" fill-opacity="0.3"></path></svg>`;
        } else {
          typeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
        }
      } else if (node.type === 'rectangle') {
        typeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>`;
      } else if (node.type === 'ellipse') {
        typeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle></svg>`;
      } else if (node.type === 'polygon') {
        typeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"></polygon></svg>`;
      } else if (node.type === 'star') {
        typeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
      } else if (node.type === 'image') {
        typeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;
      } else if (node.type === 'path') {
        typeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path></svg>`;
      } else if (node.type === 'text') {
        typeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>`;
      }
      row.appendChild(typeIcon);

      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = node.name || (isLayer(node) ? 'Capa' : isGroup(node) ? (node.isClipMask ? 'Máscara de recorte' : 'Grupo') : 'Figura');
      label.title = 'Doble clic para renombrar';

      label.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const currentName = label.textContent || '';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tree-label-input';
        input.value = currentName;

        let committed = false;
        const commit = () => {
          if (committed) return;
          committed = true;
          const nextName = input.value.trim();
          if (nextName && nextName !== currentName) {
            commandManager.executeCommand(new RenameNodeCommand(stateManager, node.id, nextName));
          } else {
            renderLayersTree();
          }
        };

        input.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') {
            ke.preventDefault();
            commit();
          } else if (ke.key === 'Escape') {
            ke.preventDefault();
            committed = true;
            renderLayersTree();
          }
        });

        input.addEventListener('blur', () => {
          commit();
        });

        label.innerHTML = '';
        label.appendChild(input);
        input.focus();
        input.select();
      });

      row.appendChild(label);

      if (isActiveLayer) {
        const badge = document.createElement('span');
        badge.className = 'tree-layer-badge';
        badge.textContent = 'Activa';
        badge.title = 'Capa activa para creación';
        row.appendChild(badge);
      }

      const actions = document.createElement('div');
      actions.className = 'tree-row-actions';

      const btnVisibility = document.createElement('button');
      btnVisibility.type = 'button';
      btnVisibility.className = `tree-action-btn tree-btn-visibility${isSelfHidden ? ' is-active btn-hidden' : ''}`;
      btnVisibility.title = isSelfHidden ? 'Mostrar elemento' : 'Ocultar elemento';
      btnVisibility.setAttribute('aria-label', isSelfHidden ? 'Mostrar' : 'Ocultar');
      btnVisibility.innerHTML = isSelfHidden
        ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
        : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

      btnVisibility.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentVisible = node.visible ?? true;
        const cmd = new SetVisibilityCommand(stateManager, node.id, !currentVisible);
        commandManager.executeCommand(cmd);
      });
      actions.appendChild(btnVisibility);

      const btnLock = document.createElement('button');
      btnLock.type = 'button';
      btnLock.className = `tree-action-btn tree-btn-lock${isSelfLocked ? ' is-active btn-locked' : ''}`;
      btnLock.title = isSelfLocked ? 'Desbloquear elemento' : 'Bloquear elemento';
      btnLock.setAttribute('aria-label', isSelfLocked ? 'Desbloquear' : 'Bloquear');
      btnLock.innerHTML = isSelfLocked
        ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`
        : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`;

      btnLock.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentLocked = node.locked ?? false;
        const cmd = new SetLockedCommand(stateManager, node.id, !currentLocked);
        commandManager.executeCommand(cmd);
      });
      actions.appendChild(btnLock);

      if (isLayer(node) && doc.children.length > 1) {
        const btnDeleteLayer = document.createElement('button');
        btnDeleteLayer.type = 'button';
        btnDeleteLayer.className = 'tree-action-btn tree-btn-delete-layer';
        btnDeleteLayer.title = 'Eliminar capa';
        btnDeleteLayer.setAttribute('aria-label', 'Eliminar capa');
        btnDeleteLayer.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
        btnDeleteLayer.addEventListener('click', (e) => {
          e.stopPropagation();
          const cmd = new DeleteLayerCommand(stateManager, node.id);
          if (cmd.isAllowed) {
            commandManager.executeCommand(cmd);
          }
        });
        actions.appendChild(btnDeleteLayer);
      }

      row.appendChild(actions);

      row.addEventListener('dragstart', (e: any) => {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'BUTTON' ||
            target.closest?.('button') ||
            target.closest?.('input'))
        ) {
          e.preventDefault?.();
          return;
        }
        draggedNodeId = node.id;
        row.classList.add('is-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.setData?.('text/plain', node.id);
          e.dataTransfer.effectAllowed = 'move';
        }
      });

      row.addEventListener('dragover', (e: any) => {
        if (!draggedNodeId || draggedNodeId === node.id) return;
        const sourceNode = stateManager.findNode(draggedNodeId);
        if (!sourceNode) return;

        if (isLayer(sourceNode) && !isLayer(node)) {
          return;
        }

        if (isGroup(sourceNode)) {
          let curr = stateManager.findParent(node.id);
          let isDescendant = false;
          while (curr) {
            if (curr.id === sourceNode.id) {
              isDescendant = true;
              break;
            }
            curr = stateManager.findParent(curr.id);
          }
          if (isDescendant) return;
        }

        e.preventDefault?.();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move';
        }

        const rect = typeof (row as any).getBoundingClientRect === 'function'
          ? (row as any).getBoundingClientRect()
          : { top: 0, height: 28 };
        const clientY = typeof e.clientY === 'number' ? e.clientY : rect.top + 14;
        const offsetY = clientY - rect.top;
        const height = rect.height || 28;

        row.classList.remove('drop-indicator-top');
        row.classList.remove('drop-indicator-bottom');
        row.classList.remove('drop-indicator-inside');

        if (isLayer(sourceNode)) {
          if (offsetY < height * 0.5) {
            row.classList.add('drop-indicator-top');
          } else {
            row.classList.add('drop-indicator-bottom');
          }
        } else {
          if (isLayer(node)) {
            if (offsetY < height * 0.25) {
              row.classList.add('drop-indicator-top');
            } else if (offsetY > height * 0.75) {
              row.classList.add('drop-indicator-bottom');
            } else {
              row.classList.add('drop-indicator-inside');
            }
          } else if (isGroup(node)) {
            if (offsetY >= height * 0.25 && offsetY <= height * 0.75) {
              row.classList.add('drop-indicator-inside');
            } else if (offsetY < height * 0.5) {
              row.classList.add('drop-indicator-top');
            } else {
              row.classList.add('drop-indicator-bottom');
            }
          } else {
            if (offsetY < height * 0.5) {
              row.classList.add('drop-indicator-top');
            } else {
              row.classList.add('drop-indicator-bottom');
            }
          }
        }
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drop-indicator-top');
        row.classList.remove('drop-indicator-bottom');
        row.classList.remove('drop-indicator-inside');
      });

      row.addEventListener('drop', (e: any) => {
        e.preventDefault?.();
        (e as any)._rowHandled = true;

        const isInside = row.classList.contains('drop-indicator-inside');
        const isTop = row.classList.contains('drop-indicator-top');
        const isBottom = row.classList.contains('drop-indicator-bottom');

        row.classList.remove('drop-indicator-top');
        row.classList.remove('drop-indicator-bottom');
        row.classList.remove('drop-indicator-inside');

        const rect = typeof (row as any).getBoundingClientRect === 'function'
          ? (row as any).getBoundingClientRect()
          : { top: 0, height: 28 };
        const clientY = typeof e.clientY === 'number' ? e.clientY : rect.top + 14;
        const offsetY = clientY - rect.top;
        const height = rect.height || 28;

        const dropPosition: 'top' | 'bottom' | 'inside' = isInside
          ? 'inside'
          : isTop
            ? 'top'
            : isBottom
              ? 'bottom'
              : offsetY < height * 0.5
                ? 'top'
                : 'bottom';

        const sourceId = draggedNodeId || e.dataTransfer?.getData?.('text/plain');
        if (!sourceId || sourceId === node.id) return;

        handleDropOnNode(sourceId, node, dropPosition);
      });

      row.addEventListener('dragend', () => {
        draggedNodeId = null;
        if (layersTree) {
          const allRows = typeof layersTree.querySelectorAll === 'function'
            ? layersTree.querySelectorAll('.tree-row')
            : [];
          allRows.forEach?.((r: any) => {
            r.classList?.remove?.('is-dragging');
            r.classList?.remove?.('drop-indicator-top');
            r.classList?.remove?.('drop-indicator-bottom');
            r.classList?.remove?.('drop-indicator-inside');
          });
        }
      });

      row.addEventListener('click', (e) => {
        const isMulti = e.shiftKey || e.ctrlKey || e.metaKey;
        if (isLayer(node)) {
          stateManager.setActiveLayerId(node.id);
          const selectableIds = node.children.filter(isSelectable).map((c) => c.id);
          if (selectableIds.length === 0) {
            if (!isMulti) {
              stateManager.setSelection([]);
            }
            return;
          }
          if (isMulti) {
            stateManager.addToSelection(selectableIds);
          } else {
            stateManager.setSelection(selectableIds);
          }
        } else if (isSelectable(node)) {
          if (isMulti) {
            stateManager.toggleInSelection(node.id);
          } else {
            stateManager.setSelection([node.id]);
          }
        }
      });

      return row;
    };

    const appendNodeAndChildren = (node: SceneNode, level: number, container: HTMLElement) => {
      const row = createRow(node, level);
      container.appendChild(row);

      const isContainer = isLayer(node) || isGroup(node);
      const isCollapsed = collapsedNodeIds.has(node.id);

      if (isContainer && !isCollapsed) {
        for (let i = node.children.length - 1; i >= 0; i--) {
          appendNodeAndChildren(node.children[i], level + 1, container);
        }
      }
    };

    for (let l = doc.children.length - 1; l >= 0; l--) {
      appendNodeAndChildren(doc.children[l], 0, layersTree);
    }

    syncLayersToolbar();
  }

  // Render inicial del árbol
  renderLayersTree();

  return {
    renderLayersTree,
    syncLayersToolbar,
    switchPanelTab,
    cleanup: () => {
      tabBtnProperties?.removeEventListener('click', onTabPropertiesClick);
      tabBtnLayers?.removeEventListener('click', onTabLayersClick);
      btnLayerMoveUp?.removeEventListener('click', onLayerMoveUpClick);
      btnLayerMoveDown?.removeEventListener('click', onLayerMoveDownClick);
      btnLayerDelete?.removeEventListener('click', onLayerDeleteClick);
      btnAddLayer?.removeEventListener('click', onAddLayerClick);
      layersTree?.removeEventListener('dragover', onLayersTreeDragOver);
      layersTree?.removeEventListener('drop', onLayersTreeDrop);
    },
  };
}
