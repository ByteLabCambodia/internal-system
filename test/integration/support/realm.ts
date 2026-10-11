/**
 * Jest runs each spec in a vm context but hands it the host's `structuredClone`, whose
 * copies carry the host realm's Object.prototype. Prisma clones a column's type params
 * that way and then checks `Object.getPrototypeOf(x) === Object.prototype`, so every
 * insert into an enum column failed under Jest ("pg/enum: typeName must be a string").
 * Plain Node is unaffected. Copy the clone's plain objects and arrays into this realm.
 */
const hostClone = globalThis.structuredClone;

function rehome<T>(value: T): T {
  if (Array.isArray(value)) return value.map(rehome) as T;
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === null || proto?.constructor?.name === 'Object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, rehome(item)]),
      ) as T;
    }
  }
  return value;
}

globalThis.structuredClone = ((
  value: unknown,
  options?: StructuredSerializeOptions,
) => rehome(hostClone(value, options))) as typeof structuredClone;
