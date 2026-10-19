import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { StateManager } from '../src/state/StateManager.ts';
import { CommandManager } from '../src/commands/CommandManager.ts';
import { Serializer } from '../src/state/Serializer.ts';
import { AddShapeCommand } from '../src/commands/AddShapeCommand.ts';
import { ResizeCommand } from '../src/commands/ResizeCommand.ts';
import { getShapeAABB, isPointInShape, getSelectionHandles } from '../src/utils/geometry.ts';
import { getShapeCenter, getShapeDimensions, rotateShapesAboutPivot, scaleShapesAboutAnchor } from '../src/utils/transform.ts';
import { exportDocumentToSvg } from '../src/utils/exportSvg.ts';
import { isShape, isImage, type Document, type ImageNode, type AssetData } from '../src/types/scene-graph.ts';

describe('ImageNode & Colocación de Imágenes Externas', () => {
  let stateManager: StateManager;
  let commandManager: CommandManager;

  const sampleAsset: AssetData = {
    id: 'asset-img-1',
    mimeType: 'image/png',
    data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    width: 640,
    height: 480,
  };

  const createSampleDoc = (): Document => ({
    id: 'doc-1',
    type: 'document',
    name: 'Test Doc',
    width: 1200,
    height: 800,
    assets: {
      [sampleAsset.id]: sampleAsset,
    },
    children: [
      {
        id: 'layer-1',
        type: 'layer',
        name: 'Capa 1',
        children: [],
      },
    ],
  });

  beforeEach(() => {
    commandManager = new CommandManager();
    stateManager = new StateManager(createSampleDoc(), commandManager);
  });

  it('1. Type Guards reconocen ImageNode como Shape y como Image', () => {
    const img: ImageNode = {
      id: 'img-1',
      type: 'image',
      name: 'Logo',
      assetId: sampleAsset.id,
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      naturalWidth: 640,
      naturalHeight: 480,
    };

    assert.equal(isShape(img), true);
    assert.equal(isImage(img), true);
  });

  it('2. StateManager gestiona assets en Document y los preserva inmutablemente', () => {
    const newAsset: AssetData = {
      id: 'asset-img-2',
      mimeType: 'image/jpeg',
      data: 'data:image/jpeg;base64,sample2',
      width: 800,
      height: 600,
    };

    stateManager.registerAsset(newAsset);
    assert.deepEqual(stateManager.getAsset('asset-img-2'), newAsset);
    assert.equal(Object.keys(stateManager.getAssets()).length, 2);
  });

  it('3. Añadir ImageNode mediante AddShapeCommand registra en historial y soporta Undo/Redo', () => {
    const img: ImageNode = {
      id: 'img-node-1',
      type: 'image',
      name: 'Fotografía',
      assetId: sampleAsset.id,
      x: 50,
      y: 50,
      width: 300,
      height: 200,
    };

    const cmd = new AddShapeCommand(stateManager, img, 'layer-1');
    commandManager.executeCommand(cmd);

    assert.ok(stateManager.findNode('img-node-1'));
    assert.equal(stateManager.getState().children[0].children.length, 1);

    commandManager.undo();
    assert.equal(stateManager.findNode('img-node-1'), null);
    assert.equal(stateManager.getState().children[0].children.length, 0);

    commandManager.redo();
    assert.ok(stateManager.findNode('img-node-1'));
    assert.equal(stateManager.getState().children[0].children.length, 1);
  });

  it('4. Geometría: getShapeAABB, isPointInShape y getSelectionHandles operan correctamente sobre ImageNode', () => {
    const img: ImageNode = {
      id: 'img-geo-1',
      type: 'image',
      name: 'Hero Image',
      assetId: sampleAsset.id,
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      rotation: 0,
    };

    const aabb = getShapeAABB(img);
    assert.equal(aabb.minX, 100);
    assert.equal(aabb.minY, 100);
    assert.equal(aabb.width, 200);
    assert.equal(aabb.height, 100);

    // Hit-testing
    assert.equal(isPointInShape(150, 150, img), true);
    assert.equal(isPointInShape(50, 50, img), false);

    // Manejadores de selección OBB
    const handles = getSelectionHandles(img);
    assert.equal(handles.length, 5); // 4 esquinas + 1 manejador de rotación
    const types = handles.map((h) => h.type);
    assert.ok(types.includes('top-left'));
    assert.ok(types.includes('bottom-right'));
    assert.ok(types.includes('rotation-handle'));
  });

  it('5. Transformaciones: getShapeCenter, getShapeDimensions, rotación y escalado de ImageNode', () => {
    const img: ImageNode = {
      id: 'img-trans-1',
      type: 'image',
      name: 'Trans',
      assetId: sampleAsset.id,
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      rotation: 0,
    };

    const center = getShapeCenter(img);
    assert.equal(center.x, 200);
    assert.equal(center.y, 150);

    const dims = getShapeDimensions(img);
    assert.equal(dims.width, 200);
    assert.equal(dims.height, 100);

    // Rotar 90 grados alrededor de su centro
    const rotated = rotateShapesAboutPivot([img], center, 90);
    assert.equal(rotated.length, 1);
    assert.equal(rotated[0].dimensions.rotation, 90);

    // Escalar al 200%
    const scaled = scaleShapesAboutAnchor([img], { x: 100, y: 100 }, 2, 2);
    assert.equal(scaled.length, 1);
    assert.equal(scaled[0].dimensions.width, 400);
    assert.equal(scaled[0].dimensions.height, 200);
  });

  it('6. updateShapesDimensions actualiza ImageNode y soporta ResizeCommand con Undo/Redo', () => {
    const img: ImageNode = {
      id: 'img-resize-1',
      type: 'image',
      name: 'Banner',
      assetId: sampleAsset.id,
      x: 50,
      y: 50,
      width: 200,
      height: 100,
    };

    stateManager.addNode('layer-1', img);

    const initialDims = { x: 50, y: 50, width: 200, height: 100 };
    const finalDims = { x: 60, y: 60, width: 300, height: 150 };

    const cmd = new ResizeCommand(stateManager, 'img-resize-1', initialDims, finalDims);
    commandManager.executeCommand(cmd);

    const updated = stateManager.findNode('img-resize-1') as ImageNode;
    assert.equal(updated.width, 300);
    assert.equal(updated.height, 150);

    commandManager.undo();
    const undone = stateManager.findNode('img-resize-1') as ImageNode;
    assert.equal(undone.width, 200);
    assert.equal(undone.height, 100);

    commandManager.redo();
    const redone = stateManager.findNode('img-resize-1') as ImageNode;
    assert.equal(redone.width, 300);
    assert.equal(redone.height, 150);
  });

  it('7. Serializer guarda y recupera ImageNode y Document.assets manteniendo integridad referencial', async () => {
    const img: ImageNode = {
      id: 'img-serial-1',
      type: 'image',
      name: 'Icono',
      assetId: sampleAsset.id,
      x: 120,
      y: 80,
      width: 64,
      height: 64,
      opacity: 0.85,
    };

    stateManager.addNode('layer-1', img);
    const jsonStr = Serializer.serializeDocument(stateManager.getState());

    assert.ok(jsonStr.includes('"type": "image"'));
    assert.ok(jsonStr.includes(sampleAsset.id));

    const parsed = await Serializer.parseDocument(jsonStr);
    assert.ok(parsed.assets?.[sampleAsset.id]);
    assert.equal(parsed.assets[sampleAsset.id].width, 640);

    const parsedImg = parsed.children[0].children[0] as ImageNode;
    assert.equal(parsedImg.type, 'image');
    assert.equal(parsedImg.assetId, sampleAsset.id);
    assert.equal(parsedImg.width, 64);
    assert.equal(parsedImg.opacity, 0.85);
  });

  it('8. exportDocumentToSvg genera elemento <image> con atributos de posicionamiento y href', () => {
    const img: ImageNode = {
      id: 'img-svg-1',
      type: 'image',
      name: 'Grafico',
      assetId: sampleAsset.id,
      x: 20,
      y: 30,
      width: 400,
      height: 300,
      rotation: 15,
      opacity: 0.9,
    };

    stateManager.addNode('layer-1', img);
    const svgCode = exportDocumentToSvg(stateManager.getState());

    assert.ok(svgCode.includes('<image'));
    assert.ok(svgCode.includes('href="data:image/png;base64,'));
    assert.ok(svgCode.includes('width="400"'));
    assert.ok(svgCode.includes('height="300"'));
    assert.ok(svgCode.includes('transform="rotate(15'));
  });

  it('9. PlacementController.placeFiles coloca una imagen, la añade al Scene Graph y la selecciona con Undo/Redo', async () => {
    const { setupPlacementController } = await import('../src/ui/PlacementController.ts');
    const { ViewportManager } = await import('../src/utils/viewport.ts');

    const viewportManager = new ViewportManager();
    const controller = setupPlacementController({
      stateManager,
      commandManager,
      viewportManager,
    });

    const file = new File(['fake-png-data'], 'test-photo.png', { type: 'image/png' });
    await controller.placeFiles([file]);

    const layer = stateManager.getState().children[0];
    assert.equal(layer.children.length, 1, 'Debe haber 1 figura añadida a la capa activa');

    const placedNode = layer.children[0] as ImageNode;
    assert.equal(placedNode.type, 'image');
    assert.equal(placedNode.name, 'test-photo');
    assert.ok(placedNode.assetId);

    // Debe quedar seleccionada automáticamente
    assert.deepEqual(stateManager.getSelection(), [placedNode.id]);

    // Deshacer (Undo) remueve la figura
    commandManager.undo();
    assert.equal(stateManager.getState().children[0].children.length, 0);

    // Rehacer (Redo) vuelve a colocarla
    commandManager.redo();
    assert.equal(stateManager.getState().children[0].children.length, 1);
    assert.equal(stateManager.getState().children[0].children[0].id, placedNode.id);

    controller.cleanup();
  });

  it('10. PlacementController.placeFiles con múltiples archivos utiliza BatchCommand en una sola acción', async () => {
    const { setupPlacementController } = await import('../src/ui/PlacementController.ts');
    const { ViewportManager } = await import('../src/utils/viewport.ts');

    const viewportManager = new ViewportManager();
    const controller = setupPlacementController({
      stateManager,
      commandManager,
      viewportManager,
    });

    const file1 = new File(['fake-1'], 'photo1.jpg', { type: 'image/jpeg' });
    const file2 = new File(['fake-2'], 'photo2.jpg', { type: 'image/jpeg' });
    await controller.placeFiles([file1, file2]);

    const layer = stateManager.getState().children[0];
    assert.equal(layer.children.length, 2, 'Deben haberse añadido 2 figuras');

    // Deshacer una sola vez debe remover ambas figuras
    commandManager.undo();
    assert.equal(stateManager.getState().children[0].children.length, 0);

    // Rehacer restaura ambas
    commandManager.redo();
    assert.equal(stateManager.getState().children[0].children.length, 2);

    controller.cleanup();
  });

  it('11. PlacementController.placeFiles con archivo SVG importa figuras vectoriales editables', async () => {
    const { setupPlacementController } = await import('../src/ui/PlacementController.ts');
    const { ViewportManager } = await import('../src/utils/viewport.ts');

    const viewportManager = new ViewportManager();
    const controller = setupPlacementController({
      stateManager,
      commandManager,
      viewportManager,
    });

    const svgContent = '<svg width="200" height="200"><rect x="10" y="10" width="80" height="50" fill="#ff0000" /></svg>';
    const svgFile = new File([svgContent], 'vector.svg', { type: 'image/svg+xml' });
    await controller.placeFiles([svgFile]);

    const layer = stateManager.getState().children[0];
    assert.equal(layer.children.length, 1);
    const shape = layer.children[0];
    assert.equal(shape.type, 'rectangle');

    controller.cleanup();
  });
});
