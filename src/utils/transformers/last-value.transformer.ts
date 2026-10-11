import { TransformFnParams } from 'class-transformer/types/interfaces';

/**
 * A checkbox paired with a hidden fallback (`<input type="hidden" name="active"
 * value="false">` then the checkbox with `value="true"`) posts the field twice when
 * ticked, which Express parses as `['false', 'true']`. The last value is the one the
 * user chose, so keep that.
 */
export const lastValueTransformer = ({ value }: TransformFnParams): unknown =>
  Array.isArray(value) ? value[value.length - 1] : value;
