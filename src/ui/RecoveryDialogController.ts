import type { StateManager } from '../state/StateManager.ts';
import type { CommandManager } from '../commands/CommandManager.ts';
import type { InputController } from '../input/InputController.ts';
import type { AutoSaveManager, AutoSaveSession } from '../state/AutoSaveManager.ts';

export interface RecoveryDialogControllerOptions {
  readonly autoSaveManager: AutoSaveManager;
  readonly stateManager: StateManager;
  readonly commandManager: CommandManager;
  readonly inputController?: InputController;
  readonly onRestored?: (session: AutoSaveSession) => void;
  readonly onDiscarded?: () => void;
}

export interface RecoveryDialogController {
  readonly openRecoveryDialog: (session: AutoSaveSession, restoreTarget?: HTMLElement | null) => void;
  readonly closeRecoveryDialog: () => void;
  readonly checkAndPromptRecovery: (restoreTarget?: HTMLElement | null) => Promise<boolean>;
  readonly cleanup: () => void;
}

/**
 * Formatea una marca temporal en una cadena de fecha y hora amigable y localizada.
 */
export function formatBackupTimestamp(timestamp: number): string {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return 'Reciente';
    }

    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (isToday) {
      return `Hoy a las ${timeStr}`;
    }

    const dateStr = date.toLocaleDateString([], {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    return `${dateStr} a las ${timeStr}`;
  } catch {
    return 'Sesión previa';
  }
}

/**
 * Configura los enlaces e interacciones del diálogo de recuperación de sesión.
 */
export function setupRecoveryDialogBindings(options: RecoveryDialogControllerOptions): RecoveryDialogController {
  const { autoSaveManager, stateManager, commandManager, inputController, onRestored, onDiscarded } = options;

  const recoveryDialog = document.querySelector<HTMLDialogElement>('#recovery-dialog');
  const btnClose = document.querySelector<HTMLButtonElement>('#btn-close-recovery');
  const btnDiscard = document.querySelector<HTMLButtonElement>('#btn-recovery-discard');
  const btnRestore = document.querySelector<HTMLButtonElement>('#btn-recovery-restore');
  const labelTime = document.querySelector<HTMLElement>('#recovery-dialog-time');
  const labelSummary = document.querySelector<HTMLElement>('#recovery-dialog-summary');
  const labelMeta = document.querySelector<HTMLElement>('#recovery-dialog-meta');

  let restoreFocusTarget: HTMLElement | null = null;
  let activeSession: AutoSaveSession | null = null;

  const closeRecoveryDialog = () => {
    if (recoveryDialog?.open) {
      if (typeof recoveryDialog.close === 'function') {
        recoveryDialog.close();
      } else {
        recoveryDialog.removeAttribute('open');
      }
    }
    if (restoreFocusTarget && typeof restoreFocusTarget.focus === 'function') {
      restoreFocusTarget.focus();
      restoreFocusTarget = null;
    }
  };

  const openRecoveryDialog = (session: AutoSaveSession, restoreTarget?: HTMLElement | null) => {
    if (!recoveryDialog) {
      return;
    }

    activeSession = session;
    restoreFocusTarget = restoreTarget ?? (document.activeElement as HTMLElement | null);

    if (labelTime) {
      labelTime.textContent = formatBackupTimestamp(session.timestamp);
    }

    if (labelSummary) {
      const { width, height } = session.dimensions;
      labelSummary.textContent = `${session.documentName} (${width} × ${height} px)`;
    }

    if (labelMeta) {
      const shapesLabel = session.shapesCount === 1 ? '1 figura' : `${session.shapesCount} figuras`;
      const layersLabel = session.layersCount === 1 ? '1 capa' : `${session.layersCount} capas`;
      labelMeta.textContent = `${shapesLabel} en ${layersLabel}`;
    }

    if (typeof recoveryDialog.showModal === 'function') {
      try {
        recoveryDialog.showModal();
      } catch {
        recoveryDialog.setAttribute('open', '');
      }
    } else {
      recoveryDialog.setAttribute('open', '');
    }

    // Foco en el botón de restaurar
    btnRestore?.focus?.();
  };

  const onRestoreClick = () => {
    if (!activeSession) {
      closeRecoveryDialog();
      return;
    }

    try {
      // Cargar el documento restaurado en el Scene Graph inmutable
      stateManager.loadState(activeSession.document);
      commandManager.clear();
      stateManager.setSelection([]);
      inputController?.zoomFit?.();

      onRestored?.(activeSession);
    } catch (err) {
      console.error('❌ [RecoveryDialog] Error al restaurar la sesión:', err);
    } finally {
      closeRecoveryDialog();
      activeSession = null;
    }
  };

  const onDiscardClick = async () => {
    try {
      await autoSaveManager.clearBackup();
      onDiscarded?.();
    } catch (err) {
      console.warn('⚠️ [RecoveryDialog] Error al limpiar respaldo:', err);
    } finally {
      closeRecoveryDialog();
      activeSession = null;
    }
  };

  const onCloseClick = () => {
    closeRecoveryDialog();
  };

  // Event Listeners
  btnRestore?.addEventListener('click', onRestoreClick);
  btnDiscard?.addEventListener('click', onDiscardClick);
  btnClose?.addEventListener('click', onCloseClick);

  /**
   * Comprueba si hay una sesión pendiente de recuperación y, de ser así, abre el diálogo.
   */
  const checkAndPromptRecovery = async (restoreTarget?: HTMLElement | null): Promise<boolean> => {
    try {
      const hasRecoverable = await autoSaveManager.hasRecoverableSession();
      if (!hasRecoverable) {
        return false;
      }

      const session = await autoSaveManager.getSavedSession();
      if (!session) {
        return false;
      }

      openRecoveryDialog(session, restoreTarget);
      return true;
    } catch (err) {
      console.warn('⚠️ [RecoveryDialog] Error al verificar sesión recuperable:', err);
      return false;
    }
  };

  const cleanup = () => {
    btnRestore?.removeEventListener('click', onRestoreClick);
    btnDiscard?.removeEventListener('click', onDiscardClick);
    btnClose?.removeEventListener('click', onCloseClick);
    closeRecoveryDialog();
  };

  return {
    openRecoveryDialog,
    closeRecoveryDialog,
    checkAndPromptRecovery,
    cleanup,
  };
}
