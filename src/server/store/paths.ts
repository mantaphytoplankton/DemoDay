const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class InvalidIdError extends Error {
  override name = "InvalidIdError";
}

/** Evaluation ids become file names; only UUID v4 is accepted (path safety). */
export function assertEvaluationId(id: string): string {
  if (!UUID_RE.test(id)) throw new InvalidIdError("Invalid evaluation id");
  return id;
}

export function isEvaluationId(id: string): boolean {
  return UUID_RE.test(id);
}
