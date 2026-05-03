export type NumericLike = string | number | null | undefined;

export function coerceNumber(value: unknown) {
  if (value === null || typeof value === "undefined") {
    return 0;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  if (typeof value === "object" && "valueOf" in value) {
    const primitive = value.valueOf();

    if (typeof primitive === "number" || typeof primitive === "string") {
      return Number(primitive);
    }
  }

  return Number(String(value));
}

export function coerceNullableNumber(value: unknown) {
  return value === null || typeof value === "undefined" ? null : coerceNumber(value);
}

export function coerceDateString(value: unknown) {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object" && "value" in value) {
    return String(value.value);
  }

  return String(value);
}
