import { useCallback, useEffect, useRef, useState } from "react";
import { documentsClient } from "@dynatrace-sdk/client-document";
import { usersAndGroupsClient } from "@dynatrace-sdk/client-iam";
import { getEnvironmentId } from "@dynatrace-sdk/app-environment";
import { cleanSnapshot, isMapSnapshot } from "./useMapPersistence";
import type { MapSnapshot } from "./useMapPersistence";

// Hook de datos para el historial de versiones (snapshots nativos del Document service).
// Agrupa los snapshots por fecha, resuelve nombres de usuarios en lote y expone
// operaciones de lectura y mutación: obtener contenido, restaurar, eliminar y paginar.
//
// Nota de permisos: listSnapshots requiere ESCRITURA sobre el documento (no basta
// solo-lectura). Si el usuario no tiene permiso, el hook queda en estado error=true
// con groups vacío (manejo con gracia en la UI).

const LEVEL_TYPE = "environment";
const PAGE_SIZE = 25;

// Nombre legible a partir de los campos del directorio IAM.
const displayName = (name?: string, surname?: string, email?: string): string => {
  const full = [name, surname].filter(Boolean).join(" ").trim();
  return full || email || "Usuario";
};

// Iniciales: primera letra del nombre en mayúscula, fallback al primer carácter del uid.
const initials = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed[0].toUpperCase();
};

// Formatea la hora local en 12h con AM/PM.
const toTimeLabel = (date: Date): string =>
  date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });

// Formatea la fecha local en formato legible ("Jun 23, 2026").
const toDateLabel = (date: Date): string =>
  date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

// ── Tipos exportados ──────────────────────────────────────────────────────────

export type VersionItem = {
  snapshotVersion: number; // número de versión auto-incremental (1, 2, 3…)
  label: string;           // "V3"
  createdTime: string;     // ISO 8601
  timeLabel: string;       // "9:08 AM" (hora local, 12h)
  dateLabel: string;       // "Jun 23, 2026" (fecha local)
  userName: string;        // "Stevenson Ramirez Castano" (o uid si no resuelve)
  userInitials: string;    // "S"
};

export type VersionGroup = { dateLabel: string; items: VersionItem[] };

