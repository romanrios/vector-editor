import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AssetManager, MAX_ASSET_DIMENSION } from '../src/assets/AssetManager.ts';
import type { AssetData } from '../src/types/scene-graph.ts';

describe('AssetManager - Gestión de Recursos Multimedia y Deduplicación', () => {
  let manager: AssetManager;

  beforeEach(() => {
    manager = new AssetManager();
  });

  it('1. MAX_ASSET_DIMENSION define un límite de 4096 píxeles para protección de VRAM', () => {
    assert.equal(MAX_ASSET_DIMENSION, 4096);
  });

  it('2. Registra y recupera un activo (AssetData) por su ID', () => {
    const asset: AssetData = {
      id: 'asset-test-1',
      mimeType: 'image/png',
      data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      width: 100,
      height: 100,
    };

    manager.registerAsset(asset);
    const retrieved = manager.getAsset('asset-test-1');
    assert.deepEqual(retrieved, asset);
  });

  it('3. Deduplicación CAS: encuentra un activo existente por su contenido data', () => {
    const dataString = 'data:image/png;base64,sample-binary-content-12345';
    const asset: AssetData = {
      id: 'asset-dedup-1',
      mimeType: 'image/png',
      data: dataString,
      width: 200,
      height: 150,
    };

    manager.registerAsset(asset);
    const foundId = manager.findAssetIdByData(dataString);
    assert.equal(foundId, 'asset-dedup-1');
  });

  it('4. Permite almacenar y recuperar imágenes renderizables en caché en memoria', () => {
    const mockRenderable = { width: 50, height: 50 } as unknown as ImageBitmap;
    manager.setRenderable('asset-cache-1', mockRenderable);

    const cached = manager.getRenderable('asset-cache-1');
    assert.equal(cached, mockRenderable);
  });

  it('5. createAssetFromDataUrl reutiliza el mismo assetId si los datos coinciden exactamente', async () => {
    const sampleDataUrl = 'data:image/png;base64,AAAA';
    const res1 = await manager.createAssetFromDataUrl(sampleDataUrl, 'image/png');
    const res2 = await manager.createAssetFromDataUrl(sampleDataUrl, 'image/png');

    assert.equal(res1.asset.id, res2.asset.id);
    assert.equal(res1.asset.data, sampleDataUrl);
  });

  it('6. clear() purga todos los registros y cachés de memoria', () => {
    const asset: AssetData = {
      id: 'asset-clear-test',
      mimeType: 'image/png',
      data: 'data:image/png;base64,sample',
      width: 80,
      height: 80,
    };
    manager.registerAsset(asset);
    manager.setRenderable(asset.id, {} as unknown as ImageBitmap);

    manager.clear();
    assert.equal(manager.getAsset(asset.id), undefined);
    assert.equal(manager.getRenderable(asset.id), undefined);
    assert.equal(manager.findAssetIdByData(asset.data), undefined);
  });
});
