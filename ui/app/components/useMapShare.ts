import { useCallback, useEffect, useRef, useState } from "react";
import { directSharesClient, documentsClient } from "@dynatrace-sdk/client-document";
import { usersAndGroupsClient } from "@dynatrace-sdk/client-iam";
import type { SsoEntity } from "@dynatrace-sdk/client-document";
import { getCurrentUserDetails, getEnvironmentId } from "@dynatrace-sdk/app-environment";
import { useT } from "../i18n";
import {
  AnalystLabelError,
  MAX_ANALYSTS,
  httpStatus,
  planRoleChange,
  readAnalysts,
  resolveRole,
  runRoleChange,
  sameLabels,
  shareStartState,
  withAnalyst,
} from "./analystRole";
import type { ShareLevel } from "./analystRole";

// Compartir un mapa (un documento del Document service) con otras personas, al
// estilo del menú "Share" de Notebooks pero acotado a nuestro caso (Forma A):
//
//  • Quien comparte usa SUS PROPIOS permisos (la app no presta los suyos). Por
//    eso el que comparte necesita en su perfil `iam:users:read` (buscar persona)
//    y `document:direct-shares:*`. Quien RECIBE no necesita nada de esto.
//  • Se comparte escribiendo el CORREO de la persona; la app lo traduce al
//    sso-id interno por detrás (la API de shares trabaja con sso-id, no correo).
//  • Tres roles: "Solo lectura" (access "read"), "Analista" (access "read-write"
//    + label de analista, ver analystRole.ts) o "Edición" (access "read-write").
//
// Modelo del Document service (límite clave): un documento admite COMO MÁXIMO un
// share por tipo de acceso. Así que manejamos 2 "cubos" por mapa —uno de lectura
// y otro de edición— y movemos a la persona entre ellos. Una persona queda en un
// solo rol (el más alto): al darle "Edición" se la quita de "Solo lectura".
// El orden de los pasos de cada cambio de rol lo decide planRoleChange: ningún
// fallo a mitad de camino deja a alguien con más permisos de los debidos.

export type ShareRole = "read" | "analyst" | "read-write";