export function useMapVersions(mapId: string | null): {
  groups: VersionGroup[];
  totalCount: number;
  loading: boolean;
  error: boolean;
  refresh: () => void;
  fetchMore: () => void;
  hasMore: boolean;
  getContent: (snapshotVersion: number) => Promise<MapSnapshot>;
  restoreServer: (snapshotVersion: number) => Promise<void>;
  deleteServer: (snapshotVersion: number) => Promise<void>;
} {
  const levelId = getEnvironmentId();

  // Estado principal
  const [groups, setGroups] = useState<VersionGroup[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [nextPageKey, setNextPageKey] = useState<string | undefined>(undefined);

  // Caché de uid → nombre resuelto (persiste entre refrescos del mismo hook).
  const userCacheRef = useRef<Map<string, string>>(new Map());

  // Token de carga: ignora resultados de una petición vieja si mapId cambió.
  const loadTokenRef = useRef(0);

  // ── Resolución de usuarios IAM ──────────────────────────────────────────────
  const resolveUsers = useCallback(
    async (uids: string[]): Promise<void> => {
      // Solo los uids que no están en caché.
      const missing = uids.filter((uid) => !userCacheRef.current.has(uid));
      if (missing.length === 0) return;
      for (let i = 0; i < missing.length; i += 25) {
        const chunk = missing.slice(i, i + 25);
        try {
          const res = await usersAndGroupsClient.getActiveUsersForOrganizationalLevel({
            levelType: LEVEL_TYPE,
            levelId,
            uuid: chunk,
          });
          for (const u of res.results ?? []) {
            userCacheRef.current.set(u.uid, displayName(u.name, u.surname, u.email));
          }
        } catch {
          // Sin permiso iam:users:read o error transitorio: fallback al uid crudo.
        }
        // Usuarios no encontrados en este lote: los dejamos sin resolver para que
        // el paso siguiente use el uid como fallback (sin reintentos).
      }
    },
    [levelId],
  );

  // ── Conversión de SnapshotMetadata a VersionItem ───────────────────────────
  const toItem = useCallback((snap: {
    snapshotVersion: number;
    modificationInfo: { createdBy: string; createdTime: Date };
  }): VersionItem => {
    const date = snap.modificationInfo.createdTime instanceof Date
      ? snap.modificationInfo.createdTime
      : new Date(snap.modificationInfo.createdTime);
    const uid = snap.modificationInfo.createdBy;
    const resolvedName = userCacheRef.current.get(uid) ?? uid;
    return {
      snapshotVersion: snap.snapshotVersion,
      label: `V${snap.snapshotVersion}`,
      createdTime: date.toISOString(),
      timeLabel: toTimeLabel(date),
      dateLabel: toDateLabel(date),
      userName: resolvedName,
      userInitials: initials(resolvedName),
    };
  }, []);

  // ── Agrupa VersionItem[] por dateLabel preservando el orden descendente ─────
  const groupByDate = (items: VersionItem[]): VersionGroup[] => {
    const map = new Map<string, VersionItem[]>();
    for (const item of items) {
      const existing = map.get(item.dateLabel);
      if (existing) {
        existing.push(item);
      } else {
        map.set(item.dateLabel, [item]);
      }
    }
    return Array.from(map.entries()).map(([dateLabel, grpItems]) => ({ dateLabel, items: grpItems }));
  };

  // ── Carga inicial o refresco completo ──────────────────────────────────────
  const load = useCallback(async () => {
    if (!mapId) {
      setGroups([]);
      setTotalCount(0);
      setNextPageKey(undefined);
      setError(false);
      return;
    }
    const token = ++loadTokenRef.current;
    const current = () => token === loadTokenRef.current;

    setLoading(true);
    setError(false);
    try {
      const res = await documentsClient.listSnapshots({ id: mapId, pageSize: PAGE_SIZE });
      if (!current()) return;

      // Resolver los usuarios mencionados en esta página.
      const uids = [...new Set(res.snapshots.map((s) => s.modificationInfo.createdBy))];
      await resolveUsers(uids);
      if (!current()) return;

      const items = res.snapshots.map(toItem);
      setGroups(groupByDate(items));
      setTotalCount(res.totalCount);
      setNextPageKey(res.nextPageKey);
    } catch {
      if (current()) {
        setError(true);
        setGroups([]);
        setTotalCount(0);
        setNextPageKey(undefined);
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, [mapId, resolveUsers, toItem]);

  // ── Paginación: cargar la siguiente página y AÑADIR al estado actual ───────
  const fetchMore = useCallback(async () => {
    if (!mapId || !nextPageKey || loading) return;
    const token = ++loadTokenRef.current;
    const current = () => token === loadTokenRef.current;

    setLoading(true);
    try {
      const res = await documentsClient.listSnapshots({ id: mapId, pageSize: PAGE_SIZE, pageKey: nextPageKey });
      if (!current()) return;

      const uids = [...new Set(res.snapshots.map((s) => s.modificationInfo.createdBy))];
      await resolveUsers(uids);
      if (!current()) return;

      const newItems = res.snapshots.map(toItem);
      setGroups((prev) => {
        // Fusionar con los grupos existentes: si el último grupo ya tiene esa fecha,
        // seguir añadiendo; si no, crear un grupo nuevo.
        const merged: VersionGroup[] = [...prev];
        for (const item of newItems) {
          const existing = merged.find((g) => g.dateLabel === item.dateLabel);
          if (existing) {
            existing.items.push(item);
          } else {
            merged.push({ dateLabel: item.dateLabel, items: [item] });
          }
        }
        return merged;
      });
      setNextPageKey(res.nextPageKey);
    } catch {
      // Error de paginación: no borramos lo ya cargado, solo paramos.
    } finally {
      if (current()) setLoading(false);
    }
  }, [mapId, nextPageKey, loading, resolveUsers, toItem]);

  // ── Obtener el contenido de una versión específica ─────────────────────────
  const getContent = useCallback(
    async (snapshotVersion: number): Promise<MapSnapshot> => {
      if (!mapId) throw new Error("Sin mapa activo");
      const res = await documentsClient.getDocument({ id: mapId, snapshotVersion });
      const text = res.content ? await res.content.get("text") : "";
      // JSON corrupto NO debe lanzar (rompería la acción sin mensaje): cae al
      // mismo camino de "forma inválida" → snapshot vacío.
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      if (!isMapSnapshot(parsed)) {
        // Snapshot con forma inválida: devolvemos nodos/edges vacíos (mejor que
        // lanzar, que rompería la UI).
        return cleanSnapshot({ nodes: [], edges: [] });
      }
      return cleanSnapshot(parsed);
    },
    [mapId],
  );

  // ── Restaurar el documento a una versión (server-side) ─────────────────────
  const restoreServer = useCallback(
    async (snapshotVersion: number): Promise<void> => {
      if (!mapId) throw new Error("Sin mapa activo");
      await documentsClient.restoreSnapshot({ id: mapId, snapshotVersion });
    },
    [mapId],
  );

  // ── Eliminar una versión (server-side) ─────────────────────────────────────
  // No refresca automáticamente: el caller llama refresh() tras confirmar.
  const deleteServer = useCallback(
    async (snapshotVersion: number): Promise<void> => {
      if (!mapId) throw new Error("Sin mapa activo");
      await documentsClient.deleteSnapshot({ id: mapId, snapshotVersion });
    },
    [mapId],
  );

  // Recarga al cambiar de mapa o al llamar load() (via refresh).
  useEffect(() => {
    void load();
  }, [load]);

  return {
    groups,
    totalCount,
    loading,
    error,
    refresh: () => void load(),
    fetchMore: () => void fetchMore(),
    hasMore: nextPageKey !== undefined,
    getContent,
    restoreServer,
    deleteServer,
  };
}
