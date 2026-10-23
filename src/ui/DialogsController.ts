import type { StateManager } from '../state/StateManager.ts';
import type { CommandManager } from '../commands/CommandManager.ts';
import { InputController } from '../input/InputController.ts';
import { Serializer } from '../state/Serializer.ts';
import { exportDocumentToSvg, downloadSvg } from '../utils/exportSvg.ts';
import { exportDocumentToRasterBlob, downloadRaster, calculateExportBounds } from '../utils/exportRaster.ts';
import { sanitizeFilename } from '../utils/sanitizeFilename.ts';

export interface DialogsControllerOptions {
  readonly stateManager: StateManager;
  readonly commandManager: CommandManager;
  readonly inputController: InputController;
}

export interface DialogsController {
  readonly openExportDialog: (restoreTarget?: HTMLElement | null) => void;
  readonly closeExportDialog: () => void;
  readonly openSaveJsonDialog?: (restoreTarget?: HTMLElement | null) => void;
  readonly closeSaveJsonDialog?: () => void;
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

  const saveJsonDialog = document.querySelector<HTMLDialogElement>('#save-json-dialog');
  const btnCloseSaveJson = document.querySelector<HTMLButtonElement>('#btn-close-save-json');
  const btnCancelSaveJson = document.querySelector<HTMLButtonElement>('#btn-cancel-save-json');
  const btnConfirmSaveJson = document.querySelector<HTMLButtonElement>('#btn-confirm-save-json');
  const saveJsonFilenameInput = document.querySelector<HTMLInputElement>('#save-json-filename-input');
  const formSaveJson = document.querySelector<HTMLFormElement>('#form-save-json');
  let saveJsonRestoreFocus: HTMLElement | null = null;

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

  const getSelectedExportScope = (): 'document' | 'selection' => {
    const radio = document.querySelector<HTMLInputElement>('input[name="export-scope"]:checked');
    return (radio?.value as 'document' | 'selection') || 'document';
  };

  const getSelectedExportBg = (): 'transparent' | 'white' => {
    const radio = document.querySelector<HTMLInputElement>('input[name="export-bg"]:checked');
    return (radio?.value as 'transparent' | 'white') || 'transparent';
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

    const scale = isRaster ? getSelectedExportScale() : 1;
    const doc = stateManager.getState();
    const bounds = calculateExportBounds(doc, onlySelected, selection);

    const w = Math.round(bounds.width * scale);
    const h = Math.round(bounds.height * scale);

    if (exportSummaryDim) {
      exportSummaryDim.textContent = `Dimensiones: ${w} × ${h} px${isRaster && scale > 1 ? ` (@${scale}x)` : ''}`;
    }

    if (exportSummaryFilename) {
      const scaleSuffix = isRaster && scale > 1 ? `@${scale}x` : '';
      const defaultBaseName = onlySelected ? 'seleccion' : (doc?.name?.trim() ? sanitizeFilename(doc.name) : 'escena');
      const userFilename = exportFilenameInput ? sanitizeFilename(exportFilenameInput.value) : '';
      const baseName = userFilename || defaultBaseName;
      exportSummaryFilename.textContent = `Archivo: ${baseName}${scaleSuffix}.${format}`;
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

    if (!hasSelection) {
      const docScopeRadio = document.querySelector<HTMLInputElement>('input[name="export-scope"][value="document"]');
      if (docScopeRadio) docScopeRadio.checked = true;
    }

    if (exportFilenameInput) {
      if (!exportFilenameInput.value.trim() || exportFilenameInput.dataset.autoName === 'true') {
        const doc = stateManager.getState();
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
    const defaultBaseName = onlySelected ? 'seleccion' : (doc?.name?.trim() ? sanitizeFilename(doc.name) : 'escena');
    const userFilename = exportFilenameInput ? sanitizeFilename(exportFilenameInput.value) : '';
    const baseName = userFilename || defaultBaseName;

    closeExportDialog();

    try {
      if (format === 'svg') {
        const svgContent = exportDocumentToSvg(doc, {
          onlySelected,
          selectedIds: selection,
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

  const onExportFilenameInputChange = () => {
    if (exportFilenameInput) {
      exportFilenameInput.dataset.autoName = 'false';
    }
    updateExportDialogUI();
  };
  exportFilenameInput?.addEventListener('input', onExportFilenameInputChange);

  // Guardar JSON Modal Dialog
  const openSaveJsonDialog = (restoreTarget?: HTMLElement | null) => {
    if (!saveJsonDialog) {
      onExportClick();
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
  };

  btnCloseSaveJson?.addEventListener('click', closeSaveJsonDialog);
  btnCancelSaveJson?.addEventListener('click', closeSaveJsonDialog);
  formSaveJson?.addEventListener('submit', onConfirmSaveJson);
  btnConfirmSaveJson?.addEventListener('click', onConfirmSaveJson);

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
      if (exportDialog && (exportDialog.open || exportDialog.hasAttribute?.('open'))) {
        e.preventDefault?.();
        closeExportDialog();
      } else if (saveJsonDialog && (saveJsonDialog.open || saveJsonDialog.hasAttribute?.('open'))) {
        e.preventDefault?.();
        closeSaveJsonDialog();
      }
    }
  };

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', onDocumentKeyDown);
  }

  return {
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
      btnCloseSaveJson?.removeEventListener('click', closeSaveJsonDialog);
      btnCancelSaveJson?.removeEventListener('click', closeSaveJsonDialog);
      formSaveJson?.removeEventListener('submit', onConfirmSaveJson);
      btnConfirmSaveJson?.removeEventListener('click', onConfirmSaveJson);

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
