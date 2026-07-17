import { useCallback, useEffect, useRef, useState } from "react";
import { directSharesClient } from "@dynatrace-sdk/client-document";
import { usersAndGroupsClient } from "@dynatrace-sdk/client-iam";
import type { SsoEntity } from "@dynatrace-sdk/client-document";
import { getCurrentUserDetails, getEnvironmentId } from "@dynatrace-sdk/app-environment";
import { useT } from "../i18n";

// Compartir un mapa (un documento del Document service) con otras personas, al
// estilo del menú "Share" de Notebooks pero acotado a nuestro caso (Forma A):
//
//  • Quien comparte usa SUS PROPIOS permisos (la app no presta los suyos). Por
//    eso el que comparte necesita en su perfil `iam:users:read` (buscar persona)
//    y `document:direct-shares:*`. Quien RECIBE no necesita nada de esto.
//  • Se comparte escribiendo el CORREO de la persona; la app lo traduce al
//    sso-id interno por detrás (la API de shares trabaja con sso-id, no correo).
//  • Dos roles: "Solo lectura" (access "read") o "Edición" (access "read-write").
//
// Modelo del Document service (límite clave): un documento admite COMO MÁXIMO un
// share por tipo de acceso. Así que manejamos 2 "cubos" por mapa —uno de lectura
// y otro de edición— y movemos a la persona entre ellos. Una persona queda en un
// solo rol (el más alto): al darle "Edición" se la quita de "Solo lectura".

export type ShareRole = "read" | "read-write";

export type ShareRecipient = {
  uid: string;
  type: string; // "user" | "group"
  role: ShareRole;
  name: string; // nombre legible (correo si no hay nombre)
  email: string;
};

export type FoundUser = { uid: string; name: string; email: string; type?: "user" | "group" };

export type OwnerInfo = { name: string; email: string };

const LEVEL_TYPE = "environment";

// "Nombre Apellido" legible a partir de los campos del directorio IAM.
const displayName = (name?: string, surname?: string, email?: string): string => {
  const full = [name, surname].filter(Boolean).join(" ").trim();
  return full || email || "Usuario";
};

// ¿Este share es de EDICIÓN? El backend puede devolver el acceso como
// ["read-write"] o como ["read","write"]; cubrimos ambas formas.
const isWriteShare = (access: string[]): boolean =>
  access.includes("read-write") || access.includes("write");

// Saca un mensaje legible del error del SDK (los errores tipados traen el detalle
// en `body.error.message` / `body.message` / `message`). Para mostrar la CAUSA
// real en vez de un genérico.
const detailMsg = (e: unknown): string | null => {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  const body = o.body;
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const err = b.error;
    if (err && typeof err === "object") {
      const m = (err as Record<string, unknown>).message;
      if (typeof m === "string" && m) return m;
    }
    if (typeof b.message === "string" && b.message) return b.message;
  }
  if (typeof o.message === "string" && o.message) return o.message;
  return null;
};

