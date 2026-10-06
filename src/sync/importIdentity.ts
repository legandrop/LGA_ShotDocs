export class ImportPending extends Error {
  constructor(public readonly reason: 'namespaceConflict' | 'legacy' | 'invalid' | 'changed' | 'unsaved' | 'mismatch', public readonly raw?: unknown) {
    super(`Import pending: ${reason}`);
  }
}

// Un Uint8Array que pasó por IndexedDB o por `structuredClone` puede venir de otro contexto de ejecución, donde
// `instanceof` da falso aunque sean los mismos bytes. Se reconoce por su marca interna, que no depende del contexto.
export const isBytes = (value: unknown): value is Uint8Array => ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]';

export function exactValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (isBytes(a) || isBytes(b)) return isBytes(a) && isBytes(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b) || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (Array.isArray(a) && a.length !== (b as unknown[]).length) return false;
  if (!Array.isArray(a) && Object.getPrototypeOf(a) !== Object.prototype && Object.getPrototypeOf(a) !== null) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => Object.hasOwn(b, k) && exactValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function plainRecord(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const proto = Object.getPrototypeOf(raw);
  if (proto === null) return true;
  if (Object.getPrototypeOf(proto) !== null) return false;
  const ctor = Object.getOwnPropertyDescriptor(proto, 'constructor')?.value;
  return typeof ctor === 'function' && ctor.prototype === proto
    && Function.prototype.toString.call(ctor) === Function.prototype.toString.call(Object);
}

export const validUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const projectReceiptKey = (operationId: string) => `importProject1:${operationId}`;
export const projectOwnerKey = (projectId: string) => `importProjectOwner1:${projectId}`;
export interface ProjectIdentity { projectId: string; operationId: string; projectName: string }

export function matchesProjectIdentity(receipt: unknown, owner: unknown, identity: ProjectIdentity): boolean {
  if (!plainRecord(receipt) || !plainRecord(owner) || !plainRecord(receipt.op) || !plainRecord(receipt.op.project)) return false;
  return ['receiptVersion', 'opId', 'seq', 'op'].every(k => Object.hasOwn(receipt, k))
    && ['ownerVersion', 'projectId', 'operationId'].every(k => Object.hasOwn(owner, k))
    && receipt.receiptVersion === 1 && owner.ownerVersion === 1
    && validUuid(receipt.opId) && receipt.opId === identity.operationId
    && owner.operationId === identity.operationId && owner.projectId === identity.projectId
    && validUuid(owner.operationId) && validUuid(owner.projectId)
    && Number.isSafeInteger(receipt.seq) && (receipt.seq as number) > 0
    && exactValue(receipt.op, { kind: 'createProject', project: { id: identity.projectId, name: identity.projectName } });
}
