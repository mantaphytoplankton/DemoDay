import { t, type MessageKey, type MessageVars } from "../i18n/t.ts";

/** Error code catalog (app-design.md section 5.3). HTTP status applies when the code is returned by the API. */
export const ERROR_CATALOG = {
  VALIDATION_FAILED: 400,
  ORIGIN_MISMATCH: 403,
  NOT_FOUND: 404,
  UNSUPPORTED_TYPE: 400,
  FILE_TOO_LARGE: 413,
  NOT_A_VIDEO: 400,
  EMPTY_FILE: 400,
  VIDEO_UNPROCESSABLE: 422,
  PROCESSING_TOO_LONG: 504,
  AI_UNAVAILABLE: 503,
  AI_REJECTED: 502,
  AI_BLOCKED: 422,
  INVALID_MODEL_OUTPUT: 502,
  RUBRIC_INVALID: 500,
  ABORTED: 409,
  INTERRUPTED: 409,
  STORE_CORRUPT: 500,
  INTERNAL: 500,
  INVALID_FOLDER_URL: 400,
  FOLDER_NOT_SHARED: 403,
  NO_TEAM_FOLDERS: 422,
  NO_VIDEO_IN_FOLDER: 422,
  DRIVE_PERMISSION_DENIED: 403,
  DRIVE_UNAVAILABLE: 503,
  DRIVE_NOT_CONFIGURED: 503,
  BATCH_ALREADY_RUNNING: 409,
  NOT_RUNNING: 409,
  NOT_RESUMABLE: 409,
  NOT_RETRYABLE: 409,
  VIDEO_TOO_LARGE: 413,
  OVERRIDE_NOTE_REQUIRED: 400,
  OVERRIDE_SCORE_INVALID: 400,
  NO_RESULT: 409,
  JOB_ACTIVE: 409,
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export function errorMessage(code: ErrorCode, vars?: MessageVars): string {
  return t(`error.${code}` as MessageKey, vars);
}

export function errorHelp(code: ErrorCode): string {
  const key = `help.${code}`;
  return key in HELP_KEYS ? t(key as MessageKey) : t("help.default");
}
const HELP_KEYS = { "help.VIDEO_UNPROCESSABLE": 1, "help.AI_UNAVAILABLE": 1, "help.RUBRIC_INVALID": 1, "help.DRIVE_PERMISSION_DENIED": 1, "help.NO_VIDEO_IN_FOLDER": 1, "help.DRIVE_UNAVAILABLE": 1, "help.VIDEO_TOO_LARGE": 1 };

export function httpStatus(code: ErrorCode): number {
  return ERROR_CATALOG[code];
}