export const useMapShare = (documentId: string | null) => {
  const t = useT();
  const [recipients, setRecipients] = useState<ShareRecipient[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false); // alguna mutación en curso
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null); // aviso suave (no error)

  // Ids de los shares (cubos) read / read-write del documento, una vez creados.
  const readShareRef = useRef<string | null>(null);
  const writeShareRef = useRef<string | null>(null);
  // Token de carga: una carga vieja (documentId anterior / modal cerrado) no debe
  // pisar el estado de una nueva. Cada load() toma un token y solo escribe si
  // sigue siendo el vigente al terminar.
  const loadTokenRef = useRef(0);

  const owner: OwnerInfo = (() => {
    const u = getCurrentUserDetails();
    return { name: u.name || u.email, email: u.email };
  })();
  const levelId = getEnvironmentId();

  // Resuelve sso-ids → nombre/correo en lote (filtro uuid admite hasta 25).
  const resolveUsers = useCallback(
    async (uids: string[]): Promise<Map<string, FoundUser>> => {
      const map = new Map<string, FoundUser>();
      if (uids.length === 0) return map;
      for (let i = 0; i < uids.length; i += 25) {
        const chunk = uids.slice(i, i + 25);
        try {
          const res = await usersAndGroupsClient.getActiveUsersForOrganizationalLevel({
            levelType: LEVEL_TYPE,
            levelId,
            uuid: chunk,
          });
          for (const u of res.results ?? []) {
            map.set(u.uid, { uid: u.uid, name: displayName(u.name, u.surname, u.email), email: u.email });
          }
        } catch {
          /* si no se puede resolver un lote, mostramos el id crudo (fallback) */
        }
      }
      return map;
    },
    [levelId],
  );

  // Resuelve sso-ids de GRUPO → nombre del grupo (API distinta a la de usuarios;
  // filtro uuid admite hasta 10). Requiere scope iam:groups:read; si no está,
  // cae al uid crudo sin romper.
  const resolveGroups = useCallback(
    async (uids: string[]): Promise<Map<string, FoundUser>> => {
      const map = new Map<string, FoundUser>();
      if (uids.length === 0) return map;
      for (let i = 0; i < uids.length; i += 10) {
        const chunk = uids.slice(i, i + 10);
        try {
          const res = await usersAndGroupsClient.getVisibleGroupsForAccount({
            levelType: LEVEL_TYPE,
            levelId,
            uuid: chunk,
          });
          for (const g of res.results ?? []) {
            map.set(g.uuid, { uid: g.uuid, name: g.groupName, email: "" });
          }
        } catch {
          /* sin scope iam:groups:read o error: dejamos el uid crudo (fallback) */
        }
      }
      return map;
    },
    [levelId],
  );

  // Lee el estado de compartir del documento: ambos cubos + sus destinatarios,
  // ya resueltos a nombre/correo. Una persona en ambos cubos cuenta como Edición.
  const load = useCallback(async () => {
    if (!documentId) {
      // Modal cerrado / sin documento: LIMPIAR el estado. Si quedaran los
      // destinatarios del mapa anterior, al abrir Compartir en otro mapa esas
      // filas viejas se renderizaban clickeables durante la carga y un clic
      // concedía acceso EN EL MAPA EQUIVOCADO.
      loadTokenRef.current++;
      readShareRef.current = null;
      writeShareRef.current = null;
      setRecipients([]);
      setError(null);
      setInfo(null);
      setLoading(false);
      return;
    }
    const token = ++loadTokenRef.current;
    const current = () => token === loadTokenRef.current;
    setLoading(true);
    setError(null);
    readShareRef.current = null;
    writeShareRef.current = null;
    try {
      const list = await directSharesClient.listDirectShares({ filter: `documentId='${documentId}'` });
      const byRole = new Map<string, ShareRecipient>(); // uid → recipient (gana read-write)

      for (const share of list["direct-shares"] ?? []) {
        const role: ShareRole = isWriteShare(share.access) ? "read-write" : "read";
        if (role === "read-write") writeShareRef.current = share.id;
        else readShareRef.current = share.id;

        // Paginar: getDirectShareRecipients trae 20 por defecto → con >20
        // destinatarios algunos quedaban invisibles (y no se podían revocar).
        let pageKey: string | undefined;
        do {
          const recs = await directSharesClient.getDirectShareRecipients({ id: share.id, pageSize: 1000, pageKey });
          for (const r of recs.recipients) {
            const existing = byRole.get(r.id);
            // read-write tiene prioridad sobre read si la persona está en ambos.
            if (!existing || role === "read-write") {
              byRole.set(r.id, { uid: r.id, type: r.type, role, name: r.id, email: "" });
            }
          }
          pageKey = recs.nextPageKey;
        } while (pageKey);
      }

      // Resolver nombres: usuarios y grupos por separado (APIs IAM distintas).
      const recsList = [...byRole.values()];
      const userUids = [...new Set(recsList.filter((r) => r.type !== "group").map((r) => r.uid))];
      const groupUids = [...new Set(recsList.filter((r) => r.type === "group").map((r) => r.uid))];
      const [resolvedUsers, resolvedGroups] = await Promise.all([
        resolveUsers(userUids),
        resolveGroups(groupUids),
      ]);
      if (!current()) return; // documentId cambió o el modal se cerró: no pisar
      const merged = recsList.map((rec) => {
        const u = rec.type === "group" ? resolvedGroups.get(rec.uid) : resolvedUsers.get(rec.uid);
        return u ? { ...rec, name: u.name, email: u.email } : rec;
      });
      merged.sort((a, b) => a.name.localeCompare(b.name));
      setRecipients(merged);
    } catch {
      if (current()) setError(t("share.loadError"));
    } finally {
      if (current()) setLoading(false);
    }
  }, [documentId, resolveUsers, resolveGroups, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Busca personas Y grupos por una parte del correo/nombre. Mínimo 3 caracteres.
  // Las dos consultas van en paralelo y son independientes: si la de grupos
  // falla (p. ej. sin scope iam:groups:read) la de personas igual responde.
  const searchUsers = useCallback(
    async (partial: string): Promise<FoundUser[]> => {
      const q = partial.trim();
      if (q.length < 3) return [];
      // El PROPIETARIO no aparece en los resultados: compartirse a sí mismo
      // creaba un share redundante y lo mostraba duplicado en la lista.
      const ownEmail = owner.email.toLowerCase();

      const findPeople = async (): Promise<FoundUser[]> => {
        try {
          const res = await usersAndGroupsClient.getActiveUsersForOrganizationalLevel({
            levelType: LEVEL_TYPE,
            levelId,
            partialString: q,
            pageSize: 10,
          });
          return (res.results ?? [])
            .filter((u) => (u.email ?? "").toLowerCase() !== ownEmail)
            .map((u) => ({
              uid: u.uid,
              name: displayName(u.name, u.surname, u.email),
              email: u.email,
              type: "user" as const,
            }));
        } catch {
          return [];
        }
      };

      const findGroups = async (): Promise<FoundUser[]> => {
        try {
          const res = await usersAndGroupsClient.getVisibleGroupsForAccount({
            levelType: LEVEL_TYPE,
            levelId,
            partialGroupName: q,
            pageSize: 10,
          });
          return (res.results ?? []).map((g) => ({
            uid: g.uuid,
            name: g.groupName,
            email: "",
            type: "group" as const,
          }));
        } catch {
          return [];
        }
      };

      // Personas primero, grupos después.
      const [people, groups] = await Promise.all([findPeople(), findGroups()]);
      return [...people, ...groups];
    },
    [levelId, owner.email],
  );

  // Localiza en el backend el cubo (share) del rol pedido, si ya existe.
  const findShare = useCallback(
    async (role: ShareRole): Promise<string | null> => {
      if (!documentId) return null;
      const list = await directSharesClient.listDirectShares({ filter: `documentId='${documentId}'` });
      const wantWrite = role === "read-write";
      const m = (list["direct-shares"] ?? []).find((s) => isWriteShare(s.access) === wantWrite);
      return m?.id ?? null;
    },
    [documentId],
  );

  // Quita un sso-id de un cubo (si el cubo existe).
  const removeFrom = useCallback(async (shareId: string | null, uid: string) => {
    if (!shareId) return;
    await directSharesClient.removeDirectShareRecipients({ id: shareId, body: { ids: [uid] } });
  }, []);

  // Concede el acceso del rol a una persona: añade al cubo si existe, o lo crea.
  // Si el create falla porque el cubo ya existía (ShareAlreadyExists), lo busca y
  // añade ahí. `notify` controla el aviso por correo de esta operación.
  const grant = useCallback(
    async (role: ShareRole, entity: SsoEntity, notify: boolean) => {
      const ref = role === "read-write" ? writeShareRef : readShareRef;
      if (ref.current) {
        await directSharesClient.addDirectShareRecipients({
          id: ref.current,
          body: { recipients: [entity] },
          sendNotification: notify,
        });
        return;
      }
      try {
        const share = await directSharesClient.createDirectShare({
          body: { documentId: documentId as string, access: role, recipients: [entity] },
          sendNotification: notify,
        });
        ref.current = share.id;
      } catch (e) {
        const existing = await findShare(role);
        if (!existing) throw e;
        ref.current = existing;
        await directSharesClient.addDirectShareRecipients({
          id: existing,
          body: { recipients: [entity] },
          sendNotification: notify,
        });
      }
    },
    [documentId, findShare],
  );

  // Da (o cambia) el acceso de una persona. La deja en un solo rol.
  const assignAccess = useCallback(
    async (user: FoundUser, role: ShareRole, notify: boolean) => {
      if (!documentId) return;
      setBusy(true);
      setError(null);
      setInfo(null);
      // Respeta el tipo real del destinatario (un grupo no es un usuario). Por
      // defecto "user": el buscador por correo siempre crea usuarios.
      const entity: SsoEntity = { id: user.uid, type: user.type === "group" ? "group" : "user" };
      try {
        try {
          await grant(role, entity, notify);
        } catch (e) {
          // El acceso puede fallar por el AVISO por correo (algunos correos lo
          // rechazan). Lo importante es DAR EL ACCESO: reintentamos sin aviso.
          if (notify) {
            await grant(role, entity, false);
            setInfo(t("share.notifyWarn"));
          } else {
            throw e;
          }
        }
        // Mantener un solo rol: quitarlo del otro cubo. El acceso del rol pedido ya
        // se concedió. UPGRADE (read→read-write): "other" es el cubo de MENOR
        // privilegio; si la limpieza falla, el dedup ya muestra el rol más alto
        // pedido → inocuo (best-effort). DOWNGRADE (read-write→read): "other" es el
        // cubo de MAYOR privilegio; si NO se quita, la persona conserva edición y el
        // dedup lo oculta mostrando "Edición" → NO podemos tragarnos ese fallo: sería
        // un downgrade de privilegio perdido sin aviso. En ese caso lo relanzamos.
        const other = role === "read-write" ? readShareRef.current : writeShareRef.current;
        const isDowngrade = role === "read";
        try {
          await removeFrom(other, user.uid);
        } catch (e) {
          if (isDowngrade) throw e; // que lo reporte el catch externo (setError con detalle)
          /* upgrade: best-effort; el grant ya quedó y el dedup muestra el rol correcto */
        }
        await load();
      } catch (e) {
        const d = detailMsg(e);
        setError(d ? t("share.shareErrMsg", { detail: d }) : t("share.shareError"));
      } finally {
        setBusy(false);
      }
    },
    [documentId, grant, removeFrom, load, t],
  );

  // Revoca por completo el acceso de una persona (de ambos cubos).
  const revoke = useCallback(
    async (uid: string) => {
      setBusy(true);
      setError(null);
      setInfo(null);
      try {
        await removeFrom(readShareRef.current, uid);
        await removeFrom(writeShareRef.current, uid);
        await load();
      } catch (e) {
        const d = detailMsg(e);
        setError(d ? t("share.revokeErrMsg", { detail: d }) : t("share.revokeError"));
      } finally {
        setBusy(false);
      }
    },
    [removeFrom, load, t],
  );

  return { owner, recipients, loading, busy, error, info, searchUsers, assignAccess, revoke, reload: load };
};
