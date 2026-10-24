import type { StateManager } from '../state/StateManager.ts';
import type { CommandManager } from '../commands/CommandManager.ts';
import { InputController } from '../input/InputController.ts';
import { Serializer } from '../state/Serializer.ts';
import { exportDocumentToSvg, downloadSvg } from '../utils/exportSvg.ts';
import { exportDocumentToRasterBlob, downloadRaster, calculateExportBounds } from '../utils/exportRaster.ts';
import { sanitizeFilename } from '../utils/sanitizeFilename.ts';

import type { Document } from '../types/scene-graph.ts';
import { getPresetById, findPresetForSize } from '../utils/artboardPresets.ts';

export interface DialogsControllerOptions {
  readonly stateManager: StateManager;
  readonly commandManager: CommandManager;
  readonly inputController: InputController;
  readonly autoSaveManager?: { clearBackup: () => Promise<void>; saveImmediate: () => Promise<any> };
  readonly onNewDocumentCreated?: () => void;
}

export interface DialogsController {
  readonly openExportDialog: (restoreTarget?: HTMLElement | null) => void;
  readonly closeExportDialog: () => void;
  readonly openSaveJsonDialog?: (restoreTarget?: HTMLElement | null, onSaved?: () => void) => void;
  readonly closeSaveJsonDialog?: () => void;
  readonly openConfirmNewDialog?: (restoreTarget?: HTMLElement | null) => void;
  readonly closeConfirmNewDialog?: () => void;
  readonly openNewDocumentDialog?: (restoreTarget?: HTMLElement | null) => void;
  readonly closeNewDocumentDialog?: () => void;
  readonly openNewDocumentFlow?: (restoreTarget?: HTMLElement | null) => void;
  readonly createNewDocument?: (width: number, height: number, name?: string) => void;
  readonly openShortcutsDialog: () => void;
  readonly closeShortcutsDialog: () => void;
  readonly openAboutDialog: (restoreFocus?: HTMLButtonElement | null) => void;
  readonly closeAboutDialog: () => void;
  readonly exportJson?: (customFilename?: string) => void;
  readonly exportSvg: (customFilename?: string) => void;
  readonly exportPng: (customFilename?: string) => Promise<void>;
  readonly exportWebp: (customFilename?: string) => Promise<void>;
  readonly cleanup: () => void;
}

function debug(...args: unknown[]): void {
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    console.log(...args);
  }
}

