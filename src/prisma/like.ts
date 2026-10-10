/** `%` and `_` in user input are literal text, not ILIKE wildcards. */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/** An ILIKE pattern matching `text` anywhere, with its wildcards escaped. */
export const contains = (text: string) => `%${escapeLike(text)}%`;
