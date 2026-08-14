import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

export type FieldErrors = Record<string, string>;

export type FormResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldErrors };

/**
 * Flattens class-validator's tree into dotted paths, so a failure inside a line item
 * arrives as `items.0.name` rather than a bare `items` carrying no message. The parent key
 * also gets a human summary ("Line 2: Quantity must be greater than zero"), which is what
 * the PR and PO forms show above the repeater.
 */
function flatten(
  failures: ValidationError[],
  parentPath = '',
  errors: FieldErrors = {},
): FieldErrors {
  for (const failure of failures) {
    const path = parentPath
      ? `${parentPath}.${failure.property}`
      : failure.property;

    const messages = Object.values(failure.constraints ?? {});
    if (messages.length) {
      errors[path] = messages[0];
    }

    if (failure.children?.length) {
      flatten(failure.children, path, errors);

      if (!errors[path]) {
        const summary = summarize(failure);
        if (summary) errors[path] = summary;
      }
    }
  }

  return errors;
}

/** The first offending child, labelled by its line number when the parent is an array. */
function summarize(failure: ValidationError): string | null {
  for (const child of failure.children ?? []) {
    const index = Number(child.property);
    const label = Number.isInteger(index) ? `Line ${index + 1}: ` : '';

    const own = Object.values(child.constraints ?? {})[0];
    if (own) return `${label}${own}`;

    for (const grandchild of child.children ?? []) {
      const message = Object.values(grandchild.constraints ?? {})[0];
      if (message) return `${label}${message}`;
    }
  }

  return null;
}

/**
 * Validates a form body and returns field errors instead of throwing, so the controller can
 * re-render the form with the user's submitted values still in it. Getting this wrong means
 * users retype whole multi-line PRs after one bad field (Part 1c).
 */
export async function validateForm<T extends object>(
  cls: new () => T,
  body: unknown,
): Promise<FormResult<T>> {
  const instance = plainToInstance(cls, body ?? {}, {
    enableImplicitConversion: true,
  });

  const failures = await validate(instance, {
    whitelist: true,
    forbidUnknownValues: false,
  });

  if (!failures.length) {
    return { ok: true, data: instance };
  }

  return { ok: false, errors: flatten(failures) };
}
