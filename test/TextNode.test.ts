import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDocument,
  isLayer,
  isGroup,
  isShape,
  isSelectable,
  isText,
  isRectangle,
  isEllipse,
  isPath,
  type Text,
  type TextNode,
  type Rectangle,
  type Ellipse,
  type Path,
  type Group,
} from '../src/types/scene-graph.ts';
import { StateManager } from '../src/state/StateManager.ts';
import { cloneNode } from '../src/utils/cloneShape.ts';

describe('Modelo de Datos para Texto (Text Node)', () => {
  it('instancia un nodo Text con propiedades mínimas requeridas', () => {
    const textNode: Text = {
      id: 'text-1',
      type: 'text',
      name: 'Texto 1',
      x: 100,
      y: 200,
      text: 'Hola Mundo',
    };

    assert.equal(textNode.id, 'text-1');
    assert.equal(textNode.type, 'text');
    assert.equal(textNode.name, 'Texto 1');
    assert.equal(textNode.x, 100);
    assert.equal(textNode.y, 200);
    assert.equal(textNode.text, 'Hola Mundo');
  });

  it('alias TextNode es equivalente al tipo Text', () => {
    const textNode: TextNode = {
      id: 'text-alias',
      type: 'text',
      name: 'Texto Alias',
      x: 10,
      y: 20,
      text: 'Prueba Alias',
    };

    assert.equal(textNode.type, 'text');
  });

  it('admite todas las propiedades visuales, tipográficas y de transformación definidas en el modelo', () => {
    const textNode: Text = {
      id: 'text-full',
      type: 'text',
      name: 'Texto Completo',
      x: 50,
      y: 75,
      text: 'Diseño Vectorial',
      fontFamily: 'Inter',
      fontSize: 24,
      fontWeight: 'bold',
      fontStyle: 'italic',
      textAlign: 'center',
      fill: '#38bdf8',
      rotation: 45,
      opacity: 0.9,
      visible: true,
      locked: false,
      zIndex: 2,
    };

    assert.equal(textNode.fontFamily, 'Inter');
    assert.equal(textNode.fontSize, 24);
    assert.equal(textNode.fontWeight, 'bold');
    assert.equal(textNode.fontStyle, 'italic');
    assert.equal(textNode.textAlign, 'center');
    assert.equal(textNode.fill, '#38bdf8');
    assert.equal(textNode.rotation, 45);
    assert.equal(textNode.opacity, 0.9);
    assert.equal(textNode.visible, true);
    assert.equal(textNode.locked, false);
    assert.equal(textNode.zIndex, 2);
  });

  describe('Type Guards', () => {
    const sampleText: Text = {
      id: 'text-tg',
      type: 'text',
      name: 'Texto TG',
      x: 10,
      y: 20,
      text: 'Test',
    };

    const sampleRect: Rectangle = {
      id: 'rect-tg',
      type: 'rectangle',
      name: 'Rect TG',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    };

    const sampleEllipse: Ellipse = {
      id: 'ellipse-tg',
      type: 'ellipse',
      name: 'Ellipse TG',
      x: 50,
      y: 50,
      radiusX: 25,
      radiusY: 25,
    };

    const samplePath: Path = {
      id: 'path-tg',
      type: 'path',
      name: 'Path TG',
      x: 0,
      y: 0,
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    };

    it('isText reconoce nodos de tipo text e invalida otros tipos', () => {
      assert.equal(isText(sampleText), true);
      assert.equal(isText(sampleRect), false);
      assert.equal(isText(sampleEllipse), false);
      assert.equal(isText(samplePath), false);
    });

    it('los demás type guards discriminan negativamente a Text', () => {
      assert.equal(isRectangle(sampleText), false);
      assert.equal(isEllipse(sampleText), false);
      assert.equal(isPath(sampleText), false);
      assert.equal(isGroup(sampleText), false);
      assert.equal(isLayer(sampleText), false);
      assert.equal(isDocument(sampleText), false);
    });

    it('isShape reconoce nodos Text como Shape', () => {
      assert.equal(isShape(sampleText), true);
    });

    it('isSelectable reconoce nodos Text como SelectableNode', () => {
      assert.equal(isSelectable(sampleText), true);
    });
  });

  describe('Integración con StateManager y Scene Graph', () => {
    it('agrega un Text a una Layer y lo encuentra mediante findNode', () => {
      const stateManager = new StateManager();
      const layerId = stateManager.getState().children[0].id;

      const text: Text = {
        id: 'text-layer-1',
        type: 'text',
        name: 'Título',
        x: 40,
        y: 80,
        text: 'Mi Título',
        fontSize: 32,
      };

      stateManager.addShape(layerId, text);

      const found = stateManager.findNode('text-layer-1');
      assert.notEqual(found, null);
      assert.equal(isText(found!), true);
      if (isText(found!)) {
        assert.equal(found.text, 'Mi Título');
        assert.equal(found.fontSize, 32);
      }
    });

    it('agrega un Text dentro de un Group', () => {
      const stateManager = new StateManager();
      const layerId = stateManager.getState().children[0].id;

      const group: Group = {
        id: 'group-1',
        type: 'group',
        name: 'Grupo con texto',
        children: [],
      };

      stateManager.addNode(layerId, group);

      const text: Text = {
        id: 'text-in-group',
        type: 'text',
        name: 'Etiqueta',
        x: 15,
        y: 25,
        text: 'Elemento Agrupado',
      };

      stateManager.addShape('group-1', text);

      const found = stateManager.findNode('text-in-group');
      assert.notEqual(found, null);
      assert.equal(isText(found!), true);

      const parent = stateManager.findParent('text-in-group');
      assert.equal(parent?.id, 'group-1');
    });

    it('soporta selección simple y múltiple de nodos Text', () => {
      const stateManager = new StateManager();
      const layerId = stateManager.getState().children[0].id;

      const text1: Text = { id: 't1', type: 'text', name: 'T1', x: 0, y: 0, text: 'A' };
      const text2: Text = { id: 't2', type: 'text', name: 'T2', x: 10, y: 10, text: 'B' };

      stateManager.addShape(layerId, text1);
      stateManager.addShape(layerId, text2);

      stateManager.setSelection(['t1']);
      assert.equal(stateManager.isSelected('t1'), true);
      assert.equal(stateManager.isSelected('t2'), false);

      stateManager.addToSelection(['t2']);
      const selected = stateManager.getSelectedNodes();
      assert.equal(selected.length, 2);
      assert.equal(selected.some((n) => n.id === 't1'), true);
      assert.equal(selected.some((n) => n.id === 't2'), true);
    });

    it('actualiza posición de Text mediante updateShapesPosition', () => {
      const stateManager = new StateManager();
      const layerId = stateManager.getState().children[0].id;

      const text: Text = { id: 't-mov', type: 'text', name: 'T Mov', x: 10, y: 20, text: 'Mover' };
      stateManager.addShape(layerId, text);

      stateManager.updateShapesPosition([{ id: 't-mov', x: 50, y: 60 }]);

      const updated = stateManager.findNode('t-mov');
      assert.notEqual(updated, null);
      if (isText(updated!)) {
        assert.equal(updated.x, 50);
        assert.equal(updated.y, 60);
      }
    });

    it('permite clonar nodos Text con cloneNode preservando propiedades y aplicando desplazamiento', () => {
      const original: Text = {
        id: 't-orig',
        type: 'text',
        name: 'Texto Original',
        x: 100,
        y: 150,
        text: 'Clonable',
        fontFamily: 'Inter',
        fontSize: 18,
        fontWeight: 'bold',
        fontStyle: 'normal',
        textAlign: 'left',
        fill: '#ffffff',
        rotation: 15,
        opacity: 0.8,
      };

      const clone = cloneNode(original, { dx: 20, dy: 30, newId: 't-cloned', newName: 'Texto Copia' });
      assert.equal(clone.id, 't-cloned');
      assert.equal(clone.name, 'Texto Copia');
      assert.equal(clone.x, 120);
      assert.equal(clone.y, 180);
      assert.equal(clone.text, 'Clonable');
      assert.equal(clone.fontFamily, 'Inter');
      assert.equal(clone.fontSize, 18);
      assert.equal(clone.fontWeight, 'bold');
      assert.equal(clone.fontStyle, 'normal');
      assert.equal(clone.textAlign, 'left');
      assert.equal(clone.fill, '#ffffff');
      assert.equal(clone.rotation, 15);
      assert.equal(clone.opacity, 0.8);
      assert.equal(Object.isFrozen(clone), true);
    });

    it('elimina un nodo Text del Scene Graph mediante removeShape', () => {
      const stateManager = new StateManager();
      const layerId = stateManager.getState().children[0].id;

      const text: Text = { id: 't-del', type: 'text', name: 'Borrar', x: 0, y: 0, text: 'Chau' };
      stateManager.addShape(layerId, text);
      assert.notEqual(stateManager.findNode('t-del'), null);

      stateManager.removeShape('t-del');
      assert.equal(stateManager.findNode('t-del'), null);
    });
  });
});