export function setupDialogsBindings(options: DialogsControllerOptions): DialogsController {
  const { stateManager, commandManager, inputController } = options;

  const btnExport = document.querySelector<HTMLButtonElement>('#btn-export, #btn-export-json');
  const btnImport = document.querySelector<HTMLButtonElement>('#btn-import');
  const fileImportInput = document.querySelector<HTMLInputElement>('#file-import-input');

  const exportDialog = document.querySelector<HTMLDialogElement>('#export-dialog');
  const btnCloseExport = document.querySelector<HTMLButtonElement>('#btn-close-export');
  const btnCancelExport = document.querySelector<HTMLButtonElement>('#btn-cancel-export');
  const btnConfirmExport = document.querySelector<HTMLButtonElement>('#btn-confirm-export');
  const groupExportScale = document.querySelector<HTMLElement>('#group-export-scale');
  const groupExportBackground = document.querySelector<HTMLElement>('#group-export-background');
  const exportSummaryDim = document.querySelector<HTMLElement>('#export-summary-dim');
  const exportSummaryFilename = document.querySelector<HTMLElement>('#export-summary-filename');
  const radioExportSelection = document.querySelector<HTMLInputElement>('#radio-export-selection');
  const textExportScopeSelection = document.querySelector<HTMLElement>('#text-export-scope-selection');
  const exportFilenameInput = document.querySelector<HTMLInputElement>('#export-filename-input');
  const exportFilenameExtension = document.querySelector<HTMLElement>('#export-filename-extension');
  const radioExportArtboard = document.querySelector<HTMLInputElement>('#radio-export-artboard');
  const textExportScopeArtboard = document.querySelector<HTMLElement>('#text-export-scope-artboard');
  const groupExportArtboardSelect = document.querySelector<HTMLElement>('#group-export-artboard-select');
  const selectExportArtboard = document.querySelector<HTMLSelectElement>('#select-export-artboard');

  const saveJsonDialog = document.querySelector<HTMLDialogElement>('#save-json-dialog');
  const btnCloseSaveJson = document.querySelector<HTMLButtonElement>('#btn-close-save-json');
  const btnCancelSaveJson = document.querySelector<HTMLButtonElement>('#btn-cancel-save-json');
  const btnConfirmSaveJson = document.querySelector<HTMLButtonElement>('#btn-confirm-save-json');
  const saveJsonFilenameInput = document.querySelector<HTMLInputElement>('#save-json-filename-input');
  const formSaveJson = document.querySelector<HTMLFormElement>('#form-save-json');
  let saveJsonRestoreFocus: HTMLElement | null = null;
  let pendingSaveJsonCallback: (() => void) | null = null;

  const confirmNewDialog = document.querySelector<HTMLDialogElement>('#confirm-new-dialog');
  const btnCloseConfirmNew = document.querySelector<HTMLButtonElement>('#btn-close-confirm-new');
  const btnConfirmNewCancel = document.querySelector<HTMLButtonElement>('#btn-confirm-new-cancel');
  const btnConfirmNewDiscard = document.querySelector<HTMLButtonElement>('#btn-confirm-new-discard');
  const btnConfirmNewSave = document.querySelector<HTMLButtonElement>('#btn-confirm-new-save');
  let confirmNewRestoreFocus: HTMLElement | null = null;

  const newDocumentDialog = document.querySelector<HTMLDialogElement>('#new-document-dialog');
  const btnCloseNewDoc = document.querySelector<HTMLButtonElement>('#btn-close-new-doc');
  const formNewDocument = document.querySelector<HTMLFormElement>('#form-new-document');
  const newDocPreset = document.querySelector<HTMLSelectElement>('#new-doc-preset');
  const newDocWidth = document.querySelector<HTMLInputElement>('#new-doc-width');
  const newDocHeight = document.querySelector<HTMLInputElement>('#new-doc-height');
  const btnCancelNewDoc = document.querySelector<HTMLButtonElement>('#btn-cancel-new-doc');
  const btnConfirmNewDoc = document.querySelector<HTMLButtonElement>('#btn-confirm-new-doc');
  let newDocumentRestoreFocus: HTMLElement | null = null;

  const shortcutsDialog = document.querySelector<HTMLDialogElement>('#shortcuts-dialog');
  const shortcutsDialogList = document.querySelector<HTMLElement>('#shortcuts-dialog-list');
  const btnCloseShortcuts = document.querySelector<HTMLButtonElement>('#btn-close-shortcuts');

  const aboutDialog = document.querySelector<HTMLDialogElement>('#about-dialog');
  const btnCloseAbout = document.querySelector<HTMLButtonElement>('#btn-close-about');
  const btnAboutBrand = document.querySelector<HTMLButtonElement>('#btn-about-brand');

  let exportRestoreFocus: HTMLElement | null = null;
  let aboutRestoreFocus: HTMLButtonElement | null = null;

  const exportJson = (customFilename?: string) => {
    if (stateManager) {
      const doc = stateManager.getState();
      const cleanName = customFilename
        ? sanitizeFilename(customFilename)
        : (doc?.name?.trim() ? sanitizeFilename(doc.name) : 'vector-scene');
      const jsonContent = Serializer.serializeDocument(doc);
      Serializer.downloadJson(`${cleanName}.json`, jsonContent);
      debug(`💾 [Serializer] Documento serializado y descargado como ${cleanName}.json`);
    }
  };

  const onExportClick = () => {
    exportJson();
  };

  const getSelectedExportFormat = (): 'svg' | 'png' | 'webp' | 'json' => {
    const radio = document.querySelector<HTMLInputElement>('input[name="export-format"]:checked');
    return (radio?.value as 'svg' | 'png' | 'webp' | 'json') || 'svg';
  };

  const getSelectedExportScale = (): number => {
    const radio = document.querySelector<HTMLInputElement>('input[name="export-scale"]:checked');
    return radio ? parseInt(radio.value, 10) || 1 : 1;
  };

  const getSelectedExportScope = (): 'document' | 'selection' | 'artboard' => {
    const radio = document.querySelector<HTMLInputElement>('input[name="export-scope"]:checked');
    return (radio?.value as 'document' | 'selection' | 'artboard') || 'document';
  };

  const getSelectedExportBg = (): 'transparent' | 'white' => {
    const radio = document.querySelector<HTMLInputElement>('input[name="export-bg"]:checked');
    return (radio?.value as 'transparent' | 'white') || 'transparent';
  };

  const populateExportArtboardSelect = () => {
    if (!selectExportArtboard) return;
    const doc = stateManager.getState();
    const artboards = stateManager.getArtboards?.() ?? (doc?.artboards ?? []);
    const activeArtboard = stateManager.getActiveArtboard();

    const prevValue = selectExportArtboard.value;

    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      selectExportArtboard.innerHTML = '';

      if (artboards.length > 1) {
        const optAll = document.createElement('option');
        optAll.value = 'all';
        optAll.textContent = `Todas las mesas de trabajo (${artboards.length} mesas)`;
        if (typeof selectExportArtboard.appendChild === 'function') {
          selectExportArtboard.appendChild(optAll);
        }
      }

      for (const ab of artboards) {
        const opt = document.createElement('option');
        opt.value = ab.id;
        opt.textContent = `${ab.name} (${Math.round(ab.width)} × ${Math.round(ab.height)} px)`;
        if (typeof selectExportArtboard.appendChild === 'function') {
          selectExportArtboard.appendChild(opt);
        }
      }
    }

    if (activeArtboard && artboards.some((a) => a.id === activeArtboard.id)) {
      selectExportArtboard.value = activeArtboard.id;
    } else if (prevValue && (prevValue === 'all' || artboards.some((a) => a.id === prevValue))) {
      selectExportArtboard.value = prevValue;
    } else if (artboards.length > 1) {
      selectExportArtboard.value = 'all';
    } else if (artboards.length === 1) {
      selectExportArtboard.value = artboards[0].id;
    }
  };

  const updateExportDialogUI = () => {
    const format = getSelectedExportFormat();
    const isRaster = format === 'png' || format === 'webp';
    if (groupExportScale) {
      groupExportScale.style.display = isRaster ? 'flex' : 'none';
    }
    if (groupExportBackground) {
      groupExportBackground.style.display = format === 'json' ? 'none' : 'flex';
    }
    if (exportFilenameExtension) {
      exportFilenameExtension.textContent = `.${format}`;
    }

    const scope = getSelectedExportScope();
    const selection = stateManager.getSelection();
    const hasSelection = selection.length > 0;
    const onlySelected = scope === 'selection' && hasSelection;

    if (groupExportArtboardSelect) {
      groupExportArtboardSelect.style.display = scope === 'artboard' ? 'flex' : 'none';
    }

    const doc = stateManager.getState();
    const artboards = stateManager.getArtboards?.() ?? (doc?.artboards ?? []);
    const selectedArtboardVal = selectExportArtboard ? selectExportArtboard.value : 'all';
    const isAllArtboards = scope === 'artboard' && (selectedArtboardVal === 'all' || (artboards.length > 1 && !selectedArtboardVal));

    const targetArtboard = scope === 'artboard' && !isAllArtboards
      ? (artboards.find((a) => a.id === selectedArtboardVal) ?? stateManager.getActiveArtboard() ?? artboards[0])
      : null;
    const targetArtboardId = targetArtboard?.id;

    const scale = isRaster ? getSelectedExportScale() : 1;
    const bounds = calculateExportBounds(doc, onlySelected, selection, targetArtboardId);

    const w = Math.round(bounds.width * scale);
    const h = Math.round(bounds.height * scale);

    if (exportSummaryDim) {
      if (isAllArtboards) {
        exportSummaryDim.textContent = `Dimensiones: ${artboards.length} mesas de trabajo independientes${isRaster && scale > 1 ? ` (@${scale}x)` : ''}`;
      } else {
        exportSummaryDim.textContent = `Dimensiones: ${w} × ${h} px${isRaster && scale > 1 ? ` (@${scale}x)` : ''}`;
      }
    }

    if (exportSummaryFilename) {
      const scaleSuffix = isRaster && scale > 1 ? `@${scale}x` : '';
      const defaultBaseName = onlySelected
        ? 'seleccion'
        : isAllArtboards
          ? (doc?.name?.trim() ? sanitizeFilename(doc.name) : 'escena')
          : targetArtboard
            ? sanitizeFilename(targetArtboard.name)
            : (doc?.name?.trim() ? sanitizeFilename(doc.name) : 'escena');
      const userFilename = exportFilenameInput ? sanitizeFilename(exportFilenameInput.value) : '';
      const baseName = userFilename || defaultBaseName;

      if (isAllArtboards) {
        exportSummaryFilename.textContent = `Archivos: ${baseName}_[mesa]${scaleSuffix}.${format} (${artboards.length} archivos)`;
      } else {
        exportSummaryFilename.textContent = `Archivo: ${baseName}${scaleSuffix}.${format}`;
      }
    }
  };

  const openExportDialog = (restoreTarget?: HTMLElement | null) => {
    if (!exportDialog) return;
    exportRestoreFocus = restoreTarget ?? (typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null);

    const selection = stateManager.getSelection();
    const hasSelection = selection.length > 0;

    if (radioExportSelection) {
      radioExportSelection.disabled = !hasSelection;
    }
    if (textExportScopeSelection) {
      textExportScopeSelection.textContent = hasSelection
        ? `Solo selección (${selection.length} ${selection.length === 1 ? 'figura' : 'figuras'})`
        : 'Solo selección (sin selección activa)';
    }

    const doc = stateManager.getState();
    const artboards = stateManager.getArtboards?.() ?? (doc?.artboards ?? []);
    const hasArtboards = artboards.length > 0;

    if (radioExportArtboard) {
      radioExportArtboard.disabled = !hasArtboards;
    }
    if (textExportScopeArtboard) {
      textExportScopeArtboard.textContent = hasArtboards
        ? (artboards.length > 1 ? 'Mesas de trabajo' : 'Mesa de trabajo')
        : 'Mesa de trabajo (sin mesas)';
    }

    populateExportArtboardSelect();

    if (!hasSelection) {
      const currentScope = getSelectedExportScope();
      if (currentScope === 'selection') {
        const docScopeRadio = document.querySelector<HTMLInputElement>('input[name="export-scope"][value="document"]');
        if (docScopeRadio) docScopeRadio.checked = true;
      }
    }

    if (exportFilenameInput) {
      if (!exportFilenameInput.value.trim() || exportFilenameInput.dataset.autoName === 'true') {
        const defaultName = hasSelection && radioExportSelection?.checked
          ? 'seleccion'
          : (doc?.name?.trim() ? sanitizeFilename(doc.name) : 'escena');
        exportFilenameInput.value = defaultName;
        exportFilenameInput.dataset.autoName = 'true';
      }
    }

    updateExportDialogUI();

    if (typeof exportDialog.showModal === 'function') {
      exportDialog.showModal();
    } else {
      exportDialog.setAttribute('open', '');
      if (exportDialog.style) {
        exportDialog.style.display = 'block';
      }
    }
  };

  const closeExportDialog = () => {
    if (!exportDialog) return;
    if (typeof exportDialog.close === 'function') {
      exportDialog.close();
    } else {
      exportDialog.removeAttribute('open');
      if (exportDialog.style) {
        exportDialog.style.display = 'none';
      }
    }
    exportRestoreFocus?.focus?.();
  };

  const onExecuteExport = async () => {
    const format = getSelectedExportFormat();
    const scope = getSelectedExportScope();
    const scale = getSelectedExportScale();
    const bg = getSelectedExportBg();
    const doc = stateManager.getState();
    const selection = stateManager.getSelection();
    const onlySelected = scope === 'selection' && selection.length > 0;
    const artboards = stateManager.getArtboards?.() ?? (doc?.artboards ?? []);
    const selectedArtboardVal = selectExportArtboard ? selectExportArtboard.value : 'all';
    const isAllArtboards = scope === 'artboard' && (selectedArtboardVal === 'all' || (artboards.length > 1 && !selectedArtboardVal));

    const targetArtboard = scope === 'artboard' && !isAllArtboards
      ? (artboards.find((a) => a.id === selectedArtboardVal) ?? stateManager.getActiveArtboard() ?? artboards[0])
      : null;
    const targetArtboardId = targetArtboard?.id;

    const defaultBaseName = onlySelected
      ? 'seleccion'
      : isAllArtboards
        ? (doc?.name?.trim() ? sanitizeFilename(doc.name) : 'escena')
        : targetArtboard
          ? sanitizeFilename(targetArtboard.name)
          : (doc?.name?.trim() ? sanitizeFilename(doc.name) : 'escena');
    const userFilename = exportFilenameInput ? sanitizeFilename(exportFilenameInput.value) : '';
    const baseName = userFilename || defaultBaseName;

    closeExportDialog();

    try {
      if (isAllArtboards && artboards.length > 0) {
        const scaleSuffix = scale > 1 ? `@${scale}x` : '';
        for (const ab of artboards) {
          const abName = sanitizeFilename(ab.name) || `mesa-${ab.id}`;
          const itemBaseName = `${baseName}_${abName}`;

          if (format === 'svg') {
            const svgContent = exportDocumentToSvg(doc, {
              artboardId: ab.id,
              includeBackground: bg === 'white',
              backgroundColor: '#ffffff',
            });
            downloadSvg(`${itemBaseName}.svg`, svgContent);
          } else if (format === 'png' || format === 'webp') {
            const blob = await exportDocumentToRasterBlob(doc, {
              format,
              scale,
              artboardId: ab.id,
              backgroundColor: bg === 'white' ? '#ffffff' : null,
            });
            downloadRaster(`${itemBaseName}${scaleSuffix}.${format}`, blob);
          } else if (format === 'json') {
            const jsonContent = Serializer.serializeDocument(doc);
            Serializer.downloadJson(`${itemBaseName}.json`, jsonContent);
          }
        }
        debug(`💾 [Export] ${artboards.length} mesas de trabajo exportadas correctamente en formato ${format.toUpperCase()}`);
      } else {
        if (format === 'svg') {
          const svgContent = exportDocumentToSvg(doc, {
            onlySelected,
            selectedIds: selection,
            artboardId: targetArtboardId,
            includeBackground: bg === 'white',
            backgroundColor: '#ffffff',
          });
          downloadSvg(`${baseName}.svg`, svgContent);
          debug('💾 [Export] SVG exportado correctamente');
        } else if (format === 'png' || format === 'webp') {
          const blob = await exportDocumentToRasterBlob(doc, {
            format,
            scale,
            onlySelected,
            selectedIds: selection,
            artboardId: targetArtboardId,
            backgroundColor: bg === 'white' ? '#ffffff' : null,
          });
          const scaleSuffix = scale > 1 ? `@${scale}x` : '';
          downloadRaster(`${baseName}${scaleSuffix}.${format}`, blob);
          debug(`💾 [Export] ${format.toUpperCase()} exportado correctamente`);
        } else if (format === 'json') {
          const jsonContent = Serializer.serializeDocument(doc);
          Serializer.downloadJson(`${baseName}.json`, jsonContent);
          debug('💾 [Export] JSON exportado correctamente');
        }
      }
    } catch (err) {
      console.error('❌ Error al exportar archivo:', err);
      if (typeof alert !== 'undefined') {
        alert(`Error al exportar: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const exportSvg = (customFilename?: string) => {
    const defaultName = sanitizeFilename(customFilename) || 'escena';
    const svgContent = exportDocumentToSvg(stateManager.getState());
    downloadSvg(`${defaultName}.svg`, svgContent);
  };

  const exportPng = async (customFilename?: string) => {
    const defaultName = sanitizeFilename(customFilename) || 'escena';
    const blob = await exportDocumentToRasterBlob(stateManager.getState(), { format: 'png', scale: 1 });
    downloadRaster(`${defaultName}.png`, blob);
  };

  const exportWebp = async (customFilename?: string) => {
    const defaultName = sanitizeFilename(customFilename) || 'escena';
    const blob = await exportDocumentToRasterBlob(stateManager.getState(), { format: 'webp', scale: 1 });
    downloadRaster(`${defaultName}.webp`, blob);
  };

  const onExportRadioChange = () => {
    if (exportFilenameInput && exportFilenameInput.dataset.autoName === 'true') {
      const scope = getSelectedExportScope();
      const doc = stateManager.getState();
      const selection = stateManager.getSelection();
      const artboards = stateManager.getArtboards?.() ?? (doc?.artboards ?? []);
      const selectedArtboardVal = selectExportArtboard ? selectExportArtboard.value : 'all';
      const isAllArtboards = scope === 'artboard' && (selectedArtboardVal === 'all' || (artboards.length > 1 && !selectedArtboardVal));
      const targetArtboard = scope === 'artboard' && !isAllArtboards
        ? (artboards.find((a) => a.id === selectedArtboardVal) ?? stateManager.getActiveArtboard() ?? artboards[0])
        : null;

      if (scope === 'selection' && selection.length > 0) {
        exportFilenameInput.value = 'seleccion';
      } else if (scope === 'artboard' && !isAllArtboards && targetArtboard) {
        exportFilenameInput.value = sanitizeFilename(targetArtboard.name);
      } else {
        exportFilenameInput.value = doc?.name?.trim() ? sanitizeFilename(doc.name) : 'escena';
      }
    }
    updateExportDialogUI();
  };

  const exportRadioInputs = typeof document.querySelectorAll === 'function'
    ? Array.from(document.querySelectorAll<HTMLInputElement>(
        'input[name="export-format"], input[name="export-scale"], input[name="export-scope"], input[name="export-bg"]'
      ))
    : [];
  exportRadioInputs.forEach((input) => {
    input.addEventListener('change', onExportRadioChange);
  });

  const onExportArtboardSelectChange = () => {
    if (exportFilenameInput && exportFilenameInput.dataset.autoName === 'true') {
      const doc = stateManager.getState();
      const artboards = stateManager.getArtboards?.() ?? (doc?.artboards ?? []);
      const val = selectExportArtboard?.value;
      if (val === 'all') {
        exportFilenameInput.value = doc?.name?.trim() ? sanitizeFilename(doc.name) : 'escena';
      } else {
        const target = artboards.find((a) => a.id === val);
        if (target) {
          exportFilenameInput.value = sanitizeFilename(target.name);
        }
      }
    }
    updateExportDialogUI();
  };
  selectExportArtboard?.addEventListener('change', onExportArtboardSelectChange);

  const onExportFilenameInputChange = () => {
    if (exportFilenameInput) {
      exportFilenameInput.dataset.autoName = 'false';
    }
    updateExportDialogUI();
  };
  exportFilenameInput?.addEventListener('input', onExportFilenameInputChange);

  // Guardar JSON Modal Dialog
  const openSaveJsonDialog = (restoreTarget?: HTMLElement | null, onSaved?: () => void) => {
    pendingSaveJsonCallback = onSaved ?? null;
    if (!saveJsonDialog) {
      onExportClick();
      if (pendingSaveJsonCallback) {
        const cb = pendingSaveJsonCallback;
        pendingSaveJsonCallback = null;
        cb();
      }
      return;
    }
    saveJsonRestoreFocus = restoreTarget ?? (typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null);

    const doc = stateManager?.getState();
    const defaultName = doc?.name?.trim() ? sanitizeFilename(doc.name) : 'vector-scene';
    if (saveJsonFilenameInput) {
      saveJsonFilenameInput.value = defaultName;
    }

    if (typeof saveJsonDialog.showModal === 'function') {
      saveJsonDialog.showModal();
    } else {
      saveJsonDialog.setAttribute('open', '');
      if (saveJsonDialog.style) {
        saveJsonDialog.style.display = 'block';
      }
    }

    saveJsonFilenameInput?.focus?.();
    saveJsonFilenameInput?.select?.();
  };

  const closeSaveJsonDialog = () => {
    if (!saveJsonDialog) return;
    if (typeof saveJsonDialog.close === 'function') {
      saveJsonDialog.close();
    } else {
      saveJsonDialog.removeAttribute('open');
      if (saveJsonDialog.style) {
        saveJsonDialog.style.display = 'none';
      }
    }
    saveJsonRestoreFocus?.focus?.();
  };

  const onCancelSaveJsonClick = () => {
    pendingSaveJsonCallback = null;
    closeSaveJsonDialog();
  };

  const onConfirmSaveJson = (e?: Event) => {
    e?.preventDefault?.();
    if (!stateManager) return;

    const doc = stateManager.getState();
    const rawName = saveJsonFilenameInput?.value.trim() || '';
    const cleanName = sanitizeFilename(rawName) || (doc?.name?.trim() ? sanitizeFilename(doc.name) : 'vector-scene');

    closeSaveJsonDialog();

    const jsonContent = Serializer.serializeDocument(doc);
    Serializer.downloadJson(`${cleanName}.json`, jsonContent);
    debug(`💾 [Serializer] Documento guardado como ${cleanName}.json`);

    if (pendingSaveJsonCallback) {
      const cb = pendingSaveJsonCallback;
      pendingSaveJsonCallback = null;
      cb();
    }
  };

  btnCloseSaveJson?.addEventListener('click', onCancelSaveJsonClick);
  btnCancelSaveJson?.addEventListener('click', onCancelSaveJsonClick);
  formSaveJson?.addEventListener('submit', onConfirmSaveJson);
  btnConfirmSaveJson?.addEventListener('click', onConfirmSaveJson);

  // Flujo Nuevo Documento: Diálogo de Confirmación de Guardado
  const openConfirmNewDialog = (restoreTarget?: HTMLElement | null) => {
    if (!confirmNewDialog) {
      openNewDocumentDialog(restoreTarget);
      return;
    }
    confirmNewRestoreFocus = restoreTarget ?? (typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null);
    if (typeof confirmNewDialog.showModal === 'function') {
      confirmNewDialog.showModal();
    } else {
      confirmNewDialog.setAttribute('open', '');
      if (confirmNewDialog.style) {
        confirmNewDialog.style.display = 'block';
      }
    }
    btnConfirmNewSave?.focus?.();
  };

  const closeConfirmNewDialog = () => {
    if (!confirmNewDialog) return;
    if (typeof confirmNewDialog.close === 'function') {
      confirmNewDialog.close();
    } else {
      confirmNewDialog.removeAttribute('open');
      if (confirmNewDialog.style) {
        confirmNewDialog.style.display = 'none';
      }
    }
    confirmNewRestoreFocus?.focus?.();
  };

  const onConfirmNewSaveClick = () => {
    closeConfirmNewDialog();
    openSaveJsonDialog(confirmNewRestoreFocus, () => {
      openNewDocumentDialog(confirmNewRestoreFocus);
    });
  };

  const onConfirmNewDiscardClick = () => {
    closeConfirmNewDialog();
    openNewDocumentDialog(confirmNewRestoreFocus);
  };

  btnCloseConfirmNew?.addEventListener('click', closeConfirmNewDialog);
  btnConfirmNewCancel?.addEventListener('click', closeConfirmNewDialog);
  btnConfirmNewDiscard?.addEventListener('click', onConfirmNewDiscardClick);
  btnConfirmNewSave?.addEventListener('click', onConfirmNewSaveClick);

  // Flujo Nuevo Documento: Diálogo de Dimensiones de Mesa de Trabajo
  const openNewDocumentDialog = (restoreTarget?: HTMLElement | null) => {
    if (!newDocumentDialog) return;
    newDocumentRestoreFocus = restoreTarget ?? (typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null);

    if (newDocPreset) newDocPreset.value = 'full-hd';
    if (newDocWidth) newDocWidth.value = '1920';
    if (newDocHeight) newDocHeight.value = '1080';

    if (typeof newDocumentDialog.showModal === 'function') {
      newDocumentDialog.showModal();
    } else {
      newDocumentDialog.setAttribute('open', '');
      if (newDocumentDialog.style) {
        newDocumentDialog.style.display = 'block';
      }
    }
    newDocPreset?.focus?.();
  };

  const closeNewDocumentDialog = () => {
    if (!newDocumentDialog) return;
    if (typeof newDocumentDialog.close === 'function') {
      newDocumentDialog.close();
    } else {
      newDocumentDialog.removeAttribute('open');
      if (newDocumentDialog.style) {
        newDocumentDialog.style.display = 'none';
      }
    }
    newDocumentRestoreFocus?.focus?.();
  };

  const onNewDocPresetChange = () => {
    if (!newDocPreset) return;
    const presetId = newDocPreset.value;
    if (presetId === 'custom') return;
    const preset = getPresetById(presetId);
    if (preset) {
      if (newDocWidth) newDocWidth.value = String(preset.width);
      if (newDocHeight) newDocHeight.value = String(preset.height);
    }
  };

  const onNewDocDimensionInput = () => {
    if (!newDocWidth || !newDocHeight || !newDocPreset) return;
    const w = parseInt(newDocWidth.value, 10);
    const h = parseInt(newDocHeight.value, 10);
    if (w > 0 && h > 0) {
      const matching = findPresetForSize(w, h);
      newDocPreset.value = matching ? matching.id : 'custom';
    }
  };

  const createNewDocument = (width: number, height: number, name: string = 'Nuevo Documento') => {
    const validWidth = Math.max(1, Math.round(width || 1920));
    const validHeight = Math.max(1, Math.round(height || 1080));

    const newDoc: Document = {
      id: 'doc-root',
      type: 'document',
      name,
      width: validWidth,
      height: validHeight,
      children: [
        {
          id: `layer-${Date.now()}`,
          type: 'layer',
          name: 'Capa 1',
          visible: true,
          locked: false,
          opacity: 1,
          children: [],
        },
      ],
      guides: [],
    };

    stateManager.loadState(newDoc);
    commandManager.clear();
    stateManager.setSelection([]);
    inputController?.setTool('select');
    inputController?.centerArtboard?.(true);
    options.autoSaveManager?.clearBackup?.();
    options.onNewDocumentCreated?.();
    debug(`📄 [Nuevo Documento] Creado con éxito (${validWidth} × ${validHeight}) y mesa de trabajo centrada.`);
  };

  const onConfirmNewDocSubmit = (e?: Event) => {
    e?.preventDefault?.();
    const w = parseInt(newDocWidth?.value || '1920', 10);
    const h = parseInt(newDocHeight?.value || '1080', 10);
    closeNewDocumentDialog();
    createNewDocument(w, h);
  };

  btnCloseNewDoc?.addEventListener('click', closeNewDocumentDialog);
  btnCancelNewDoc?.addEventListener('click', closeNewDocumentDialog);
  formNewDocument?.addEventListener('submit', onConfirmNewDocSubmit);
  btnConfirmNewDoc?.addEventListener('click', onConfirmNewDocSubmit);
  newDocPreset?.addEventListener('change', onNewDocPresetChange);
  newDocWidth?.addEventListener('input', onNewDocDimensionInput);
  newDocHeight?.addEventListener('input', onNewDocDimensionInput);

  const openNewDocumentFlow = (restoreTarget?: HTMLElement | null) => {
    openConfirmNewDialog(restoreTarget);
  };

  btnCloseExport?.addEventListener('click', closeExportDialog);
  btnCancelExport?.addEventListener('click', closeExportDialog);
  btnConfirmExport?.addEventListener('click', onExecuteExport);

  const unsubscribeExportRequest = inputController.on('exportRequest', () => {
    openExportDialog();
  });

  btnExport?.addEventListener('click', onExportClick);

  // Importación JSON
  const onImportClick = (e: MouseEvent) => {
    if (e.target !== fileImportInput) {
      fileImportInput?.click();
    }
  };

  const onFileInputClick = (e: MouseEvent) => {
    e.stopPropagation?.();
  };

  const onFileChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file || !stateManager) return;

    const readWithFileReader = (f: Blob | File) => {
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const text = typeof reader.result === 'string' ? reader.result : '';
          const doc = await Serializer.parseDocument(text);
          stateManager.loadState(doc);
          commandManager.clear();
          inputController.zoomFit();
          debug('📂 [Serializer] Documento importado y cargado con éxito:', doc);
        } catch (error) {
          console.error('❌ Error al importar documento JSON:', error);
          if (typeof alert !== 'undefined') {
            alert(`Error al importar el archivo JSON: ${error instanceof Error ? error.message : String(error)}`);
          }
        } finally {
          target.value = '';
        }
      };

      reader.onerror = () => {
        console.error('❌ Error al leer el archivo con FileReader:', reader.error);
        target.value = '';
      };

      reader.readAsText(f);
    };

    if (typeof FileReader !== 'undefined') {
      readWithFileReader(file);
    } else if (typeof file.text === 'function') {
      (async () => {
        try {
          const text = await file.text();
          const doc = await Serializer.parseDocument(text);
          stateManager.loadState(doc);
          commandManager.clear();
          inputController.zoomFit();
          debug('📂 [Serializer] Documento importado y cargado con éxito:', doc);
        } catch (error) {
          console.error('❌ Error al importar documento JSON:', error);
          if (typeof alert !== 'undefined') {
            alert(`Error al importar el archivo JSON: ${error instanceof Error ? error.message : String(error)}`);
          }
        } finally {
          target.value = '';
        }
      })();
    }
  };

  btnImport?.addEventListener('click', onImportClick);
  fileImportInput?.addEventListener('click', onFileInputClick);
  fileImportInput?.addEventListener('change', onFileChange);

  // Atajos de teclado
  const populateShortcutsDialog = () => {
    if (!shortcutsDialogList) return;
    const shortcuts = typeof inputController.getShortcuts === 'function'
      ? inputController.getShortcuts()
      : InputController.SHORTCUTS;

    shortcutsDialogList.innerHTML = '';
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const table = document.createElement('table');
      table.className = 'shortcuts-table';
      const tbody = document.createElement('tbody');

      for (const item of shortcuts) {
        const tr = document.createElement('tr');

        const tdCat = document.createElement('td');
        tdCat.className = 'shortcut-category';
        tdCat.textContent = item.category;

        const tdDesc = document.createElement('td');
        tdDesc.className = 'shortcut-desc';
        tdDesc.textContent = item.description;

        const tdKey = document.createElement('td');
        tdKey.className = 'shortcut-key';
        tdKey.textContent = item.key;

        tr.appendChild(tdCat);
        tr.appendChild(tdDesc);
        tr.appendChild(tdKey);
        tbody.appendChild(tr);
      }

      table.appendChild(tbody);
      shortcutsDialogList.appendChild(table);
    }
  };

  const openShortcutsDialog = () => {
    if (!shortcutsDialog) return;
    populateShortcutsDialog();
    if (typeof shortcutsDialog.showModal === 'function') {
      shortcutsDialog.showModal();
    } else {
      shortcutsDialog.setAttribute('open', '');
      if (shortcutsDialog.style) {
        shortcutsDialog.style.display = 'block';
      }
    }
  };

  const closeShortcutsDialog = () => {
    if (!shortcutsDialog) return;
    if (typeof shortcutsDialog.close === 'function') {
      shortcutsDialog.close();
    } else {
      shortcutsDialog.removeAttribute('open');
      if (shortcutsDialog.style) {
        shortcutsDialog.style.display = 'none';
      }
    }
  };

  btnCloseShortcuts?.addEventListener('click', closeShortcutsDialog);

  // Inicializar atajos en el diálogo
  populateShortcutsDialog();

  // Acerca de
  const openAboutDialog = (restoreFocus: HTMLButtonElement | null = null) => {
    if (!aboutDialog) return;
    aboutRestoreFocus = restoreFocus;
    if (typeof aboutDialog.showModal === 'function') {
      aboutDialog.showModal();
    } else {
      aboutDialog.setAttribute('open', '');
      if (aboutDialog.style) {
        aboutDialog.style.display = 'block';
      }
    }
  };

  const closeAboutDialog = () => {
    if (!aboutDialog) return;
    if (typeof aboutDialog.close === 'function') {
      aboutDialog.close();
    } else {
      aboutDialog.removeAttribute('open');
      if (aboutDialog.style) {
        aboutDialog.style.display = 'none';
      }
    }
    aboutRestoreFocus?.focus?.();
  };

  const onBrandAboutClick = () => {
    openAboutDialog(btnAboutBrand);
  };

  btnAboutBrand?.addEventListener('click', onBrandAboutClick);
  btnCloseAbout?.addEventListener('click', closeAboutDialog);

  const onDocumentKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (confirmNewDialog && (confirmNewDialog.open || confirmNewDialog.hasAttribute?.('open'))) {
        e.preventDefault?.();
        closeConfirmNewDialog();
      } else if (newDocumentDialog && (newDocumentDialog.open || newDocumentDialog.hasAttribute?.('open'))) {
        e.preventDefault?.();
        closeNewDocumentDialog();
      } else if (exportDialog && (exportDialog.open || exportDialog.hasAttribute?.('open'))) {
        e.preventDefault?.();
        closeExportDialog();
      } else if (saveJsonDialog && (saveJsonDialog.open || saveJsonDialog.hasAttribute?.('open'))) {
        e.preventDefault?.();
        onCancelSaveJsonClick();
      }
    }
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', onDocumentKeyDown);
  }

  return {
    openNewDocumentFlow,
    openConfirmNewDialog,
    closeConfirmNewDialog,
    openNewDocumentDialog,
    closeNewDocumentDialog,
    createNewDocument,
    openExportDialog,
    closeExportDialog,
    openSaveJsonDialog,
    closeSaveJsonDialog,
    openShortcutsDialog,
    closeShortcutsDialog,
    openAboutDialog,
    closeAboutDialog,
    exportJson,
    exportSvg,
    exportPng,
    exportWebp,
    cleanup: () => {
      exportFilenameInput?.removeEventListener('input', onExportFilenameInputChange);
      btnCloseSaveJson?.removeEventListener('click', onCancelSaveJsonClick);
      btnCancelSaveJson?.removeEventListener('click', onCancelSaveJsonClick);
      formSaveJson?.removeEventListener('submit', onConfirmSaveJson);
      btnConfirmSaveJson?.removeEventListener('click', onConfirmSaveJson);

      btnCloseConfirmNew?.removeEventListener('click', closeConfirmNewDialog);
      btnConfirmNewCancel?.removeEventListener('click', closeConfirmNewDialog);
      btnConfirmNewDiscard?.removeEventListener('click', onConfirmNewDiscardClick);
      btnConfirmNewSave?.removeEventListener('click', onConfirmNewSaveClick);

      btnCloseNewDoc?.removeEventListener('click', closeNewDocumentDialog);
      btnCancelNewDoc?.removeEventListener('click', closeNewDocumentDialog);
      formNewDocument?.removeEventListener('submit', onConfirmNewDocSubmit);
      btnConfirmNewDoc?.removeEventListener('click', onConfirmNewDocSubmit);
      newDocPreset?.removeEventListener('change', onNewDocPresetChange);
      newDocWidth?.removeEventListener('input', onNewDocDimensionInput);
      newDocHeight?.removeEventListener('input', onNewDocDimensionInput);

      btnExport?.removeEventListener('click', onExportClick);
      btnImport?.removeEventListener('click', onImportClick);
      fileImportInput?.removeEventListener('click', onFileInputClick);
      fileImportInput?.removeEventListener('change', onFileChange);

      btnCloseExport?.removeEventListener('click', closeExportDialog);
      btnCancelExport?.removeEventListener('click', closeExportDialog);
      btnConfirmExport?.removeEventListener('click', onExecuteExport);
      exportRadioInputs.forEach((input) => {
        input.removeEventListener('change', onExportRadioChange);
      });
      selectExportArtboard?.removeEventListener('change', onExportArtboardSelectChange);
      unsubscribeExportRequest?.();

      btnCloseShortcuts?.removeEventListener('click', closeShortcutsDialog);
      btnAboutBrand?.removeEventListener('click', onBrandAboutClick);
      btnCloseAbout?.removeEventListener('click', closeAboutDialog);

      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('keydown', onDocumentKeyDown);
      }
    },
  };
}