const LEVEL_OF: Record<ShareRole, ShareLevel> = { read: "viewer", analyst: "analyst", "read-write": "editor" };

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
  // Analistas según las labels del documento (al cargar) y si QUIEN COMPARTE es
  // analista de este mapa (entonces no puede cambiar accesos).
  const analystsRef = useRef<Set<string>>(new Set());
  const [locked, setLocked] = useState(false);
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
      analystsRef.current = new Set();
      setLocked(false);
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
      // Labels del documento → quién es analista; y el rol de quien comparte.
      const meta = await documentsClient.getDocumentMetadata({ id: documentId });
      const analysts = new Set(readAnalysts(meta.labels));
      const meLocked = resolveRole(meta, getCurrentUserDetails().id) === "analyst";
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
        // Edición + label de analista = Analista (solo personas).
        const role: ShareRole =
          rec.role === "read-write" && rec.type !== "group" && analysts.has(rec.uid) ? "analyst" : rec.role;
        return u ? { ...rec, role, name: u.name, email: u.email } : { ...rec, role };
      });
      merged.sort((a, b) => a.name.localeCompare(b.name));
      analystsRef.current = analysts;
      setLocked(meLocked);
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
    async (role: "read" | "read-write"): Promise<string | null> => {
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
    async (role: "read" | "read-write", entity: SsoEntity, notify: boolean) => {
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

  // Pone o quita a una persona en las labels de analista del documento. Lee la
  // metadata fresca y escribe con bloqueo optimista; si otro escribió en el medio
  // (409), relee y reintenta. No toca ninguna otra label.
  const setAnalystLabel = useCallback(
    async (uid: string, on: boolean) => {
      if (!documentId) return;
      for (let i = 0; i < 3; i++) {
        const meta = await documentsClient.getDocumentMetadata({ id: documentId });
        const next = withAnalyst(meta.labels, uid, on); // tooMany / badId: lanza
        if (sameLabels(meta.labels, next)) return; // ya estaba como se pide
        try {
          await documentsClient.updateDocument({
            id: documentId,
            optimisticLockingVersion: meta.version,
            body: { labels: next },
          });
          return;
        } catch (e) {
          if (httpStatus(e) !== 409) throw e;
        }
      }
      throw new Error("conflict");
    },
    [documentId],
  );

  // Mensaje del error de un cambio de rol (el tope de analistas tiene el suyo).
  const roleErrMsg = useCallback(
    (e: unknown, fallback: string, withDetail: string): string => {
      if (e instanceof AnalystLabelError && e.code === "tooMany") return t("share.analystLimit", { n: MAX_ANALYSTS });
      const d = detailMsg(e);
      return d ? t(withDetail, { detail: d }) : t(fallback);
    },
    [t],
  );

  // Ejecuta un cambio de rol con los pasos que decide planRoleChange.
  const changeRole = useCallback(
    async (entity: SsoEntity, to: ShareLevel, notify: boolean): Promise<void> => {
      const steps = planRoleChange(shareStartState(to, analystsRef.current.has(entity.id)), to);
      let notifyFailed = false;
      // El acceso puede fallar por el AVISO por correo (algunos correos lo
      // rechazan). Lo importante es DAR EL ACCESO: reintentamos sin aviso.
      const grantNotify = async (role: "read" | "read-write") => {
        try {
          await grant(role, entity, notify);
        } catch (e) {
          if (!notify) throw e;
          await grant(role, entity, false);
          notifyFailed = true;
        }
      };
      // Al bajar de Edición a Solo lectura, sacar del cubo de edición es
      // OBLIGATORIO (si no, conservaría edición sin aviso); al subir, sacar del de
      // lectura es limpieza (el rol más alto ya manda). planRoleChange lo marca así.
      const res = await runRoleChange(steps, {
        grantRead: () => grantNotify("read"),
        grantWrite: () => grantNotify("read-write"),
        removeRead: () => removeFrom(readShareRef.current, entity.id),
        removeWrite: () => removeFrom(writeShareRef.current, entity.id),
        addLabel: () => setAnalystLabel(entity.id, true),
        removeLabel: () => setAnalystLabel(entity.id, false),
      });
      if (notifyFailed) setInfo(t("share.notifyWarn"));
      if (!res.ok) throw res.error;
    },
    [grant, removeFrom, setAnalystLabel, t],
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
        // Analista es solo para personas: la app no puede saber quién es de un grupo.
        if (role === "analyst" && entity.type === "group") {
          setError(t("share.analystGroupOff"));
          return;
        }
        await changeRole(entity, LEVEL_OF[role], notify);
        await load();
      } catch (e) {
        // Se recarga ANTES de mostrar el error (load lo limpia al empezar): así la
        // lista refleja lo que sí alcanzó a cambiar y el aviso no se pierde.
        const msg = roleErrMsg(e, "share.shareError", "share.shareErrMsg");
        await load();
        setError(msg);
      } finally {
        setBusy(false);
      }
    },
    [documentId, changeRole, load, roleErrMsg, t],
  );

  // Revoca por completo el acceso de una persona (ambos cubos y su label).
  const revoke = useCallback(
    async (uid: string) => {
      setBusy(true);
      setError(null);
      setInfo(null);
      try {
        await changeRole({ id: uid, type: "user" }, "none", false); // quitar no depende del tipo
        await load();
      } catch (e) {
        const msg = roleErrMsg(e, "share.revokeError", "share.revokeErrMsg");
        await load();
        setError(msg);
      } finally {
        setBusy(false);
      }
    },
    [changeRole, load, roleErrMsg],
  );

  return { owner, recipients, loading, busy, error, info, locked, searchUsers, assignAccess, revoke, reload: load };
};
