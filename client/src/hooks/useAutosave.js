import { useEffect, useRef, useState, useCallback } from 'react';
import * as api from '../utils/api';

/*
 * useAutosave — debounced PUT of an existing quotation to /api/quotations/:id.
 *
 * Diseño minimalista alineado con SPEC-FIX-01 versión pragmática (Opción A):
 *   - Sólo aplica a cotizaciones YA persistidas (con quotId). Nuevas requieren
 *     que el usuario haga el primer Guardar para crear el registro.
 *   - Debounce configurable (default 1500ms). Cada cambio reinicia el timer.
 *   - Skip si el `data` actual es idéntico al último persistido (deep-equal).
 *   - Estado expuesto: 'idle' | 'saving' | 'saved' | 'error'.
 *   - flush() expone un save inmediato (para llamar antes de export, navegar,
 *     o `beforeunload`).
 *   - Feature flag por env var. Si REACT_APP_AUTOSAVE_ENABLED no es 'true',
 *     el hook queda inerte (no agenda ningún save). Permite kill-switch.
 *
 * Lo que NO hace (diferido a una iteración posterior):
 *   - Optimistic locking con If-Match / _version (no hay columna aún).
 *   - Idempotency-Key (no hay Redis para cachear respuestas).
 *   - Offline queue con IndexedDB.
 *   - Conflict resolution UI.
 *   - Retry con backoff exponencial. Si falla, queda en estado 'error' y
 *     reintenta en el siguiente cambio del usuario.
 */

const ENABLED = process.env.REACT_APP_AUTOSAVE_ENABLED === 'true';

function stableStringify(obj) {
  // Deterministic JSON for diff detection. Sufficient for shallow equality
  // checks on the editor state shape (no Date/Map/etc on the wire).
  try { return JSON.stringify(obj); } catch (_) { return ''; }
}

export function useAutosave({ quotId, data, debounceMs = 1500, onSaved, onError }) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const lastSavedSnapshotRef = useRef(null);
  const timerRef = useRef(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(null);

  const doSave = useCallback(async (snapshot) => {
    if (!quotId) return;
    if (inFlightRef.current) {
      // Another save is in flight — queue this one as the next "pending"
      // payload to send right after the current finishes.
      pendingRef.current = snapshot;
      return;
    }
    inFlightRef.current = true;
    setStatus('saving');
    try {
      const resp = await api.updateQuotation(quotId, snapshot);
      lastSavedSnapshotRef.current = stableStringify(snapshot);
      setLastSavedAt(new Date());
      setStatus('saved');
      if (onSaved) onSaved(resp);
    } catch (err) {
      setStatus('error');
      if (onError) onError(err);
    } finally {
      inFlightRef.current = false;
      // If there were edits during the save, send the latest pending
      // snapshot now (collapses N intermediate edits into 1 follow-up PUT).
      if (pendingRef.current) {
        const next = pendingRef.current;
        pendingRef.current = null;
        // Don't await — caller doesn't need to know about this chained save.
        doSave(next);
      }
    }
  }, [quotId, onSaved, onError]);

  // Schedule a debounced save when `data` changes.
  useEffect(() => {
    if (!ENABLED) return undefined;
    if (!quotId) return undefined; // new quotation: needs explicit Guardar first
    const snapshot = stableStringify(data);
    // Initial mount: capture baseline without firing a save.
    if (lastSavedSnapshotRef.current == null) {
      lastSavedSnapshotRef.current = snapshot;
      return undefined;
    }
    if (snapshot === lastSavedSnapshotRef.current) return undefined;
    // Debounce
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      doSave(data);
    }, debounceMs);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [quotId, data, debounceMs, doSave]);

  // flush() — caller fuerza un save inmediato (para export, navegación, etc.).
  const flush = useCallback(async () => {
    if (!ENABLED) return;
    if (!quotId) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const snapshot = stableStringify(data);
    if (snapshot === lastSavedSnapshotRef.current) return;
    await doSave(data);
  }, [quotId, data, doSave]);

  // Reset baseline desde fuera (después de un POST que crea la cotización
  // y nos retorna el estado canónico, o después de cargar desde server).
  const resetBaseline = useCallback((newData) => {
    lastSavedSnapshotRef.current = stableStringify(newData);
    setStatus('idle');
  }, []);

  return { enabled: ENABLED, status, lastSavedAt, flush, resetBaseline };
}

export default useAutosave;
