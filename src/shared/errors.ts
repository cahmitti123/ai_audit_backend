/**
 * Custom Error Classes
 * ====================
 * Structured error handling for the application
 */

/**
 * Base application error
 */
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Resource not found error
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    super(
      identifier
        ? `${resource} with ID '${identifier}' not found`
        : `${resource} not found`,
      404,
      "NOT_FOUND"
    );
  }
}

/**
 * Validation error
 */
export class ValidationError extends AppError {
  constructor(message: string, public details?: unknown) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

/**
 * External API error
 */
export class ExternalApiError extends AppError {
  constructor(
    public api: string,
    message: string,
    public originalError?: unknown
  ) {
    super(`${api} API error: ${message}`, 502, "EXTERNAL_API_ERROR");
  }
}

/**
 * Database error
 */
export class DatabaseError extends AppError {
  constructor(message: string, public originalError?: unknown) {
    super(`Database error: ${message}`, 500, "DATABASE_ERROR");
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends AppError {
  constructor(message: string = "Authentication failed") {
    super(message, 401, "AUTHENTICATION_ERROR");
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(`Configuration error: ${message}`, 500, "CONFIGURATION_ERROR");
  }
}
