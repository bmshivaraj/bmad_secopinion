/**
 * Cross-module API response envelope (AD-9). Every route handler returns one
 * of these shapes -- `error` is `null` on success, populated on failure.
 */
export interface ApiSuccess<T> {
  data: T;
  error: null;
}

export interface ApiErrorBody {
  code: string;
  message: string;
}

export interface ApiFailure {
  data: null;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(data: T): ApiSuccess<T> {
  return { data, error: null };
}

export function fail(code: string, message: string): ApiFailure {
  return { data: null, error: { code, message } };
}

/**
 * Base class for module-owned domain errors. Business logic throws typed
 * domain errors; only the route-handler boundary maps them to HTTP status
 * and an ApiFailure envelope (AD-9) -- business logic never throws raw HTTP
 * errors.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
