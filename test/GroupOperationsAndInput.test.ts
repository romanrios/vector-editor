import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { InputController } from '../src/input/InputController.ts';
import { BatchCommand } from '../src/commands/BatchCommand.ts';
import {
  isGroup,
  type Group,
  type Path,
  type Rectangle,
} from '../src/types/scene-graph.ts';

// Helper de mock para Canvas con simulación de eventos en entorno Node.js
function createMockCanvas(): HTMLCanvasElement & {
  dispatchSimulatedEvent: (type: string, e: unknown) => void;
} {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};

  return {
    style: { cursor: 'default' },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
    getContext: () => null,
    addEventListener: (type: string, listener: (e: unknown) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(listener);
    },
    removeEventListener: (type: string, listener: (e: unknown) => void) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== listener);
    },
    dispatchSimulatedEvent: (type: string, event: unknown) => {
      if (listeners[type]) {
        for (const listener of listeners[type]) {
          listener(event);
        }
      }
    },
  } as unknown as HTMLCanvasElement & { dispatchSimulatedEvent: (type: string, e: unknown) => void };
}

describe('Integración de Grupos en Operaciones y Entrada', () => {
  // 1. Arrastre y flechas con un grupo
  describe('1. Mover: arrastre y flechas con un grupo', () => {
    it('arrastre de un grupo mueve todas sus figuras hoja y registra UNA sola entrada de historial (BatchCommand), revertible con Ctrl+Z', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      const layerId = stateManager.getState().children[0].id;

      const r1: Rectangle = {
        id: 'r1',
        type: 'rectangle',
        name: 'R1',
        x: 10,
        y: 10,
        width: 40,
        height: 40,
      };
      const r2: Rectangle = {
        id: 'r2',
        type: 'rectangle',
        name: 'R2',
        x: 60,
        y: 60,
        width: 40,
        height: 40,
      };
      const group: Group = {
        id: 'g1',
        type: 'group',
        name: 'Grupo 1',
        children: [r1, r2],
      };
      stateManager.addNode(layerId, group);

      // Clic para seleccionar el grupo más externo
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 20, clientY: 20 });
      assert.deepEqual(stateManager.getSelection(), ['g1']);

      // Arrastre con desplazamiento > 3px: dx = 30, dy = 40
      canvas.dispatchSimulatedEvent('mousemove', { clientX: 50, clientY: 60 });

      // Verificación en vivo: ambas figuras se movieron
      const liveR1 = stateManager.findNode('r1') as Rectangle;
      const liveR2 = stateManager.findNode('r2') as Rectangle;
      assert.equal(liveR1.x, 40);
      assert.equal(liveR1.y, 50);
      assert.equal(liveR2.x, 90);
      assert.equal(liveR2.y, 100);

      // Soltar
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 50, clientY: 60 });

      // Solo una entrada en el historial
      assert.equal(commandManager.canUndo(), true);
      const undoStack = (commandManager as any).undoStack;
      assert.equal(undoStack.length, 1);
      assert.equal(undoStack[0] instanceof BatchCommand, true);

      // Ctrl+Z revierte ambas figuras
      commandManager.undo();
      const undoneR1 = stateManager.findNode('r1') as Rectangle;
      const undoneR2 = stateManager.findNode('r2') as Rectangle;
      assert.equal(undoneR1.x, 10);
      assert.equal(undoneR1.y, 10);
      assert.equal(undoneR2.x, 60);
      assert.equal(undoneR2.y, 60);

      controller.destroy();
    });

    it('movimiento con flechas de un grupo fusiona comandos en UNA sola entrada dentro del timeout de 400ms, y Ctrl+Z lo revierte', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      const layerId = stateManager.getState().children[0].id;

      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 20, y: 20, width: 30, height: 30 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 70, y: 70, width: 30, height: 30 };
      const group: Group = { id: 'g1', type: 'group', name: 'Grupo Flechas', children: [r1, r2] };
      stateManager.addNode(layerId, group);
      stateManager.setSelection(['g1']);

      // Primera pulsación de flecha en t = 1000
      controller.moveSelection(5, 0, 1000);
      assert.equal((stateManager.findNode('r1') as Rectangle).x, 25);
      assert.equal((stateManager.findNode('r2') as Rectangle).x, 75);

      // Segunda pulsación de flecha en t = 1200 (200ms después, dentro del timeout de 400ms)
      controller.moveSelection(5, 0, 1200);
      assert.equal((stateManager.findNode('r1') as Rectangle).x, 30);
      assert.equal((stateManager.findNode('r2') as Rectangle).x, 80);

      // Historial: deben haberse fusionado en UNA sola entrada
      const undoStack = (commandManager as any).undoStack;
      assert.equal(undoStack.length, 1);
      assert.equal(undoStack[0] instanceof BatchCommand, true);

      // Ctrl+Z revierte el movimiento completo
      commandManager.undo();
      assert.equal((stateManager.findNode('r1') as Rectangle).x, 20);
      assert.equal((stateManager.findNode('r2') as Rectangle).x, 70);

      controller.destroy();
    });
  });

  // 2. Alinear y distribuir con grupos y figuras mezclados
  describe('2. Alinear y distribuir con grupos y figuras mezclados', () => {
    it('alinea a la izquierda un grupo y una figura suelta usando getNodeAABB de cada nodo como unidad, y Ctrl+Z lo revierte', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      const layerId = stateManager.getState().children[0].id;

      // Grupo g1: r1 en (50, 50, 40, 40), r2 en (70, 70, 40, 40) => AABB: minX = 50, maxX = 110
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 50, y: 50, width: 40, height: 40 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 70, y: 70, width: 40, height: 40 };
      const g1: Group = { id: 'g1', type: 'group', name: 'G1', children: [r1, r2] };

      // Figura suelta r3 en (200, 50, 50, 50) => AABB: minX = 200, maxX = 250
      const r3: Rectangle = { id: 'r3', type: 'rectangle', name: 'R3', x: 200, y: 50, width: 50, height: 50 };

      stateManager.addNode(layerId, g1);
      stateManager.addShape(layerId, r3);

      stateManager.setSelection(['g1', 'r3']);

      // Alinear a la izquierda: caja combinada minX = 50. g1 queda en minX = 50 (delta = 0). r3 se mueve a minX = 50 (delta = -150)
      const aligned = controller.alignSelection('left');
      assert.equal(aligned, true);

      // g1 no cambió
      assert.equal((stateManager.findNode('r1') as Rectangle).x, 50);
      assert.equal((stateManager.findNode('r2') as Rectangle).x, 70);
      // r3 se alineó a 50
      assert.equal((stateManager.findNode('r3') as Rectangle).x, 50);

      // Una sola entrada en historial
      assert.equal(commandManager.canUndo(), true);
      const undoStack = (commandManager as any).undoStack;
      assert.equal(undoStack.length, 1);

      // Ctrl+Z revierte
      commandManager.undo();
      assert.equal((stateManager.findNode('r3') as Rectangle).x, 200);

      controller.destroy();
    });

    it('distribuye horizontalmente grupos y figuras mezclados manteniendo espacios libres uniformes, y Ctrl+Z lo revierte', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      const layerId = stateManager.getState().children[0].id;

      // 3 unidades:
      // Unidad 1: r1 suelto en (0, 0, 50, 50) => ancho 50, minX = 0, maxX = 50
      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 0, y: 0, width: 50, height: 50 };
      // Unidad 2: g1 grupo en (100, 0, 40, 50) con r2a y r2b
      const r2a: Rectangle = { id: 'r2a', type: 'rectangle', name: 'R2A', x: 100, y: 0, width: 20, height: 50 };
      const r2b: Rectangle = { id: 'r2b', type: 'rectangle', name: 'R2B', x: 120, y: 0, width: 20, height: 50 };
      const g1: Group = { id: 'g1', type: 'group', name: 'G1', children: [r2a, r2b] };
      // Unidad 3: r3 suelto en (300, 0, 50, 50) => minX = 300, maxX = 350
      const r3: Rectangle = { id: 'r3', type: 'rectangle', name: 'R3', x: 300, y: 0, width: 50, height: 50 };

      stateManager.addShape(layerId, r1);
      stateManager.addNode(layerId, g1);
      stateManager.addShape(layerId, r3);

      stateManager.setSelection(['r1', 'g1', 'r3']);

      // Total span = 350 - 0 = 350. Total item widths = 50 + 40 + 50 = 140. Free space = 210 / 2 = 105.
      // Posición esperada de g1: 50 + 105 = 155 (delta = 155 - 100 = 55)
      const distributed = controller.distributeSelection('horizontal');
      assert.equal(distributed, true);

      // r2a y r2b deben desplazarse 55 px
      assert.equal((stateManager.findNode('r2a') as Rectangle).x, 155);
      assert.equal((stateManager.findNode('r2b') as Rectangle).x, 175);

      // Una sola entrada en historial
      assert.equal((commandManager as any).undoStack.length, 1);

      // Ctrl+Z revierte
      commandManager.undo();
      assert.equal((stateManager.findNode('r2a') as Rectangle).x, 100);
      assert.equal((stateManager.findNode('r2b') as Rectangle).x, 120);

      controller.destroy();
    });
  });

  // 3. Estilos sobre un grupo
  describe('3. Estilos sobre un grupo', () => {
    it('aplica estilo sobre un grupo afectando a todas sus figuras hoja, y Ctrl+Z lo revierte', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      const layerId = stateManager.getState().children[0].id;

      const r1: Rectangle = {
        id: 'r1',
        type: 'rectangle',
        name: 'R1',
        x: 10,
        y: 10,
        width: 40,
        height: 40,
        fill: '#ff0000',
        stroke: '#000000',
        strokeWidth: 1,
      };
      const r2: Rectangle = {
        id: 'r2',
        type: 'rectangle',
        name: 'R2',
        x: 60,
        y: 60,
        width: 40,
        height: 40,
        fill: '#0000ff',
        stroke: '#ffffff',
        strokeWidth: 2,
      };
      const group: Group = { id: 'g1', type: 'group', name: 'G1', children: [r1, r2] };
      stateManager.addNode(layerId, group);

      stateManager.setSelection(['g1']);

      const applied = controller.applyStyle({ fill: '#00ff00', strokeWidth: 5 });
      assert.equal(applied, true);

      // Ambas figuras hoja recibieron el estilo
      const modR1 = stateManager.findNode('r1') as Rectangle;
      const modR2 = stateManager.findNode('r2') as Rectangle;
      assert.equal(modR1.fill, '#00ff00');
      assert.equal(modR1.strokeWidth, 5);
      assert.equal(modR2.fill, '#00ff00');
      assert.equal(modR2.strokeWidth, 5);

      // Historial: una sola entrada
      assert.equal(commandManager.canUndo(), true);
      assert.equal((commandManager as any).undoStack.length, 1);

      // Ctrl+Z revierte ambos
      commandManager.undo();
      const revR1 = stateManager.findNode('r1') as Rectangle;
      const revR2 = stateManager.findNode('r2') as Rectangle;
      assert.equal(revR1.fill, '#ff0000');
      assert.equal(revR1.strokeWidth, 1);
      assert.equal(revR2.fill, '#0000ff');
      assert.equal(revR2.strokeWidth, 2);

      controller.destroy();
    });
  });

  // 4. Duplicar y pegar un grupo con IDs únicos
  describe('4. Duplicar y pegar un grupo', () => {
    it('duplica un grupo generando IDs únicos y conservando estructura, y Ctrl+Z lo revierte', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      const layerId = stateManager.getState().children[0].id;

      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 20, y: 20, width: 30, height: 30 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 60, y: 60, width: 30, height: 30 };
      const group: Group = { id: 'g1', type: 'group', name: 'G1', children: [r1, r2] };
      stateManager.addNode(layerId, group);

      stateManager.setSelection(['g1']);

      const duplicated = controller.duplicate();
      assert.notEqual(duplicated, null);
      assert.equal(duplicated!.length, 1);

      const dupGroup = duplicated![0] as unknown as Group;
      assert.equal(isGroup(dupGroup), true);
      assert.notEqual(dupGroup.id, 'g1');
      assert.equal(dupGroup.children.length, 2);

      const dupR1 = dupGroup.children[0] as Rectangle;
      const dupR2 = dupGroup.children[1] as Rectangle;
      assert.notEqual(dupR1.id, 'r1');
      assert.notEqual(dupR2.id, 'r2');
      // Desplazamiento de 10px
      assert.equal(dupR1.x, 30);
      assert.equal(dupR1.y, 30);
      assert.equal(dupR2.x, 70);
      assert.equal(dupR2.y, 70);

      // Copia seleccionada
      assert.deepEqual(stateManager.getSelection(), [dupGroup.id]);

      // Ctrl+Z revierte
      commandManager.undo();
      assert.equal(stateManager.findNode(dupGroup.id), null);
      assert.equal(stateManager.findNode(dupR1.id), null);
      assert.notEqual(stateManager.findNode('g1'), null);

      controller.destroy();
    });

    it('copia y pega un grupo generando IDs únicos y conservando orden y posiciones relativas', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      const layerId = stateManager.getState().children[0].id;

      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 10, width: 40, height: 40 };
      const group: Group = { id: 'g1', type: 'group', name: 'G1', children: [r1] };
      stateManager.addNode(layerId, group);

      stateManager.setSelection(['g1']);
      assert.equal(controller.copy(), true);

      const pasted = controller.paste();
      assert.notEqual(pasted, null);
      assert.equal(pasted!.length, 1);

      const pastedGroup = pasted![0] as unknown as Group;
      assert.equal(isGroup(pastedGroup), true);
      assert.notEqual(pastedGroup.id, 'g1');

      // Las copias quedan seleccionadas
      assert.deepEqual(stateManager.getSelection(), [pastedGroup.id]);

      // Ctrl+Z revierte
      commandManager.undo();
      assert.equal(stateManager.findNode(pastedGroup.id), null);
      assert.notEqual(stateManager.findNode('g1'), null);

      controller.destroy();
    });
  });

  // 5. Hit-test con grupo anidado, oculto y bloqueado
  describe('5. Hit-test recursivo con grupo anidado, oculto y bloqueado', () => {
    it('hit-test acierta en figura dentro de grupos anidados, e ignora ancestros ocultos o bloqueados', () => {
      const stateManager = new StateManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager);
      const layerId = stateManager.getState().children[0].id;

      // Figura en el fondo de la capa
      const bgRect: Rectangle = { id: 'bg', type: 'rectangle', name: 'Fondo', x: 100, y: 100, width: 100, height: 100 };
      stateManager.addShape(layerId, bgRect);

      // Grupos anidados por encima
      const targetRect: Rectangle = { id: 'target', type: 'rectangle', name: 'Target', x: 120, y: 120, width: 50, height: 50 };
      const gInner: Group = { id: 'gInner', type: 'group', name: 'GInner', children: [targetRect] };
      const gOuter: Group = { id: 'gOuter', type: 'group', name: 'GOuter', children: [gInner] };
      stateManager.addNode(layerId, gOuter);

      // Ambos visibles y desbloqueados: hitTest sobre (130, 130) debe retornar 'target'
      const hitNormal = controller.hitTest(130, 130);
      assert.equal(hitNormal?.id, 'target');

      // Si gInner está bloqueado, debe ignorar 'target' y acertar 'bg'
      stateManager.updateNode('gInner', { locked: true });
      const hitInnerLocked = controller.hitTest(130, 130);
      assert.equal(hitInnerLocked?.id, 'bg');

      // Desbloquear gInner y ocultar gOuter: debe ignorar todo gOuter y acertar 'bg'
      stateManager.updateNode('gInner', { locked: false });
      stateManager.updateNode('gOuter', { visible: false });
      const hitOuterHidden = controller.hitTest(130, 130);
      assert.equal(hitOuterHidden?.id, 'bg');

      controller.destroy();
    });
  });

  // 6. Clic, doble clic y clic en hermano
  describe('6. Clic, doble clic y clic en hermano', () => {
    it('clic selecciona el grupo más externo, doble clic desciende un nivel, y clic simple en hermano selecciona el hermano del mismo nivel', () => {
      const stateManager = new StateManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager);
      const layerId = stateManager.getState().children[0].id;

      // Jerarquía:
      // gOuter
      //   rA (20, 20, 40, 40)
      //   gInner (100, 20, 80, 40)
      //     rB (100, 20, 35, 40)
      //     rC (145, 20, 35, 40)
      // rOutside (300, 20, 40, 40)
      const rA: Rectangle = { id: 'rA', type: 'rectangle', name: 'RA', x: 20, y: 20, width: 40, height: 40 };
      const rB: Rectangle = { id: 'rB', type: 'rectangle', name: 'RB', x: 100, y: 20, width: 35, height: 40 };
      const rC: Rectangle = { id: 'rC', type: 'rectangle', name: 'RC', x: 145, y: 20, width: 35, height: 40 };
      const gInner: Group = { id: 'gInner', type: 'group', name: 'GInner', children: [rB, rC] };
      const gOuter: Group = { id: 'gOuter', type: 'group', name: 'GOuter', children: [rA, gInner] };
      const rOutside: Rectangle = { id: 'rOutside', type: 'rectangle', name: 'ROutside', x: 300, y: 20, width: 40, height: 40 };

      stateManager.addNode(layerId, gOuter);
      stateManager.addShape(layerId, rOutside);

      // Paso 1: Clic simple sobre rB (110, 30) => selecciona el grupo más externo: gOuter
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 110, clientY: 30 });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 110, clientY: 30 });
      assert.deepEqual(stateManager.getSelection(), ['gOuter']);

      // Paso 2: Doble clic sobre rB (110, 30) con gOuter seleccionado => desciende un nivel a gInner
      canvas.dispatchSimulatedEvent('dblclick', { clientX: 110, clientY: 30 });
      assert.deepEqual(stateManager.getSelection(), ['gInner']);

      // Paso 3: Doble clic de nuevo sobre rB (110, 30) con gInner seleccionado => desciende a rB
      canvas.dispatchSimulatedEvent('dblclick', { clientX: 110, clientY: 30 });
      assert.deepEqual(stateManager.getSelection(), ['rB']);

      // Paso 4: Contexto de selección: con rB seleccionado (padre gInner), clic simple sobre rC (hermano en gInner)
      // Debe seleccionar rC (el hermano del mismo nivel)
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 155, clientY: 30 });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 155, clientY: 30 });
      assert.deepEqual(stateManager.getSelection(), ['rC']);

      // Paso 5: Clic fuera de gInner sobre rOutside => vuelve a la regla normal
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 310, clientY: 30 });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 310, clientY: 30 });
      assert.deepEqual(stateManager.getSelection(), ['rOutside']);

      controller.destroy();
    });
  });

  // 7. Selección directa dentro de un grupo
  describe('7. Selección directa dentro de un grupo', () => {
    it('la herramienta de selección directa elige el trazado individual ignorando la agrupación', () => {
      const stateManager = new StateManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager);
      const layerId = stateManager.getState().children[0].id;

      const path: Path = {
        id: 'p1',
        type: 'path',
        name: 'Trazado en Grupo',
        x: 50,
        y: 50,
        points: [{ x: 50, y: 50 }, { x: 100, y: 50 }],
        stroke: '#ff0000',
        strokeWidth: 4,
      };
      const group: Group = { id: 'g1', type: 'group', name: 'G1', children: [path] };
      stateManager.addNode(layerId, group);

      controller.setTool('direct-select');

      // Clic cerca del punto (50, 50)
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 52, clientY: 52 });

      // Debe haber seleccionado individualmente 'p1', NO 'g1'
      assert.deepEqual(stateManager.getSelection(), ['p1']);
      assert.equal(controller.isDraggingPoint, true);
      assert.equal(controller.draggedPointIndex, 0);

      controller.destroy();
    });
  });

  // 8. Rectángulo de selección marquesina con grupos
  describe('8. Rectángulo de selección marquesina', () => {
    it('selecciona grupos como unidades de primer nivel y excluye los ocultos o bloqueados', () => {
      const stateManager = new StateManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager);
      const layerId = stateManager.getState().children[0].id;

      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 20, y: 20, width: 30, height: 30 };
      const g1: Group = { id: 'g1', type: 'group', name: 'G1', children: [r1] };

      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 60, y: 20, width: 30, height: 30 };
      const gLocked: Group = { id: 'gLocked', type: 'group', name: 'GLocked', locked: true, children: [r2] };

      const r3: Rectangle = { id: 'r3', type: 'rectangle', name: 'R3', x: 100, y: 20, width: 30, height: 30 };
      const gHidden: Group = { id: 'gHidden', type: 'group', name: 'GHidden', visible: false, children: [r3] };

      stateManager.addNode(layerId, g1);
      stateManager.addNode(layerId, gLocked);
      stateManager.addNode(layerId, gHidden);

      // Iniciar marquesina arrastrando en el vacío desde (0, 0) hasta (150, 80)
      canvas.dispatchSimulatedEvent('mousedown', { clientX: 0, clientY: 0 });
      canvas.dispatchSimulatedEvent('mousemove', { clientX: 150, clientY: 80 });
      canvas.dispatchSimulatedEvent('mouseup', { clientX: 150, clientY: 80 });

      // Solo 'g1' debe estar seleccionado (unidad de primer nivel, no 'r1', y excluye locked y hidden)
      assert.deepEqual(stateManager.getSelection(), ['g1']);

      controller.destroy();
    });
  });

  // 9. Atajos de teclado: Ctrl+G y Ctrl+Shift+G
  describe('9. Atajos de teclado para agrupar y desagrupar', () => {
    it('Ctrl+G agrupa figuras y Ctrl+Shift+G desagrupa, con soporte de Ctrl+Z', () => {
      const stateManager = new StateManager();
      const commandManager = new CommandManager();
      const canvas = createMockCanvas();
      const controller = new InputController(canvas, stateManager, commandManager);
      const layerId = stateManager.getState().children[0].id;

      const r1: Rectangle = { id: 'r1', type: 'rectangle', name: 'R1', x: 10, y: 10, width: 40, height: 40 };
      const r2: Rectangle = { id: 'r2', type: 'rectangle', name: 'R2', x: 60, y: 10, width: 40, height: 40 };
      stateManager.addShape(layerId, r1);
      stateManager.addShape(layerId, r2);
      stateManager.setSelection(['r1', 'r2']);

      let prevented = false;
      const fakeEventGroup = {
        key: 'g',
        ctrlKey: true,
        shiftKey: false,
        metaKey: false,
        target: { tagName: 'BODY' },
        preventDefault: () => { prevented = true; },
      };

      // Disparar atajo Ctrl+G
      (controller as any).handleKeyDown(fakeEventGroup);
      assert.equal(prevented, true);

      // Ahora debe haber 1 grupo seleccionado
      const sel = stateManager.getSelection();
      assert.equal(sel.length, 1);
      const newGroup = stateManager.findNode(sel[0]);
      assert.equal(newGroup !== null && isGroup(newGroup), true);
      assert.equal((newGroup as Group).children.length, 2);

      // Ctrl+Z revierte la agrupación
      commandManager.undo();
      assert.equal(stateManager.findNode(sel[0]), null);
      assert.notEqual(stateManager.findNode('r1'), null);
      assert.notEqual(stateManager.findNode('r2'), null);

      // Rehacer para volver a tener el grupo
      commandManager.redo();
      const groupId = stateManager.getSelection()[0];
      assert.notEqual(stateManager.findNode(groupId), null);

      // Disparar atajo Ctrl+Shift+G para desagrupar
      prevented = false;
      const fakeEventUngroup = {
        key: 'g',
        ctrlKey: true,
        shiftKey: true,
        metaKey: false,
        target: { tagName: 'BODY' },
        preventDefault: () => { prevented = true; },
      };
      (controller as any).handleKeyDown(fakeEventUngroup);
      assert.equal(prevented, true);

      // El grupo fue desagrupado
      assert.equal(stateManager.findNode(groupId), null);
      assert.deepEqual(stateManager.getSelection(), ['r1', 'r2']);

      // Ctrl+Z revierte el desagrupado (vuelve a crear el grupo)
      commandManager.undo();
      assert.notEqual(stateManager.findNode(groupId), null);

      controller.destroy();
    });
  });
});
